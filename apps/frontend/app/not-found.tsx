import { Compass, Plus } from 'lucide-react';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-fg-faint">
        <Compass size={26} />
      </div>
      <h1 className="text-lg font-semibold">找不到页面</h1>
      <p className="mt-1 text-sm text-fg-muted">这里什么都没有，回首页看看你的作品吧。</p>
      <a href="/" className="mt-5"><Button icon={Plus}>返回首页</Button></a>
    </div>
  );
}
