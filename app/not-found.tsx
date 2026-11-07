import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark.tsx';

export default function NotFound() {
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
