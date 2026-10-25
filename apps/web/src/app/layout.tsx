import './globals.css';

import type { ReactNode } from 'react';

/** The real root layout is `[locale]/layout.tsx`; this one only exists for `app/not-found.tsx`. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
