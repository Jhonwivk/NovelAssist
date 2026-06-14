'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BookOpen, Bot, Check, ChevronDown, Circle, Database, Disc,
  FileSearch, History, Info, Languages, ListChecks, Package, PenLine, Play,
  RotateCw, Save, Search, ShieldCheck, Sparkles, Wand2, Wrench,
} from 'lucide-react';
import { apiClient, streamSse } from '@/lib/api';
import type { Chapter } from '@/lib/types';
import { Avatar, Badge, Button, Card, Chip, Disclosure, EmptyState, Label, Spinner, Tabs, TextArea, TextInput, Tooltip, toast, useConfirm } from './ui';
import { ThemeToggle } from './theme-toggle';
import { IssueMarks, issueMarksKey } from './editor-marks';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type RightTab = 'ai' | 'state' | 'issues' | 'lookup';

function textToHtml(text: string): string {
  return text.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function htmlToText(html: string): string {
  if (typeof window === 'undefined') return html.replace(/<[^>]+>/g, '');
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.innerText;
}
function statusIcon(status: string, hasIssue: boolean): any {
  if (hasIssue) return AlertTriangle;
  if (status === 'complete') return Check;
  if (status === 'writing') return PenLine;
  return Circle;
}

export function ChapterEditor({ chapter, novelId }: { chapter: Chapter; novelId: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [title, setTitle] = useState(chapter.title);
  const [outline, setOutline] = useState(chapter.outlineText ?? '');
  const [instruction, setInstruction] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [charCount, setCharCount] = useState(chapter.wordCount);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [polishPreview, setPolishPreview] = useState('');
  const [rtTab, setRtTab] = useState<RightTab>('ai');
  const [showInfo, setShowInfo] = useState(false);
  const [sceneCfg, setSceneCfg] = useState<{ characterIds: number[]; goals: string }>(() => {
    try {
      const p = JSON.parse(chapter.sceneConfig ?? '{}');
      return { characterIds: p.characterIds ?? [], goals: Array.isArray(p.goals) ? p.goals.join('；') : p.goals ?? '' };
    } catch {
      return { characterIds: [], goals: '' };
    }
  });
  const [selToolbar, setSelToolbar] = useState<{ top: number; left: number } | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const buffer = useRef('');

  const save = useMutation({
    mutationFn: (data: Partial<Chapter>) => apiClient.saveChapter(chapter.id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chapter', chapter.id] }),
  });

  const editor = useEditor({
    extensions: [StarterKit, CharacterCount.configure({}), IssueMarks],
    content: chapter.content || '',
    onUpdate: ({ editor }) => {
      setCharCount(editor.storage.characterCount.characters());
      scheduleSave(editor.getHTML());
    },
    onBlur: ({ editor }) => flushSave(editor.getHTML()),
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setSelToolbar(null);
        return;
      }
      try {
        const coords = editor.view.coordsAtPos(to);
        setSelToolbar({ top: coords.top - 52, left: Math.max(8, coords.left - 80) });
      } catch {
        setSelToolbar(null);
      }
    },
  });

  // 周边数据
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
  const { data: bible } = useQuery({ queryKey: ['bible', novelId], queryFn: () => apiClient.getBible(novelId) });
  const { data: issues } = useQuery({ queryKey: ['issues', novelId], queryFn: () => apiClient.listIssues(novelId) });
  const { data: foreshadows } = useQuery({ queryKey: ['foreshadows', novelId], queryFn: () => apiClient.listForeshadows(novelId) });
  const { data: rt } = useQuery({
    queryKey: ['runtime', chapter.id],
    queryFn: () => apiClient.runtimeContext(novelId, chapter.id),
    enabled: rtTab === 'state',
  });
  const { data: changes, refetch: refetchChanges } = useQuery({
    queryKey: ['changes', chapter.id],
    queryFn: () => apiClient.chapterChanges(chapter.id),
    enabled: rtTab === 'issues',
  });
  const { data: snapshots } = useQuery({ queryKey: ['snapshots', chapter.id], queryFn: () => apiClient.listSnapshots(chapter.id) });

  const chapters = novel?.chapters ?? [];
  const characters = (bible?.entities ?? []).filter((e) => e.type === 'character');
  const chapterIssueIds = new Set(
    (issues ?? []).filter((i) => i.status === 'open' && i.location?.includes(`"chapterId":${chapter.id}`)).map((i) => i.id),
  );
  const issuesByChapter = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of issues ?? []) {
      if (i.status !== 'open') continue;
      const match = i.location?.match(/"chapterId":(\d+)/);
      if (match) m.set(Number(match[1]), (m.get(Number(match[1])) ?? 0) + 1);
    }
    return m;
  }, [issues]);

  // 内联标记：把本章未解决问题 + 伏笔推送给编辑器 decoration 插件
  const markVersion = useRef(0);
  useEffect(() => {
    if (!editor) return;
    const chapterIssues = (issues ?? []).filter((i) => i.status === 'open' && (i.location ?? '').includes(`"chapterId":${chapter.id}`));
    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(issueMarksKey, { issues: chapterIssues, foreshadows: foreshadows ?? [], v: ++markVersion.current }),
      );
    } catch {
      /* ignore */
    }
  }, [editor, issues, foreshadows, chapter.id]);

  // ---- 保存 ----
  function scheduleSave(content: string) {
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => doSave(content), 1500);
  }
  function flushSave(content: string) {
    clearTimeout(timer.current);
    doSave(content);
  }
  async function doSave(content: string) {
    setSaveState('saving');
    try {
      await save.mutateAsync({ content });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }
  async function flushSaveText() {
    if (editor) flushSave(editor.getHTML());
  }

  // ---- AI 流式 ----
  async function generate() {
    if (!editor || aiBusy) return;
    setAiBusy(true); setAiMsg('正在生成本章正文…（含运行时状态）');
    editor.setEditable(false); buffer.current = '';
    await streamSse('/ai/chapter', { novelId, chapterId: chapter.id, instruction: instruction || undefined, targetWords: undefined }, {
      onToken: (t) => { buffer.current += t; editor.commands.setContent(textToHtml(buffer.current), false); },
      onError: (m) => setAiMsg('生成失败：' + m),
      onDone: () => setAiMsg('生成完成，已填入编辑器'),
    });
    editor.setEditable(true); setAiBusy(false); flushSave(editor.getHTML());
  }
  async function continueWriting() {
    if (!editor || aiBusy) return;
    setAiBusy(true); setAiMsg('续写中…');
    editor.setEditable(false); buffer.current = htmlToText(editor.getHTML());
    await streamSse('/ai/continue', { novelId, chapterId: chapter.id, content: buffer.current, instruction: instruction || undefined }, {
      onToken: (t) => { buffer.current += t; editor.commands.setContent(textToHtml(buffer.current), false); },
      onError: (m) => setAiMsg('续写失败：' + m),
      onDone: () => setAiMsg('续写完成'),
    });
    editor.setEditable(true); setAiBusy(false); flushSave(editor.getHTML());
  }
  async function selectionOp(kind: 'polish' | 'expand' | 'rewrite' | 'viewpoint') {
    if (!editor || aiBusy) return;
    const sel = editor.state.selection;
    const text = sel.empty ? '' : editor.state.doc.textBetween(sel.from, sel.to, '\n');
    if (!text.trim()) { setAiMsg('请先在正文中选中要操作的文字'); return; }
    const label = kind === 'polish' ? '润色' : kind === 'expand' ? '扩写' : kind === 'rewrite' ? '改写' : '转视角';
    setAiBusy(true); setAiMsg(`${label}中…`); setPolishPreview(''); setSelToolbar(null);
    let acc = '';
    const body: Record<string, unknown> = kind === 'polish'
      ? { novelId, selection: text, instruction: instruction || undefined }
      : { novelId, text, instruction: instruction || undefined, ...(kind === 'viewpoint' ? { viewpoint: '第一人称' } : {}) };
    await streamSse(`/ai/${kind}`, body, {
      onToken: (t) => { acc += t; setPolishPreview(acc); },
      onError: (m) => setAiMsg(`${label}失败：` + m),
      onDone: () => {
        if (acc.trim()) {
          editor.chain().focus().deleteSelection().insertContent(textToHtml(acc)).run();
          flushSave(editor.getHTML()); setPolishPreview(''); setAiMsg(`已用${label}结果替换选中片段`);
        }
      },
    });
    setAiBusy(false);
  }
  async function summarize() {
    if (aiBusy) return;
    setAiBusy(true); setAiMsg('生成章节摘要中…');
    try { await apiClient.summarize(chapter.id); setAiMsg('摘要已生成'); qc.invalidateQueries({ queryKey: ['chapter', chapter.id] }); }
    catch (e) { setAiMsg('失败：' + (e instanceof Error ? e.message : '')); }
    finally { setAiBusy(false); }
  }
  async function consistencyCheck() {
    if (aiBusy) return;
    setAiBusy(true); setAiMsg('一致性检查中（L1→L4）…');
    try {
      await flushSaveText();
      await apiClient.consistencyCheck(chapter.id);
      setAiMsg('检查完成'); setRtTab('issues');
      qc.invalidateQueries({ queryKey: ['issues', novelId] });
      await refetchChanges();
    } catch (e) { setAiMsg('检查失败：' + (e instanceof Error ? e.message : '')); }
    finally { setAiBusy(false); }
  }
  async function analyzeChapter() { await consistencyCheck(); }
  async function snapshot() {
    try { await apiClient.snapshot(chapter.id, 'manual'); setAiMsg('已存版本快照'); qc.invalidateQueries({ queryKey: ['snapshots', chapter.id] }); }
    catch (e) { setAiMsg('快照失败'); }
  }
  const rollback = useMutation({ mutationFn: (sid: number) => apiClient.rollback(chapter.id, sid), onSuccess: () => qc.invalidateQueries({ queryKey: ['chapter', chapter.id] }) });

  function updateScene(next: { characterIds: number[]; goals: string }) {
    setSceneCfg(next);
    save.mutate({ sceneConfig: JSON.stringify({ characterIds: next.characterIds, goals: next.goals ? next.goals.split(/[；;\n]/).map((s) => s.trim()).filter(Boolean) : [] }) });
  }

  const saveLabel = saveState === 'saving' ? '保存中' : saveState === 'error' ? '未保存' : '已保存';
  const saveTone = saveState === 'error' ? 'text-danger' : saveState === 'saving' ? 'text-fg-muted' : 'text-accent';

  const rtTabs = [
    { key: 'ai', label: 'AI', icon: Bot },
    { key: 'state', label: '状态', icon: Database },
    { key: 'issues', label: '问题', icon: ShieldCheck },
    { key: 'lookup', label: '速查', icon: BookOpen },
  ];

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md">
        <a href={`/novels/${novelId}`} className="flex items-center gap-1.5 text-xs text-fg-muted transition-app hover:text-fg">
          <ChevronDown size={14} className="rotate-90" />
          <span className="max-w-[12rem] truncate">{novel?.title}</span>
        </a>
        <span className="text-fg-faint">/</span>
        <span className="text-xs font-medium">第 {(chapter.order ?? 0) + 1} 章 · {chapter.title}</span>
        <span className="ml-2 text-xxs text-fg-faint">{charCount} 字</span>
        <span className={`ml-1 inline-flex items-center gap-1 text-xxs ${saveTone}`}>
          {saveState === 'saving' && <Spinner size={11} />}
          {saveState === 'saved' && <Check size={12} />}
          {saveLabel}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左栏：章节树 */}
        <aside className="hidden w-52 shrink-0 flex-col overflow-hidden border-r border-border bg-surface md:flex">
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
            <span className="text-overline">章节</span>
            <a href={`/novels/${novelId}`} className="text-fg-faint transition-app hover:text-primary"><PenLine size={14} /></a>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
            {chapters.map((c) => {
              const cur = c.id === chapter.id;
              const Ic = statusIcon(c.status, (issuesByChapter.get(c.id) ?? 0) > 0);
              const issueCount = issuesByChapter.get(c.id) ?? 0;
              return (
                <button
                  key={c.id}
                  onClick={() => router.push(`/novels/${novelId}/chapters/${c.id}`)}
                  className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-app ${cur ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg'}`}
                >
                  <Ic size={14} strokeWidth={2} className={issueCount > 0 ? 'text-danger' : c.status === 'complete' ? 'text-accent' : 'text-fg-faint'} />
                  <span className="flex-1 truncate">{c.title}</span>
                  <span className="text-xxs text-fg-faint opacity-0 group-hover:opacity-100">{c.wordCount}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 中央编辑区 */}
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto w-full max-w-[760px] px-8 py-6">
            <div className="mb-3 flex items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => save.mutate({ title })}
                className="flex-1 border-none bg-transparent px-0 text-xl font-bold text-fg outline-none placeholder:text-fg-faint"
                placeholder="章节标题"
              />
              <button onClick={() => setShowInfo((s) => !s)} className="inline-flex items-center gap-1 text-xs text-fg-muted transition-app hover:text-fg">
                章节信息
                <ChevronDown size={14} className={`transition-app ${showInfo && 'rotate-180'}`} />
              </button>
            </div>

            {showInfo && (
              <Card variant="outline" className="mb-4 animate-slide-up">
                <div className="space-y-3">
                  <div>
                    <Label>章纲</Label>
                    <TextArea rows={3} value={outline} onChange={(e) => setOutline(e.target.value)} onBlur={() => save.mutate({ outlineText: outline })} placeholder="本章要点 / 情节 / 节奏" />
                  </div>
                  <div>
                    <Label>出场角色（生成时注入运行时状态）</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {characters.map((c) => {
                        const on = sceneCfg.characterIds.includes(c.id);
                        return <Chip key={c.id} active={on} onClick={() => updateScene({ characterIds: on ? sceneCfg.characterIds.filter((x) => x !== c.id) : [...sceneCfg.characterIds, c.id], goals: sceneCfg.goals })}>{c.name}</Chip>;
                      })}
                      {characters.length === 0 && <span className="text-xs text-fg-faint">先在「设定」加角色</span>}
                    </div>
                  </div>
                  <TextInput value={sceneCfg.goals} onChange={(e) => updateScene({ characterIds: sceneCfg.characterIds, goals: e.target.value })} placeholder="本章目标，分号分隔" />
                </div>
              </Card>
            )}

            <div className="prose-editor">
              <EditorContent editor={editor} />
            </div>
          </div>
        </main>

        {/* 右栏：4 Tab */}
        <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
          <Tabs tabs={rtTabs} value={rtTab} onChange={(k) => setRtTab(k as RightTab)} className="px-2" />
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {rtTab === 'ai' && (
              <div className="space-y-3">
                <TextArea rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="AI 指令（可选）：如「多写对话、加快节奏」" />
                <div className="grid grid-cols-2 gap-1.5">
                  <Button onClick={generate} disabled={aiBusy} loading={aiBusy} icon={Sparkles} size="sm">生成本章</Button>
                  <Button variant="secondary" onClick={continueWriting} disabled={aiBusy} icon={Play} size="sm">续写</Button>
                  <Button variant="secondary" onClick={summarize} disabled={aiBusy} icon={FileSearch} size="sm">摘要</Button>
                  <Button variant="secondary" onClick={consistencyCheck} disabled={aiBusy} icon={ShieldCheck} size="sm">查问题</Button>
                </div>
                <Button variant="ghost" onClick={snapshot} disabled={aiBusy} icon={Save} size="sm" className="w-full">存为版本快照</Button>
                {aiMsg && <p className="text-xs text-fg-muted">{aiMsg}</p>}
                {polishPreview && <pre className="max-h-40 overflow-auto rounded-md bg-surface-2 p-2 text-xs whitespace-pre-wrap">{polishPreview}</pre>}
                {(snapshots ?? []).length > 0 && (
                  <Disclosure summary={<span className="inline-flex items-center gap-1.5"><History size={13} />历史版本（{(snapshots ?? []).length}）</span>}>
                    <div className="space-y-1">
                      {(snapshots ?? []).map((s: any) => (
                        <div key={s.id} className="flex items-center justify-between text-xxs">
                          <span className="text-fg-faint">{new Date(s.createdAt).toLocaleString()}</span>
                          <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={async () => { if (await confirm({ title: '回滚到该版本？', desc: '当前内容会先自动存一份快照。', confirmText: '回滚' })) rollback.mutate(s.id); }}>
                            <RotateCw size={11} />回滚
                          </button>
                        </div>
                      ))}
                    </div>
                  </Disclosure>
                )}
                <p className="text-xxs text-fg-faint">选中正文文字可唤起浮动工具栏（润色/扩写/改写/视角）。</p>
              </div>
            )}

            {rtTab === 'state' && (
              <div className="space-y-2 text-xs">
                {(rt?.runtime?.characters ?? []).length === 0 && <p className="text-fg-muted">暂无运行时状态。这是第一章，或先在「章节信息」选出场角色。</p>}
                {(rt?.runtime?.characters ?? []).map((c: any) => (
                  <Disclosure key={c.id} defaultOpen summary={<span className="font-medium">{c.name}</span>}>
                    <div className="space-y-1 text-fg-muted">
                      {Object.keys(c.state ?? {}).length > 0 && <div className="text-xxs">{Object.entries(c.state).map(([k, v]) => `${k}=${v}`).join('，')}</div>}
                      {c.known?.length > 0 && <div className="inline-flex items-center gap-1 text-accent"><Check size={11} />已知 {c.known.length} 条</div>}
                      {c.unknown?.length > 0 && <div className="inline-flex items-center gap-1 text-danger"><Info size={11} />不知 {c.unknown.length} 条</div>}
                    </div>
                  </Disclosure>
                ))}
                {(rt?.runtime?.items ?? []).length > 0 && (
                  <Card variant="sunken" className="p-2">
                    <div className="mb-1 inline-flex items-center gap-1.5 font-medium"><Package size={13} />道具</div>
                    {rt.runtime.items.map((i: any, n: number) => <div key={n} className="text-fg-muted">{i.name}（{i.holder}）</div>)}
                  </Card>
                )}
                {(rt?.runtime?.infoConstraints ?? []).length > 0 && (
                  <Card variant="outline" className="border-info/30 p-2">
                    <div className="mb-1 inline-flex items-center gap-1.5 font-medium text-info"><Info size={13} />信息流约束</div>
                    {rt.runtime.infoConstraints.map((i: any, n: number) => <div key={n} className="text-fg-muted">「{i.content}」仅部分角色知晓</div>)}
                  </Card>
                )}
              </div>
            )}

            {rtTab === 'issues' && (
              <div className="space-y-2 text-xs">
                <Button variant="secondary" onClick={analyzeChapter} disabled={aiBusy} loading={aiBusy} icon={ListChecks} className="w-full">分析本章</Button>
                {changes?.analyzed && <p className="text-fg-muted">状态 {changes.counts.states} · 事件 {changes.counts.events} · 物品 {changes.counts.items} · 信息流 {changes.counts.info} · 问题 {changes.counts.issues}</p>}
                {(changes?.issues ?? []).filter((x: any) => x.status === 'open').length === 0 && changes?.analyzed && (
                  <div className="rounded-md border border-accent/30 bg-accent/10 p-2 text-accent">本章无未解决问题</div>
                )}
                {(changes?.issues ?? []).filter((x: any) => x.status === 'open').map((is: any) => (
                  <Card key={is.id} variant={is.severity === 'high' ? 'outline' : 'sunken'} className={`p-2 ${is.severity === 'high' ? 'border-danger/40' : is.severity === 'medium' ? 'border-warn/40' : ''}`}>
                    <div className="flex flex-wrap items-center gap-1"><Badge tone={is.severity === 'high' ? 'danger' : is.severity === 'medium' ? 'warn' : 'neutral'}>{is.severity}</Badge><Badge tone="neutral">{is.layer}</Badge><span className="font-medium">{is.type}</span></div>
                    {is.suggestion && <p className="mt-1 text-fg-muted">{is.suggestion}</p>}
                  </Card>
                ))}
              </div>
            )}

            {rtTab === 'lookup' && (
              <BibleLookup novelId={novelId} bible={bible} sceneCfg={sceneCfg} />
            )}
          </div>
        </aside>
      </div>

      {/* 浮动 AI 工具栏（选中文本时）*/}
      {selToolbar && (
        <div
          className="fixed z-pop flex items-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-1 shadow-pop animate-scale-in"
          style={{ top: Math.max(8, selToolbar.top), left: selToolbar.left }}
        >
          {([['polish', '润色', Wrench], ['expand', '扩写', Sparkles], ['rewrite', '改写', Wand2], ['viewpoint', '视角', Languages]] as ['polish' | 'expand' | 'rewrite' | 'viewpoint', string, any][]).map(([k, label, Ic]) => (
            <Tooltip key={k} label={label}>
              <button onMouseDown={(e) => { e.preventDefault(); selectionOp(k); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg transition-app hover:bg-surface-2">
                <Ic size={14} strokeWidth={2} />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

function BibleLookup({ novelId, bible, sceneCfg }: { novelId: number; bible: any; sceneCfg: { characterIds: number[] } }) {
  const [q, setQ] = useState('');
  const entities = (bible?.entities ?? []).filter((e: any) => !q || e.name.includes(q) || (e.description ?? '').includes(q));
  const present = (bible?.entities ?? []).filter((e: any) => sceneCfg.characterIds.includes(e.id));
  return (
    <div className="space-y-2 text-xs">
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 角色/地点/道具…" icon={Search} />
      {present.length > 0 && (
        <div>
          <div className="mb-1 text-overline">本章出场</div>
          <div className="flex flex-wrap gap-1">
            {present.map((e: any) => <span key={e.id} className="rounded bg-primary-soft px-1.5 py-0.5 text-primary">{e.name}</span>)}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 text-overline">设定条目（{entities.length}）</div>
        <div className="space-y-1">
          {entities.slice(0, 30).map((e: any) => (
            <div key={e.id} className="rounded-md bg-surface-2 p-1.5">
              <div className="flex items-center gap-1"><Badge tone="neutral">{e.type}</Badge><span className="font-medium">{e.name}</span></div>
              {e.description && <p className="mt-0.5 text-fg-muted">{e.description}</p>}
            </div>
          ))}
        </div>
      </div>
      <a href={`/novels/${novelId}`} className="block text-primary hover:underline">打开完整 Bible →</a>
    </div>
  );
}
