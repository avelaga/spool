'use client';

import { useEffect } from 'react';
import { DENSITY_LABELS, setDensity, useDensity, type Density } from '@/lib/density.ts';

/** Compact / default / large grid. Keys: − and = (or +). */
export function DensityControl() {
  const density = useDensity();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.viewer')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      if (e.key === '-' && density > 0) setDensity((density - 1) as Density);
      if ((e.key === '=' || e.key === '+') && density < 2) setDensity((density + 1) as Density);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [density]);

  return (
    <div className="segmented density" role="group" aria-label="Grid size">
      {DENSITY_LABELS.map((label, i) => (
        <button key={label} aria-pressed={density === i} aria-label={label} title={label} onClick={() => setDensity(i as Density)}>
          <GridIcon cells={[4, 3, 2][i]} />
        </button>
      ))}
    </div>
  );
}

/** A tiny n×n grid glyph. */
function GridIcon({ cells }: { cells: number }) {
  const gap = 1.5;
  const size = (14 - gap * (cells - 1)) / cells;
  const rects = [];
  for (let r = 0; r < cells; r++)
    for (let c = 0; c < cells; c++)
      rects.push(<rect key={`${r}${c}`} x={c * (size + gap)} y={r * (size + gap)} width={size} height={size} rx={0.6} />);
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor" aria-hidden>
      {rects}
    </svg>
  );
}
