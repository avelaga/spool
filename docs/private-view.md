# Private view

Hide individual frames or whole rolls from guests, without touching the archive.

## Turn it on

Set both of these in `.env.local`:

```sh
SPOOL_UNLOCK_PATH=some-unlisted-path   # the private view lives at /<this>
SPOOL_PASSWORD=…
SPOOL_PRIVACY_REQUIRED=1               # recommended, see "Safeguards" below
```

If either `SPOOL_UNLOCK_PATH` or `SPOOL_PASSWORD` is missing, the unlock page is a plain 404 and the private view can't be reached.

## Use it

1. Go to `/<SPOOL_UNLOCK_PATH>` and enter the password.
2. Mark photos:
   - **One photo:** open it and press `p` (or use the button at the top left of the viewer).
   - **Several:** press `s` (or **Select**). Then click photos, shift-click a range, drag across them, or use **Select roll** on a roll header. Then choose **Make private** or **Make visible**.
   - **A whole roll:** **Make roll private** on the roll's page. Frames added to that roll later are hidden too. Press `p` on a single frame to make it visible again.
3. **Private only** shows just the hidden photos, and each one has a lock badge.

Refreshing the page, opening a new tab, clicking **Lock**, 30 idle minutes, or a server restart all return you to the guest view. The unlock exists only in the page's memory: there's no cookie and nothing in storage.

## How it works

- **Enforced on the server.** For guests, private photos are dropped in the database query, so they're missing from the page data, filter counts, roll pages and "next roll" links. Their thumbnail, viewer and original addresses return 404, exactly like photos that don't exist. Private images are served `no-store`.
- **Rules live in one place.** All the logic is in [`src/lib/privacy.ts`](../src/lib/privacy.ts).
  - A photo is private if a mark matches its **content hash or its path**, so renaming *or* re-exporting a file keeps it hidden. If marks conflict, private wins.
  - A private roll hides every frame in it unless that frame is explicitly marked visible.
- **The private-view tools aren't in the guest page.** They're a separate chunk, downloaded only after unlocking.

## Safeguards

Every change writes the private list to `backups/privacy-latest.json`, plus one dated copy per day. If the database ever holds fewer private markings than the latest backup (or none while `SPOOL_PRIVACY_REQUIRED=1`), Spool goes into **lockdown**: guests see nothing until the list is restored. During lockdown, backups aren't overwritten.

```sh
npm run privacy:status
npm run privacy:backup
npm run privacy:restore [file]     # default: backups/privacy-latest.json
# in Docker: docker compose exec spool npm run privacy:status
```

| Variable | Default | Purpose |
|---|---|---|
| `SPOOL_UNLOCK_PATH` / `SPOOL_PASSWORD` | — | Turn on the private view. Both must be set. |
| `SPOOL_BACKUP_DIR` | `./backups` | Where the private list is backed up. Must be outside the archive. |
| `SPOOL_PRIVACY_REQUIRED` | — | `1` = if no private markings exist, guests see nothing (for fresh installs). |

The tests in [`test/privacy.test.ts`](../test/privacy.test.ts) cover renames, re-exports, roll rules, conflicting marks, lockdown and restore.
