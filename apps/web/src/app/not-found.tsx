import Link from 'next/link';

/** Fallback for requests the locale proxy did not handle; localized 404s live in `[locale]/not-found.tsx`. */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="bg-background text-foreground flex min-h-dvh items-center justify-center p-4">
        <main className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-h3">Page not found</h1>
          <Link className="text-primary-text text-sm underline" href="/">
            Go to dashboard
          </Link>
        </main>
      </body>
    </html>
  );
}
