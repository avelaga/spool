'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { FACETS, hasActiveFilters, type FacetOption, type FilterState } from '@/lib/view.ts';

interface Props {
  state: FilterState;
  options: Record<string, FacetOption[]>;
  selectCount: number;
  onChange: (s: FilterState) => void;
}

const GAP = 6; // must match .chips gap

export function FilterBar({ state, options, selectCount, onChange }: Props) {
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
        return (
          <div key={f.key} className="facet">
            <span className="facet-label mono">{f.label}</span>
            <FacetChips opts={opts} onToggle={(slug) => toggle(f.key, slug)} />
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

/**
 * One row of chips. Collapsed, it shows only what fits on a single line plus "+N"
 * (selected chips always stay visible). "+N" wraps the rest onto more lines; "Less" folds it back.
 */
function FacetChips({ opts, onToggle }: { opts: FacetOption[]; onToggle: (slug: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [fit, setFit] = useState(opts.length);
  const row = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);

  // Measure every chip in a hidden single-line copy, then fit as many as the row allows.
  useLayoutEffect(() => {
    const calc = () => {
      const width = row.current?.clientWidth ?? 0;
      const kids = [...(ruler.current?.children ?? [])] as HTMLElement[];
      if (!width || !kids.length) return;
      const more = kids.pop()!.offsetWidth; // the sample "+99" chip
      const widths = kids.map((k) => k.offsetWidth);
      const all = widths.reduce((sum, w, i) => sum + w + (i ? GAP : 0), 0);
      if (all <= width) return setFit(widths.length);
      let used = more;
      let n = 0;
      for (const w of widths) {
        if (used + GAP + w > width) break;
        used += GAP + w;
        n++;
      }
      setFit(Math.max(1, n));
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (row.current) ro.observe(row.current);
    return () => ro.disconnect();
  }, [opts]);

  const shown = expanded ? opts : opts.filter((o, i) => i < fit || o.active);
  const hidden = opts.length - shown.length;

  return (
    <div ref={row} className="chips" data-expanded={expanded || undefined}>
      {shown.map((o) => (
        <button
          key={o.slug}
          className="chip"
          aria-pressed={o.active}
          disabled={!o.count && !o.active}
          onClick={() => onToggle(o.slug)}
        >
          {o.value}
          <span className="chip-count mono">{o.count}</span>
        </button>
      ))}
      {hidden > 0 && (
        <button className="chip chip-more" onClick={() => setExpanded(true)} aria-label={`Show ${hidden} more`}>
          +{hidden}
        </button>
      )}
      {expanded && fit < opts.length && (
        <button className="chip chip-more" onClick={() => setExpanded(false)}>
          Less
        </button>
      )}

      {/* Invisible single-line copy used only for measuring. */}
      <div ref={ruler} className="chips-ruler" aria-hidden>
        {opts.map((o) => (
          <span key={o.slug} className="chip">
            {o.value}
            <span className="chip-count mono">{o.count}</span>
          </span>
        ))}
        <span className="chip chip-more">+99</span>
      </div>
    </div>
  );
}
