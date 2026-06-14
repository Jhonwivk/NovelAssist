'use client';

import { Feather } from 'lucide-react';
import { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Avatar, Breadcrumb } from './ui';
import { ThemeToggle } from './theme-toggle';

export function AppShell({ breadcrumbs, actions, children, max = 'max-w-6xl' }: { breadcrumbs?: { label: string; href?: string }[]; actions?: ReactNode; children: ReactNode; max?: string }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md">
        <a href="/" className="flex items-center gap-2 transition-app hover:opacity-80">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-white shadow-1">
            <Feather size={14} strokeWidth={2.2} />
          </span>
          <span className="hidden text-sm font-semibold sm:inline">NovelAssist</span>
        </a>
        {breadcrumbs && <Breadcrumb items={breadcrumbs} />}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          <ThemeToggle />
          <Avatar name="我" size={26} />
        </div>
      </header>
      <main className={cn('mx-auto px-6 py-8', max)}>{children}</main>
    </div>
  );
}
