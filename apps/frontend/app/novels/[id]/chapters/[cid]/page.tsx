'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { ChapterEditor } from '@/components/chapter-editor';

export default function ChapterEditorPage({
  params,
}: {
  params: { id: string; cid: string };
}) {
  const novelId = Number(params.id);
  const chapterId = Number(params.cid);

  const { data: chapter, isLoading, error } = useQuery({
    queryKey: ['chapter', chapterId],
    queryFn: () => apiClient.getChapter(chapterId),
  });

  if (isLoading) return <main className="p-10 text-fg-muted">加载章节中…</main>;
  if (error || !chapter) return <main className="p-10 text-danger">章节加载失败</main>;

  return <ChapterEditor key={chapterId} chapter={chapter} novelId={novelId} />;
}
