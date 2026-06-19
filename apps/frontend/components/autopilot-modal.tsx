'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wand2, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { Button, Label, Modal, ProgressBar, TextInput, toast } from './ui';

/**
 * 整书自动编排（mode c）：总纲 → 全书章纲 → 逐章「生成+分析+门禁」。
 * 后端为单个长任务；前端轮询章节列表展示实时进度，请求结束即完成。
 * 失败/中断可在后端按章节状态续跑（再次调用会跳过已写章节）。
 */
export function AutopilotModal({ novelId, open, onClose }: { novelId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(20);
  const [targetWords, setTargetWords] = useState(3300);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<{ written: number; gateFailed: number; failed: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 轮询章节列表拿实时进度（running 时）
  const { data: novel } = useQuery({
    queryKey: ['novel', novelId],
    queryFn: () => apiClient.getNovel(novelId),
    refetchInterval: running ? 3000 : false,
  });
  const chapters = novel?.chapters ?? [];
  const written = chapters.filter((c: any) => (c.wordCount ?? 0) > 200).length;
  const needsFix = chapters.filter((c: any) => c.status === 'needs_fix').length;

  useEffect(() => {
    if (!open) { setDone(false); setResult(null); setRunning(false); abortRef.current?.abort(); }
  }, [open]);

  async function run() {
    setRunning(true); setDone(false); setResult(null);
    abortRef.current = new AbortController();
    try {
      const r = await apiClient.autopilot(novelId, { target, targetWords });
      setResult(r);
      toast.success(`整书生成完成：${r.written} 章${r.gateFailed ? `（${r.gateFailed} 章待复核）` : ''}`);
    } catch (e) {
      toast.error('整书生成出错：' + (e instanceof Error ? e.message : ''));
    } finally {
      setRunning(false); setDone(true);
      qc.invalidateQueries({ queryKey: ['novel', novelId] });
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    toast.message('已请求停止（后端当前章写完后结束，可再次运行续跑）');
  }

  const pct = target ? Math.min(100, Math.round((written / target) * 100)) : 0;

  return (
    <Modal open={open} onClose={() => { if (!running) onClose(); }} title="✨ 整书生成" size="md"
      footer={
        running ? (
          <Button variant="danger" onClick={stop}>停止</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>{done ? '关闭' : '取消'}</Button>
            {!done && <Button icon={Wand2} onClick={run}>开始生成</Button>}
          </>
        )
      }>
      {!running && !done && (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            一键编排全书：自动生成/补全总纲 → 规划全书章纲 → 逐章「生成正文 + 一致性分析 + 摘要 + 门禁」。
            每章约 1-2 分钟，可中断、可续跑（已写章节自动跳过）。
          </p>
          <div className="flex items-end gap-3">
            <div>
              <Label>目标章数</Label>
              <TextInput type="number" min={1} max={80} value={target} onChange={(e) => setTarget(Math.max(1, Math.min(80, Number(e.target.value) || 1)))} className="w-28" />
            </div>
            <div>
              <Label>每章字数</Label>
              <TextInput type="number" min={800} max={6000} value={targetWords} onChange={(e) => setTargetWords(Math.max(800, Math.min(6000, Number(e.target.value) || 3300)))} className="w-28" />
            </div>
          </div>
          <p className="text-xxs text-fg-faint">提示：每章会走全套记忆+一致性流水线，保证章间连续；门禁会把存疑章节标记为「待复核」。</p>
        </div>
      )}

      {running && (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin text-primary" />
            正在生成… {written}/{target} 章
          </div>
          <ProgressBar value={pct} />
          <div className="flex gap-4 text-xxs text-fg-muted">
            <span>已写 {written} 章</span>
            <span className={needsFix ? 'text-warn' : ''}>待复核 {needsFix} 章</span>
          </div>
          <p className="text-xxs text-fg-faint">可随时停止；已写章节不会丢失，再次运行自动续写剩余章节。</p>
        </div>
      )}

      {done && result && (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 size={18} className="text-primary" />
            完成：共写 {result.written} 章（全作 {result.total} 章）
          </div>
          <div className="flex gap-4 text-xs text-fg-muted">
            <span className="flex items-center gap-1"><AlertTriangle size={13} className="text-warn" /> {result.gateFailed} 章待复核</span>
            {result.failed > 0 && <span className="text-danger">{result.failed} 章失败</span>}
          </div>
          <p className="text-xxs text-fg-faint">前往「章节」查看，待复核章节会在章节树上标黄，可进编辑器用「去AI味 / 一键修复」处理。</p>
        </div>
      )}
    </Modal>
  );
}
