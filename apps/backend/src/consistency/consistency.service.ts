import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { countWords, htmlToParagraphs, stripHtml } from '../common/text.utils';

/**
 * 一致性引擎五层（plan §5）。
 * L1 事实抽取（/extract）→ 入库；L2 确定性规则；L3 图谱推理；L4 LLM 语义；L5 反馈学习。
 * L1-L3 零 LLM 成本、毫秒级；L4 调模型；L5 据 resolve 调整 Rule.weight。
 */

const DEAD_VALUES = ['死亡', '已死', '陨落', '阵亡', '身亡', '故去'];
// 归一后修为统一存「境界」，规则只认这一个 key。
const MONOTONIC_ATTRS = ['境界'];
// 抽取属性名归一（修复"修为/等级/境界"三套并存击穿规则的问题）。
const ATTR_CANON: Record<string, string> = {
  修为: '境界', 修为等级: '境界', 等级: '境界', 境界: '境界', 实力: '境界', 实力境界: '境界',
  身体: '身体', 身体伤势: '身体', 伤势: '身体', 状态: '状态',
  位置: '位置', 情绪: '情绪', 持有者: '持有者',
};
// 元指代/泛称，绝不应入库为实体（曾出现"读者"被当 character 注入信息流约束）。
const META_NAMES = new Set(['读者', '读者们', '作者', '笔者', '旁白', '叙述者', '众人', '所有人', '大家', '某人', '我', '你', '他', '她', '它']);

interface RawIssue {
  layer: 'L2' | 'L3' | 'L4';
  severity: 'high' | 'medium' | 'low';
  type: string;
  entities: string[];
  evidence?: string;
  conflictWith?: string;
  suggestion?: string;
  confidence: number;
  autoFixable?: boolean;
}

