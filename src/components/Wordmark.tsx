import Link from 'next/link';

/**
 * Logo + name, linking home. Drawings come from spool.png / "spool bw.png" at the repo root:
 *   light theme → colour (public/logo.png)
 *   dark theme  → white line drawing (public/logo-bw-inverted.png)
 * CSS picks one, so there's no flash when the theme is known.
 */
export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="Spool — home">
      <img src="/logo.png" alt="" width={50} height={32} className="wordmark-logo logo-light" />
      <img src="/logo-bw-inverted.png" alt="" width={50} height={32} className="wordmark-logo logo-dark" />
      <span>spool</span>
    </Link>
  );
}
