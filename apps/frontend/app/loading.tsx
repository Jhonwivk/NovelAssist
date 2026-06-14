import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 flex h-12 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="ml-auto h-6 w-6 rounded-full" />
      </div>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Skeleton className="mb-6 h-8 w-48" />
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </main>
    </div>
  );
}
