'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RollView } from '@/components/RollView.tsx';
import type { ArchiveData, RollDTO } from '@/lib/queries.ts';
import { ownerFetch } from '@/lib/owner-store.ts';
import { useOwnerKey } from '@/lib/use-owner.ts';
import { Wordmark } from '@/components/Wordmark.tsx';

type OwnerRoll = ArchiveData & { neighbors: { prev: RollDTO | null; next: RollDTO | null } };

/**
 * A roll with nothing visible is a real 404 for guests. In the private view, the same
 * page loads the roll with the in-memory key instead.
 */
export default function RollNotFound() {
  const key = useOwnerKey();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<OwnerRoll | null>(null);

  useEffect(() => {
    if (!key) return;
    ownerFetch(`/api/archive?roll=${Number(id)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [key, id]);

  if (key && data?.rolls[0]) return <RollView data={data} neighbors={data.neighbors} />;
  if (key && !data) return <main className="page" />;

  return (
    <main className="page">
      <header className="site-head">
        <Wordmark />
      </header>
      <div className="empty">
        <p>Nothing here.</p>
        <Link href="/" className="chip">
          Back to the archive
        </Link>
      </div>
    </main>
  );
}
