'use client';

import { useState } from 'react';
import { FACETS, hasActiveFilters, type FacetOption, type FilterState } from '@/lib/view.ts';

interface Props {
  state: FilterState;
  options: Record<string, FacetOption[]>;
  selectCount: number;
  onChange: (s: FilterState) => void;
}

/** Facets shown collapsed to this many chips until expanded. */
const COLLAPSED = 7;

export function FilterBar({ state, options, selectCount, onChange }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const toggle = (facet: string, slug: string) => {
    const next = new Set(state.facets[facet]);
    next.has(slug) ? next.delete(slug) : next.add(slug);
    onChange({ ...state, facets: { ...state.facets, [facet]: next } });
  };

  const clear = () =>
    onChange({ ...state, selects: false, facets: Object.fromEntries(FACETS.map((f) => [f.key, new Set<string>()])) });

  return (
    <nav className="filters" aria-label="Filters">
      {FACETS.map((f) => {
        const opts = options[f.key] ?? [];
        if (!opts.length) return null;
        const expanded = open[f.key] || opts.length <= COLLAPSED + 1;
        const shown = expanded ? opts : opts.filter((o, i) => i < COLLAPSED || o.active);
        return (
          <div key={f.key} className="facet">
            <span className="facet-label mono">{f.label}</span>
            <div className="chips">
              {shown.map((o) => (
                <button
                  key={o.slug}
                  className="chip"
                  aria-pressed={o.active}
                  disabled={!o.count && !o.active}
                  onClick={() => toggle(f.key, o.slug)}
                >
                  {o.value}
                  <span className="chip-count mono">{o.count}</span>
                </button>
              ))}
              {!expanded && (
                <button className="chip chip-more" onClick={() => setOpen({ ...open, [f.key]: true })}>
                  +{opts.length - shown.length}
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className="facet">
        <span className="facet-label mono">Picks</span>
        <div className="chips">
          <button className="chip" aria-pressed={state.selects} onClick={() => onChange({ ...state, selects: !state.selects })}>
            ★ Selects<span className="chip-count mono">{selectCount}</span>
          </button>
          {hasActiveFilters(state) && (
            <button className="chip chip-clear" onClick={clear}>
              Clear all
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
