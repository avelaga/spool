'use client';

import { useEffect, useRef } from 'react';
import type { PhotoTuple } from './queries.ts';
import { P } from './view.ts';

const EDGE = 80; // px from the viewport edge where dragging auto-scrolls
const MAX_SPEED = 28; // px per frame

/**
 * Click-and-drag range selection over grid tiles (mouse / pen; touch keeps scrolling).
 * Press on a tile and drag: everything between the start tile and the tile under the
 * pointer is selected — or deselected, if the start tile was already selected.
 * Dragging near the top/bottom edge scrolls the page. A press without moving is a plain click.
 */
export function useDragSelect(opts: {
  enabled: boolean;
  flat: PhotoTuple[];
  selection: Set<number> | null;
  setSelection: (s: Set<number>) => void;
  /** shared with shift-click so ranges continue from the last drag */
  anchor: React.RefObject<number | null>;
}) {
  const { enabled, flat } = opts;
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!enabled) return;
    let drag: { start: number; last: number; base: Set<number>; add: boolean; moved: boolean; x: number; y: number } | null =
      null;
    let raf = 0;
    let suppressClick = false;

    const tileAt = (x: number, y: number): number | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.tile[data-selecting]');
      const i = el ? Number(el.dataset.index) : NaN;
      return Number.isNaN(i) ? null : i;
    };

    const apply = () => {
      if (!drag) return;
      const next = new Set(drag.base);
      const [lo, hi] = drag.start < drag.last ? [drag.start, drag.last] : [drag.last, drag.start];
      for (let i = lo; i <= hi; i++) {
        const id = flat[i]?.[P.id];
        if (id === undefined) continue;
        drag.add ? next.add(id) : next.delete(id);
      }
      latest.current.setSelection(next);
    };

    const track = () => {
      if (!drag) return;
      const i = tileAt(drag.x, drag.y);
      if (i !== null && i !== drag.last) {
        drag.last = i;
        drag.moved = true;
        apply();
      }
    };

    const autoScroll = () => {
      raf = 0;
      if (!drag) return;
      const h = window.innerHeight;
      const dy =
        drag.y < EDGE ? -((EDGE - drag.y) / EDGE) * MAX_SPEED : drag.y > h - EDGE ? ((drag.y - (h - EDGE)) / EDGE) * MAX_SPEED : 0;
      if (!dy) return;
      window.scrollBy(0, dy);
      track();
      raf = requestAnimationFrame(autoScroll);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch' || e.shiftKey || e.metaKey || e.ctrlKey) return;
      const start = tileAt(e.clientX, e.clientY);
      if (start === null) return;
      e.preventDefault(); // no text selection / native link drag
      const base = new Set(latest.current.selection ?? []);
      drag = { start, last: start, base, add: !base.has(flat[start][P.id]), moved: false, x: e.clientX, y: e.clientY };
      document.documentElement.classList.add('drag-selecting');
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      track();
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };

    const onUp = () => {
      if (!drag) return;
      if (drag.moved) {
        suppressClick = true; // the click that follows pointerup must not toggle the last tile again
        latest.current.anchor.current = drag.last;
      }
      drag = null;
      cancelAnimationFrame(raf);
      raf = 0;
      document.documentElement.classList.remove('drag-selecting');
    };

    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onDragStart = (e: DragEvent) => {
      if ((e.target as Element)?.closest?.('.tile')) e.preventDefault();
    };

    document.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dragstart', onDragStart);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dragstart', onDragStart);
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove('drag-selecting');
    };
  }, [enabled, flat]);
}
