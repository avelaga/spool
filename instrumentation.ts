export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./src/lib/indexer/schedule.ts');
    startScheduler();
  }
}
