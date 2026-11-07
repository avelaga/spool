'use client';

import Link from 'next/link';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DENSITY_SCALE, DENSITY_SCALE_SMALL, useDensity } from '@/lib/density.ts';
import type { PhotoTuple, RollDTO } from '@/lib/queries.ts';
import { justify, P, prettyDate, rowHeightFor, rollMeta, thumbUrl, type Block } from '@/lib/view.ts';
import { Scrubber, type Marker } from './Scrubber.tsx';

const OVERSCAN = 1200; // px above/below the viewport to keep mounted

interface Props {
  sections: { roll: RollDTO | null; photos: PhotoTuple[] }[];
  onOpen: (index: number) => void;
  /** Index of the photo to keep in view (e.g. after closing the viewer). */
  focusIndex?: number | null;
  /** Private view: when set, clicks toggle selection instead of opening. */
  selection?: Set<number> | null;
  onSelect?: (index: number, range: boolean) => void;
  /** Toggle every photo in a roll (selection mode, grouped layout). */
  onSelectRoll?: (rollId: number) => void;
  /** Show the roll timeline on the right edge (needs `rolls` in the stream layout). */
  scrubber?: boolean;
  rolls?: Map<number, RollDTO>;
}

export function Grid({ sections, onOpen, focusIndex, selection, onSelect, onSelectRoll, scrubber, rolls }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const density = useDensity();

  // Measure synchronously on mount (first paint is right), then follow resizes.
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!width) return { blocks: [] as Block[], height: 0 };
    const small = width < 600;
    const gap = density === 0 ? (small ? 2 : 3) : small ? 3 : 6;
    return justify(sections, width, {
      gap,
      target: Math.round(rowHeightFor(width) * (small ? DENSITY_SCALE_SMALL : DENSITY_SCALE)[density]),
      header: small ? 64 : 76,
      sectionGap: small ? 28 : 44,
    });
  }, [sections, width, density]);

  // When the grid size changes, keep the photo that was at the top of the screen in view.
  const prev = useRef<{ density: number; blocks: Block[] }>({ density, blocks: [] });
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { density, blocks: layout.blocks };
    if (before.density === density || !before.blocks.length || !ref.current) return;
    const top = ref.current.getBoundingClientRect().top + window.scrollY;
    const y = window.scrollY - top;
    if (y <= 0) return;
    const row = before.blocks.find((b) => b.kind === 'row' && b.y + b.h > y);
    const anchor = row?.kind === 'row' ? row.items[0].index : null;
    if (anchor === null) return;
    const now = layout.blocks.find((b) => b.kind === 'row' && b.items.some((i) => i.index === anchor));
    if (now) window.scrollTo({ top: top + now.y - 12 });
  }, [layout, density]);

  // Track which slice of the page is visible (layout effect: no blank frame after a layout change).
  useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = ref.current!.getBoundingClientRect().top + window.scrollY;
      const y0 = window.scrollY - top - OVERSCAN;
      const y1 = window.scrollY - top + window.innerHeight + OVERSCAN;
      setRange((r) => (r[0] === y0 && r[1] === y1 ? r : [y0, y1]));
    };
    const onScroll = () => (raf ||= requestAnimationFrame(update));
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [layout]);

  // Keep the photo you were viewing on screen when the viewer closes.
  useEffect(() => {
    if (focusIndex == null) return;
    const block = layout.blocks.find((b) => b.kind === 'row' && b.items.some((i) => i.index === focusIndex));
    if (!block) return;
    const top = ref.current!.getBoundingClientRect().top + window.scrollY + block.y;
    if (top < window.scrollY + 80 || top + block.h > window.scrollY + window.innerHeight) {
      window.scrollTo({ top: top - window.innerHeight / 3 });
    }
  }, [focusIndex, layout]);

  const visible = sliceBlocks(layout.blocks, range[0], range[1]);

  // Where each roll starts: its header, or (stream layout) the first row containing it.
  const markers = useMemo(() => {
    const out: Marker[] = [];
    let last: number | null = null;
    for (const b of layout.blocks) {
      if (b.kind === 'header') {
        out.push({ y: b.y, roll: b.roll });
        last = b.roll.id;
      } else {
        for (const it of b.items) {
          const id = it.photo[P.roll];
          if (id === last) continue;
          last = id;
          const roll = rolls?.get(id);
          if (roll && out.at(-1)?.roll.id !== id) out.push({ y: b.y, roll });
        }
      }
    }
    return out;
  }, [layout, rolls]);

  const rollIds = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const sec of sections) if (sec.roll) m.set(sec.roll.id, sec.photos.map((p) => p[P.id]));
    return m;
  }, [sections]);

  return (
    <>
    {/* Outside .grid: its `contain: layout` would pin position:fixed children to the grid. */}
    {scrubber && <Scrubber markers={markers} height={layout.height} grid={ref} />}
    <div ref={ref} className="grid" style={{ height: layout.height }}>
      {visible.map((b) =>
        b.kind === 'header' ? (
          <RollHeader
            key={`h${b.roll.id}`}
            block={b}
            selected={selection ? (rollIds.get(b.roll.id) ?? []).filter((id) => selection.has(id)).length : null}
            onSelectRoll={onSelectRoll}
          />
        ) : (
          b.items.map((it) => (
            <Tile
              key={it.photo[P.id]}
              photo={it.photo}
              index={it.index}
              x={it.x}
              y={b.y}
              w={it.w}
              h={b.h}
              onOpen={onOpen}
              selected={selection ? selection.has(it.photo[P.id]) : null}
              onSelect={onSelect}
            />
          ))
        ),
      )}
    </div>
    </>
  );
}