@Injectable()
export class ConsistencyService {
  private readonly logger = new Logger(ConsistencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /** L1：抽取章节事实并入库（返回抽取结果）。 */
  async extractAndStore(chapterId: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);
    const content = htmlToParagraphs(chapter.content).join('\n\n');
    if (!content.trim()) return null;

    const known = await this.prisma.entity.findMany({
      where: { novelId: chapter.novelId },
      select: { name: true },
    });

    const res: any = await this.ai.loggedJsonSilent('extract', chapter.novelId, '/extract', {
      title: chapter.title,
      content,
      knownEntities: known.map((e) => e.name),
    });
    const facts = res?.result ?? null;
    if (!facts) return null;

    // new_entities
    for (const ne of facts.new_entities ?? []) {
      if (!ne?.name) continue;
      await this.findOrCreateEntity(chapter.novelId, ne.name, normalizeType(ne.type), ne.description);
    }

    // state_changes
    for (const sc of facts.state_changes ?? []) {
      if (!sc?.entity || !sc?.attr) continue;
      const ent = await this.findOrCreateEntity(chapter.novelId, sc.entity, 'character');
      if (!ent) continue;
      await this.upsertState(ent.id, chapterId, canonAttr(String(sc.attr)), sc.value, sc.evidence ?? null);
    }

    // events
    for (const ev of facts.events ?? []) {
      await this.prisma.event.create({
        data: {
          novelId: chapter.novelId,
          chapterId,
          type: String(ev.type ?? '事件'),
          participants: JSON.stringify(ev.participants ?? []),
          location: ev.location ?? null,
          result: ev.result ?? null,
          causes: JSON.stringify(ev.causes ?? []),
        },
      });
    }

    // relation_changes
    for (const rc of facts.relation_changes ?? []) {
      if (!rc?.subject || !rc?.object || !rc?.type) continue;
      const s = await this.findOrCreateEntity(chapter.novelId, rc.subject, 'character');
      const o = await this.findOrCreateEntity(chapter.novelId, rc.object, 'character');
      if (!s || !o) continue;
      await this.prisma.relation.create({
        data: {
          novelId: chapter.novelId,
          subjectId: s.id,
          objectId: o.id,
          type: String(rc.type),
          validFromChapter: chapter.order,
          attributes: JSON.stringify(rc.strength != null ? { strength: rc.strength } : {}),
        },
      });
    }

    // foreshadow_triggers
    for (const ft of facts.foreshadow_triggers ?? []) {
      if (!ft?.title) continue;
      const existing = await this.prisma.foreshadow.findFirst({ where: { novelId: chapter.novelId, title: ft.title } });
      if (existing) {
        if (ft.action === 'payoff') {
          await this.prisma.foreshadow.update({ where: { id: existing.id }, data: { status: 'paid_off', payoffChapter: chapter.order } });
        }
      } else {
        await this.prisma.foreshadow.create({
          data: {
            novelId: chapter.novelId,
            title: ft.title,
            setupChapter: ft.action === 'setup' ? chapter.order : null,
            payoffChapter: ft.action === 'payoff' ? chapter.order : null,
            status: ft.action === 'payoff' ? 'paid_off' : 'setup',
          },
        });
      }
    }

    // character_states：角色当前状态（位置/情绪/身体/等级）→ EntityState（归一 + 去重）
    for (const cs of facts.character_states ?? []) {
      if (!cs?.entity) continue;
      const ent = await this.findOrCreateEntity(chapter.novelId, String(cs.entity), 'character');
      if (!ent) continue;
      for (const attr of ['位置', '情绪', '身体', '等级', '修为']) {
        const v = (cs as any)[attr];
        if (v) await this.upsertState(ent.id, chapterId, canonAttr(attr), v, null);
      }
    }

    // item_transfers：道具易主 → EntityState(item, 持有者)
    for (const it of facts.item_transfers ?? []) {
      if (!it?.item) continue;
      const item = await this.findOrCreateEntity(chapter.novelId, String(it.item), 'item');
      const toEntity = it.to ? await this.findOrCreateEntity(chapter.novelId, String(it.to), 'character') : null;
      if (item && toEntity) {
        await this.upsertState(item.id, chapterId, '持有者', String(toEntity.id), null);
      }
    }

    // information_changes：信息流知情者更新（learner 为元指代如"读者"则跳过，防伪角色污染）
    for (const ic of facts.information_changes ?? []) {
      if (!ic?.content || !ic?.learner) continue;
      const learner = await this.findOrCreateEntity(chapter.novelId, String(ic.learner), 'character');
      if (!learner) continue;
      let info = await this.prisma.information.findFirst({ where: { novelId: chapter.novelId, content: String(ic.content) } });
      if (!info) {
        info = await this.prisma.information.create({
          data: { novelId: chapter.novelId, content: String(ic.content), importance: 'normal' },
        });
      }
      let knowers: { entityId: number; sinceChapter: number }[] = [];
      try { knowers = JSON.parse(info.knowers ?? '[]'); } catch { knowers = []; }
      if (ic.action === 'forget') {
        knowers = knowers.filter((k) => k.entityId !== learner.id);
      } else {
        if (!knowers.some((k) => k.entityId === learner.id)) knowers.push({ entityId: learner.id, sinceChapter: chapter.order });
      }
      await this.prisma.information.update({ where: { id: info.id }, data: { knowers: JSON.stringify(knowers) } });
    }

    return facts;
  }

  /** 全量检查（L1→L4），结果落 ConsistencyIssue。 */
  async checkChapter(chapterId: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);

    await this.seedRules(chapter.novelId);
    await this.extractAndStore(chapterId);

    const facts = { participants: await this.chapterParticipants(chapterId) };
    const l2 = await this.l2Rules(chapter, facts);
    const l3 = await this.l3Graph(chapter);
    const l4 = await this.l4Semantic(chapter);

    // L4 语义层易误报：丢弃低置信问题（L1-L3 为确定性规则，全部保留）。
    const all = [...l2, ...l3, ...l4].filter((i) => !(i.layer === 'L4' && i.confidence < 0.55));

