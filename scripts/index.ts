/** Manual index run: `npm run index` */
import { runIndex } from '../src/lib/indexer/run.ts';

const stats = await runIndex((m) => console.log(m));
console.log(stats);
