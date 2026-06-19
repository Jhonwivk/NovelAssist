'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Bot, Check, Copy, EyeOff, Library, Plus, Send, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { apiClient, streamSse } from '@/lib/api';
import { Avatar, Badge, Button, Card, EmptyState, SegmentedControl, Select, Spinner, TextArea, TextInput, Tooltip, toast } from './ui';
import { IssueCard, SEV_META, chapterIdOf } from './issue-card';

// =================== 一致性面板 ===================

export function ConsistencyPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const { data: issues, isLoading } = useQuery({
    queryKey: ['issues', novelId],
    queryFn: () => apiClient.listIssues(novelId),
    refetchInterval: analyzingAll ? 3000 : false,
  });
  const { data: chapters } = useQuery({
    queryKey: ['novel', novelId],
    queryFn: () => apiClient.getNovel(novelId),
  });
  const analyzeAll = useMutation({
    mutationFn: () => apiClient.analyzeAll(novelId),
    onMutate: () => setAnalyzingAll(true),
    onSuccess: (r) => { setAnalyzingAll(false); qc.invalidateQueries({ queryKey: ['issues', novelId] }); qc.invalidateQueries({ queryKey: ['bible', novelId] }); toast.success(`已分析 ${r.analyzed}/${r.total} 章${r.failed ? `（${r.failed} 章失败）` : ''}`); },
    onError: () => { setAnalyzingAll(false); toast.error('分析失败'); },
  });
  const check = useMutation({
    mutationFn: (cid: number) => apiClient.consistencyCheck(cid),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['issues', novelId] }); toast.success(`检查完成，发现 ${Array.isArray(r) ? r.length : 0} 个问题`); },
    onError: () => toast.error('检查失败'),
  });
  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'resolved' | 'ignored' | 'intentional' }) =>
      apiClient.resolveIssue(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues', novelId] }),
  });
  const fix = useMutation({
    mutationFn: (id: number) => apiClient.fixIssue(id),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['issues', novelId] }); r?.success ? toast.success(r.message) : toast.error(r?.message ?? '修复失败'); },
    onError: () => toast.error('修复请求失败'),
  });

  const chapterList = chapters?.chapters ?? [];
  const latest = chapterList[chapterList.length - 1];

  const open = (issues ?? []).filter((i) => i.status === 'open')
    .sort((a, b) => (SEV_META[a.severity]?.rank ?? 9) - (SEV_META[b.severity]?.rank ?? 9));
  const counts = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const i of open) counts[i.severity] = (counts[i.severity] ?? 0) + 1;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-primary" />一致性检查</h3>
          <span className="text-xxs text-fg-faint">L1 抽取 · L2 规则 · L3 图谱 · L4 语义 · L5 反馈</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" icon={ShieldCheck} loading={check.isPending} disabled={!latest || check.isPending || analyzingAll} onClick={() => latest && check.mutate(latest.id)}>
            {check.isPending ? '检查中…' : '检查最新章'}
          </Button>
          <Button variant="secondary" size="sm" icon={Library} loading={analyzingAll} disabled={analyzingAll || chapterList.length === 0} onClick={() => analyzeAll.mutate()}>
            {analyzingAll ? `分析全书…（${open.length} 问题）` : '分析全书'}
          </Button>
        </div>
      </div>

      {analyzingAll && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary-soft/40 px-3 py-2 text-xs text-fg">
          <Spinner size={13} /> 正在逐章抽取设定 / 一致性 / 摘要（已发现 {open.length} 个问题）。切到「设定库 / 知识图谱」可实时看到数据增长。
        </div>
      )}

      {/* 概览统计 */}
      {open.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {(['high', 'medium', 'low'] as const).map((s) => (
            <div key={s} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs">
              <span className={`h-2 w-2 rounded-full ${s === 'high' ? 'bg-danger' : s === 'medium' ? 'bg-warn' : 'bg-fg-faint'}`} />
              <span className="text-fg-muted">{SEV_META[s].label}</span>
              <span className="font-semibold tabular-nums">{counts[s] ?? 0}</span>
            </div>
          ))}
        </div>
      )}

      {isLoading && <div className="flex items-center gap-2 text-sm text-fg-muted"><Spinner size={14} />加载中…</div>}

      {!isLoading && open.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="暂无未解决问题" desc="写完一章后点「检查最新章」，引擎将逐层扫描事实/规则/图谱/语义冲突。" />
      ) : (
        <div className="space-y-2.5">
          {open.map((i) => {
            const cid = chapterIdOf(i.location);
            return (
              <IssueCard key={i.id} issue={i} chapterList={chapterList}
                actions={<>
                  {i.evidence && i.suggestion && (
                    <Button size="sm" icon={Wrench} loading={fix.isPending && fix.variables === i.id} onClick={() => fix.mutate(i.id)}>AI 修复</Button>
                  )}
                  {cid != null && (
                    <a href={`/novels/${novelId}/chapters/${cid}`} className="inline-flex">
                      <Button size="sm" variant="ghost" icon={ArrowUpRight}>跳转编辑</Button>
                    </a>
                  )}
                  <Button size="sm" variant="secondary" icon={Check} loading={resolve.isPending && resolve.variables?.id === i.id} onClick={() => resolve.mutate({ id: i.id, status: 'resolved' })}>已修正</Button>
                  <Tooltip label="情节需要，不计入假正例"><Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: i.id, status: 'intentional' })}>有意为之</Button></Tooltip>
                  <Tooltip label="降低此类规则权重"><Button size="sm" variant="ghost" icon={EyeOff} onClick={() => resolve.mutate({ id: i.id, status: 'ignored' })}>忽略此类</Button></Tooltip>
                </>}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// =================== 灵感工具 ===================
export function IdeaTools({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'idea' | 'title' | 'synopsis' | 'hook'>('idea');
  const [genre, setGenre] = useState('');
  const [keywords, setKeywords] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
  const update = useMutation({ mutationFn: (data: any) => apiClient.updateNovel(novelId, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['novel', novelId] }) });

  async function run() {
    setBusy(true); setOut('');
    try {
      let r: any;
      if (tab === 'idea') r = await apiClient.aiIdea({ genre, keywords });
      else if (tab === 'title') r = await apiClient.aiTitle(novelId);
      else if (tab === 'synopsis') r = await apiClient.aiSynopsis(novelId);
      else r = await apiClient.aiHook(novelId);
      setOut(r?.content ?? r?.summary ?? '');
    } catch { toast.error('生成失败'); } finally { setBusy(false); }
  }

  function copyOut() { navigator.clipboard?.writeText(out); toast.success('已复制到剪贴板'); }
  function applyTitle(t: string) { update.mutate({ title: t.trim() }); toast.success('已设为作品标题'); }
  function applySynopsis() { update.mutate({ synopsis: out.trim() }); toast.success('已设为简介'); }
  function appendOutline() { const cur = novel?.masterOutline ?? ''; update.mutate({ masterOutline: cur + (cur ? '\n\n' : '') + '【开篇钩子】\n' + out.trim() }); toast.success('已加入总纲'); }

  // 书名候选：去编号/书名号，逐条渲染
  const candidates =
    tab === 'title'
      ? out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[\d一二三四五六七八九十]+[.、)）\s]+/, '').replace(/^《|》$/g, '').trim()).filter(Boolean)
      : [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">灵感与文案</h3>
        <span className="text-xxs text-fg-faint">生成后可一键应用回作品</span>
      </div>
      <div className="mb-3">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v)}
          options={[{ value: 'idea', label: '灵感' }, { value: 'title', label: '书名' }, { value: 'synopsis', label: '简介' }, { value: 'hook', label: '钩子' }]}
        />
      </div>
      {tab === 'idea' && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <TextInput value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="题材" />
          <TextInput value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="关键词，逗号分隔" />
        </div>
      )}
      <Button onClick={run} loading={busy} icon={Sparkles} className="mb-3">{busy ? '生成中…' : '生成'}</Button>

      {out && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={Copy} onClick={copyOut}>复制</Button>
            {tab === 'synopsis' && <Button size="sm" icon={Check} loading={update.isPending} onClick={applySynopsis}>设为简介</Button>}
            {tab === 'hook' && <Button size="sm" icon={Plus} loading={update.isPending} onClick={appendOutline}>加入总纲</Button>}
          </div>
          {tab === 'title' ? (
            <div className="space-y-1.5">
              {candidates.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
                  <span className="text-sm font-medium">{c}</span>
                  <Button size="sm" variant="ghost" icon={Check} onClick={() => applyTitle(c)}>用这个</Button>
                </div>
              ))}
              {candidates.length === 0 && <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-sm">{out}</pre>}
            </div>
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-sm">{out}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// =================== AI 对话助手 ===================
type Msg = { role: 'user' | 'assistant'; content: string };
export function AiChat({ novelId }: { novelId: number }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setBusy(true);
    await streamSse('/ai/chat', { novelId, message: text }, {
      onToken: (t) => setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + t };
        return next;
      }),
      onError: (m) => setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', content: '⚠️ ' + m };
        return next;
      }),
      onDone: () => setBusy(false),
    });
    setBusy(false);
  }

  return (
    <div className="flex h-[30rem] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">AI 助手</h3>
        <span className="text-xxs text-fg-faint">带全书记忆</span>
      </div>
      <div className="flex-1 space-y-4 overflow-auto rounded-lg border border-border bg-bg p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-fg-muted">
            <Bot size={28} strokeWidth={1.5} className="mb-2 text-primary" />
            <p>问我任何关于这本书的问题</p>
            <p className="mt-0.5 text-xs text-fg-faint">我会参考设定、前文与运行时状态作答</p>
          </div>
        )}
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const isLast = i === messages.length - 1;
          return (
            <div key={i} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
              {isUser ? <Avatar name="我" size={28} /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Bot size={15} /></span>}
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${isUser ? 'bg-primary text-white' : 'bg-surface-2 text-fg'}`}>
                {m.content}
                {!isUser && busy && isLast && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse-soft bg-primary align-middle" />}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex gap-2">
        <TextInput value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="输入问题，回车发送" />
        <Button onClick={send} loading={busy} icon={Send}>{busy ? '' : '发送'}</Button>
      </div>
    </div>
  );
}

// =================== Token 成本看板 ===================
export function CostPanel({ novelId }: { novelId: number }) {
  const { data } = useQuery({ queryKey: ['cost', novelId], queryFn: () => apiClient.costStats(novelId), refetchInterval: 15000 });
  const t = data?.total;
  const byType = data?.byType ?? [];
  const maxTok = Math.max(...byType.map((b: any) => b.tokensIn + b.tokensOut), 1);
  const totalTok = (t?.tokensIn ?? 0) + (t?.tokensOut ?? 0) || 1;
  const inPct = ((t?.tokensIn ?? 0) / totalTok) * 100;

  return (
    <div>
      <h3 className="mb-3 font-semibold">Token 成本看板</h3>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Stat label="调用次数" v={t?.calls ?? 0} />
        <Stat label="输入 token" v={t?.tokensIn ?? 0} />
        <Stat label="输出 token" v={t?.tokensOut ?? 0} />
        <Stat label="缓存命中" v={t?.cached ?? 0} />
        <Stat label="错误" v={t?.errors ?? 0} />
        <Stat label="估算成本(¥)" v={t?.estCostYuan ?? 0} />
      </div>

      {/* 输入/输出比例条 */}
      {totalTok > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-overline">输入 / 输出</div>
          <div className="flex h-3 overflow-hidden rounded-full">
            <div className="bg-primary transition-all" style={{ width: `${inPct}%` }} title={`输入 ${t?.tokensIn ?? 0}`} />
            <div className="bg-accent transition-all" style={{ width: `${100 - inPct}%` }} title={`输出 ${t?.tokensOut ?? 0}`} />
          </div>
          <div className="mt-1 flex justify-between text-xxs text-fg-faint">
            <span><span className="inline-block h-2 w-2 rounded-full bg-primary" /> 输入 {((t?.tokensIn ?? 0)).toLocaleString()}</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-accent" /> 输出 {((t?.tokensOut ?? 0)).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* 按任务类型柱状图 */}
      {byType.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-overline">按任务类型</div>
          <div className="space-y-2.5">
            {byType.map((b: any) => {
              const tok = b.tokensIn + b.tokensOut;
              const pct = (tok / maxTok) * 100;
              return (
                <div key={b.key}>
                  <div className="mb-0.5 flex justify-between text-xs">
                    <span className="font-medium">{b.key}</span>
                    <span className="text-fg-faint">{b.calls} 次 · {tok.toLocaleString()} tok{b.cached > 0 && ` · 缓存 ${b.cached}`}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded border border-border bg-surface p-2">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="text-lg font-semibold">{typeof v === 'number' ? v.toLocaleString() : v}</div>
    </div>
  );
}

// =================== 伏笔面板 ===================
export function ForeshadowPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: list } = useQuery({ queryKey: ['foreshadows', novelId], queryFn: () => apiClient.listForeshadows(novelId) });
  const { data: reminders } = useQuery({ queryKey: ['foreshadow-reminders', novelId], queryFn: () => apiClient.foreshadowReminders(novelId) });
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const create = useMutation({
    mutationFn: () => apiClient.createForeshadow(novelId, { title: title.trim(), description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['foreshadows', novelId] }); setTitle(''); setDesc(''); },
  });
  const setPayoff = useMutation({
    mutationFn: (id: number) => apiClient.updateForeshadow(id, { status: 'paid_off' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foreshadows', novelId] }),
  });

  return (
    <div>
      <h3 className="mb-3 font-semibold">伏笔状态机</h3>
      {(reminders ?? []).length > 0 && (
        <div className="mb-3 rounded border border-warn/50 bg-warn/10 p-2 text-xs">
          ⏰ {reminders!.length} 个伏笔埋下已久未回收：{reminders!.map((r) => r.title).join('、')}
        </div>
      )}
      <div className="space-y-2">
        {(list ?? []).map((f) => (
          <div key={f.id} className="rounded border border-border bg-surface p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{f.title}</span>
              <span className={`text-xs ${f.status === 'paid_off' ? 'text-accent' : 'text-warn'}`}>
                {f.status === 'paid_off' ? '已回收' : '待回收'}
              </span>
            </div>
            {f.description && <p className="text-xs text-fg-muted">{f.description}</p>}
            {f.status === 'setup' && <Button variant="ghost" onClick={() => setPayoff.mutate(f.id)}>标记已回收</Button>}
          </div>
        ))}
        {(list ?? []).length === 0 && <p className="text-sm text-fg-muted">暂无伏笔。写章节后 L1 抽取会自动识别，或手动添加。</p>}
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="伏笔标题" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="说明（可选）" />
        <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>添加伏笔</Button>
      </div>
    </div>
  );
}

// =================== 物品栏 ===================
export function ItemPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ['items', novelId], queryFn: () => apiClient.items(novelId) });
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = useMutation({
    mutationFn: () => apiClient.createEntity(novelId, { type: 'item', name: name.trim(), description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items', novelId] }); qc.invalidateQueries({ queryKey: ['bible', novelId] }); setName(''); setDesc(''); },
  });
  return (
    <div>
      <h3 className="mb-3 font-semibold">物品栏（持有 / 状态 / 流转）</h3>
      <div className="space-y-2">
        {(items ?? []).map((it: any) => (
          <details key={it.id} className="rounded border border-border bg-surface p-2 text-sm">
            <summary className="flex cursor-pointer items-center justify-between">
              <span className="font-medium">{it.name}</span>
              <span className="text-xs text-fg-muted">持有：{it.currentHolder ?? '无'} · {it.status}</span>
            </summary>
            {it.description && <p className="mt-1 text-xs text-fg-muted">{it.description}</p>}
            {it.transfers?.length > 0 && (
              <div className="mt-1 text-xs text-fg-muted">
                流转：{it.transfers.map((t: any, i: number) => (
                  <span key={i}>{i > 0 && ' → '}{t.holderName}（第{t.chapterOrder + 1}章）</span>
                ))}
              </div>
            )}
          </details>
        ))}
        {(items ?? []).length === 0 && <p className="text-sm text-fg-muted">暂无道具。写章节后 L1 抽取会自动追踪关键道具，或手动添加。</p>}
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="道具名" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="外观 / 能力 / 使用限制" />
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>添加道具</Button>
      </div>
    </div>
  );
}

// =================== 地点栏 ===================
export function LocationPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: bible } = useQuery({ queryKey: ['bible', novelId], queryFn: () => apiClient.getBible(novelId) });
  const locations = (bible?.entities ?? []).filter((e) => e.type === 'location');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [parentId, setParentId] = useState('');
  const create = useMutation({
    mutationFn: () => apiClient.createEntity(novelId, { type: 'location', name: name.trim(), description: desc, parentId: parentId ? Number(parentId) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bible', novelId] }); setName(''); setDesc(''); setParentId(''); },
  });

  // 构建树
  const byParent = new Map<number | null, any[]>();
  for (const l of locations) {
    const p = (l as any).parentId ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(l);
  }
  const renderNode = (loc: any, depth: number): any => {
    const children = byParent.get(loc.id) ?? [];
    return (
      <div key={loc.id}>
        <div style={{ paddingLeft: depth * 12 }} className="text-sm">
          {depth > 0 && '└ '}
          <span className="font-medium">{loc.name}</span>
          {loc.description && <span className="text-xs text-fg-muted"> — {loc.description}</span>}
        </div>
        {children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <h3 className="mb-3 font-semibold">地点栏（层级）</h3>
      <div className="space-y-1">
        {(byParent.get(null) ?? []).map((l) => renderNode(l, 0))}
        {locations.length === 0 && <p className="text-sm text-fg-muted">暂无地点。手动添加，或写章节后 L1 抽取自动建立。</p>}
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="地点名" />
        <div>
          <div className="mb-1 text-xs text-fg-muted">父级地点（可选）</div>
          <Select<string>
            value={parentId}
            onChange={(v) => setParentId(v)}
            placeholder="顶级（无父级）"
            options={locations.map((l: any) => ({ value: String(l.id), label: l.name }))}
          />
        </div>
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="描述 / 进入限制" />
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>添加地点</Button>
      </div>
    </div>
  );
}