/** Binary search for the first block that could be visible. */
function sliceBlocks(blocks: Block[], y0: number, y1: number): Block[] {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].y + blocks[mid].h < y0) lo = mid + 1;
    else hi = mid;
  }
  const out: Block[] = [];
  for (let i = lo; i < blocks.length && blocks[i].y <= y1; i++) out.push(blocks[i]);
  return out;
}

function RollHeader({
  block,
  selected,
  onSelectRoll,
}: {
  block: Extract<Block, { kind: 'header' }>;
  /** Selected photos in this roll; null when not selecting. */
  selected: number | null;
  onSelectRoll?: (rollId: number) => void;
}) {
  const r = block.roll;
  const all = selected === block.count;
  return (
    <header className="roll-head" style={{ top: block.y, height: block.h }}>
      <Link href={`/roll/${r.id}`} className="roll-head-link">
        <span className="roll-head-date mono">{prettyDate(r.date)}</span>
        <span className="roll-head-title">{r.title}</span>
      </Link>
      {selected !== null ? (
        <button className="chip roll-head-select" aria-pressed={all} onClick={() => onSelectRoll?.(r.id)}>
          {all ? 'Deselect roll' : 'Select roll'}
          <span className="chip-count mono">{selected ? `${selected}/${block.count}` : block.count}</span>
        </button>
      ) : (
        <span className="roll-head-meta mono">{[...rollMeta(r), `${block.count} fr`].join('  ·  ')}</span>
      )}
    </header>
  );
}

const Tile = memo(function Tile(props: {
  photo: PhotoTuple;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  onOpen: (index: number) => void;
  /** null = not selecting */
  selected: boolean | null;
  onSelect?: (index: number, range: boolean) => void;
}) {
  const { photo, index, x, y, w, h, onOpen, selected, onSelect } = props;
  const id = photo[P.id];
  return (
    <a
      href={`?photo=${id}`}
      className="tile"
      data-index={index}
      data-selected={selected ? '' : undefined}
      data-selecting={selected !== null ? '' : undefined}
      style={{ transform: `translate(${x}px, ${y}px)`, width: w, height: h, backgroundColor: photo[P.color] }}
      onClick={(e) => {
        if (selected !== null) {
          e.preventDefault();
          onSelect?.(index, e.shiftKey);
          return;
        }
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onOpen(index);
      }}
    >
      <img
        src={thumbUrl(photo)}
        alt=""
        decoding="async"
        draggable={false}
        ref={(img) => {
          if (img?.complete) img.dataset.loaded = '';
        }}
        onLoad={(e) => (e.currentTarget.dataset.loaded = '')}
      />
      {photo[P.sel] ? <span className="tile-star" aria-label="Select">★</span> : null}
      {photo[P.priv] ? <LockIcon className="tile-lock" /> : null}
    </a>
  );
});

/** Only ever rendered in the private view (guest data has no private flag). */
export function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor" />
      <path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
