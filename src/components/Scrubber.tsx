'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RollDTO } from '@/lib/queries.ts';
import { prettyDate } from '@/lib/view.ts';

export interface Marker {
  /** y of the roll's first row/header inside the grid */
  y: number;
  roll: RollDTO;
}

interface Props {
  markers: Marker[];
  /** total grid height */
  height: number;
  grid: React.RefObject<HTMLDivElement | null>;
}

const PAD = 24; // track inset from the viewport edges
const HEAD_ROOM = 16; // land a roll just below the top edge

/**
 * Timeline down the right edge: year marks, hover to preview a roll, click/drag to jump,
 * [ and ] for previous/next roll.
 */
export function Scrubber({ markers, height, grid }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [vh, setVh] = useState(0);
  const [pos, setPos] = useState(0); // 0..1 of scrollable grid
  const [hover, setHover] = useState<number | null>(null); // 0..1 under the pointer
  const [dragging, setDragging] = useState(false);
  const [scrolling, setScrolling] = useState(false);

  const gridTop = () => (grid.current ? grid.current.getBoundingClientRect().top + window.scrollY : 0);
  const span = Math.max(1, height - vh * 0.5);

  // Follow the page scroll.
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout>;
    const update = () => {
      setVh(window.innerHeight);
      setPos(Math.min(1, Math.max(0, (window.scrollY - gridTop() + HEAD_ROOM) / span)));
    };
    const onScroll = () => {
      update();
      setScrolling(true);
      clearTimeout(idle);
      idle = setTimeout(() => setScrolling(false), 1200);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      clearTimeout(idle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span]);

  /** The roll that starts at or before grid position y. */
  const markerAt = (y: number) => {
    let lo = 0;
    let hi = markers.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (markers[mid].y <= y) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };

  const jumpToY = (y: number) => window.scrollTo({ top: gridTop() + y - HEAD_ROOM });
  const fractionFromEvent = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  };
  // When scrubbing, snap to the start of the roll under the pointer.
  const jumpToFraction = (f: number) => {
    const m = markers[markerAt(f * span)];
    jumpToY(m ? m.y : f * span);
  };

  // No text selection anywhere on the page while scrubbing (Safari selects across the page otherwise).
  useEffect(() => {
    if (!dragging) return;
    document.documentElement.classList.add('scrubbing');
    window.getSelection()?.removeAllRanges();
    return () => document.documentElement.classList.remove('scrubbing');
  }, [dragging]);

  // [ and ] step through rolls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.viewer')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      if (e.key !== '[' && e.key !== ']') return;
      const here = window.scrollY - gridTop() + HEAD_ROOM + 1;
      const i = markerAt(here);
      const next = e.key === ']' ? markers[i + 1] : markers[here - markers[i].y > 40 ? i : i - 1];
      if (next) jumpToY(next.y);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Year marks, thinned so labels never collide.
  const trackH = Math.max(1, vh - PAD * 2);
  const years = useMemo(() => {
    const out: { year: number; f: number }[] = [];
    let last: number | null = null;
    let lastPx = -Infinity;
    for (const m of markers) {
      const year = m.roll.year;
      if (!year || year === last) continue;
      last = year;
      const f = Math.min(1, m.y / span);
      if (f * trackH - lastPx < 18) continue;
      out.push({ year, f });
      lastPx = f * trackH;
    }
    return out;
  }, [markers, span, trackH]);

  if (!vh || height < vh * 2.5 || markers.length < 2) return null;

  const labelF = hover ?? pos;
  const labelRoll = markers[markerAt(labelF * span)]?.roll;
  const showLabel = hover !== null || dragging || scrolling;

  return (
    <div className="scrubber" data-active={hover !== null || dragging || scrolling || undefined} aria-hidden>
      <div
        ref={track}
        className="scrubber-track"
        onPointerDown={(e) => {
          e.preventDefault(); // don't start a text selection
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          jumpToFraction(fractionFromEvent(e));
        }}
        onPointerMove={(e) => {
          const f = fractionFromEvent(e);
          if (e.pointerType === 'mouse') setHover(f);
          if (dragging) jumpToFraction(f);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onPointerLeave={() => setHover(null)}
      >
        {years.map((y) => (
          <span key={y.year} className="scrubber-year mono" style={{ top: `${y.f * 100}%` }}>
            {y.year}
          </span>
        ))}
        <span className="scrubber-thumb" style={{ top: `${pos * 100}%` }} />
        {hover !== null && <span className="scrubber-hover" style={{ top: `${hover * 100}%` }} />}
        {showLabel && labelRoll && (
          <span className="scrubber-label" style={{ top: `${labelF * 100}%` }}>
            <span className="mono muted">{prettyDate(labelRoll.date)}</span>
            <span>{labelRoll.title}</span>
          </span>
        )}
      </div>
    </div>
  );
}
