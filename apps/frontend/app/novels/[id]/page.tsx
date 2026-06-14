'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlignLeft, BarChart3, Bot, BookOpen, Download, FileText, Flag, Lightbulb,
  ListOrdered, MapPin, MoreVertical, Network, Package, PenLine, Plus, ShieldCheck, Sparkles, Trash2, Upload,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { AiChat, ConsistencyPanel, CostPanel, ForeshadowPanel, IdeaTools, ItemPanel, LocationPanel } from '@/components/workbench-panels';
import { RelationshipGraph, TimelineView } from '@/components/visualization';
import { BatchChaptersModal } from '@/components/batch-chapters-modal';
import { BiblePanel } from '@/components/bible-panel';
import { AppShell } from '@/components/app-shell';
import { Badge, Button, Card, EmptyState, IconButton, Menu, NavItem, Skeleton, SkeletonCard, TextInput, toast, useConfirm } from '@/components/ui';

type Tab = 'chapters' | 'bible' | 'outline' | 'chat' | 'idea' | 'consistency' | 'foreshadow' | 'items' | 'locations' | 'graph' | 'timeline' | 'cost';

const NAV: { key: Tab; label: string; icon: any }[] = [
  { key: 'chapters', label: '章节', icon: ListOrdered },
  { key: 'bible', label: '设定', icon: BookOpen },
  { key: 'outline', label: '大纲', icon: AlignLeft },
  { key: 'chat', label: 'AI 助手', icon: Bot },
  { key: 'idea', label: '灵感', icon: Lightbulb },
  { key: 'consistency', label: '一致性', icon: ShieldCheck },
  { key: 'foreshadow', label: '伏笔', icon: Flag },
  { key: 'items', label: '物品', icon: Package },
  { key: 'locations', label: '地点', icon: MapPin },
  { key: 'graph', label: '关系图', icon: Network },
  { key: 'timeline', label: '时间线', icon: FileText },
  { key: 'cost', label: '成本', icon: BarChart3 },
];

