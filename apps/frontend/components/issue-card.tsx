'use client';

import { useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Eye, EyeOff, Quote } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { Badge, Button, Card, Spinner } from './ui';

export const SEV_META: Record<string, { tone: 'danger' | 'warn' | 'neutral'; label: string; rank: number }> = {
  high: { tone: 'danger', label: '严重', rank: 0 },
  medium: { tone: 'warn', label: '中等', rank: 1 },
  low: { tone: 'neutral', label: '轻微', rank: 2 },
};

export function safeArr(s: string | undefined | null): string[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function chapterIdOf(loc: string | undefined | null): number | null {
  const m = (loc ?? '').match(/"chapterId":(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * 共享问题卡：一致性面板 与 编辑器「问题」tab 复用。
 * actions 为各调用方自行注入的操作按钮（修复/已修正/忽略等），卡片本身只负责展示 + 原文上下文展开。
 */
export function IssueCard({ issue, chapterList, actions }: { issue: any; chapterList?: any[]; actions?: ReactNode }) {
  const sev = SEV_META[issue.severity] ?? SEV_META.low;
  const entities = safeArr(issue.entities);
  const cid = chapterIdOf(issue.location);
  const ch = cid == null || !chapterList ? null : chapterList.find((c: any) => c.id === cid);
  const conf = typeof issue.confidence === 'number' ? Math.round(issue.confidence * 100) : null;
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="outline" className={`p-3.5 ${issue.severity === 'high' ? 'border-danger/40' : issue.severity === 'medium' ? 'border-warn/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={sev.tone}>{sev.label}</Badge>
        <Badge tone="neutral">{issue.layer}</Badge>
        <span className="text-sm font-medium">{issue.type}</span>
        {ch && <span className="text-xxs text-fg-faint">· 第 {(ch.order ?? 0) + 1} 章 {ch.title}</span>}
        {conf != null && <span className="ml-auto text-xxs text-fg-faint tabular-nums">置信度 {conf}%</span>}
      </div>

      {entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entities.map((e, n) => <span key={n} className="rounded bg-surface-2 px-1.5 py-0.5 text-xxs text-fg-muted">{e}</span>)}
        </div>
      )}

      {issue.evidence && (
        <div className="mt-2 flex gap-1.5 rounded-md bg-surface-2 px-2.5 py-2 text-xs text-fg">
          <Quote size={12} className="mt-0.5 shrink-0 text-fg-faint" />
          <span className="leading-relaxed">{issue.evidence}</span>
        </div>
      )}
      {issue.conflictWith && (
        <p className="mt-2 flex gap-1.5 text-xs text-fg-muted">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
          <span className="leading-relaxed">{issue.conflictWith}</span>
        </p>
      )}
      {issue.suggestion && (
        <p className="mt-2 flex gap-1.5 text-xs text-accent">
          <Check size={12} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{issue.suggestion}</span>
        </p>
      )}

      {expanded && issue.evidence && cid != null && (
        <div className="mt-2 animate-fade-in"><ContextSnippet chapterId={cid} evidence={issue.evidence} /></div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
        {issue.evidence && cid != null && (
          <Button size="sm" variant="ghost" icon={expanded ? EyeOff : Eye} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起原文' : '查看原文'}
          </Button>
        )}
        {actions}
      </div>
    </Card>
  );
}

function ContextSnippet({ chapterId, evidence }: { chapterId: number; evidence: string }) {
  const { data: chapter, isLoading } = useQuery({
    queryKey: ['chapter', chapterId],
    queryFn: () => apiClient.getChapter(chapterId),
    enabled: !!chapterId,
  });
  if (isLoading) return <div className="flex items-center gap-2 py-2 text-xs text-fg-muted"><Spinner size={12} />加载原文…</div>;
  if (!chapter?.content) return <p className="text-xs text-fg-faint">章节无内容</p>;
  const plain = chapter.content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const paragraphs = plain.split(/\n+/).filter(Boolean);
  const needle = evidence.slice(0, Math.min(25, evidence.length));
  const matchIdx = paragraphs.findIndex((p) => p.includes(needle) || p.includes(evidence.slice(0, 12)));
  if (matchIdx === -1) return <p className="text-xs text-fg-faint">未在正文中找到此段原文（可能已被修改）</p>;
  const start = Math.max(0, matchIdx - 1);
  const end = Math.min(paragraphs.length, matchIdx + 2);
  function highlight(text: string, isMatch: boolean) {
    if (!isMatch) return text;
    const idx = text.indexOf(needle);
    if (idx === -1) return text;
    return (<>{text.slice(0, idx)}<mark className="rounded bg-danger/25 px-0.5 text-fg underline decoration-danger decoration-wavy underline-offset-2">{text.slice(idx, idx + evidence.length)}</mark>{text.slice(idx + evidence.length)}</>);
  }
  return (
    <div className="max-h-56 overflow-auto rounded-md border border-border bg-bg p-3 font-serif text-sm leading-relaxed">
      {paragraphs.slice(start, end).map((p, i) => (
        <p key={i} className="mb-2 text-fg-muted" style={{ textIndent: '2em' }}>{highlight(p, start + i === matchIdx)}</p>
      ))}
    </div>
  );
}
