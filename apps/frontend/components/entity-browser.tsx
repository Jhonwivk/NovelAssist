'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { Button, Disclosure, EmptyState, Label, Modal, SegmentedControl, Select, TextArea, TextInput } from './ui';
import { CharacterTrajectory } from './character-trajectory';
import { ItemPanel, LocationPanel } from './workbench-panels';

type EType = 'character' | 'item' | 'location' | 'organization';

/**
 * 设定库：统一浏览/管理 角色卡 / 物品 / 地点 / 组织（同一张 entities 表）+ 世界观。
 * 取代原来分散的 设定/物品/地点 三个 tab。
 */
export function EntityBrowser({ novelId }: { novelId: number }) {
  const [type, setType] = useState<EType>('character');
  return (
    <section className="space-y-4">
      <WorldviewSection novelId={novelId} />
      <SegmentedControl<EType>
        size="sm"
        value={type}
        onChange={setType}
        options={[
          { value: 'character', label: '角色' },
          { value: 'item', label: '物品' },
          { value: 'location', label: '地点' },
          { value: 'organization', label: '组织' },
        ]}
      />
      {type === 'character' && <CharacterSection novelId={novelId} />}
      {type === 'item' && <ItemPanel novelId={novelId} />}
      {type === 'location' && <LocationPanel novelId={novelId} />}
      {type === 'organization' && <OrgSection novelId={novelId} />}
    </section>
  );
}

function WorldviewSection({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: bible } = useQuery({ queryKey: ['bible', novelId], queryFn: () => apiClient.getBible(novelId) });
  const [worldview, setWorldview] = useState('');
  useEffect(() => { setWorldview(bible?.worldviewText ?? ''); }, [bible?.worldviewText]);
  const save = useMutation({
    mutationFn: (text: string) => apiClient.updateNovel(novelId, { worldviewText: text }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bible', novelId] }); qc.invalidateQueries({ queryKey: ['novel', novelId] }); },
  });
  return (
    <Disclosure summary={<span className="font-medium">世界观 / 设定</span>}>
      <TextArea rows={6} value={worldview} onChange={(e) => setWorldview(e.target.value)} placeholder="境界体系、金手指规则、世界格局……（一致性引擎会以此为硬约束）" />
      <div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate(worldview)}>{save.isPending ? '保存中…' : '保存设定'}</Button></div>
    </Disclosure>
  );
}

function CharacterSection({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: bible } = useQuery({ queryKey: ['bible', novelId], queryFn: () => apiClient.getBible(novelId) });
  const characters = (bible?.entities ?? []).filter((e) => e.type === 'character');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [trajId, setTrajId] = useState<number | null>(null);
  const add = useMutation({
    mutationFn: (data: { type: string; name: string; description: string }) => apiClient.createEntity(novelId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bible', novelId] }); setName(''); setDesc(''); },
  });
  const remove = useMutation({ mutationFn: apiClient.deleteEntity, onSuccess: () => qc.invalidateQueries({ queryKey: ['bible', novelId] }) });

  return (
    <div className="space-y-3">
      {characters.length === 0 ? (
        <EmptyState title="还没有角色" desc="添加角色卡，或写章节后 L1 抽取会自动建立。" />
      ) : (
        <div className="space-y-2">
          {characters.map((c) => (
            <div key={c.id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setTrajId(c.id)}>轨迹</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>删除</Button>
                </div>
              </div>
              {c.description && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{c.description}</p>}
            </div>
          ))}
        </div>
      )}
      <Modal open={trajId !== null} onClose={() => setTrajId(null)} title="角色状态轨迹" size="lg">
        {trajId !== null && <CharacterTrajectory entityId={trajId} onClose={() => setTrajId(null)} />}
      </Modal>
      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="角色名" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="性格 / 外貌 / 背景 / 能力…" />
        <div className="flex justify-end"><Button size="sm" disabled={!name.trim() || add.isPending} onClick={() => add.mutate({ type: 'character', name: name.trim(), description: desc })}>添加角色</Button></div>
      </div>
    </div>
  );
}

function OrgSection({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: bible } = useQuery({ queryKey: ['bible', novelId], queryFn: () => apiClient.getBible(novelId) });
  const orgs = (bible?.entities ?? []).filter((e) => e.type === 'organization');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const add = useMutation({
    mutationFn: () => apiClient.createEntity(novelId, { type: 'organization', name: name.trim(), description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bible', novelId] }); setName(''); setDesc(''); },
  });
  return (
    <div className="space-y-3">
      {orgs.length === 0 ? (
        <EmptyState title="还没有组织/势力" desc="添加宗门、帮派、势力等（L1 抽取也会自动建立）。" />
      ) : (
        <div className="space-y-2">
          {orgs.map((o) => (
            <div key={o.id} className="rounded-md border border-border bg-surface p-3">
              <span className="font-medium">{o.name}</span>
              {o.description && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{o.description}</p>}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="组织/势力名" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="宗旨 / 结构 / 与他方关系" />
        <div className="flex justify-end"><Button size="sm" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>添加组织</Button></div>
      </div>
    </div>
  );
}
