import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RollView } from '@/components/RollView.tsx';
import { getArchive, getRollNeighbors } from '@/lib/queries.ts';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const roll = getArchive(Number((await params).id)).rolls[0];
  return { title: roll?.title ?? 'Not found' };
}

export default async function RollPage({ params }: Params) {
  const id = Number((await params).id);
  const data = getArchive(id); // guest view: rolls with nothing visible come back empty
  if (!data.rolls[0]) notFound();
  return <RollView data={data} neighbors={getRollNeighbors(id)} />;
}
