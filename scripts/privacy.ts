/**
 *   npm run privacy:backup              save the private list to backups/
 *   npm run privacy:restore [file]      merge a backup back in (default: backups/privacy-latest.json)
 *   npm run privacy:status              show whether guests are locked out
 */
import { backupDir, privacyStatus, restoreBackup, writeBackup } from '../src/lib/privacy-backup.ts';

const [cmd, file] = process.argv.slice(2);
if (cmd === 'backup') {
  const status = privacyStatus();
  if (status.lockdown) {
    console.error(`Refusing: lockdown is active (${status.reason}). Restore first so the good backup isn't overwritten.`);
    process.exit(1);
  }
  console.log(`Saved ${status.actual} private markings → ${writeBackup()}`);
} else if (cmd === 'restore') {
  const r = restoreBackup(file);
  console.log(`Restored ${r.photos} photo markings and ${r.rolls} private rolls.`);
  const s = privacyStatus();
  console.log(s.lockdown ? `Still locked down: ${s.reason}` : `OK: ${s.actual} private markings, guests can browse again.`);
  if (!s.lockdown) writeBackup();
} else if (cmd === 'status') {
  console.log({ ...privacyStatus(), backupDir });
} else {
  console.log('usage: npm run privacy:backup | privacy:restore [file] | privacy:status');
  process.exit(1);
}