    // 覆盖该章节旧问题
    await this.prisma.consistencyIssue.deleteMany({ where: { novelId: chapter.novelId, location: { contains: `"chapterId":${chapterId}` } } });
    for (const issue of all) {
      await this.prisma.consistencyIssue.create({
        data: {
          novelId: chapter.novelId,
          layer: issue.layer,
          severity: issue.severity,
          type: issue.type,
          entities: JSON.stringify(issue.entities),
          location: JSON.stringify({ chapterId }),
          evidence: issue.evidence ?? null,
          conflictWith: issue.conflictWith ?? null,
          suggestion: issue.suggestion ?? null,
          confidence: issue.confidence,
          autoFixable: issue.autoFixable ?? false,
          status: 'open',
        },
      });
    }
    return all;
  }

  listIssues(novelId: number) {
    return this.prisma.consistencyIssue.findMany({ where: { novelId }, orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }] });
  }

  /** 本章抽取产生的变化（plan 深化方案 §4 Tab3「生成后变化」）。 */
  async chapterChanges(chapterId: number) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);

    const [states, events, issues, relations, infos, itemStates, entities] = await Promise.all([
      this.prisma.entityState.findMany({ where: { chapterId } }),
      this.prisma.event.findMany({ where: { chapterId } }),
      this.prisma.consistencyIssue.findMany({ where: { novelId: chapter.novelId, location: { contains: `"chapterId":${chapterId}` } } }),
      this.prisma.relation.findMany({ where: { novelId: chapter.novelId, validFromChapter: chapter.order } }),
      this.prisma.information.findMany({ where: { novelId: chapter.novelId } }),
      this.prisma.entityState.findMany({ where: { chapterId, attrName: { in: ['持有者', '状态'] } } }),
      this.prisma.entity.findMany({ where: { novelId: chapter.novelId }, select: { id: true, name: true } }),
    ]);
    const name = (id: number) => entities.find((e) => e.id === id)?.name ?? `#${id}`;

    const stateChanges = states
      .filter((s) => !['持有者', '状态'].includes(s.attrName))
      .map((s) => ({ entity: name(s.entityId), attr: s.attrName, value: s.value }));
    const itemTransfers = itemStates
      .filter((s) => s.attrName === '持有者')
      .map((s) => ({ item: name(s.entityId), holder: name(Number(s.value)) }));
    const relationChanges = relations.map((r) => ({ subject: name(r.subjectId), object: name(r.objectId), type: r.type }));
    const information = infos
      .filter((i) => {
        try { return JSON.parse(i.knowers ?? '[]').some((k: any) => k.sinceChapter === chapter.order); } catch { return false; }
      })
      .map((i) => {
        let knowers: any[] = [];
        try { knowers = JSON.parse(i.knowers ?? '[]'); } catch { knowers = []; }
        const newKnowers = knowers.filter((k) => k.sinceChapter === chapter.order).map((k) => name(k.entityId));
        return { content: i.content, learners: newKnowers };
      });

    return {
      analyzed: true,
      counts: { states: stateChanges.length, events: events.length, items: itemTransfers.length, relations: relationChanges.length, info: information.length, issues: issues.length },
      stateChanges,
      events: events.map((e) => ({ type: e.type, result: e.result, participants: safeJsonArr(e.participants) })),
      itemTransfers,
      relationChanges,
      information,
      issues: issues.map((i) => ({ id: i.id, layer: i.layer, severity: i.severity, type: i.type, suggestion: i.suggestion, status: i.status })),
    };
  }

  /** L5：用户 resolve（resolved/ignored/intentional）→ 据假正例率调整该类规则权重。 */
  async resolveIssue(id: number, status: 'resolved' | 'ignored' | 'intentional') {
    const issue = await this.prisma.consistencyIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException(`Issue ${id} not found`);
    const updated = await this.prisma.consistencyIssue.update({ where: { id }, data: { status } });

    // 按规则类型聚合：被忽略/标记有意的比例越高 → 权重越低
    const siblings = await this.prisma.consistencyIssue.findMany({ where: { novelId: issue.novelId, type: issue.type } });
    const flagged = siblings.filter((s) => s.status === 'ignored' || s.status === 'intentional').length;
    const rate = siblings.length ? flagged / siblings.length : 0;
    const weight = Math.max(0.2, 1 - rate);
    await this.prisma.rule.updateMany({ where: { novelId: issue.novelId, name: issue.type }, data: { weight } });
    return { updated, weight };
  }

  /** AI 一键修复：据 evidence+suggestion 改写问题段落，替换章节正文，标记已解决。 */
  async fixIssue(id: number) {
    const issue = await this.prisma.consistencyIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException(`Issue ${id} not found`);
    if (!issue.evidence || !issue.suggestion) {
      return { success: false, message: '该问题缺少原文证据或修改建议，无法自动修复' };
    }

    // 从 location JSON 提取 chapterId
    const locMatch = issue.location?.match(/"chapterId":(\d+)/);
    const chapterId = locMatch ? Number(locMatch[1]) : null;
    if (!chapterId) {
      return { success: false, message: '无法定位问题所在章节' };
    }

    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      return { success: false, message: '章节不存在' };
    }

    // 调 ai-service 修正
    const context = htmlToParagraphs(chapter.content).join('\n').slice(0, 2000);
    const result: any = await this.ai.jsonRequest('/fix-issue', {
      evidence: issue.evidence,
      suggestion: issue.suggestion,
      context,
    });
    const fixedText = result?.content ?? '';
    if (!fixedText.trim()) {
      return { success: false, message: 'AI 未返回修正结果' };
    }

    // 段落级替换：在 <p> 块里按"纯文本包含"定位（避免 HTML 标签干扰导致直替失败）。
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const plainEvidence = stripHtml(issue.evidence).replace(/\s+/g, '');
    const probe = plainEvidence.slice(0, Math.min(24, plainEvidence.length));
    let newContent = chapter.content;
    let replaced = false;

    const blocks = chapter.content.match(/<p>[\s\S]*?<\/p>/gi) || [];
    if (probe && blocks.length) {
      for (const b of blocks) {
        if (stripHtml(b).replace(/\s+/g, '').includes(probe)) {
          newContent = newContent.replace(b, `<p>${esc(fixedText.trim())}</p>`);
          replaced = true;
          break;
        }
      }
    }
    // 回退：原始 evidence 直接子串替换
    if (!replaced) {
      const raw = issue.evidence.trim();
      if (raw && chapter.content.includes(raw)) {
        newContent = chapter.content.replace(raw, esc(fixedText.trim()));
        replaced = true;
      }
    }
    if (!replaced) {
      return { success: false, message: '未在正文中定位到问题段落，请手动修复' };
    }

    // ① 修复前自动快照（可回滚）
    const snapshot = await this.prisma.chapterSnapshot.create({
      data: { chapterId, content: chapter.content, wordCount: chapter.wordCount, reason: 'pre-fix' },
    });

    // ② 保存 + 重算字数 + 标记已解决
    const updated = await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { content: newContent, wordCount: countWords(newContent) },
    });
    await this.prisma.consistencyIssue.update({ where: { id }, data: { status: 'resolved' } });

    // ③ 修复后自动复查（fire-and-forget，检测修复是否引入新矛盾）
    this.checkChapter(chapterId).catch(() => undefined);

    return { success: true, message: '已自动修复并替换正文（修复前已存快照，可回滚）', wordCount: updated.wordCount, snapshotId: snapshot.id };
  }

  // ================= 各层实现 =================

  private async l2Rules(chapter: any, facts: { participants: { entityId: number; name: string }[] }): Promise<RawIssue[]> {
    const issues: RawIssue[] = [];

    // 规则②：已死角色不可行动
    const dead = await this.prisma.entityState.findMany({
      where: { value: { in: DEAD_VALUES } },
    });
    const deadIds = new Set(dead.map((d) => d.entityId));
    for (const p of facts.participants) {
      if (deadIds.has(p.entityId)) {
        issues.push({
          layer: 'L2', severity: 'high', type: '已死角色行动',
          entities: [p.name], confidence: 0.95, autoFixable: false,
          evidence: `${p.name} 在本章行动`,
          conflictWith: '该角色此前已标记为死亡',
          suggestion: '补充复活设定，或修正为其他角色',
        });
      }
    }

    // 规则①：修为/境界倒退
    const states = await this.prisma.entityState.findMany({
      where: { attrName: { in: MONOTONIC_ATTRS } },
      orderBy: { chapterId: 'asc' },
    });
    const byEntity = new Map<number, typeof states>();
    for (const s of states) {
      if (!byEntity.has(s.entityId)) byEntity.set(s.entityId, []);
      byEntity.get(s.entityId)!.push(s);
    }
    for (const [entityId, hist] of byEntity) {
      if (hist.length < 3) continue;
      const recent = hist[hist.length - 1];
      const prev = hist[hist.length - 2];
      const earlierValues = hist.slice(0, -2).map((h) => h.value);
      if (recent.value && prev.value && recent.value !== prev.value && earlierValues.includes(recent.value)) {
        const ent = await this.prisma.entity.findUnique({ where: { id: entityId } });
        issues.push({
          layer: 'L2', severity: 'medium', type: '修为境界倒退',
          entities: [ent?.name ?? `#${entityId}`], confidence: 0.6,
          evidence: recent.evidence ?? undefined,
          conflictWith: `此前为「${prev.value}」`,
          suggestion: '确认是否倒退，若非有意需补充解释',
        });
      }
    }

    // 规则⑤：道具持有者必须健在；规则③：销毁道具不再现（plan §2.2）
    const orderMap = await this.orderMap(chapter.novelId);
    const beforeOrder = chapter.order;
    const items = await this.prisma.entity.findMany({ where: { novelId: chapter.novelId, type: 'item' } });
    const holderStates = await this.prisma.entityState.findMany({
      where: { entityId: { in: items.map((i) => i.id) }, attrName: '持有者' },
    });
    const holderByItem = new Map<number, { holderId: number; order: number }>();
    for (const s of holderStates) {
      const o = orderMap.get(s.chapterId) ?? 0;
      if (o >= beforeOrder) continue;
      const cur = holderByItem.get(s.entityId);
      if (!cur || o >= cur.order) holderByItem.set(s.entityId, { holderId: Number(s.value), order: o });
    }
    for (const [itemId, { holderId }] of holderByItem) {
      if (deadIds.has(holderId)) {
        const item = items.find((i) => i.id === itemId);
        const holder = await this.prisma.entity.findUnique({ where: { id: holderId } });
        issues.push({
          layer: 'L2', severity: 'high', type: '道具持有者已死',
          entities: [item?.name ?? `#${itemId}`, holder?.name ?? `#${holderId}`], confidence: 0.9,
          evidence: `「${item?.name}」的持有者「${holder?.name}」已标记死亡`,
          suggestion: '补充道具易主事件，或修正持有关系',
        });
      }
    }
    const destroyedStates = await this.prisma.entityState.findMany({
      where: { attrName: '状态', value: { in: ['销毁', '已销毁', '损毁', '消失'] } },
    });
    const destroyedNames = new Set<string>();
    for (const ds of destroyedStates) {
      const o = orderMap.get(ds.chapterId) ?? 0;
      if (o < beforeOrder) {
        const ent = await this.prisma.entity.findUnique({ where: { id: ds.entityId } });
        if (ent) destroyedNames.add(ent.name);
      }
    }
    const content = htmlToParagraphs(chapter.content).join('');
    for (const name of destroyedNames) {
      if (content.includes(name)) {
        issues.push({
          layer: 'L2', severity: 'medium', type: '销毁道具再现',
          entities: [name], confidence: 0.7,
          evidence: `本章再次出现「${name}」`, conflictWith: '该道具此前已销毁',
          suggestion: '确认是否有修复/重铸交代',
        });
      }
    }

    return issues;
  }

  /** L3：关系冲突（同一对实体存在互斥关系且无过渡交代）。 */
  private async l3Graph(chapter: any): Promise<RawIssue[]> {
    const issues: RawIssue[] = [];
    const orderMap = await this.orderMap(chapter.novelId);

    // 因果链：事件声明的 causes 须能在更早事件中找到（plan 深化方案 §2.3 DAG）
    const events = await this.prisma.event.findMany({ where: { novelId: chapter.novelId }, orderBy: { id: 'asc' } });
    for (const ev of events) {
      let causes: string[] = [];
      try { causes = JSON.parse(ev.causes ?? '[]'); } catch { causes = []; }
      if (!causes.length) continue;
      const evOrder = orderMap.get(ev.chapterId ?? -1) ?? -1;
      // 首章(order 0)的 causes 多为背景回溯，本就无前置事件，跳过以降噪。
      if (evOrder <= 0) continue;
      for (const c of causes) {
        const matched = events.some((e) => {
          const o = orderMap.get(e.chapterId ?? -1) ?? -1;
          if (o >= evOrder) return false;
          const hay = `${e.type}${e.result ?? ''}`;
          return hay.includes(c) || c.includes(e.type);
        });
        if (!matched) {
          issues.push({
            layer: 'L3', severity: 'low', type: '因果链断裂', entities: [], confidence: 0.5,
            evidence: `事件「${ev.type}」依赖的因果「${c}」未见前置事件`,
            suggestion: '补充前置情节，或修正因果标注',
          });
          break;
        }
      }
    }

    const conflictPairs = new Set(['师父', '父亲', '母亲']); // 与 敌对 互斥示意
    const relations = await this.prisma.relation.findMany({ where: { novelId: chapter.novelId } });
    const byPair = new Map<string, typeof relations>();
    for (const r of relations) {
      const key = `${r.subjectId}-${r.objectId}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key)!.push(r);
    }
    for (const [key, rels] of byPair) {
      const types = new Set(rels.map((r) => r.type));
      const hasClose = [...types].some((t) => conflictPairs.has(t));
      const hasHostile = [...types].some((t) => /敌|仇|对手/.test(t));
      if (hasClose && hasHostile) {
        const [sid, oid] = key.split('-').map(Number);
        const s = await this.prisma.entity.findUnique({ where: { id: sid } });
        const o = await this.prisma.entity.findUnique({ where: { id: oid } });
        issues.push({
          layer: 'L3', severity: 'medium', type: '关系冲突',
          entities: [s?.name ?? `#${sid}`, o?.name ?? `#${oid}`], confidence: 0.7,
          evidence: `关系：${[...types].join('、')}`,
          suggestion: '补充关系转变的情节交代',
        });
      }
    }
    return issues;
  }

  /** L4：LLM 语义层（软矛盾）。 */
  private async l4Semantic(chapter: any): Promise<RawIssue[]> {
    const novel = await this.prisma.novel.findUnique({ where: { id: chapter.novelId } });
    const characters = await this.prisma.entity.findMany({ where: { novelId: chapter.novelId, type: 'character' }, take: 10 });
    const rules = await this.prisma.rule.findMany({ where: { novelId: chapter.novelId, enabled: true } });
    const recentStates = await this.prisma.entityState.findMany({
      where: { chapterId: { lt: chapter.id } },
      orderBy: { chapterId: 'desc' },
      take: 20,
    });
    const priorContext = recentStates.map((s) => `${s.attrName}=${s.value}`).join('；');

    try {
      const res: any = await this.ai.loggedJsonSilent('consistency-check', chapter.novelId, '/consistency-check', {
        title: novel?.title,
        genre: novel?.genre ?? undefined,
        worldviewText: novel?.worldviewText ?? undefined,
        chapterTitle: chapter.title,
        content: htmlToParagraphs(chapter.content).join('\n\n'),
        priorContext: priorContext || undefined,
        characters: characters.map((c) => ({ name: c.name, description: c.description })),
        rules: rules.map((r) => `${r.name}：${r.description}`),
      });
      const arr = res?.result?.issues ?? [];
      return (arr as any[]).map((i) => ({
        layer: 'L4' as const,
        severity: (i.severity ?? 'medium') as 'high' | 'medium' | 'low',
        type: String(i.type ?? '语义问题'),
        entities: [] as string[],
        evidence: i.evidence_quote ?? i.explanation,
        conflictWith: i.explanation,
        suggestion: i.suggestion,
        confidence: Number(i.confidence ?? 0.6),
        autoFixable: false,
      }));
    } catch (e) {
      this.logger.warn(`L4 语义检查失败：${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  // ================= 辅助 =================

  private async chapterParticipants(chapterId: number) {
    const events = await this.prisma.event.findMany({ where: { chapterId }, select: { participants: true } });
    const names = new Set<string>();
    for (const ev of events) {
      try {
        for (const p of JSON.parse(ev.participants)) names.add(String(p));
      } catch {
        /* ignore */
      }
    }
    const out: { entityId: number; name: string }[] = [];
    for (const name of names) {
      const ent = await this.prisma.entity.findFirst({ where: { name } });
      if (ent) out.push({ entityId: ent.id, name });
    }
    return out;
  }

  /** 规范化名称 + 去重；元指代/无效名返回 null（调用方需跳过）。 */
  private async findOrCreateEntity(novelId: number, rawName: string, type: string, description?: string) {
    const name = cleanEntityName(rawName);
    if (!name) return null;
    const existing = await this.prisma.entity.findFirst({ where: { novelId, name } });
    if (existing) return existing;
    return this.prisma.entity.create({
      data: { novelId, name, type, description: description ?? null },
    });
  }

  /** EntityState 去重写入：同(实体,章,属性)已存在则更新，避免一章内同属性多条。 */
  private async upsertState(entityId: number, chapterId: number, attrName: string, value: unknown, evidence: string | null = null) {
    const v = String(value ?? '');
    const existing = await this.prisma.entityState.findFirst({ where: { entityId, chapterId, attrName } });
    if (existing) {
      await this.prisma.entityState.update({ where: { id: existing.id }, data: { value: v, evidence } });
    } else {
      await this.prisma.entityState.create({ data: { entityId, chapterId, attrName, value: v, evidence } });
    }
  }

  private async orderMap(novelId: number): Promise<Map<number, number>> {
    const chapters = await this.prisma.chapter.findMany({ where: { novelId }, select: { id: true, order: true } });
    return new Map(chapters.map((c) => [c.id, c.order]));
  }

  private async seedRules(novelId: number) {
    const count = await this.prisma.rule.count({ where: { novelId } });
    if (count > 0) return;
    const defaults = [
      ['修为不可倒退', '修炼境界/等级应单调不退（除有明确被废情节）'],
      ['已死角色不可行动', '已标记死亡的角色不应再行动，除非有复活设定'],
      ['被销毁道具不可再现', '已销毁/消耗的道具不应无交代地再次出现'],
      ['同一时刻一人一地', '同一时间点一个角色不应出现在两个互斥地点'],
      ['唯一道具不可多人持有', '唯一性道具不应同时被多人持有'],
      ['道具持有者必须健在', '道具持有者死亡后须有显式易主事件'],
      ['称呼一致', 'A 对 B 的称呼一旦确立不应无故突变'],
      ['地理可达', '跨地点移动须有合理时间间隔'],
      ['时序逻辑', '事件 B 依赖 A，则 B 不能早于 A'],
    ];
    await this.prisma.rule.createMany({
      data: defaults.map(([name, desc]) => ({ novelId, name, description: desc, layer: 'L2', enabled: true, weight: 1.0 })),
    });
  }
}

/** 属性名归一（修为/等级/境界→境界 等）。 */
function canonAttr(a: string): string {
  const k = (a ?? '').trim();
  return ATTR_CANON[k] ?? k;
}

/** 实体名规范化：去括号注释/书名号/引号；元指代或异常名返回 null。 */
function cleanEntityName(raw?: string): string | null {
  if (raw == null) return null;
  let n = String(raw).trim();
  n = n.replace(/[（(][^）)]*[）)]/g, ''); // 去「（被熔炼消解）」「（内含…）」等注释
  n = n.replace(/^[「『"'《]+|[」』"'》]+$/g, '').trim();
  n = n.replace(/[，。、,.!！?？;；:：]+$/g, '').trim();
  if (!n) return null;
  if (n.length > 16) return null; // 过长疑似句子/描述，非实体名
  if (META_NAMES.has(n)) return null;
  return n;
}

function normalizeType(t?: string): string {
  const s = (t ?? '').trim();
  if (/角色|人物|主角|配角/.test(s)) return 'character';
  if (/地点|场景|城市|位置/.test(s)) return 'location';
  if (/组织|势力|门派|宗门|帮/.test(s)) return 'organization';
  if (/道具|法宝|武器|物品/.test(s)) return 'item';
  if (/功法|能力|体系|境界/.test(s)) return 'power_system';
  return 'character';
}

function safeJsonArr(s: string | null): string[] {
  try {
    const v = JSON.parse(s ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
