'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlignLeft, Check, Copy, Plus, Sparkles, Upload } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { Button, Card, SegmentedControl, TextInput, toast } from './ui';

type Sub = 'outline' | 'idea' | 'title' | 'synopsis' | 'hook';

/**
 * 创作前期面板：总纲 + 灵感/书名/简介/钩子（合并自原 OutlinePanel + IdeaTools）。
 * 都是"开书阶段、定方向/起书名/写简介/想开篇"的元数据生成工具，生成后可一键写回作品字段。
 */
export function OutlinePanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });

  const [sub, setSub] = useState<Sub>('outline');

  // ---- 总纲 ----
  const [master, setMaster] = useState('');
  const [optInstruction, setOptInstruction] = useState('');
  const [busy, setBusy] = useState<'gen' | 'opt' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (novel) setMaster(novel.masterOutline ?? ''); }, [novel]);

  const save = useMutation({ mutationFn: () => apiClient.updateNovel(novelId, { masterOutline: master }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['novel', novelId] }); toast.success('总纲已保存'); } });
  const gen = useMutation({ mutationFn: () => apiClient.aiOutline(novelId), onSuccess: (r) => { const t = r?.content ?? ''; if (t) { setMaster(t); toast.success('已生成总纲'); } } });
  const opt = useMutation({ mutationFn: () => apiClient.aiOutlineOptimize(novelId, master, optInstruction || undefined), onSuccess: (r) => { const t = r?.content ?? ''; if (t) { setMaster(t); toast.success('已优化'); } } });
  async function runGen() { setBusy('gen'); try { await gen.mutateAsync(); } catch { toast.error('生成失败'); } finally { setBusy(null); } }
  async function runOpt() { if (!master.trim()) { toast.error('请先生成或填写总纲'); return; } setBusy('opt'); try { await opt.mutateAsync(); } catch { toast.error('优化失败'); } finally { setBusy(null); } }
  function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { let t = String(reader.result ?? ''); if (f.name.endsWith('.md')) t = t.replace(/```[\s\S]*?```/g, '').trim(); setMaster(t); toast.success(`已导入 ${f.name}`); };
    reader.readAsText(f); e.target.value = '';
  }

  // ---- 灵感 / 书名 / 简介 / 钩子 ----
  const [genre, setGenre] = useState('');
  const [keywords, setKeywords] = useState('');
  const [out, setOut] = useState('');
  const [ideaBusy, setIdeaBusy] = useState(false);
  const update = useMutation({ mutationFn: (data: any) => apiClient.updateNovel(novelId, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['novel', novelId] }) });

  async function run() {
    setIdeaBusy(true); setOut('');
    try {
      let r: any;
      if (sub === 'idea') r = await apiClient.aiIdea({ genre, keywords });
      else if (sub === 'title') r = await apiClient.aiTitle(novelId);
      else if (sub === 'synopsis') r = await apiClient.aiSynopsis(novelId);
      else r = await apiClient.aiHook(novelId);
      setOut(r?.content ?? r?.summary ?? '');
    } catch { toast.error('生成失败'); } finally { setIdeaBusy(false); }
  }
  function copyOut() { navigator.clipboard?.writeText(out); toast.success('已复制到剪贴板'); }
  function applyTitle(t: string) { update.mutate({ title: t.trim() }); toast.success('已设为作品标题'); }
  function applySynopsis() { update.mutate({ synopsis: out.trim() }); toast.success('已设为简介'); }
  function appendOutline() { const cur = novel?.masterOutline ?? ''; update.mutate({ masterOutline: cur + (cur ? '\n\n' : '') + '【开篇钩子】\n' + out.trim() }); toast.success('已加入总纲'); }
  const candidates = sub === 'title'
    ? out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[\d一二三四五六七八九十]+[.、)）\s]+/, '').replace(/^《|》$/g, '').trim()).filter(Boolean)
    : [];

  return (
    <section className="space-y-4">
      <SegmentedControl<Sub>
        value={sub}
        onChange={setSub}
        options={[
          { value: 'outline', label: '总纲' },
          { value: 'idea', label: '灵感' },
          { value: 'title', label: '书名' },
          { value: 'synopsis', label: '简介' },
          { value: 'hook', label: '钩子' },
        ]}
      />

      {sub === 'outline' && (
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
          {busy === 'opt' && <TextInput className="mb-2" value={optInstruction} onChange={(e) => setOptInstruction(e.target.value)} placeholder="优化要求（可选）" />}
          <textarea rows={14} value={master} onChange={(e) => setMaster(e.target.value)} placeholder="主线、卷目规划、核心冲突走向……" className="w-full rounded-md border border-border bg-surface px-3 py-2 font-serif text-sm text-fg placeholder:text-fg-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--c-ring)]" />
          <div className="mt-2 flex justify-end"><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>保存总纲</Button></div>
        </Card>
      )}

      {sub !== 'outline' && (
        <div>
          <p className="mb-3 text-xxs text-fg-faint">生成作品元数据，可一键应用回作品字段。</p>
          {sub === 'idea' && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              <TextInput value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="题材" />
              <TextInput value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="关键词，逗号分隔" />
            </div>
          )}
          <Button onClick={run} loading={ideaBusy} icon={Sparkles} className="mb-3">{ideaBusy ? '生成中…' : '生成'}</Button>

          {out && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={Copy} onClick={copyOut}>复制</Button>
                {sub === 'synopsis' && <Button size="sm" icon={Check} loading={update.isPending} onClick={applySynopsis}>设为简介</Button>}
                {sub === 'hook' && <Button size="sm" icon={Plus} loading={update.isPending} onClick={appendOutline}>加入总纲</Button>}
              </div>
              {sub === 'title' ? (
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
      )}
    </section>
  );
}
