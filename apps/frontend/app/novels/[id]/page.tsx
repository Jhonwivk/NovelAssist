'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download, Layers, ListOrdered, MoreHorizontal, MoreVertical, PenLine, Plus, Sparkles, Trash2, Pencil, Wand2,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { AiChat, ConsistencyPanel, CostPanel, IdeaTools } from '@/components/workbench-panels';
import { BatchChaptersModal } from '@/components/batch-chapters-modal';
import { AutopilotModal } from '@/components/autopilot-modal';
import { EntityBrowser } from '@/components/entity-browser';
import { KnowledgeView } from '@/components/knowledge-view';
import { OutlinePanel } from '@/components/outline-panel';
import { WorkbenchNav, mapLegacyTab, WorkbenchTab } from '@/components/workbench-nav';
import { AppShell } from '@/components/app-shell';
import { Badge, Button, Card, EmptyState, IconButton, Label, Menu, Modal, Skeleton, SkeletonCard, TextInput, toast, useConfirm } from '@/components/ui';

type RenameKind = 'novel' | 'chapter' | 'volume';

export default function WorkbenchPage({ params }: { params: { id: string } }) {
  const novelId = Number(params.id);
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<WorkbenchTab>(() => {
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    return mapLegacyTab(q);
  });
  const [batchOpen, setBatchOpen] = useState(false);
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState('');
  const [newVol, setNewVol] = useState('');
  const [batchTitlesOpen, setBatchTitlesOpen] = useState(false);
  const [rename, setRename] = useState<{ kind: RenameKind; id: number; value: string } | null>(null);

  const { data: novel, isLoading } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
  const { data: issues } = useQuery({ queryKey: ['issues', novelId], queryFn: () => apiClient.listIssues(novelId) });
  const openIssueCount = (issues ?? []).filter((i) => i.status === 'open').length;

  const createChapter = useMutation({
    mutationFn: (data: { title: string; outlineText?: string }) => apiClient.createChapter(novelId, data),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('章节已创建'); router.push(`/novels/${novelId}/chapters/${c.id}`); },
  });
  const delChapter = useMutation({ mutationFn: (id: number) => apiClient.deleteChapter(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('已删除章节'); } });
  const moveChapter = useMutation({ mutationFn: ({ id, volumeId }: { id: number; volumeId: number | null }) => apiClient.saveChapter(id, { volumeId }), onSuccess: () => qc.invalidateQueries({ queryKey: ['novel', novelId] }) });
  const createVolume = useMutation({ mutationFn: (t: string) => apiClient.createVolume(novelId, { title: t }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('已新建卷'); setNewVol(''); } });
  const delVolume = useMutation({ mutationFn: (id: number) => apiClient.deleteVolume(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('已删除卷（章节转为未分卷）'); } });

  function submitRename() {
    if (!rename || !rename.value.trim()) return;
    if (rename.kind === 'novel') apiClient.updateNovel(novelId, { title: rename.value.trim() }).then(() => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); qc.invalidateQueries({ queryKey: ['novels'] }); toast.success('已重命名作品'); });
    else if (rename.kind === 'chapter') apiClient.saveChapter(rename.id, { title: rename.value.trim() }).then(() => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('已重命名章节'); });
    else apiClient.updateVolume(rename.id, { title: rename.value.trim() }).then(() => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('已重命名卷'); });
    setRename(null);
  }

  if (isLoading || !novel) return <AppShell breadcrumbs={[{ label: '作品' }]}><div className="space-y-3"><Skeleton className="h-9 w-64" /><SkeletonCard /></div></AppShell>;

  function submitChapter(e: React.FormEvent) { e.preventDefault(); if (!title.trim()) return; createChapter.mutate({ title: title.trim(), outlineText: outline || undefined }); }

  const chapters = novel.chapters ?? [];
  const volumes = [...(novel.volumes ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // 分组：各卷 + 未分卷
  const groups = [
    ...volumes.map((v) => ({ volume: v, list: chapters.filter((c) => c.volumeId === v.id) })),
    { volume: null as any, list: chapters.filter((c) => c.volumeId == null) },
  ].filter((g) => g.list.length > 0 || g.volume);

  return (
    <AppShell
      breadcrumbs={[{ label: '我的作品', href: '/' }, { label: novel.title }]}
      sidebar={<WorkbenchNav tab={tab} setTab={setTab} chapterCount={chapters.length} issueCount={openIssueCount} />}
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
            <IconButton icon={Pencil} label="重命名作品" size="sm" onClick={() => setRename({ kind: 'novel', id: novelId, value: novel.title })} />
            {novel.bookSummary && <Badge tone="accent">已建记忆</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">{novel.genre || '未分类'} · {novel.wordCount.toLocaleString()} 字 · {chapters.length} 章 · {volumes.length} 卷</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={Plus} onClick={() => setShowNew((s) => !s)}>新建章节</Button>
          <Menu align="end" trigger={<Button variant="secondary" size="sm" iconRight={MoreHorizontal}>生成</Button>} items={[
            { label: '批量生成（多章计划）', icon: Sparkles, onClick: () => setBatchOpen(true) },
            { label: '整书生成（autopilot）', icon: Wand2, onClick: () => setAutopilotOpen(true) },
            { divider: true, label: '' },
            { label: '批量改标题', icon: Pencil, onClick: () => setBatchTitlesOpen(true) },
          ]} />
        </div>
      </div>

      {showNew && (
        <Card variant="outline" className="mb-5 animate-slide-up">
          <form onSubmit={submitChapter} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1"><Label>章节标题</Label><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：初入宗门" autoFocus /></div>
            <div className="min-w-[18rem] flex-1"><Label>章纲（可选）</Label><TextInput value={outline} onChange={(e) => setOutline(e.target.value)} placeholder="本章要点 / 情节" /></div>
            <Button type="submit" loading={createChapter.isPending} disabled={!title.trim()} icon={PenLine}>创建并编辑</Button>
          </form>
        </Card>
      )}

      <section className="min-w-0">
          {tab === 'chapters' && (
            <div>
              {/* 新建卷 */}
              <div className="mb-4 flex items-center gap-2">
                <Layers size={15} className="text-fg-faint" />
                <TextInput value={newVol} onChange={(e) => setNewVol(e.target.value)} placeholder="新建卷名（如：第一卷 起源）" className="h-8 max-w-xs text-sm" onKeyDown={(e) => { if (e.key === 'Enter' && newVol.trim()) { e.preventDefault(); createVolume.mutate(newVol.trim()); } }} />
                <Button size="sm" variant="secondary" icon={Plus} disabled={!newVol.trim()} onClick={() => createVolume.mutate(newVol.trim())}>新建卷</Button>
              </div>

              {chapters.length === 0 && volumes.length === 0 ? (
                <EmptyState icon={ListOrdered} title="还没有章节" desc="新建一章开始创作，或用「批量生成」让 AI 一次产出多章。" action={<div className="flex gap-2"><Button icon={Plus} onClick={() => setShowNew(true)}>新建章节</Button><Button variant="secondary" icon={Sparkles} onClick={() => setBatchOpen(true)}>批量生成</Button></div>} />
              ) : (
                <div className="space-y-5">
                  {groups.map((g, gi) => (
                    <div key={g.volume?.id ?? `nv${gi}`}>
                      <div className="mb-2 flex items-center gap-2 border-b border-border pb-1.5">
                        <Layers size={14} className="text-primary" />
                        <span className="text-sm font-semibold">{g.volume ? g.volume.title : '未分卷'}</span>
                        <span className="text-xxs text-fg-faint">{g.list.length} 章</span>
                        {g.volume && (
                          <div className="ml-auto flex">
                            <IconButton icon={Pencil} label="重命名卷" size="sm" onClick={() => setRename({ kind: 'volume', id: g.volume.id, value: g.volume.title })} />
                            <IconButton icon={Trash2} label="删除卷" size="sm" onClick={async () => { if (await confirm({ title: `删除卷「${g.volume.title}」？`, desc: '卷内章节将转为「未分卷」，不会被删除。', danger: true, confirmText: '删除' })) delVolume.mutate(g.volume.id); }} />
                          </div>
                        )}
                      </div>
                      {g.list.length === 0 ? (
                        <p className="py-2 text-xs text-fg-faint">（本卷暂无章节）</p>
                      ) : (
                        <div className="space-y-2">
                          {g.list.map((c) => (
                            <Card key={c.id} variant="outline" className="flex items-center gap-3 p-3 hover:border-line">
                              <Link href={`/novels/${novelId}/chapters/${c.id}`} className="flex flex-1 items-center gap-3">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-xxs font-medium text-fg-muted">{c.order + 1}</span>
                                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.title}</div><div className="text-xxs text-fg-faint">{c.wordCount.toLocaleString()} 字 · {new Date(c.updatedAt).toLocaleString()}</div></div>
                              </Link>
                              <Badge tone={c.status === 'needs_fix' ? 'warn' : c.status === 'complete' ? 'accent' : 'neutral'}>{c.status === 'needs_fix' ? '待复核' : c.status === 'complete' ? '完成' : c.status === 'writing' ? '写作中' : c.status === 'gen_failed' ? '生成失败' : '草稿'}</Badge>
                              <Menu align="end" trigger={<IconButton icon={MoreVertical} label="更多" size="sm" />} items={[
                                { label: '重命名', icon: Pencil, onClick: () => setRename({ kind: 'chapter', id: c.id, value: c.title }) },
                                { label: '编辑', icon: PenLine, onClick: () => router.push(`/novels/${novelId}/chapters/${c.id}`) },
                                { divider: true, label: '' },
                                ...volumes.map((v) => ({ label: `移至：${v.title}`, onClick: () => moveChapter.mutate({ id: c.id, volumeId: v.id }) })),
                                { label: '移至：未分卷', onClick: () => moveChapter.mutate({ id: c.id, volumeId: null }) },
                                { divider: true, label: '' },
                                { label: '删除', icon: Trash2, danger: true, onClick: async () => { if (await confirm({ title: `删除「${c.title}」？`, danger: true, confirmText: '删除' })) delChapter.mutate(c.id); } },
                              ]} />
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === 'bible' && <EntityBrowser novelId={novelId} />}
          {tab === 'outline' && <OutlinePanel novelId={novelId} />}
          {tab === 'chat' && <AiChat novelId={novelId} />}
          {tab === 'idea' && <IdeaTools novelId={novelId} />}
          {tab === 'consistency' && <ConsistencyPanel novelId={novelId} />}
          {tab === 'insight' && <KnowledgeView novelId={novelId} />}
          {tab === 'cost' && <CostPanel novelId={novelId} />}
        </section>

      <BatchChaptersModal novelId={novelId} open={batchOpen} onClose={() => setBatchOpen(false)} />
      <AutopilotModal novelId={novelId} open={autopilotOpen} onClose={() => setAutopilotOpen(false)} />

      {/* 通用重命名 */}
      <Modal open={!!rename} onClose={() => setRename(null)} title={rename?.kind === 'novel' ? '重命名作品' : rename?.kind === 'volume' ? '重命名卷' : '重命名章节'} size="sm"
        footer={<><Button variant="ghost" onClick={() => setRename(null)}>取消</Button><Button icon={PenLine} onClick={submitRename}>保存</Button></>}>
        <Label>名称</Label>
        <TextInput value={rename?.value ?? ''} onChange={(e) => setRename((r) => (r ? { ...r, value: e.target.value } : r))} placeholder="输入新名称" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }} />
      </Modal>

      {/* 批量改标题 */}
      {batchTitlesOpen && <BatchTitlesModal novelId={novelId} chapters={chapters} onClose={() => setBatchTitlesOpen(false)} />}
    </AppShell>
  );
}

function BatchTitlesModal({ novelId, chapters, onClose }: { novelId: number; chapters: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [titles, setTitles] = useState<Record<number, string>>(() => Object.fromEntries(chapters.map((c) => [c.id, c.title])));
  const [saving, setSaving] = useState(false);
  async function saveAll() {
    setSaving(true);
    try {
      await Promise.all(chapters.filter((c) => titles[c.id] !== c.title).map((c) => apiClient.saveChapter(c.id, { title: titles[c.id].trim() || c.title })));
      qc.invalidateQueries({ queryKey: ['novel', novelId] });
      toast.success('标题已更新');
      onClose();
    } catch { toast.error('保存失败'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="批量修改章节标题" desc="可批量编辑全部章节标题，一次保存。" size="md"
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button icon={PenLine} loading={saving} onClick={saveAll}>保存全部</Button></>}>
      <div className="space-y-2">
        {chapters.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-xxs text-fg-faint">{c.order + 1}</span>
            <TextInput value={titles[c.id] ?? ''} onChange={(e) => setTitles((t) => ({ ...t, [c.id]: e.target.value }))} />
          </div>
        ))}
        {chapters.length === 0 && <p className="text-sm text-fg-muted">还没有章节。</p>}
      </div>
    </Modal>
  );
}

