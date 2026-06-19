'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState, type ReactNode } from 'react';
import { ConfirmProvider } from '@/components/ui';
import { useHtmlTheme } from '@/lib/use-html-theme';

export function Providers({ children }: { children: ReactNode }) {
  const theme = useHtmlTheme();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ConfirmProvider>{children}</ConfirmProvider>
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-fg)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
