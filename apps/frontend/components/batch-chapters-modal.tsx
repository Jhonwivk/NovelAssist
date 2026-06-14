'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { Button, Label, Modal, TextArea, TextInput } from './ui';

type Plan = { title: string; outline: string };

export function BatchChaptersModal({ novelId, open, onClose }: { novelId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [count, setCount] = useState(10);
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number; msg: string } | null>(null);
  const [autoContent, setAutoContent] = useState(false);
  const [err, setErr] = useState('');

  async function generatePlan() {
    setBusy('plan');
    setErr('');
    try {
      const r = await apiClient.aiOutlineChapters(novelId, count, instruction || undefined);
      const chapters: Plan[] = r?.result?.chapters ?? [];
      if (!chapters.length) throw new Error('AI 未返回章节计划');
      setPlan(chapters.map((c) => ({ title: c.title ?? '', outline: c.outline ?? '' })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy('');
    }
  }

  function edit(i: number, key: keyof Plan, v: string) {
    setPlan((p) => (p ? p.map((x, idx) => (idx === i ? { ...x, [key]: v } : x)) : p));
  }
  function remove(i: number) {
    setPlan((p) => (p ? p.filter((_, idx) => idx !== i) : p));
  }

  async function createAll() {
    if (!plan || !plan.length) return;
    setErr('');
    setProgress({ done: 0, total: plan.length, msg: '创建章节…' });
    const createdIds: number[] = [];
    try {
      for (let i = 0; i < plan.length; i++) {
        const c = await apiClient.createChapter(novelId, { title: plan[i].title.trim() || `第${i + 1}章`, outlineText: plan[i].outline || undefined });
        createdIds.push(c.id);
        setProgress({ done: i + 1, total: plan.length, msg: `已创建 ${i + 1}/${plan.length}` });
      }

      if (autoContent) {
        for (let i = 0; i < createdIds.length; i++) {
          setProgress({ done: i, total: createdIds.length, msg: `生成正文 ${i}/${createdIds.length}：${plan[i]?.title ?? ''}` });
          await apiClient.generateChapterContent(createdIds[i]);
        }
        setProgress({ done: createdIds.length, total: createdIds.length, msg: '全部完成' });
      }

      qc.invalidateQueries({ queryKey: ['novel', novelId] });
      setTimeout(() => {
        reset();
        onClose();
      }, 600);
    } catch (e) {
      setErr((e instanceof Error ? e.message : '失败') + `（已完成 ${createdIds.length}/${plan.length}）`);
      qc.invalidateQueries({ queryKey: ['novel', novelId] });
    } finally {
      setBusy('');
    }
  }

  function reset() {
    setPlan(null);
    setProgress(null);
    setErr('');
    setInstruction('');
  }

  return (
    <Modal open={open} onClose={onClose} title="✨ 批量生成章节">
      {!plan && (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">根据总纲与设定，AI 一次性生成多章「标题 + 章纲」，可编辑后批量创建。</p>
          <div className="flex items-end gap-3">
            <div>
              <Label>章节数量</Label>
              <TextInput type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="w-24" />
            </div>
            <Button onClick={generatePlan} disabled={!!busy}>{busy === 'plan' ? '生成计划中…' : '生成章节计划'}</Button>
          </div>
          <div>
            <Label>额外要求（可选）</Label>
            <TextArea rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="如：节奏快一些、每 3 章一个小高潮" />
          </div>
          {err && <p className="text-sm text-danger">{err}</p>}
          <p className="text-xs text-fg-faint">提示：先在「大纲」标签生成/导入总纲，批量计划质量更高。</p>
        </div>
      )}

      {plan && !progress && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg-muted">共 {plan.length} 章，可编辑</span>
            <Button variant="ghost" onClick={() => setPlan(null)}>← 重新生成</Button>
          </div>
          <div className="max-h-[40vh] space-y-2 overflow-auto">
            {plan.map((c, i) => (
              <div key={i} className="rounded border border-border bg-surface-2 p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fg-faint">{i + 1}.</span>
                  <TextInput value={c.title} onChange={(e) => edit(i, 'title', e.target.value)} className="text-sm" placeholder="章节标题" />
                  <button onClick={() => remove(i)} className="text-xs text-danger">✕</button>
                </div>
                <TextArea rows={2} value={c.outline} onChange={(e) => edit(i, 'outline', e.target.value)} className="mt-1 text-xs" placeholder="章纲" />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoContent} onChange={(e) => setAutoContent(e.target.checked)} />
            创建后自动生成正文（逐章生成并保存，较慢）
          </label>
          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex gap-2">
            <Button onClick={createAll} disabled={!!busy}>{autoContent ? '创建并生成正文' : '全部创建'}</Button>
            <Button variant="ghost" onClick={onClose}>取消</Button>
          </div>
        </div>
      )}

      {progress && (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm">{progress.msg}</p>
          <div className="mx-auto h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-fg-faint">{progress.done}/{progress.total}</p>
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
