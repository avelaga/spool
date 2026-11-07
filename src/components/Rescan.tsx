'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function Rescan({ lastAt }: { lastAt: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/rescan', { method: 'POST' });
      const body = await res.json();
      if (!body.ok) throw new Error('Scan failed');
      setMsg(body.changed ? 'Updated' : 'No changes');
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rescan mono muted">
      <span>{busy ? 'Scanning…' : (msg ?? (lastAt ? `Indexed ${ago(lastAt)}` : 'Not indexed yet'))}</span>
      <button onClick={run} disabled={busy} className="rescan-btn" aria-label="Rescan archive" title="Rescan archive">
        ↻
      </button>
    </div>
  );
}
