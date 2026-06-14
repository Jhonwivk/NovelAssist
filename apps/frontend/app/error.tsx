'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-lg font-semibold">出错了</h1>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">页面加载时发生错误。可以重试，或返回继续。</p>
      <div className="mt-5 flex gap-2">
        <Button icon={RotateCw} onClick={reset}>重试</Button>
        <a href="/"><Button variant="ghost">返回首页</Button></a>
      </div>
    </div>
  );
}
