'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send } from 'lucide-react';
import { apiClient, streamSse } from '@/lib/api';
import { Avatar, Button, TextArea, TextInput } from './ui';

// =================== 一致性面板 ===================
export function ConsistencyPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: issues, isLoading } = useQuery({
    queryKey: ['issues', novelId],
    queryFn: () => apiClient.listIssues(novelId),
  });
  const { data: chapters } = useQuery({
    queryKey: ['novel', novelId],
    queryFn: () => apiClient.getNovel(novelId),
  });
  const check = useMutation({
    mutationFn: (cid: number) => apiClient.consistencyCheck(cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues', novelId] }),
  });
  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'resolved' | 'ignored' | 'intentional' }) =>
      apiClient.resolveIssue(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issues', novelId] }),
  });

  const latest = chapters?.chapters?.[(chapters.chapters?.length ?? 0) - 1];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">一致性检查（L1-L5）</h3>
        <Button
          variant="secondary"
          disabled={!latest || check.isPending}
          onClick={() => latest && check.mutate(latest.id)}
        >
          {check.isPending ? '检查中…' : `检查最新章`}
        </Button>
      </div>
      {check.data && <p className="mb-2 text-xs text-fg-muted">本轮发现 {check.data.length} 个问题</p>}
      {isLoading && <p className="text-sm text-fg-muted">加载…</p>}
      <div className="space-y-2">
        {(issues ?? []).filter((i) => i.status === 'open').map((i) => (
          <div key={i.id} className="rounded-md border border-border bg-surface p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-xs text-white ${i.severity === 'high' ? 'bg-danger' : i.severity === 'medium' ? 'bg-warn' : 'bg-fg-faint'}`}>{i.severity}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{i.layer}</span>
              <span className="font-medium">{i.type}</span>
            </div>
            {(JSON.parse(i.entities || '[]') as string[]).length > 0 && (
              <p className="mt-1 text-xs text-fg-muted">涉及：{(JSON.parse(i.entities) as string[]).join('、')}</p>
            )}
            {i.evidence && <p className="mt-1 text-xs">证据：{i.evidence}</p>}
            {i.suggestion && <p className="mt-1 text-xs text-accent">建议：{i.suggestion}</p>}
            <div className="mt-2 flex gap-1">
              <Button variant="secondary" onClick={() => resolve.mutate({ id: i.id, status: 'resolved' })}>已修正</Button>
              <Button variant="ghost" onClick={() => resolve.mutate({ id: i.id, status: 'intentional' })}>有意为之</Button>
              <Button variant="ghost" onClick={() => resolve.mutate({ id: i.id, status: 'ignored' })}>忽略此类</Button>
            </div>
          </div>
        ))}
        {!isLoading && (issues ?? []).filter((i) => i.status === 'open').length === 0 && (
          <p className="text-sm text-fg-muted">暂无未解决问题。写完一章后点「检查最新章」。</p>
        )}
      </div>
    </div>
  );
}

