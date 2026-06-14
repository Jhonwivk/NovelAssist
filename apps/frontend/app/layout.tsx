import './globals.css';
import type { Metadata } from 'next';
import { Providers } from './providers';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'NovelAssist · AI 小说创作台',
  description: '面向长篇小说的 AI 创作工作台 — 设定一致性、长程记忆、运行时状态、AI 协作',
};

// 所有页面均客户端数据驱动，跳过静态预渲染
export const dynamic = 'force-dynamic';

// 避免 SSR/CSR 主题闪烁：在 hydration 前按 localStorage 设置 .dark/.light
const themeScript = `(function(){try{var t=localStorage.getItem('na-theme');if(t==='light'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}else{document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
