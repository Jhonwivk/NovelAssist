'use client';

import Link from 'next/link';
import { BookOpen, FileText, Library, Sparkles, Plus, MoreVertical, Trash2, Download, Key, Settings, Check, Search } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { Novel } from '@/lib/types';
import { Badge, Button, Card, Disclosure, EmptyState, IconButton, Label, Menu, ProgressBar, SegmentedControl, SkeletonCard, Stat, TextInput, useConfirm, toast } from '@/components/ui';
import { AppShell } from '@/components/app-shell';
import { useEffect, useState } from 'react';

const GENRE_COVERS: { match: string[]; cover: string }[] = [
  { match: ['玄幻', '修真', '仙侠', '武侠'], cover: 'from-violet-600 to-indigo-600' },
  { match: ['科幻', '星际', '机甲'], cover: 'from-emerald-500 to-teal-600' },
  { match: ['末世', '灾难', '末日'], cover: 'from-rose-500 to-orange-500' },
  { match: ['都市', '现实', '职场'], cover: 'from-sky-500 to-blue-600' },
  { match: ['悬疑', '推理', '惊悚'], cover: 'from-amber-500 to-pink-500' },
  { match: ['言情', '女频', '甜宠'], cover: 'from-fuchsia-600 to-purple-600' },
];
const FALLBACK_COVERS = ['from-violet-600 to-indigo-600', 'from-emerald-500 to-teal-600', 'from-rose-500 to-orange-500', 'from-sky-500 to-blue-600', 'from-amber-500 to-pink-500', 'from-fuchsia-600 to-purple-600'];
function coverFor(novel: Novel): string {
  const g = novel.genre ?? '';
  for (const c of GENRE_COVERS) if (c.match.some((m) => g.includes(m))) return c.cover;
  let h = 0;
  for (let i = 0; i < novel.title.length; i++) h = (h * 31 + novel.title.charCodeAt(i)) >>> 0;
  return FALLBACK_COVERS[h % FALLBACK_COVERS.length];
}

type Sort = 'recent' | 'words' | 'chapters';

export default function HomePage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: novels, isLoading } = useQuery({ queryKey: ['novels'], queryFn: apiClient.listNovels });
  const remove = useMutation({
    mutationFn: apiClient.deleteNovel,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['novels'] }); toast.success('已删除作品'); },
  });

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const all = novels ?? [];
  const list = all
    .filter((n) => !query.trim() || n.title.toLowerCase().includes(query.trim().toLowerCase()) || (n.genre ?? '').toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      if (sort === 'words') return (b.wordCount ?? 0) - (a.wordCount ?? 0);
      if (sort === 'chapters') return (b.chapters?.length ?? 0) - (a.chapters?.length ?? 0);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  const totalWords = all.reduce((s, n) => s + (n.wordCount ?? 0), 0);
  const totalChapters = all.reduce((s, n) => s + (n.chapters?.length ?? 0), 0);
  const withMemory = all.filter((n) => n.bookSummary).length;

  return (
    <AppShell breadcrumbs={[{ label: '我的作品' }]} actions={<Link href="/novels/new"><Button icon={Plus} size="sm">新建作品</Button></Link>}>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="作品" value={list.length} icon={BookOpen} />
        <Stat label="总字数" value={totalWords.toLocaleString()} icon={FileText} />
        <Stat label="章节" value={totalChapters} icon={Library} />
        <Stat label="已建记忆" value={withMemory} icon={Sparkles} hint="长程记忆" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-overline">全部作品 · {all.length}</h2>
        {all.length > 0 && (
          <div className="flex items-center gap-2">
            <TextInput icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题/题材" className="h-8 w-44 text-sm" />
            <SegmentedControl<Sort>
              size="sm"
              value={sort}
              onChange={setSort}
              options={[{ value: 'recent', label: '最近' }, { value: 'words', label: '字数' }, { value: 'chapters', label: '章节' }]}
            />
          </div>
        )}
      </div>

      {/* API 配置 */}
      <ApiConfigCard />

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
          {list.map((n: Novel) => {
            const chapters = n.chapters ?? [];
            const last = chapters[chapters.length - 1];
            const complete = chapters.filter((c: any) => c.status === 'complete').length;
            const progress = chapters.length ? Math.round((complete / chapters.length) * 100) : 0;
            return (
              <Card key={n.id} variant="elevated" className="group overflow-hidden p-0">
                <Link href={`/novels/${n.id}`}>
                  <div className={`h-20 bg-gradient-to-br ${coverFor(n)} relative`}>
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
                  <div className="mb-1 flex items-center justify-between text-xxs text-fg-faint">
                    <span>完成度</span><span className="tabular-nums">{progress}%（{complete}/{chapters.length}）</span>
                  </div>
                  <ProgressBar value={progress} tone={progress === 100 ? 'accent' : 'primary'} />
                  <div className="mt-2.5 flex items-center justify-between">
                    <div className="flex gap-1">
                      {n.bookSummary && <Badge tone="accent">记忆</Badge>}
                      {chapters.length === 0 && <Badge tone="warn">未开篇</Badge>}
                      {chapters.some((c: any) => c.status === 'needs_fix') && <Badge tone="warn">待复核</Badge>}
                    </div>
                    <Menu
                      align="end"
                      trigger={<IconButton icon={MoreVertical} label="更多操作" size="sm" />}
                      items={[
                        { label: '导出 TXT', icon: Download, onClick: () => window.open(apiClient.exportUrl(n.id, 'txt')) },
                        { label: '导出 Markdown', icon: Download, onClick: () => window.open(apiClient.exportUrl(n.id, 'md')) },
                        { label: '导出 DOCX', icon: Download, onClick: () => window.open(apiClient.exportUrl(n.id, 'docx')) },
                        { label: '导出 EPUB', icon: Download, onClick: () => window.open(apiClient.exportUrl(n.id, 'epub')) },
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

function ApiConfigCard() {
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: () => apiClient.getConfig() });
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) { setBaseUrl(config.base_url ?? ''); setModel(config.model ?? ''); }
  }, [config]);

  async function save() {
    setSaving(true);
    try {
      await apiClient.setConfig({ token: token || undefined, base_url: baseUrl || undefined, model: model || undefined });
      toast.success('已保存，AI 服务正在热重载…');
      setToken('');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['config'] }), 3000);
    } catch { toast.error('保存失败'); }
    finally { setSaving(false); }
  }

  return (
    <div className="mb-6">
      <Disclosure summary={<span className="inline-flex items-center gap-2"><Settings size={14} />API 配置 {config?.has_token ? <Badge tone="accent">已连接</Badge> : <Badge tone="danger">未配置</Badge>}</span>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>API Key（Bearer Token）</Label>
            <TextInput type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={config?.has_token ? '已配置（输入新值覆盖）' : '粘贴 API Key'} />
          </div>
          <div>
            <Label>Base URL</Label>
            <TextInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://open.bigmodel.cn/api/anthropic" />
          </div>
          <div>
            <Label>模型</Label>
            <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder="glm-5.2" />
          </div>
          <div className="flex items-end">
            <Button onClick={save} loading={saving} icon={Check}>保存并热重载</Button>
          </div>
        </div>
        <p className="mt-2 text-xxs text-fg-faint">保存后 AI 服务自动热重载（~3 秒）。Token 仅写入本地 .env（gitignored），不会上传。</p>
      </Disclosure>
    </div>
  );
}