export default function WorkbenchPage({ params }: { params: { id: string } }) {
  const novelId = Number(params.id);
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>(() => {
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    return (q === 'outline' ? 'outline' : 'chapters') as Tab;
  });
  const [batchOpen, setBatchOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState('');

  const { data: novel, isLoading } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
  const { data: issues } = useQuery({ queryKey: ['issues', novelId], queryFn: () => apiClient.listIssues(novelId) });
  const openIssueCount = (issues ?? []).filter((i) => i.status === 'open').length;

  const createChapter = useMutation({
    mutationFn: (data: { title: string; outlineText?: string }) => apiClient.createChapter(novelId, data),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('章节已创建'); router.push(`/novels/${novelId}/chapters/${c.id}`); },
  });
  const delChapter = useMutation({ mutationFn: (id: number) => apiClient.deleteChapter(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('已删除章节'); } });

  if (isLoading || !novel) return <AppShell breadcrumbs={[{ label: '作品' }]}><div className="space-y-3"><Skeleton className="h-9 w-64" /><SkeletonCard /></div></AppShell>;

  function submitChapter(e: React.FormEvent) { e.preventDefault(); if (!title.trim()) return; createChapter.mutate({ title: title.trim(), outlineText: outline || undefined }); }

  const chapters = novel.chapters ?? [];

  return (
    <AppShell
      breadcrumbs={[{ label: '我的作品', href: '/' }, { label: novel.title }]}
      actions={
        <Menu align="end" trigger={<Button variant="secondary" size="sm" icon={Download}>导出</Button>} items={[
          { label: '导出 TXT', onClick: () => window.open(apiClient.exportUrl(novelId, 'txt')) },
          { label: '导出 Markdown', onClick: () => window.open(apiClient.exportUrl(novelId, 'md')) },
          { label: '导出 DOCX', onClick: () => window.open(apiClient.exportUrl(novelId, 'docx')) },
          { label: '导出 EPUB', onClick: () => window.open(apiClient.exportUrl(novelId, 'epub')) },
        ]} />
      }
    >
      {/* Hero */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{novel.title}</h1>
            {novel.bookSummary && <Badge tone="accent">已建记忆</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {novel.genre || '未分类'} · {novel.wordCount.toLocaleString()} 字 · {chapters.length} 章
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setShowNew((s) => !s)}>新建章节</Button>
          <Button variant="secondary" size="sm" icon={Sparkles} onClick={() => setBatchOpen(true)}>批量生成</Button>
        </div>
      </div>

      {showNew && (
        <Card variant="outline" className="mb-5 animate-slide-up">
          <form onSubmit={submitChapter} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <label className="mb-1.5 block text-xs font-medium text-fg-muted">章节标题</label>
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：初入宗门" autoFocus />
            </div>
            <div className="min-w-[18rem] flex-1">
              <label className="mb-1.5 block text-xs font-medium text-fg-muted">章纲（可选）</label>
              <TextInput value={outline} onChange={(e) => setOutline(e.target.value)} placeholder="本章要点 / 情节" />
            </div>
            <Button type="submit" loading={createChapter.isPending} disabled={!title.trim()} icon={PenLine}>创建并编辑</Button>
          </form>
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        {/* Sidebar nav */}
        <aside className="md:sticky md:top-16 md:self-start">
          <nav className="space-y-0.5">
            {NAV.map((n) => (
              <NavItem key={n.key} active={tab === n.key} icon={n.icon} label={n.label} onClick={() => setTab(n.key)} count={n.key === 'chapters' ? chapters.length : n.key === 'consistency' ? openIssueCount : undefined} />
            ))}
          </nav>
        </aside>

        {/* Content */}
        <section className="min-w-0">
          {tab === 'chapters' && (
            chapters.length === 0 ? (
              <EmptyState icon={ListOrdered} title="还没有章节" desc="新建一章开始创作，或用「批量生成」让 AI 一次产出多章。" action={<div className="flex gap-2"><Button icon={Plus} onClick={() => setShowNew(true)}>新建章节</Button><Button variant="secondary" icon={Sparkles} onClick={() => setBatchOpen(true)}>批量生成</Button></div>} />
            ) : (
              <div className="space-y-2">
                {chapters.map((c) => (
                  <Card key={c.id} variant="outline" className="flex items-center gap-3 p-3 hover:border-line">
                    <Link href={`/novels/${novelId}/chapters/${c.id}`} className="flex flex-1 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-xxs font-medium text-fg-muted">{c.order + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.title}</div>
                        <div className="text-xxs text-fg-faint">{c.wordCount.toLocaleString()} 字 · {new Date(c.updatedAt).toLocaleString()}</div>
                      </div>
                    </Link>
                    <Badge tone={c.status === 'complete' ? 'accent' : 'neutral'}>{c.status === 'complete' ? '完成' : c.status === 'writing' ? '写作中' : '草稿'}</Badge>
                    <Menu align="end" trigger={<IconButton icon={MoreVertical} label="更多" size="sm" />} items={[
                      { label: '编辑', icon: PenLine, onClick: () => router.push(`/novels/${novelId}/chapters/${c.id}`) },
                      { divider: true, label: '' },
                      { label: '删除', icon: Trash2, danger: true, onClick: async () => { if (await confirm({ title: `删除「${c.title}」？`, danger: true, confirmText: '删除' })) delChapter.mutate(c.id); } },
                    ]} />
                  </Card>
                ))}
              </div>
            )
          )}
          {tab === 'bible' && <BiblePanel novelId={novelId} />}
          {tab === 'outline' && <OutlinePanel novelId={novelId} />}
          {tab === 'chat' && <AiChat novelId={novelId} />}
          {tab === 'idea' && <IdeaTools novelId={novelId} />}
          {tab === 'consistency' && <ConsistencyPanel novelId={novelId} />}
          {tab === 'foreshadow' && <ForeshadowPanel novelId={novelId} />}
          {tab === 'items' && <ItemPanel novelId={novelId} />}
          {tab === 'locations' && <LocationPanel novelId={novelId} />}
          {tab === 'graph' && <RelationshipGraph novelId={novelId} />}
          {tab === 'timeline' && <TimelineView novelId={novelId} />}
          {tab === 'cost' && <CostPanel novelId={novelId} />}
        </section>
      </div>

      <BatchChaptersModal novelId={novelId} open={batchOpen} onClose={() => setBatchOpen(false)} />
    </AppShell>
  );
}

function OutlinePanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
  const [master, setMaster] = useState('');
  const [optInstruction, setOptInstruction] = useState('');
  const [busy, setBusy] = useState<'gen' | 'opt' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (novel) setMaster(novel.masterOutline ?? ''); }, [novel]);

  const save = useMutation({
    mutationFn: () => apiClient.updateNovel(novelId, { masterOutline: master }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('总纲已保存'); },
  });
  const gen = useMutation({ mutationFn: () => apiClient.aiOutline(novelId), onSuccess: (r) => { const t = r?.content ?? ''; if (t) { setMaster(t); toast.success('已生成总纲'); } } });
  const opt = useMutation({ mutationFn: () => apiClient.aiOutlineOptimize(novelId, master, optInstruction || undefined), onSuccess: (r) => { const t = r?.content ?? ''; if (t) { setMaster(t); toast.success('已优化'); } } });

  async function runGen() { setBusy('gen'); try { await gen.mutateAsync(); } catch (e) { toast.error('生成失败'); } finally { setBusy(null); } }
  async function runOpt() { if (!master.trim()) { toast.error('请先生成或填写总纲'); return; } setBusy('opt'); try { await opt.mutateAsync(); } catch (e) { toast.error('优化失败'); } finally { setBusy(null); } }

  function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { let t = String(reader.result ?? ''); if (f.name.endsWith('.md')) t = t.replace(/```[\s\S]*?```/g, '').trim(); setMaster(t); toast.success(`已导入 ${f.name}`); };
    reader.readAsText(f); e.target.value = '';
  }

  return (
    <Card variant="outline">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">三级大纲 · 总纲</h3>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" icon={Sparkles} loading={busy === 'gen'} onClick={runGen}>生成</Button>
          <Button size="sm" variant="secondary" icon={AlignLeft} loading={busy === 'opt'} onClick={runOpt}>优化</Button>
          <Button size="sm" variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()}>导入</Button>
          <input ref={fileRef} type="file" accept=".txt,.md" className="hidden" onChange={onImport} />
        </div>
      </div>
      {busy === 'opt' && <TextInput className="mb-2" value={optInstruction} onChange={(e) => setOptInstruction(e.target.value)} placeholder="优化要求（可选）：如增加第二卷冲突、补强开篇钩子" />}
      <textarea
        rows={14}
        value={master}
        onChange={(e) => setMaster(e.target.value)}
        placeholder="主线、卷目规划、核心冲突走向……"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-serif text-sm text-fg placeholder:text-fg-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--c-ring)]"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>保存总纲</Button>
      </div>
    </Card>
  );
}
