/** Re-index on startup and every SPOOL_RESCAN_MINUTES (default 10). 0 disables. */
import { runIndex } from './run.ts';

const g = globalThis as unknown as { __spoolTimer?: NodeJS.Timeout };

export function startScheduler() {
  const minutes = Number(process.env.SPOOL_RESCAN_MINUTES ?? 10);
  if (!minutes || g.__spoolTimer) return;

  const tick = () =>
    runIndex((m) => console.log(`[spool] ${m}`))
      .then((s) => {
        if (s.added || s.updated || s.removed) console.log(`[spool] indexed: +${s.added} ~${s.updated} -${s.removed} (${s.ms}ms)`);
      })
      .catch((e) => console.error(`[spool] index failed: ${e.message}`));

  setTimeout(tick, 2_000);
  g.__spoolTimer = setInterval(tick, minutes * 60_000);
}
