'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlignLeft, Sparkles, Upload } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { Button, Card, TextInput, toast } from './ui';

export function OutlinePanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: novel } = useQuery({ queryKey: ['novel', novelId], queryFn: () => apiClient.getNovel(novelId) });
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
      {busy === 'opt' && <TextInput className="mb-2" value={optInstruction} onChange={(e) => setOptInstruction(e.target.value)} placeholder="优化要求（可选）" />}
      <textarea rows={14} value={master} onChange={(e) => setMaster(e.target.value)} placeholder="主线、卷目规划、核心冲突走向……" className="w-full rounded-md border border-border bg-surface px-3 py-2 font-serif text-sm text-fg placeholder:text-fg-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--c-ring)]" />
      <div className="mt-2 flex justify-end"><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>保存总纲</Button></div>
    </Card>
  );
}
