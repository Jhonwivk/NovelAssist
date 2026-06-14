'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { Badge } from './ui';

const EMOTION_MAP: [RegExp, number][] = [
  [/愤怒|暴怒|狂怒|怒火/, -2],
  [/悲伤|哀|痛|绝望/, -1.5],
  [/愧疚|内疚|自责/, -1],
  [/焦虑|不安|恐惧|害怕|慌/, -0.8],
  [/紧张|警惕|戒备/, -0.5],
  [/复杂|矛盾|纠结/, 0],
  [/平静|镇定|冷静|淡然/, 0.2],
  [/坚定|决绝|决心|决意/, 1],
  [/喜悦|开心|高兴|欣慰/, 1.5],
  [/兴奋|狂喜|振奋/, 2],
  [/轻松|放松/, 1],
];

function emotionScore(v: string): number | null {
  for (const [re, s] of EMOTION_MAP) if (re.test(v)) return s;
  return null;
}

export function CharacterTrajectory({ entityId, onClose }: { entityId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['trajectory', entityId], queryFn: () => apiClient.trajectory(entityId) });

  if (isLoading) return <p className="text-sm text-fg-muted">加载轨迹…</p>;
  if (!data) return null;

  const e = data.entity;
  const levelSeries = pickFirst(data.series, ['修为境界', '境界', '修为', '等级', '实力']);
  const moodSeries = data.series['情绪'] ?? [];
  const locationSeries = data.series['位置'] ?? [];

  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center gap-2">
        <Badge tone="neutral">{e.type}</Badge>
        <span className="text-lg font-bold">{e.name}</span>
      </div>
      {e.description && <p className="text-fg-muted">{e.description}</p>}

      {levelSeries && levelSeries.length > 0 && (
        <Section title="📊 等级 / 境界演化">
          <Milestones items={levelSeries.map((p: any) => ({ chapter: p.chapterOrder, label: p.value }))} tone="accent" />
        </Section>
      )}

      {moodSeries.length > 0 && (
        <Section title="💭 情绪曲线">
          <EmotionCurve points={moodSeries.map((p: any) => ({ chapter: p.chapterOrder, value: p.value }))} maxOrder={data.maxOrder} />
        </Section>
      )}

      {locationSeries.length > 0 && (
        <Section title="📍 位置历程">
          <Milestones items={locationSeries.map((p: any) => ({ chapter: p.chapterOrder, label: p.value }))} tone="info" />
        </Section>
      )}

      {data.possessions.length > 0 && (
        <Section title="🎒 持有变更">
          <div className="space-y-1 text-xs text-fg-muted">
            {data.possessions.map((p: any, i: number) => (
              <div key={i}>第 {p.chapterOrder + 1} 章 · 获得 <span className="text-fg">{p.itemName}</span></div>
            ))}
          </div>
        </Section>
      )}

      {data.events.length > 0 && (
        <Section title="📖 相关事件">
          <div className="space-y-1 text-xs text-fg-muted">
            {data.events.slice(0, 12).map((ev: any, i: number) => (
              <div key={i}>第 {(ev.chapterOrder ?? 0) + 1} 章 · {ev.type}{ev.result ? '：' + ev.result : ''}</div>
            ))}
          </div>
        </Section>
      )}

      <button onClick={onClose} className="text-xs text-primary hover:underline">关闭</button>
    </div>
  );
}

function pickFirst(series: Record<string, any[]>, keys: string[]) {
  for (const k of keys) if (series[k]?.length) return series[k];
  return null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-medium">{title}</div>
      {children}
    </div>
  );
}

function Milestones({ items, tone }: { items: { chapter: number; label: string }[]; tone: 'accent' | 'info' }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {items.map((it, i) => (
        <div key={i} className="flex min-w-[5rem] flex-col items-center text-center">
          <div className="text-xs text-fg">{it.label}</div>
          <div className={`my-1 h-2.5 w-2.5 rounded-full ${tone === 'accent' ? 'bg-accent' : 'bg-info'}`} />
          <div className="text-xs text-fg-faint">第 {it.chapter + 1} 章</div>
          {i < items.length - 1 && <div className="mt-1 h-px w-full bg-border" />}
        </div>
      ))}
    </div>
  );
}

function EmotionCurve({ points, maxOrder }: { points: { chapter: number; value: string }[]; maxOrder: number }) {
  const W = 520;
  const H = 140;
  const PAD = 24;
  const mapped = points
    .map((p) => ({ chapter: p.chapter, score: emotionScore(p.value), value: p.value }))
    .filter((p) => p.score != null) as { chapter: number; score: number; value: string }[];

  if (mapped.length < 2) {
    return <Milestones items={points.map((p) => ({ chapter: p.chapter, label: p.value }))} tone="info" />;
  }
  const span = Math.max(1, maxOrder);
  const x = (ch: number) => PAD + (ch / span) * (W - PAD * 2);
  const y = (s: number) => H / 2 - (s / 2.5) * (H / 2 - PAD);
  const path = mapped.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.chapter).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 160 }}>
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="var(--c-border)" strokeDasharray="3 3" />
      <text x={4} y={y(2)} fill="var(--c-fg-faint)" fontSize="10">高昂</text>
      <text x={4} y={y(-2)} fill="var(--c-fg-faint)" fontSize="10">低落</text>
      <path d={path} fill="none" stroke="var(--c-primary)" strokeWidth="2" />
      {mapped.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.chapter)} cy={y(p.score)} r="3.5" fill="var(--c-primary)" />
          <title>{`第 ${p.chapter + 1} 章：${p.value}`}</title>
        </g>
      ))}
    </svg>
  );
}
