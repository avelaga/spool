'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PhotoTuple, RollDTO } from '@/lib/queries.ts';
import { originalUrl, P, prettyDate, rollMeta, thumbUrl, viewUrl } from '@/lib/view.ts';
import { LockIcon } from './Grid.tsx';

interface Props {
  photos: PhotoTuple[];
  rolls: Map<number, RollDTO>;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

export function Viewer({ photos, rolls, index, onIndex, onClose }: Props) {
  const photo = photos[index];
  const roll = rolls.get(photo[P.roll])!;
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Position within its roll ("12 / 36")
  const rollPhotos = photos.filter((p) => p[P.roll] === photo[P.roll]);
  const frame = rollPhotos.indexOf(photo) + 1;

  const prev = () => index > 0 && onIndex(index - 1);
  const next = () => index < photos.length - 1 && onIndex(index + 1);

  useEffect(() => {
    const size = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    size();
    window.addEventListener('resize', size);
    document.documentElement.classList.add('viewer-open');
    return () => {
      window.removeEventListener('resize', size);
      document.documentElement.classList.remove('viewer-open');
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'k') prev();
      else if (e.key === 'ArrowRight' || e.key === 'j') next();
      else if (e.key === 'Escape') onClose();
      else if (e.key === 'i' || e.key === ' ') {
        e.preventDefault();
        setChrome((c) => !c);
      } else if (e.key === 'o') window.open(originalUrl(photo), '_blank');
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Warm the neighbours so arrowing feels instant.
  useEffect(() => {
    for (const i of [index + 1, index - 1, index + 2]) {
      const p = photos[i];
      if (p) new Image().src = viewUrl(p);
    }
  }, [index, photos]);

  // Fit inside the viewport with breathing room.
  // Side margin doubles as the prev/next click zone, so it never overlaps the photo.
  const pad = vp.w < 600 ? 0 : 64;
  const bottom = vp.w < 600 ? 88 : 72;
  const ar = photo[P.w] / photo[P.h];
  const maxW = Math.max(0, vp.w - pad * 2);
  const maxH = Math.max(0, vp.h - pad - bottom);
  const w = Math.min(maxW, maxH * ar);
  const h = w / ar;
  const src = viewUrl(photo);

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${roll.title}, frame ${frame}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const t = touch.current;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
        else if (dy > 90) onClose();
        touch.current = null;
      }}
    >
      <div
        className="viewer-stage"
        style={{ width: w, height: h, top: pad + (maxH - h) / 2, backgroundColor: photo[P.color] }}
        onClick={onClose}
        title="Click to close"
      >
        <img className="viewer-thumb" src={thumbUrl(photo)} alt="" />
        <img
          key={src}
          className="viewer-full"
          src={src}
          alt=""
          data-loaded={loaded === src ? '' : undefined}
          onLoad={() => setLoaded(src)}
        />
      </div>

      <button className="viewer-nav viewer-prev" onClick={prev} disabled={index === 0} aria-label="Previous">
        ‹
      </button>
      <button className="viewer-nav viewer-next" onClick={next} disabled={index === photos.length - 1} aria-label="Next">
        ›
      </button>
      <button className="viewer-close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      <footer className="viewer-caption" data-hidden={!chrome || undefined}>
        <div className="viewer-caption-main">
          <Link href={`/roll/${roll.id}`} className="viewer-roll">
            {roll.title}
          </Link>
          <span className="mono muted">{prettyDate(roll.date)}</span>
        </div>
        <div className="viewer-caption-meta mono muted">
          {photo[P.priv] ? <LockIcon className="viewer-lock" /> : null}
          {photo[P.sel] ? <span className="star">★</span> : null}
          <span>
            {String(frame).padStart(2, '0')} / {String(rollPhotos.length).padStart(2, '0')}
          </span>
          {rollMeta(roll).map((m) => (
            <span key={m}>{m}</span>
          ))}
          <a href={originalUrl(photo)} target="_blank" rel="noreferrer" className="viewer-orig">
            Original ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
