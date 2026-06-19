import type { Bible, Chapter, Novel } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export interface ChapterGate {
  passed: boolean;
  highIssues: number;
  totalIssues: number;
  overlapPrev: number;
  warnings: string[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  // novels
  listNovels: () => api<Novel[]>('/novels'),
  getNovel: (id: number) => api<Novel>(`/novels/${id}`),
  createNovel: (data: Partial<Novel>) =>
    api<Novel>('/novels', { method: 'POST', body: JSON.stringify(data) }),
  updateNovel: (id: number, data: Partial<Novel>) =>
    api<Novel>(`/novels/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteNovel: (id: number) => api<{ id: number }>(`/novels/${id}`, { method: 'DELETE' }),

  // chapters
  listChapters: (novelId: number) => api<Chapter[]>(`/novels/${novelId}/chapters`),
  getChapter: (id: number) => api<Chapter>(`/chapters/${id}`),
  createChapter: (novelId: number, data: { title: string; outlineText?: string; volumeId?: number }) =>
    api<Chapter>(`/novels/${novelId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  saveChapter: (id: number, data: Partial<Chapter>) =>
    api<Chapter>(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteChapter: (id: number) =>
    api<{ id: number }>(`/chapters/${id}`, { method: 'DELETE' }),

  // 后台分析（L1 抽取 + 一致性 + 摘要，fire-and-forget）
  analyzeChapter: (id: number) =>
    api<{ id: number; status: string }>(`/chapters/${id}/analyze`, { method: 'POST' }),

  // 分卷
  createVolume: (novelId: number, data: { title: string; order?: number }) =>
    api<any>(`/novels/${novelId}/volumes`, { method: 'POST', body: JSON.stringify(data) }),
  updateVolume: (id: number, data: Partial<{ title: string; order: number; summary: string }>) =>
    api<any>(`/volumes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteVolume: (id: number) =>
    api<any>(`/volumes/${id}`, { method: 'DELETE' }),

  // bible
  getBible: (novelId: number) => api<Bible>(`/novels/${novelId}/bible`),
  createEntity: (
    novelId: number,
    data: { type: string; name: string; description?: string; attributes?: Record<string, unknown>; parentId?: number },
  ) =>
    api<Bible['entities'][number]>(`/novels/${novelId}/entities`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateEntity: (id: number, data: Partial<{ name: string; description?: string }>) =>
    api<Bible['entities'][number]>(`/entities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteEntity: (id: number) =>
    api<{ id: number }>(`/entities/${id}`, { method: 'DELETE' }),

  // memory
  summarize: (chapterId: number) =>
    api<{ id: number; content: string }>(`/memory/summarize/${chapterId}`, { method: 'POST' }),

  // export
  exportUrl: (novelId: number, format: 'txt' | 'md' | 'docx' | 'epub') =>
    `${BASE}/export/novels/${novelId}?format=${format}`,

  // 物品栏（带持有者/状态/流转）
  items: (novelId: number) => api<any[]>(`/novels/${novelId}/items`),

  // 角色状态轨迹
  trajectory: (entityId: number) => api<any>(`/entities/${entityId}/trajectory`),

  // 一致性引擎
  consistencyCheck: (chapterId: number) =>
    api<any>(`/consistency/check/${chapterId}`, { method: 'POST' }),
  chapterChanges: (chapterId: number) =>
    api<any>(`/consistency/changes/${chapterId}`),
  runtimeContext: (novelId: number, chapterId: number) =>
    api<any>(`/memory/context?novelId=${novelId}&chapterId=${chapterId}`),
  listIssues: (novelId: number) =>
    api<any[]>(`/consistency/issues?novelId=${novelId}`),
  resolveIssue: (id: number, status: 'resolved' | 'ignored' | 'intentional') =>
    api<any>(`/consistency/issues/${id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) }),
  fixIssue: (id: number) =>
    api<{ success: boolean; message: string }>(`/consistency/issues/${id}/fix`, { method: 'POST' }),

  // 伏笔
  listForeshadows: (novelId: number) =>
    api<any[]>(`/novels/${novelId}/foreshadows`),
  foreshadowReminders: (novelId: number) =>
    api<any[]>(`/novels/${novelId}/foreshadows/reminders`),
  createForeshadow: (novelId: number, data: { title: string; description?: string }) =>
    api<any>(`/novels/${novelId}/foreshadows`, { method: 'POST', body: JSON.stringify(data) }),
  updateForeshadow: (id: number, data: Partial<{ status: string; payoffChapter: number; description: string }>) =>
    api<any>(`/foreshadows/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteForeshadow: (id: number) =>
    api<any>(`/foreshadows/${id}`, { method: 'DELETE' }),

  // 时间线
  timelineEvents: (novelId: number) =>
    api<any[]>(`/novels/${novelId}/timeline`),
  timelineConflicts: (novelId: number) =>
    api<any[]>(`/novels/${novelId}/timeline/conflicts`),
  relationshipGraph: (novelId: number) =>
    api<{ nodes: any[]; edges: any[] }>(`/novels/${novelId}/timeline/graph`),

  // 版本快照
  snapshot: (chapterId: number, reason?: string) =>
    api<any>(`/chapters/${chapterId}/snapshot`, { method: 'POST', body: JSON.stringify({ reason }) }),
  listSnapshots: (chapterId: number) =>
    api<any[]>(`/chapters/${chapterId}/snapshots`),
  diff: (chapterId: number, snapshotId?: number) =>
    api<any[]>(`/chapters/${chapterId}/diff${snapshotId ? `?snapshotId=${snapshotId}` : ''}`),
  rollback: (chapterId: number, snapshotId: number) =>
    api<any>(`/chapters/${chapterId}/rollback/${snapshotId}`, { method: 'POST' }),

  // 文风
  getStyle: (novelId: number) => api<any>(`/novels/${novelId}/style`),
  putStyle: (novelId: number, data: any) =>
    api<any>(`/novels/${novelId}/style`, { method: 'PUT', body: JSON.stringify(data) }),

  // 成本看板
  costStats: (novelId?: number) =>
    api<any>(`/stats/cost${novelId ? `?novelId=${novelId}` : ''}`),

  // API 配置
  getConfig: () => api<any>('/config'),
  setConfig: (data: { token?: string; base_url?: string; model?: string }) =>
    api<any>('/config', { method: 'POST', body: JSON.stringify(data) }),

  // AI 非流式（灵感/书名/简介/钩子/审稿）
  aiIdea: (data: any) => api<any>('/ai/idea', { method: 'POST', body: JSON.stringify(data) }),
  aiTitle: (novelId: number, instruction?: string) =>
    api<any>('/ai/title', { method: 'POST', body: JSON.stringify({ novelId, instruction }) }),
  aiSynopsis: (novelId: number, instruction?: string) =>
    api<any>('/ai/synopsis', { method: 'POST', body: JSON.stringify({ novelId, instruction }) }),
  aiHook: (novelId: number, instruction?: string) =>
    api<any>('/ai/hook', { method: 'POST', body: JSON.stringify({ novelId, instruction }) }),
  aiOutline: (novelId: number, instruction?: string) =>
    api<any>('/ai/outline', { method: 'POST', body: JSON.stringify({ novelId, instruction }) }),
  aiOutlineOptimize: (novelId: number, currentOutline: string, instruction?: string) =>
    api<any>('/ai/outline/optimize', { method: 'POST', body: JSON.stringify({ novelId, currentOutline, instruction }) }),
  aiOutlineChapters: (novelId: number, count: number, instruction?: string) =>
    api<any>('/ai/outline/chapters', { method: 'POST', body: JSON.stringify({ novelId, count, instruction }) }),
  // 统一章节流水线：生成正文 → 落库 → 同步分析 → 门禁（批量/整书生成走此入口）
  generateChapterContent: (chapterId: number) =>
    api<{ id: number; wordCount: number; gate?: ChapterGate }>(`/chapters/${chapterId}/write`, { method: 'POST' }),

  // 设定模板
  listTemplates: () => api<any[]>('/templates'),
  createTemplate: (data: any) =>
    api<any>('/templates', { method: 'POST', body: JSON.stringify(data) }),
  deleteTemplate: (id: number) =>
    api<any>(`/templates/${id}`, { method: 'DELETE' }),
  aiReview: (chapterId: number) =>
    api<any>('/ai/review', { method: 'POST', body: JSON.stringify({ chapterId }) }),

  // 整书编排 + 门禁 + 去AI味 + Beat分解（P0/P1/P2 新增）
  autopilot: (novelId: number, opts: { target?: number; wave?: number; targetWords?: number }) =>
    api<{ written: number; gateFailed: number; failed: number; total: number }>(
      `/novels/${novelId}/autopilot`,
      { method: 'POST', body: JSON.stringify(opts) },
    ),
  analyzeAll: (novelId: number) =>
    api<{ analyzed: number; failed: number; total: number }>(
      `/novels/${novelId}/analyze-all`,
      { method: 'POST' },
    ),
  reflowAll: (novelId: number) =>
    api<{ reflowed: number; total: number }>(
      `/novels/${novelId}/reflow-all`,
      { method: 'POST' },
    ),
  chapterGate: (chapterId: number) => api<ChapterGate>(`/chapters/${chapterId}/gate`),
  humanize: (chapterId: number) =>
    api<{ id: number; wordCount: number; snapshotId: number }>(`/ai/humanize/${chapterId}`, { method: 'POST' }),
  chapterBeats: (novelId: number, data: { chapterTitle?: string; outline: string; instruction?: string }) =>
    api<{ beats: string[] }>(`/ai/chapter-beats`, { method: 'POST', body: JSON.stringify({ novelId, ...data }) }),
  refreshVolume: (novelId: number, volumeId?: number) =>
    api<any>(`/memory/volume/${novelId}${volumeId ? `?volumeId=${volumeId}` : ''}`, { method: 'POST' }),
};

// ---- SSE 流式（AI 生成）----

export interface SseHandlers {
  onToken?: (token: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

function parseSseEvent(raw: string): { type: string; data: string } {
  let type = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { type, data: dataLines.join('\n') };
}

export async function streamSse(path: string, body: unknown, handlers: SseHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : '网络错误');
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    handlers.onError?.(`请求失败 ${res.status}：${text.slice(0, 300)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseEvent(raw);

        if (event.type === 'error') {
          try {
            const parsed = JSON.parse(event.data);
            handlers.onError?.(parsed.message ?? event.data);
          } catch {
            handlers.onError?.(event.data);
          }
          return;
        }
        if (event.data === '[DONE]') {
          handlers.onDone?.();
          return;
        }
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.token) handlers.onToken?.(parsed.token);
        } catch {
          /* ignore malformed */
        }
      }
    }
    handlers.onDone?.();
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : '流读取错误');
  }
}
