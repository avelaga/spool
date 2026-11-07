/**
 * Privacy must fail toward hiding. Runs against a throwaway database.
 * (Run with --conditions=react-server so 'server-only' imports resolve.)
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPOOL_DATA = mkdtempSync(join(tmpdir(), 'spool-test-'));
process.env.SPOOL_BACKUP_DIR = join(process.env.SPOOL_DATA, 'backups');
process.env.SPOOL_PASSWORD = 'correct horse';
process.env.SPOOL_UNLOCK_PATH = 'darkroom';

const { db } = await import('../src/lib/db.ts');
const { getArchive, getPhotoFile, getRollNeighbors } = await import('../src/lib/queries.ts');
const { setPhotosPrivate, setRollPrivate } = await import('../src/lib/privacy.ts');
const { unlock, isOwner } = await import('../src/lib/auth.ts');
const { privacyStatus, restoreBackup, readBackup } = await import('../src/lib/privacy-backup.ts');
const { photoForRequest } = await import('../src/lib/photo-access.ts');

const OWNER = { owner: true };
const guestIds = (roll?: number) => getArchive(roll).photos.map((p) => p[0]).sort();
const ownerPriv = () => Object.fromEntries(getArchive(undefined, OWNER).photos.map((p) => [p[0], p[7]]));

function addPhoto(id: number, rollId: number, path: string, hash: string) {
  db()
    .prepare(
      `INSERT INTO photos (id, path, roll_id, idx, frame_key, hash, bytes, mtime, width, height, seen_run)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, 3, 2, 1)`,
    )
    .run(id, path, rollId, id, String(id), hash);
}

before(() => {
  const ins = db().prepare('INSERT INTO rolls (id, path, title, date, seen_run) VALUES (?, ?, ?, ?, 1)');
  ins.run(1, '2022/22.1.1 a', 'a', '2022-01-01');
  ins.run(2, '2022/22.2.2 b', 'b', '2022-02-02');
  addPhoto(1, 1, '2022/22.1.1 a/1.jpg', 'h1');
  addPhoto(2, 1, '2022/22.1.1 a/2.jpg', 'h2');
  addPhoto(3, 1, '2022/22.1.1 a/3.jpg', 'h3');
  addPhoto(10, 2, '2022/22.2.2 b/10.jpg', 'h10');
});

test('default: everything visible, guest data carries no private flag', () => {
  assert.deepEqual(guestIds(), [1, 10, 2, 3]);
  assert.equal(getArchive().photos[0].length, 7);
  assert.equal(getArchive().rolls[0].private, undefined);
});

test('private:yes hides from guests, owner still sees it flagged', () => {
  setPhotosPrivate([1], true);
  assert.deepEqual(guestIds(), [10, 2, 3]);
  assert.equal(ownerPriv()[1], 1);
  assert.equal(ownerPriv()[2], 0);
  assert.equal(getPhotoFile(1)!.isPrivate, 1);
  assert.equal(getArchive(1).rolls[0].count, 2, 'roll count excludes private frames');
});

test('stays hidden after the file is renamed (hash match)', () => {
  db().prepare('UPDATE photos SET path = ? WHERE id = 1').run('2022/22.1.1 a/renamed.jpg');
  assert.ok(!guestIds().includes(1));
});

test('stays hidden after the file is re-exported in place (path match)', () => {
  db().prepare('UPDATE photos SET hash = ?, path = ? WHERE id = 1').run('h1-edited', '2022/22.1.1 a/1.jpg');
  assert.ok(!guestIds().includes(1));
});

test('private:no un-hides', () => {
  setPhotosPrivate([1], false);
  assert.ok(guestIds().includes(1));
  assert.equal(db().prepare('SELECT COUNT(*) n FROM private_photos').get()!.n, 0, 'no rows needed for the default');
});

test('private roll: hides every frame, including ones added later; roll vanishes for guests', () => {
  setPhotosPrivate([3], true); // hidden one by one before the roll rule
  setRollPrivate(1, true);
  addPhoto(4, 1, '2022/22.1.1 a/4.jpg', 'h4');
  assert.deepEqual(guestIds(), [10]);
  assert.equal(getArchive(1).rolls.length, 0, 'roll page 404s for guests');
  assert.equal(getRollNeighbors(2).prev, null, 'pager skips it');
  assert.equal(getArchive(1, OWNER).rolls[0].private, true);
});

test('a single frame can be made visible inside a private roll (explicit private:no)', () => {
  setPhotosPrivate([2], false);
  assert.deepEqual(guestIds(), [10, 2]);
});

test('private roll survives the roll folder being renamed', () => {
  db().prepare('UPDATE rolls SET path = ? WHERE id = 1').run('2022/22.1.1 a renamed');
  db().prepare("UPDATE photos SET path = replace(path, '22.1.1 a/', '22.1.1 a renamed/') WHERE roll_id = 1").run();
  const visible = guestIds();
  assert.ok(!visible.includes(1) && !visible.includes(3), 'frames hidden via the roll stay hidden');
  db().prepare('UPDATE rolls SET path = ? WHERE id = 1').run('2022/22.1.1 a');
  db().prepare("UPDATE photos SET path = replace(path, '22.1.1 a renamed/', '22.1.1 a/') WHERE roll_id = 1").run();
});

test('if rows conflict, private:yes wins', () => {
  db().prepare('INSERT INTO private_photos (hash, path, private, updated_at) VALUES (?, ?, 0, 1)').run('h10', 'x');
  db().prepare('INSERT INTO private_photos (hash, path, private, updated_at) VALUES (?, ?, 1, 1)').run('nope', '2022/22.2.2 b/10.jpg');
  assert.ok(!guestIds().includes(10));
  db().prepare("DELETE FROM private_photos WHERE hash IN ('h10', 'nope')").run();
});

test('making the roll visible again keeps frames hidden one by one', () => {
  setRollPrivate(1, false);
  assert.deepEqual(guestIds(), [1, 10, 2, 4]);
  assert.equal(ownerPriv()[3], 1);
});

test('guest payload never includes index stats', () => {
  db().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastIndex', ?)").run(JSON.stringify({ at: 5, photos: 999 }));
  assert.deepEqual(getArchive().lastIndex, { at: 5 });
});

test('every change writes a backup that matches the database', () => {
  const b = readBackup()!;
  const dbYes = db().prepare('SELECT COUNT(*) n FROM private_photos WHERE private = 1').get()!.n as number;
  assert.equal(b.photos.filter((p) => p.private === 1).length, dbYes);
  assert.equal(privacyStatus().lockdown, false);
});

test('lockdown: if the private list goes missing, guests see nothing until it is restored', async () => {
  const before = guestIds();
  db().exec('DELETE FROM private_photos; DELETE FROM private_rolls;');
  await new Promise((r) => setTimeout(r, 3100)); // status is cached for 3s
  assert.equal(privacyStatus().lockdown, true);
  assert.deepEqual(guestIds(), [], 'guest archive is empty');
  assert.equal(getArchive(2).rolls.length, 0, 'roll pages 404');
  const guestImg = await photoForRequest(new Request('http://x/'), Promise.resolve({ id: '10' }));
  assert.equal(guestImg, null, 'even normally-public images are refused');
  assert.equal(getArchive(undefined, OWNER).photos.length, 5, 'owner still sees everything');

  restoreBackup();
  assert.equal(privacyStatus().lockdown, false);
  assert.deepEqual(guestIds(), before, 'back to exactly what guests saw before');
});

test('unlock: right password gives a key that works; wrong password gives nothing', async () => {
  const key = await unlock('correct horse');
  assert.ok(key);
  assert.ok(isOwner(new Request('http://x/', { headers: { 'x-spool-key': key! } })));
  assert.ok(isOwner(new Request(`http://x/?k=${key}`)), 'img URLs carry it as ?k=');
  assert.equal(isOwner(new Request('http://x/')), false);
  assert.equal(isOwner(new Request('http://x/?k=forged')), false);
  assert.equal(await unlock('wrong'), null);
});