// =================== 灵感工具 ===================
export function IdeaTools({ novelId }: { novelId: number }) {
  const [tab, setTab] = useState<'idea' | 'title' | 'synopsis' | 'hook' | 'outline'>('idea');
  const [genre, setGenre] = useState('');
  const [keywords, setKeywords] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setOut('');
    try {
      let r: any;
      if (tab === 'idea') r = await apiClient.aiIdea({ genre, keywords });
      else if (tab === 'title') r = await apiClient.aiTitle(novelId);
      else if (tab === 'synopsis') r = await apiClient.aiSynopsis(novelId);
      else if (tab === 'hook') r = await apiClient.aiHook(novelId);
      else r = await apiClient.aiOutline(novelId);
      setOut(r?.content ?? r?.summary ?? JSON.stringify(r, null, 2));
    } catch (e) {
      setOut('失败：' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  const tabs: [typeof tab, string][] = [['idea', '灵感'], ['title', '书名'], ['synopsis', '简介'], ['hook', '钩子'], ['outline', '大纲']];

  return (
    <div>
      <h3 className="mb-3 font-semibold">灵感与文案工具</h3>
      <div className="mb-3 flex flex-wrap gap-1">
        {tabs.map(([t, label]) => (
          <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>{label}</Button>
        ))}
      </div>
      {tab === 'idea' && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <TextInput value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="题材" />
          <TextInput value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="关键词，逗号分隔" />
        </div>
      )}
      <Button onClick={run} disabled={busy} className="mb-2">{busy ? '生成中…' : '生成'}</Button>
      {out && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-surface p-3 text-sm">{out}</pre>}
    </div>
  );
}

// =================== AI 对话助手 ===================
type Msg = { role: 'user' | 'assistant'; content: string };
export function AiChat({ novelId }: { novelId: number }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setBusy(true);
    await streamSse('/ai/chat', { novelId, message: text }, {
      onToken: (t) => setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + t };
        return next;
      }),
      onError: (m) => setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', content: '⚠️ ' + m };
        return next;
      }),
      onDone: () => setBusy(false),
    });
    setBusy(false);
  }

  return (
    <div className="flex h-[30rem] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">AI 助手</h3>
        <span className="text-xxs text-fg-faint">带全书记忆</span>
      </div>
      <div className="flex-1 space-y-4 overflow-auto rounded-lg border border-border bg-bg p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-fg-muted">
            <Bot size={28} strokeWidth={1.5} className="mb-2 text-primary" />
            <p>问我任何关于这本书的问题</p>
            <p className="mt-0.5 text-xs text-fg-faint">我会参考设定、前文与运行时状态作答</p>
          </div>
        )}
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const isLast = i === messages.length - 1;
          return (
            <div key={i} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
              {isUser ? <Avatar name="我" size={28} /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Bot size={15} /></span>}
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${isUser ? 'bg-primary text-white' : 'bg-surface-2 text-fg'}`}>
                {m.content}
                {!isUser && busy && isLast && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse-soft bg-primary align-middle" />}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex gap-2">
        <TextInput value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="输入问题，回车发送" />
        <Button onClick={send} loading={busy} icon={Send}>{busy ? '' : '发送'}</Button>
      </div>
    </div>
  );
}

// =================== Token 成本看板 ===================
export function CostPanel({ novelId }: { novelId: number }) {
  const { data } = useQuery({ queryKey: ['cost', novelId], queryFn: () => apiClient.costStats(novelId), refetchInterval: 15000 });
  const t = data?.total;
  return (
    <div>
      <h3 className="mb-3 font-semibold">Token 成本看板</h3>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Stat label="调用次数" v={t?.calls ?? 0} />
        <Stat label="输入 token" v={t?.tokensIn ?? 0} />
        <Stat label="输出 token" v={t?.tokensOut ?? 0} />
        <Stat label="缓存命中" v={t?.cached ?? 0} />
        <Stat label="错误" v={t?.errors ?? 0} />
        <Stat label="估算成本(¥)" v={t?.estCostYuan ?? 0} />
      </div>
      {data?.byType && data.byType.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-fg-muted">按任务类型</p>
          <div className="space-y-1">
            {data.byType.map((b: any) => (
              <div key={b.key} className="flex justify-between text-xs">
                <span>{b.key}</span>
                <span className="text-fg-muted">{b.calls} 次 · 缓存 {b.cached} · {b.tokensIn + b.tokensOut} tok</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded border border-border bg-surface p-2">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="text-lg font-semibold">{typeof v === 'number' ? v.toLocaleString() : v}</div>
    </div>
  );
}

// =================== 伏笔面板 ===================
export function ForeshadowPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: list } = useQuery({ queryKey: ['foreshadows', novelId], queryFn: () => apiClient.listForeshadows(novelId) });
  const { data: reminders } = useQuery({ queryKey: ['foreshadow-reminders', novelId], queryFn: () => apiClient.foreshadowReminders(novelId) });
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const create = useMutation({
    mutationFn: () => apiClient.createForeshadow(novelId, { title: title.trim(), description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['foreshadows', novelId] }); setTitle(''); setDesc(''); },
  });
  const setPayoff = useMutation({
    mutationFn: (id: number) => apiClient.updateForeshadow(id, { status: 'paid_off' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foreshadows', novelId] }),
  });

  return (
    <div>
      <h3 className="mb-3 font-semibold">伏笔状态机</h3>
      {(reminders ?? []).length > 0 && (
        <div className="mb-3 rounded border border-warn/50 bg-warn/10 p-2 text-xs">
          ⏰ {reminders!.length} 个伏笔埋下已久未回收：{reminders!.map((r) => r.title).join('、')}
        </div>
      )}
      <div className="space-y-2">
        {(list ?? []).map((f) => (
          <div key={f.id} className="rounded border border-border bg-surface p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{f.title}</span>
              <span className={`text-xs ${f.status === 'paid_off' ? 'text-accent' : 'text-warn'}`}>
                {f.status === 'paid_off' ? '已回收' : '待回收'}
              </span>
            </div>
            {f.description && <p className="text-xs text-fg-muted">{f.description}</p>}
            {f.status === 'setup' && <Button variant="ghost" onClick={() => setPayoff.mutate(f.id)}>标记已回收</Button>}
          </div>
        ))}
        {(list ?? []).length === 0 && <p className="text-sm text-fg-muted">暂无伏笔。写章节后 L1 抽取会自动识别，或手动添加。</p>}
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="伏笔标题" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="说明（可选）" />
        <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>添加伏笔</Button>
      </div>
    </div>
  );
}

// =================== 物品栏 ===================
export function ItemPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ['items', novelId], queryFn: () => apiClient.items(novelId) });
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = useMutation({
    mutationFn: () => apiClient.createEntity(novelId, { type: 'item', name: name.trim(), description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items', novelId] }); qc.invalidateQueries({ queryKey: ['bible', novelId] }); setName(''); setDesc(''); },
  });
  return (
    <div>
      <h3 className="mb-3 font-semibold">物品栏（持有 / 状态 / 流转）</h3>
      <div className="space-y-2">
        {(items ?? []).map((it: any) => (
          <details key={it.id} className="rounded border border-border bg-surface p-2 text-sm">
            <summary className="flex cursor-pointer items-center justify-between">
              <span className="font-medium">{it.name}</span>
              <span className="text-xs text-fg-muted">持有：{it.currentHolder ?? '无'} · {it.status}</span>
            </summary>
            {it.description && <p className="mt-1 text-xs text-fg-muted">{it.description}</p>}
            {it.transfers?.length > 0 && (
              <div className="mt-1 text-xs text-fg-muted">
                流转：{it.transfers.map((t: any, i: number) => (
                  <span key={i}>{i > 0 && ' → '}{t.holderName}（第{t.chapterOrder + 1}章）</span>
                ))}
              </div>
            )}
          </details>
        ))}
        {(items ?? []).length === 0 && <p className="text-sm text-fg-muted">暂无道具。写章节后 L1 抽取会自动追踪关键道具，或手动添加。</p>}
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="道具名" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="外观 / 能力 / 使用限制" />
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>添加道具</Button>
      </div>
    </div>
  );
}

// =================== 地点栏 ===================
export function LocationPanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: bible } = useQuery({ queryKey: ['bible', novelId], queryFn: () => apiClient.getBible(novelId) });
  const locations = (bible?.entities ?? []).filter((e) => e.type === 'location');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [parentId, setParentId] = useState('');
  const create = useMutation({
    mutationFn: () => apiClient.createEntity(novelId, { type: 'location', name: name.trim(), description: desc, parentId: parentId ? Number(parentId) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bible', novelId] }); setName(''); setDesc(''); setParentId(''); },
  });

  // 构建树
  const byParent = new Map<number | null, any[]>();
  for (const l of locations) {
    const p = (l as any).parentId ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(l);
  }
  const renderNode = (loc: any, depth: number): any => {
    const children = byParent.get(loc.id) ?? [];
    return (
      <div key={loc.id}>
        <div style={{ paddingLeft: depth * 12 }} className="text-sm">
          {depth > 0 && '└ '}
          <span className="font-medium">{loc.name}</span>
          {loc.description && <span className="text-xs text-fg-muted"> — {loc.description}</span>}
        </div>
        {children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <h3 className="mb-3 font-semibold">地点栏（层级）</h3>
      <div className="space-y-1">
        {(byParent.get(null) ?? []).map((l) => renderNode(l, 0))}
        {locations.length === 0 && <p className="text-sm text-fg-muted">暂无地点。手动添加，或写章节后 L1 抽取自动建立。</p>}
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="地点名" />
        <TextInput value={parentId} onChange={(e) => setParentId(e.target.value)} placeholder="父级地点 id（可选，留空为顶级）" className="text-xs" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="描述 / 进入限制" />
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>添加地点</Button>
      </div>
    </div>
  );
}
