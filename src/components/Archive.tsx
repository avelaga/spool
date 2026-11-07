'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchiveData, PhotoTuple } from '@/lib/queries.ts';
import { ownerFetch } from '@/lib/owner-store.ts';
import { useDragSelect } from '@/lib/use-drag-select.ts';
import { useOwnerKey } from '@/lib/use-owner.ts';
import {
  applyFilters,
  facetOptions,
  hasActiveFilters,
  P,
  readFilters,
  writeFilters,
  type FilterState,
} from '@/lib/view.ts';
import { BackToTop } from './BackToTop.tsx';
import { FilterBar } from './FilterBar.tsx';
import { Grid } from './Grid.tsx';
import { Viewer } from './Viewer.tsx';

// Private-view tools live in their own chunk, downloaded only after unlocking.
const OwnerKit = lazy(() => import('./owner/OwnerKit.tsx'));

interface Props {
  /** Guest data rendered by the server. Replaced in memory by the private view after unlocking. */
  data: ArchiveData;
  /** 'roll' = single roll page: no filters, no section headers. */
  mode: 'archive' | 'roll';
  rollId?: number;
}

export function Archive({ data: guestData, mode, rollId }: Props) {
  const params = useSearchParams();
  const pathname = usePathname();
  const state = useMemo(() => readFilters(new URLSearchParams(params.toString())), [params]);

  // ----- private view: swap in the full data set while a key is held
  const key = useOwnerKey();
  const [ownerData, setOwnerData] = useState<ArchiveData | null>(null);
  const [privateOnly, setPrivateOnly] = useState(false);
  const [selection, setSelection] = useState<Set<number> | null>(null);
  const anchor = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const res = await ownerFetch(`/api/archive${rollId ? `?roll=${rollId}` : ''}`);
    setOwnerData(await res.json());
  }, [rollId]);

  useEffect(() => {
    if (key) reload().catch(() => {});
    else setOwnerData(null);
  }, [key, reload]);

  const owner = !!key && !!ownerData;
  const data = useMemo<ArchiveData>(() => {
    const d = (owner && ownerData) || guestData;
    if (!owner || !privateOnly) return d;
    const photos = d.photos.filter((p) => p[P.priv]);
    const counts = new Map<number, number>();
    for (const p of photos) counts.set(p[P.roll], (counts.get(p[P.roll]) ?? 0) + 1);
    const rolls = d.rolls.filter((r) => counts.has(r.id)).map((r) => ({ ...r, count: counts.get(r.id)! }));
    return { ...d, photos, rolls };
  }, [owner, ownerData, guestData, privateOnly]);

  // ----- filtering
  const rolls = useMemo(() => new Map(data.rolls.map((r) => [r.id, r])), [data.rolls]);
  const selectCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of data.photos) if (p[P.sel]) m.set(p[P.roll], (m.get(p[P.roll]) ?? 0) + 1);
    return m;
  }, [data.photos]);

  const sections = useMemo(
    () =>
      mode === 'roll'
        ? applyFilters(data.rolls, data.photos, { ...state, selects: false, facets: readFilters(new URLSearchParams()).facets })
        : applyFilters(data.rolls, data.photos, state),
    [data, state, mode],
  );
  const flat = useMemo(() => sections.flatMap((s) => s.photos), [sections]);
  const gridSections = useMemo(
    () => (mode === 'roll' || !state.grouped ? [{ roll: null, photos: flat }] : sections),
    [mode, state.grouped, flat, sections],
  );
  const options = useMemo(() => facetOptions(data.rolls, selectCounts, state), [data.rolls, selectCounts, state]);
  const selectCount = useMemo(
    () => applyFilters(data.rolls, data.photos, { ...state, selects: true }).reduce((n, s) => n + s.photos.length, 0),
    [data, state],
  );

  // ----- URL-driven viewer: ?photo=<id>
  const photoId = Number(params.get('photo')) || null;
  const viewerIndex = photoId ? flat.findIndex((p) => p[P.id] === photoId) : -1;
  const pushed = useRef(false);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    if (viewerIndex >= 0) setFocus(viewerIndex);
    else pushed.current = false;
  }, [viewerIndex]);

  const urlWith = (photo: number | null, base = params.toString()) => {
    const sp = new URLSearchParams(base);
    photo ? sp.set('photo', String(photo)) : sp.delete('photo');
    const q = sp.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  const open = (i: number) => {
    window.history.pushState(null, '', urlWith(flat[i][P.id]));
    pushed.current = true;
  };
  const go = (i: number) => window.history.replaceState(null, '', urlWith(flat[i][P.id]));
  const close = () => {
    if (pushed.current) window.history.back();
    else window.history.replaceState(null, '', urlWith(null));
  };
  const setFilters = (s: FilterState) => {
    const q = writeFilters(new URLSearchParams(params.toString()), s).toString();
    window.history.replaceState(null, '', q ? `${pathname}?${q}` : pathname);
  };

  // ----- selection (private view)
  const onSelect = (index: number, range: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev);
      const ids: PhotoTuple[] =
        range && anchor.current !== null
          ? flat.slice(Math.min(anchor.current, index), Math.max(anchor.current, index) + 1)
          : [flat[index]];
      const turnOn = !prev?.has(flat[index][P.id]);
      for (const p of ids) turnOn ? next.add(p[P.id]) : next.delete(p[P.id]);
      return next;
    });
    anchor.current = index;
  };
  /** Whole roll: select every frame, or clear them if they're all selected already. */
  const onSelectRoll = (rollId: number) => {
    const ids = flat.filter((p) => p[P.roll] === rollId).map((p) => p[P.id]);
    setSelection((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) all ? next.delete(id) : next.add(id);
      return next;
    });
    anchor.current = null;
  };
  useDragSelect({ enabled: owner && !!selection, flat, selection, setSelection, anchor });

  const changeSelecting = (s: Set<number> | null) => {
    anchor.current = null;
    setSelection(s);
  };

  const activeLabels = useMemo(
    () => [
      ...Object.values(options).flatMap((opts) => opts.filter((o) => o.active).map((o) => o.value)),
      ...(state.selects ? ['★ Selects'] : []),
    ],
    [options, state.selects],
  );

  const total = flat.length;
  const viewerPhoto = viewerIndex >= 0 ? flat[viewerIndex] : null;

  return (
    <>
      {owner && (
        <Suspense>
          <OwnerKit
            mode={mode}
            roll={mode === 'roll' ? (ownerData?.rolls[0] ?? null) : null}
            flat={flat}
            viewerPhoto={viewerPhoto}
            privateCount={(ownerData?.photos ?? []).filter((p) => p[P.priv]).length}
            lockdown={ownerData?.lockdown ?? null}
            privateOnly={privateOnly}
            setPrivateOnly={setPrivateOnly}
            selection={selection}
            setSelection={changeSelecting}
            reload={reload}
          />
        </Suspense>
      )}

      {mode === 'archive' && !selection && <BackToTop active={activeLabels} />}
      {mode === 'archive' && (
        <>
          <FilterBar state={state} options={options} selectCount={selectCount} onChange={setFilters} />
          <div className="toolbar">
            <span className="mono muted">
              {total.toLocaleString()} frames · {sections.length} rolls
            </span>
            <div className="segmented" role="group" aria-label="Layout">
              <button aria-pressed={state.grouped} onClick={() => setFilters({ ...state, grouped: true })}>
                Rolls
              </button>
              <button aria-pressed={!state.grouped} onClick={() => setFilters({ ...state, grouped: false })}>
                Stream
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Order">
              <button aria-pressed={state.newestFirst} onClick={() => setFilters({ ...state, newestFirst: true })}>
                Newest
              </button>
              <button aria-pressed={!state.newestFirst} onClick={() => setFilters({ ...state, newestFirst: false })}>
                Oldest
              </button>
            </div>
          </div>
        </>
      )}

      {total ? (
        <Grid
          sections={gridSections}
          onOpen={open}
          focusIndex={viewerIndex < 0 ? focus : null}
          selection={owner ? selection : null}
          onSelect={onSelect}
          onSelectRoll={onSelectRoll}
          scrubber={mode === 'archive'}
          rolls={rolls}
        />
      ) : (
        <div className="empty">
          <p>No frames match these filters.</p>
          {hasActiveFilters(state) && (
            <button className="chip" onClick={() => setFilters(readFilters(new URLSearchParams()))}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {viewerIndex >= 0 && <Viewer photos={flat} rolls={rolls} index={viewerIndex} onIndex={go} onClose={close} />}
    </>
  );
}
