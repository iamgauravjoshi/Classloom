'use client';

import { Toaster } from '@classloom/ui/components/ui/toast';
import { TooltipProvider } from '@classloom/ui/components/ui/tooltip';
import { SerwistProvider } from '@serwist/turbopack/react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { type ReactNode, useState } from 'react';

import { onQueryError, retryQuery } from '@/lib/query-auth-error';

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(() => {
    // Read at error time, so it is the page the person is on when the session ends.
    const onError = (error: unknown) =>
      onQueryError(error, router, window.location.pathname + window.location.search);
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: { staleTime: 30_000, retry: retryQuery, refetchOnWindowFocus: false },
      },
    });
  });

  return (
    <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV !== 'production'}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster>{children}</Toaster>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SerwistProvider>
  );
}
