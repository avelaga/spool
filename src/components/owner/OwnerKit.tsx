'use client';

/**
 * Private-view tools. Lazy-loaded only after unlocking, so none of this ships to guests.
 *   p        toggle private on the photo open in the viewer
 *   s        start / stop selecting in the grid (shift-click selects a range)
 *   Esc      stop selecting
 */
import { useEffect, useState } from 'react';
import type { PhotoTuple, RollDTO } from '@/lib/queries.ts';
import { lock, ownerFetch } from '@/lib/owner-store.ts';
import { P } from '@/lib/view.ts';

interface Props {
  mode: 'archive' | 'roll';
  roll: RollDTO | null;
  flat: PhotoTuple[];
  viewerPhoto: PhotoTuple | null;
  privateCount: number;
  lockdown: string | null;
  privateOnly: boolean;
  setPrivateOnly: (v: boolean) => void;
  selection: Set<number> | null;
  setSelection: (s: Set<number> | null) => void;
  reload: () => Promise<void>;
}

export default function OwnerKit(props: Props) {
  const { mode, roll, flat, viewerPhoto, privateCount, lockdown, privateOnly, setPrivateOnly, selection, setSelection, reload } =
    props;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const send = async (body: object) => {
    setBusy(true);
    try {
      await ownerFetch('/api/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const photos = (n: number) => (n === 1 ? '1 photo' : `${n} photos`);

  /** Only sends photos whose state actually changes; the message counts real changes. */
  const setPhotos = async (list: PhotoTuple[], value: boolean) => {
    const change = list.filter((p) => !!p[P.priv] !== value);
    const already = list.length - change.length;
    const word = value ? 'private' : 'visible';
    if (change.length) await send({ photoIds: change.map((p) => p[P.id]), private: value });
    setToast(
      change.length
        ? `${photos(change.length)} made ${word}${already ? ` · ${already} already ${word}` : ''}`
        : `Already ${word}`,
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || busy) return;
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      if (e.key === 'p' && viewerPhoto) {
        setPhotos([viewerPhoto], !viewerPhoto[P.priv]);
      } else if (e.key === 's' && !viewerPhoto) {
        setSelection(selection ? null : new Set());
      } else if (e.key === 'Escape' && selection) {
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selected = selection ? flat.filter((p) => selection.has(p[P.id])) : [];
  const toHide = selected.filter((p) => !p[P.priv]).length;
  const toShow = selected.length - toHide;

  return (
    <>
      {lockdown && (
        <div className="owner-lockdown" role="alert">
          <strong>Guests currently see nothing.</strong> The private list looks incomplete ({lockdown}). Restore it with{' '}
          <code>npm run privacy:restore</code>, then refresh.
        </div>
      )}
      <div className="owner-bar">
        <span className="owner-dot" aria-hidden />
        <span className="mono">Private view</span>
        <span className="mono muted">{privateCount} private</span>
        <div className="owner-actions">
          {mode === 'roll' && roll && (
            <button
              className="chip"
              disabled={busy}
              onClick={async () => {
                await send({ rollId: roll.id, private: !roll.private });
                setToast(roll.private ? 'Roll made visible' : 'Roll made private');
              }}
            >
              {roll.private ? 'Make roll visible' : 'Make roll private'}
            </button>
          )}
          {mode === 'archive' && (
            <button className="chip" aria-pressed={privateOnly} onClick={() => setPrivateOnly(!privateOnly)}>
              Private only
            </button>
          )}
          <button className="chip" aria-pressed={!!selection} onClick={() => setSelection(selection ? null : new Set())}>
            Select <kbd>S</kbd>
          </button>
          <button className="chip" onClick={lock}>
            Lock
          </button>
        </div>
      </div>

      {selection && (
        <div className="select-bar" role="toolbar" aria-label="Selection">
          <span className="mono">{selected.length} selected</span>
          <button
            className="chip"
            onClick={() => setSelection(new Set(flat.map((p) => p[P.id])))}
            disabled={selected.length === flat.length}
          >
            All in view
          </button>
          <button
            className="chip chip-solid"
            disabled={!toHide || busy}
            onClick={async () => {
              await setPhotos(selected, true);
              setSelection(null);
            }}
          >
            Make private{toHide ? <span className="chip-count mono">{toHide}</span> : null}
          </button>
          <button
            className="chip"
            disabled={!toShow || busy}
            onClick={async () => {
              await setPhotos(selected, false);
              setSelection(null);
            }}
          >
            Make visible{toShow ? <span className="chip-count mono">{toShow}</span> : null}
          </button>
          <button className="chip chip-clear" onClick={() => setSelection(null)}>
            Cancel
          </button>
        </div>
      )}

      {toast && (
        <div className="owner-toast mono" role="status">
          {toast}
        </div>
      )}

      {viewerPhoto && (
        <button
          className="viewer-private"
          data-on={viewerPhoto[P.priv] ? '' : undefined}
          disabled={busy}
          onClick={() => setPhotos([viewerPhoto], !viewerPhoto[P.priv])}
        >
          {viewerPhoto[P.priv] ? 'Private · make visible' : 'Make private'} <kbd>P</kbd>
        </button>
      )}
    </>
  );
}
