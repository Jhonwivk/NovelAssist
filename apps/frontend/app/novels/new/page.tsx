'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Sparkles, Wand2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { AUDIENCES, BUILTIN_TEMPLATES, GENRES, type Template } from '@/lib/templates';
import { Badge, Button, Card, Label, Modal, TextArea, TextInput, toast } from '@/components/ui';
import { AppShell } from '@/components/app-shell';

interface Form {
  title: string; genre: string; theme: string; trope: string;
  coreSetting: string; audience: string; synopsis: string; worldviewText: string; templateName: string;
}
const EMPTY: Form = { title: '', genre: '', theme: '', trope: '', coreSetting: '', audience: '', synopsis: '', worldviewText: '', templateName: '' };

export default function NewNovelPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [err, setErr] = useState('');

  const { data: remote } = useQuery({ queryKey: ['templates'], queryFn: () => apiClient.listTemplates() });
  const templates: Template[] = useMemo(() => (remote && remote.length ? remote : BUILTIN_TEMPLATES), [remote]);

  const saveTpl = useMutation({
    mutationFn: (data: any) => apiClient.createTemplate(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('模板已保存'); setSaveTplOpen(false); setTplName(''); },
  });
  const delTpl = useMutation({
    mutationFn: (id: number) => apiClient.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('已删除模板'); },
  });

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function applyTemplate(t: Template) {
    setForm((f) => ({
      ...f,
      genre: t.genre, theme: t.theme, trope: t.trope, coreSetting: t.coreSetting, audience: t.audience,
      synopsis: f.synopsis || t.synopsisHint, worldviewText: f.worldviewText || t.worldviewSkeleton, templateName: t.name,
    }));
    toast.success(`已套用「${t.name}」模板`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setErr('请填写标题'); return; }
    setSaving(true); setErr('');
    try {
      const { templateName, ...rest } = form;
      const meta = { theme: rest.theme, trope: rest.trope, coreSetting: rest.coreSetting, audience: rest.audience, templateName: templateName || undefined };
      const novel = await apiClient.createNovel({ title: rest.title, genre: rest.genre || undefined, synopsis: rest.synopsis || undefined, worldviewText: rest.worldviewText || undefined, meta });
      toast.success('作品已创建，开始生成大纲');
      router.push(`/novels/${novel.id}?tab=outline`);
    } catch (e) { setErr(e instanceof Error ? e.message : '创建失败'); setSaving(false); }
  }

  function doSaveTpl() {
    if (!tplName.trim()) return;
    saveTpl.mutate({ name: tplName.trim(), genre: form.genre, theme: form.theme, trope: form.trope, coreSetting: form.coreSetting, audience: form.audience, synopsisHint: form.synopsis, worldviewSkeleton: form.worldviewText });
  }

  return (
    <AppShell breadcrumbs={[{ label: '我的作品', href: '/' }, { label: '新建作品' }]} max="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">新建作品</h1>
        <p className="mt-1 text-sm text-fg-muted">选一个套路模板快速起步，或自由填写。建书后会先进入大纲生成。</p>
      </div>

      <div className="mb-6">
        <Label>设定模板</Label>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const active = form.templateName === t.name;
            return (
              <Card key={t.name + (t.id ?? '')} variant={active ? 'elevated' : 'outline'} className="cursor-pointer p-3 hover:border-line" onClick={() => applyTemplate(t)}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.isBuiltin ? <Badge tone="neutral">内置</Badge> : <Badge tone="primary">我的</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-xxs text-fg-muted">{t.coreSetting}</p>
                <div className="mt-1.5 flex gap-1">
                  <Badge tone="neutral">{t.genre}</Badge>
                  <Badge tone="neutral">{t.audience}</Badge>
                  {t.isBuiltin === false && t.id && <button className="ml-auto text-xxs text-danger hover:underline" onClick={(e) => { e.stopPropagation(); delTpl.mutate(t.id!); }}>删除</button>}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <Card variant="outline">
        <form onSubmit={submit} className="space-y-4">
          <datalist id="genres">{GENRES.map((g) => <option key={g} value={g} />)}</datalist>
          <datalist id="audiences">{AUDIENCES.map((a) => <option key={a} value={a} />)}</datalist>

          <div>
            <Label>标题 *</Label>
            <TextInput value={form.title} onChange={set('title')} placeholder="例：星海征途" error={!!err && !form.title.trim()} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>类型</Label><TextInput value={form.genre} onChange={set('genre')} list="genres" placeholder="玄幻 / 都市…" /></div>
            <div><Label>受众</Label><TextInput value={form.audience} onChange={set('audience')} list="audiences" placeholder="男频 / 女频…" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>题材</Label><TextInput value={form.theme} onChange={set('theme')} placeholder="重生 / 末世 / 系统…" /></div>
            <div><Label>叙事套路</Label><TextInput value={form.trope} onChange={set('trope')} placeholder="废柴逆袭 / 扮猪吃虎…" /></div>
          </div>
          <div>
            <Label>核心设定 / 金手指</Label>
            <TextArea rows={3} value={form.coreSetting} onChange={set('coreSetting')} placeholder="本书最核心的卖点与独特机制" />
          </div>
          <div><Label>简介</Label><TextArea rows={2} value={form.synopsis} onChange={set('synopsis')} placeholder="一两句话讲清卖点与主线" /></div>
          <div><Label>世界观 / 设定</Label><TextArea rows={5} value={form.worldviewText} onChange={set('worldviewText')} placeholder="体系、地理、势力、核心规则……AI 会据此保持设定一致" /></div>

          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" loading={saving} icon={Sparkles}>{saving ? '创建中…' : '创建并生成大纲'}</Button>
            <Button type="button" variant="secondary" icon={Save} onClick={() => { setTplName(form.templateName || form.theme || '我的模板'); setSaveTplOpen(true); }}>保存为模板</Button>
            <Button type="button" variant="ghost" onClick={() => router.back()}>取消</Button>
          </div>
        </form>
      </Card>

      <Modal open={saveTplOpen} onClose={() => setSaveTplOpen(false)} title="保存为模板" desc="把当前设定存为可复用的模板。" size="sm"
        footer={<><Button variant="ghost" onClick={() => setSaveTplOpen(false)}>取消</Button><Button icon={Wand2} loading={saveTpl.isPending} onClick={doSaveTpl}>保存</Button></>}>
        <Label>模板名称</Label>
        <TextInput value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="例：我的修真模板" autoFocus />
      </Modal>
    </AppShell>
  );
}
