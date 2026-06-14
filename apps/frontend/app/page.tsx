'use client';

import Link from 'next/link';
import { BookOpen, FileText, Library, Sparkles, Plus, MoreVertical, Trash2, Download } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { Novel } from '@/lib/types';
import { Badge, Button, Card, EmptyState, IconButton, Menu, ProgressBar, SkeletonCard, Stat, useConfirm, toast } from '@/components/ui';
import { AppShell } from '@/components/app-shell';

const COVERS = [
  'from-violet-600 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-orange-500',
  'from-sky-500 to-blue-600',
  'from-amber-500 to-pink-500',
  'from-fuchsia-600 to-purple-600',
];

export default function HomePage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: novels, isLoading } = useQuery({ queryKey: ['novels'], queryFn: apiClient.listNovels });
  const remove = useMutation({
    mutationFn: apiClient.deleteNovel,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['novels'] }); toast.success('已删除作品'); },
  });

  const list = novels ?? [];
  const totalWords = list.reduce((s, n) => s + (n.wordCount ?? 0), 0);
  const totalChapters = list.reduce((s, n) => s + (n.chapters?.length ?? 0), 0);
  const withMemory = list.filter((n) => n.bookSummary).length;

  return (
    <AppShell breadcrumbs={[{ label: '我的作品' }]} actions={<Link href="/novels/new"><Button icon={Plus} size="sm">新建作品</Button></Link>}>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="作品" value={list.length} icon={BookOpen} />
        <Stat label="总字数" value={totalWords.toLocaleString()} icon={FileText} />
        <Stat label="章节" value={totalChapters} icon={Library} />
        <Stat label="已建记忆" value={withMemory} icon={Sparkles} hint="长程记忆" />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-overline">全部作品</h2>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="还没有作品"
          desc="选一个套路模板快速起步，或自由新建。建书后会先生成大纲。"
          action={<Link href="/novels/new"><Button icon={Plus}>新建第一部作品</Button></Link>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((n: Novel, i) => {
            const chapters = n.chapters ?? [];
            const last = chapters[chapters.length - 1];
            return (
              <Card key={n.id} variant="elevated" className="group overflow-hidden p-0">
                <Link href={`/novels/${n.id}`}>
                  <div className={`h-20 bg-gradient-to-br ${COVERS[i % COVERS.length]} relative`}>
                    <div className="absolute inset-0 bg-black/10" />
                    <div className="absolute bottom-2 left-3 right-10">
                      <div className="line-clamp-1 text-base font-semibold text-white drop-shadow">{n.title}</div>
                      <div className="mt-0.5 text-xxs text-white/80">{n.genre || '未分类'}</div>
                    </div>
                  </div>
                </Link>
                <div className="p-3">
                  <div className="mb-2 flex items-center justify-between text-xxs text-fg-muted">
                    <span>{chapters.length} 章 · {(n.wordCount ?? 0).toLocaleString()} 字</span>
                    <span>{new Date(n.updatedAt).toLocaleDateString()}</span>
                  </div>
                  {last ? (
                    <div className="mb-2 truncate text-xs text-fg-muted">最近：第 {last.order + 1} 章 · {last.title}</div>
                  ) : (
                    <div className="mb-2 text-xs text-fg-faint">尚无章节</div>
                  )}
                  <ProgressBar value={Math.min(100, chapters.length * 8)} />
                  <div className="mt-2.5 flex items-center justify-between">
                    <div className="flex gap-1">
                      {n.bookSummary && <Badge tone="accent">记忆</Badge>}
                      {chapters.length === 0 && <Badge tone="warn">未开篇</Badge>}
                    </div>
                    <Menu
                      align="end"
                      trigger={<IconButton icon={MoreVertical} label="更多" size="sm" className="opacity-0 group-hover:opacity-100" />}
                      items={[
                        { label: '导出 TXT', icon: Download, onClick: () => window.open(apiClient.exportUrl(n.id, 'txt')) },
                        { label: '导出 Markdown', icon: Download, onClick: () => window.open(apiClient.exportUrl(n.id, 'md')) },
                        { divider: true, label: '' },
                        { label: '删除作品', icon: Trash2, danger: true, onClick: async () => { if (await confirm({ title: `删除《${n.title}》？`, desc: '此操作不可恢复，作品与全部章节/设定将一并删除。', danger: true, confirmText: '删除' })) remove.mutate(n.id); } },
                      ]}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
