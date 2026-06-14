'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { Button } from './ui';

const FALLBACK_COLORS: Record<string, string> = {
  character: '#7c5cff', location: '#00d4aa', organization: '#ffb020',
  item: '#4a9eff', power_system: '#ff5959', worldview: '#0891b2',
};

/** 从 CSS 变量读取配色，保证 G6 跟随明暗主题（修主题泄漏）。 */
function themeColors() {
  if (typeof window === 'undefined') return { node: FALLBACK_COLORS, fg: '#e8eaed', stroke: '#252932', edge: '#5f6368', edgeLabel: '#9aa0a6' };
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    node: {
      character: v('--c-primary', '#7c5cff'),
      location: v('--c-accent', '#00d4aa'),
      organization: v('--c-warn', '#ffb020'),
      item: v('--c-info', '#4a9eff'),
      power_system: v('--c-danger', '#ff5959'),
      worldview: '#0891b2',
    },
    fg: v('--c-fg', '#e8eaed'),
    stroke: v('--c-surface-2', '#252932'),
    edge: v('--c-fg-faint', '#5f6368'),
    edgeLabel: v('--c-fg-muted', '#9aa0a6'),
  };
}

// =================== 关系图（AntV G6 v5 + 章节滑块）===================
export function RelationshipGraph({ novelId }: { novelId: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ['graph', novelId], queryFn: () => apiClient.relationshipGraph(novelId) });
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
  const maxOrder = Math.max(0, ...(novel?.chapters ?? []).map((c) => c.order));
  const [chapter, setChapter] = useState<number>(maxOrder);
  const [showAll, setShowAll] = useState(true);
  const [themeV, setThemeV] = useState(0);

  // 主题切换时重建图（G6 颜色需重新读取 CSS 变量）
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeV((v) => v + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (novel && chapter > maxOrder) setChapter(maxOrder);
  }, [maxOrder, chapter, novel]);

  const colors = themeColors();

  const visibleEdges = (data?.edges ?? []).filter((e: any) => {
    if (showAll) return true;
    const from = e.validFrom ?? 0;
    const to = e.validTo;
    return from <= chapter && (to == null || to >= chapter);
  });

  useEffect(() => {
    if (!data || !ref.current || data.nodes.length === 0) return;
    let graph: any;
    let cancelled = false;
    (async () => {
      const { Graph } = await import('@antv/g6');
      if (cancelled || !ref.current) return;
      const width = ref.current.clientWidth || 600;
      graph = new Graph({
        container: ref.current,
        width,
        height: 440,
        autoFit: 'view',
        data: {
          nodes: data.nodes.map((n: any) => ({ id: String(n.id), data: { label: n.label, type: n.type } })),
          edges: visibleEdges.map((e: any) => ({ source: String(e.source), target: String(e.target), data: { label: e.label } })),
        },
        node: {
          style: {
            size: 30,
            fill: (d: any) => colors.node[d.data?.type as string] ?? '#6b7280',
            labelText: (d: any) => d.data?.label || d.id,
            labelPlacement: 'bottom',
            labelFontSize: 11,
            labelFill: colors.fg,
            stroke: colors.stroke,
          },
        },
        edge: {
          style: {
            stroke: colors.edge,
            labelText: (d: any) => d.data?.label,
            labelFontSize: 10,
            labelFill: colors.edgeLabel,
            endArrow: true,
          },
        },
        layout: { type: 'force', preventOverlap: true, nodeSize: 44, linkDistance: 120 },
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      });
      try { await graph.render(); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; try { graph?.destroy(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, showAll, chapter, themeV]);

  return (
    <div>
      <h3 className="mb-3 font-semibold">关系图（AntV G6）</h3>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {Object.entries(colors.node).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: v }} />
            {labelOf(k)}
          </span>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-3 rounded border border-border bg-surface px-3 py-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 全部章节
        </label>
        {!showAll && (
          <>
            <input type="range" min={0} max={Math.max(1, maxOrder)} value={chapter} onChange={(e) => setChapter(Number(e.target.value))} className="flex-1" />
            <span className="w-20 text-right text-fg-muted">第 {chapter + 1} 章</span>
          </>
        )}
      </div>
      {isLoading && <p className="text-sm text-fg-muted">加载…</p>}
      <div ref={ref} className="overflow-hidden rounded border border-border bg-surface" style={{ height: 440 }} />
      {data && data.nodes.length === 0 && (
        <p className="mt-2 text-sm text-fg-muted">暂无实体/关系。跑过一致性检查（L1 抽取会自动建立关系）或添加角色后，节点会出现。</p>
      )}
      {data && data.nodes.length > 0 && (
        <p className="mt-1 text-xs text-fg-muted">{data.nodes.length} 节点 · 当前 {visibleEdges.length}/{data.edges.length} 条关系（可拖拽/缩放）</p>
      )}
    </div>
  );
}

function labelOf(t: string): string {
  return ({ character: '角色', location: '地点', organization: '组织', item: '道具', power_system: '能力体系', worldview: '世界观' } as Record<string, string>)[t] ?? t;
}

// =================== 时间线（主线/支线/伏笔分层）===================
const MAIN_KEYWORDS = /突破|拜师|获救|死亡|陨落|身世|真相|决裂|结盟|背叛|复活|重伤|结怨|和好|相遇|离别|觉醒|传承|夺|失去/;

export function TimelineView({ novelId }: { novelId: number }) {
  const { data: events } = useQuery({ queryKey: ['timeline', novelId], queryFn: () => apiClient.timelineEvents(novelId) });
  const { data: conflicts } = useQuery({ queryKey: ['timeline-conflicts', novelId], queryFn: () => apiClient.timelineConflicts(novelId) });
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
  const { data: foreshadows } = useQuery({ queryKey: ['foreshadows', novelId], queryFn: () => apiClient.listForeshadows(novelId) });
  const [layer, setLayer] = useState<'all' | 'main' | 'side'>('all');

  const orderOf = (id: number | null) => novel?.chapters?.find((c) => c.id === id)?.order ?? -1;
  const sorted = [...(events ?? [])]
    .map((e: any) => ({ ...e, _order: orderOf(e.chapterId), _main: MAIN_KEYWORDS.test(`${e.type}${e.result ?? ''}`) }))
    .sort((a, b) => a._order - b._order || a.id - b.id);
  const shown = sorted.filter((e) => layer === 'all' || (layer === 'main' ? e._main : !e._main));

  return (
    <div>
      <h3 className="mb-3 font-semibold">时间线</h3>
      {(conflicts ?? []).length > 0 && (
        <div className="mb-3 rounded border border-danger/50 bg-danger/10 p-2 text-xs text-danger">
          ⚠ 检测到 {(conflicts ?? []).length} 处时序冲突：
          {(conflicts ?? []).map((c: any, i: number) => (
            <span key={i}> {c.participant} 同时在 {c.locations.join(' / ')}；</span>
          ))}
        </div>
      )}
      <div className="mb-3 flex gap-1">
        {([['all', '全部'], ['main', '主线'], ['side', '支线']] as const).map(([k, label]) => (
          <Button key={k} variant={layer === k ? 'primary' : 'secondary'} onClick={() => setLayer(k)} className="text-xs">{label}</Button>
        ))}
      </div>

      <div className="relative max-h-[26rem] overflow-auto pl-4">
        <div className="absolute bottom-0 left-[6px] top-0 w-px bg-border" />
        {shown.length === 0 && <p className="text-sm text-fg-muted">暂无事件。写章节并跑一致性检查后，L1 抽取会自动建立事件。</p>}
        {shown.map((e: any) => {
          const parts = safeParse(e.participants);
          return (
            <div key={e.id} className="relative mb-3 pl-5">
              <span className={`absolute left-[2px] top-1.5 h-2 w-2 rounded-full ${e._main ? 'bg-primary' : 'bg-fg-faint'}`} />
              <div className="rounded border border-border bg-surface p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.type} {e._main && <span className="ml-1 text-xs text-primary">主线</span>}</span>
                  <span className="text-xs text-fg-muted">第 {(e._order ?? 0) + 1} 章</span>
                </div>
                {parts.length > 0 && <p className="mt-0.5 text-xs text-fg-muted">参与：{parts.join('、')}</p>}
                {e.location && <p className="text-xs text-fg-muted">地点：{e.location}</p>}
                {e.result && <p className="mt-0.5 text-xs">{e.result}</p>}
              </div>
            </div>
          );
        })}

        {/* 伏笔层 */}
        {(foreshadows ?? []).length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 text-xs font-medium text-info">🔥 伏笔</div>
            {(foreshadows ?? []).map((f: any) => (
              <div key={f.id} className="relative mb-2 pl-5 text-xs">
                <span className="absolute left-[1px] top-1 text-info">{f.status === 'paid_off' ? '▼' : '▲'}</span>
                <span className="text-fg">{f.title}</span>
                <span className="ml-2 text-fg-faint">
                  {f.setupChapter != null && `埋于第 ${f.setupChapter + 1} 章`}
                  {f.payoffChapter != null && ` · 回收于第 ${f.payoffChapter + 1} 章`}
                  {f.status === 'setup' && ' · 待回收'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function safeParse(s: string | null): string[] {
  try {
    const v = JSON.parse(s ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
