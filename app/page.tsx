import { Suspense } from 'react';
import { Archive } from '@/components/Archive.tsx';
import { Rescan } from '@/components/Rescan.tsx';
import { getArchive } from '@/lib/queries.ts';
import { Wordmark } from '@/components/Wordmark.tsx';

export const dynamic = 'force-dynamic';

export default function Home() {
  const data = getArchive();
  return (
    <main className="page">
      <header className="site-head">
        <Wordmark />
        <Rescan lastAt={data.lastIndex?.at ?? null} />
      </header>
      <Suspense>
        <Archive data={data} mode="archive" />
      </Suspense>
    </main>
  );
}
