'use client';

import { useEffect, useState } from 'react';

/**
 * Floating pill that appears once the filters are scrolled out of view.
 * Shows the active filters so you know what you're looking at, and takes you back up to change them.
 */
export function BackToTop({ active }: { active: string[] }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 0.8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const summary =
    active.length === 0 ? 'All frames' : active.length <= 3 ? active.join(' · ') : `${active.slice(0, 2).join(' · ')} +${active.length - 2}`;

  return (
    <button
      className="to-top"
      data-shown={shown || undefined}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <span className="to-top-arrow" aria-hidden>
        ↑
      </span>
      <span className="to-top-label">Filters</span>
      <span className="to-top-summary mono">{summary}</span>
    </button>
  );
}
