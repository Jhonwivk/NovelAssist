'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { Entity } from '@/lib/types';
import { Button, Label, Modal, TextArea, TextInput } from './ui';
import { CharacterTrajectory } from './character-trajectory';

export function BiblePanel({ novelId }: { novelId: number }) {
  const qc = useQueryClient();
  const { data: bible } = useQuery({
    queryKey: ['bible', novelId],
    queryFn: () => apiClient.getBible(novelId),
  });

  const [worldview, setWorldview] = useState('');
  useEffect(() => {
    setWorldview(bible?.worldviewText ?? '');
  }, [bible?.worldviewText]);

  const saveWorldview = useMutation({
    mutationFn: (text: string) => apiClient.updateNovel(novelId, { worldviewText: text }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bible', novelId] }),
  });

  const characters = (bible?.entities ?? []).filter((e) => e.type === 'character');

  return (
    <section className="space-y-6">
      <div>
        <Label>世界观 / 设定</Label>
        <TextArea rows={6} value={worldview} onChange={(e) => setWorldview(e.target.value)} />
        <div className="mt-2 flex justify-end">
          <Button
            variant="secondary"
            disabled={saveWorldview.isPending}
            onClick={() => saveWorldview.mutate(worldview)}
          >
            {saveWorldview.isPending ? '保存中…' : '保存设定'}
          </Button>
        </div>
      </div>

      <CharacterList novelId={novelId} characters={characters} />
    </section>
  );
}

function CharacterList({ novelId, characters }: { novelId: number; characters: Entity[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [trajId, setTrajId] = useState<number | null>(null);

  const add = useMutation({
    mutationFn: (data: { type: string; name: string; description: string }) =>
      apiClient.createEntity(novelId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bible', novelId] });
      setName('');
      setDesc('');
    },
  });
  const remove = useMutation({
    mutationFn: apiClient.deleteEntity,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bible', novelId] }),
  });

  return (
    <div>
      <Label>角色卡</Label>
      <div className="space-y-2">
        {characters.map((c) => (
          <div key={c.id} className="rounded-md border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{c.name}</span>
              <div className="flex gap-1">
                <Button variant="secondary" onClick={() => setTrajId(c.id)}>📊 轨迹</Button>
                <Button variant="ghost" onClick={() => remove.mutate(c.id)}>删除</Button>
              </div>
            </div>
            {c.description && <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{c.description}</p>}
          </div>
        ))}
        {characters.length === 0 && <p className="text-sm text-fg-muted">还没有角色，添加一个吧。</p>}
      </div>
      <Modal open={trajId !== null} onClose={() => setTrajId(null)} title="角色状态轨迹">
        {trajId !== null && <CharacterTrajectory entityId={trajId} onClose={() => setTrajId(null)} />}
      </Modal>

      <div className="mt-3 space-y-2 rounded-md border border-dashed border-border p-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="角色名" />
        <TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="性格 / 外貌 / 背景 / 能力…" />
        <div className="flex justify-end">
          <Button
            disabled={!name.trim() || add.isPending}
            onClick={() => add.mutate({ type: 'character', name: name.trim(), description: desc })}
          >
            添加角色
          </Button>
        </div>
      </div>
    </div>
  );
}
