import { notFound } from 'next/navigation';
import { UnlockForm } from '@/components/UnlockForm.tsx';
import { unlockPath } from '@/lib/auth.ts';

export const dynamic = 'force-dynamic';

/** Only SPOOL_UNLOCK_PATH resolves; every other single-segment URL is a plain 404. */
export default async function Slug({ params }: { params: Promise<{ slug: string }> }) {
  const path = unlockPath();
  if (!path || decodeURIComponent((await params).slug) !== path) notFound();
  return (
    <main className="unlock">
      <UnlockForm />
    </main>
  );
}
