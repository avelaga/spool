import Link from 'next/link';
import { Suspense } from 'react';
import type { ArchiveData, RollDTO } from '@/lib/queries.ts';
import { prettyDate, slug } from '@/lib/view.ts';
import { Archive } from './Archive.tsx';
import { Wordmark } from './Wordmark.tsx';

/** Roll page body. Shared by the server page (guest) and the private-view fallback. */
export function RollView({ data, neighbors }: { data: ArchiveData; neighbors: { prev: RollDTO | null; next: RollDTO | null } }) {
  const roll = data.rolls[0];
  const facts: { label: string; value: string | null; href?: string }[] = [
    { label: 'Format', value: roll.size && `${roll.size}${roll.sizeInferred ? ' (guessed)' : ''}`, href: roll.size ? `/?format=${slug(roll.size)}` : undefined },
    { label: 'Type', value: roll.class, href: roll.class ? `/?type=${slug(roll.class)}` : undefined },
    { label: 'Film', value: roll.film, href: roll.film ? `/?film=${slug(roll.film)}` : undefined },
    { label: 'Tone', value: roll.tone, href: roll.tone ? `/?tone=${slug(roll.tone)}` : undefined },
    { label: 'Collection', value: roll.collection },
  ];

  return (
    <main className="page">
      <header className="site-head">
        <Wordmark />
        <Link href="/" className="mono muted back">
          ← Archive
        </Link>
      </header>

      <section className="roll-intro">
        <p className="mono muted">{prettyDate(roll.date)}</p>
        <h1>{roll.title}</h1>
        <dl className="facts">
          {facts
            .filter((f) => f.value)
            .map((f) => (
              <div key={f.label}>
                <dt className="mono">{f.label}</dt>
                <dd>{f.href ? <Link href={f.href}>{f.value}</Link> : f.value}</dd>
              </div>
            ))}
        </dl>
      </section>

      <Suspense>
        <Archive data={data} mode="roll" rollId={roll.id} />
      </Suspense>

      <nav className="roll-pager">
        <RollLink roll={neighbors.next} dir="Newer" />
        <RollLink roll={neighbors.prev} dir="Older" />
      </nav>
    </main>
  );
}

function RollLink({ roll, dir }: { roll: RollDTO | null; dir: string }) {
  if (!roll) return <span />;
  return (
    <Link href={`/roll/${roll.id}`} className={`roll-pager-link ${dir === 'Older' ? 'is-older' : ''}`}>
      <span className="mono muted">
        {dir === 'Newer' ? '← ' : ''}
        {dir} · {prettyDate(roll.date)}
        {dir === 'Older' ? ' →' : ''}
      </span>
      <span>{roll.title}</span>
    </Link>
  );
}
