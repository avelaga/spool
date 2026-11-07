<p align="center"><img src="assets/logo-colour.png" width="140" alt=""></p>

# Spool

A calm, self-hosted, **read-only** viewer for a film photography archive. It turns an existing folder of scans into a fast, filterable, roll-by-roll archive, without moving, renaming or writing a single file.

- **Folder names become filters:** format (35mm, 645, 6×7…), type (point & shoot, medium/large format), film stock, tone and year. Each dated folder is a roll.
- **One photo per frame:** for each frame it shows the shareable JPEG (a compressed or edited copy if there is one) and never shows raw scans or duplicates.
- **Built for thousands of photos:** a justified grid that only renders what's on screen, filters kept in the URL, a full-screen viewer (← → Esc), roll pages, and a year/roll timeline down the right edge.
- **Hidden private view:** reached through an unlisted address and a password. You can hide single frames or whole rolls. Guests can't tell anything is hidden.

## Requirements

Node **23.6+**. It uses Node's built-in TypeScript support and `node:sqlite`, so there's no database server to install.

## Setup

```sh
npm install
cp .env.example .env.local   # then edit it
npm run review               # dry run: how every roll parses → data/review.md
npm run index                # index the archive + make thumbnails
npm run build && npm start   # http://localhost:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `SPOOL_ARCHIVE` | `/Volumes/MAIN/000 FILM 2.0` | The archive root. It is **only ever read**. |
| `SPOOL_DATA` | `./data` | SQLite database, thumbnails and viewer images. Must be outside the archive. |
| `SPOOL_RESCAN_MINUTES` | `10` | How often to pick up new or changed photos automatically (`0` = off). |
| `SPOOL_UNLOCK_PATH` / `SPOOL_PASSWORD` | — | Turn on the private view at `/<SPOOL_UNLOCK_PATH>`. Both must be set. |
| `SPOOL_BACKUP_DIR` | `./backups` | Where the private list is backed up on every change. |
| `SPOOL_PRIVACY_REQUIRED` | — | `1` = if no private markings are found, show guests nothing. Safety for fresh installs. |

## How folders are parsed

Everything lives in [`spool.config.ts`](spool.config.ts). Run `npm run review` after any change to see how every roll parses and which rolls need a look.

- **Rolls** are folders named `YY.M.D title`, e.g. `22.9.6 august f3` or `18.2.21 | 1st Bronica Ektar Arch`, either at the top level or inside a collection folder (`2022`, `summer 2018`, `Photoshoots`).
- **Keywords** in a roll's name set its size, type and film. For example, `ps` → 35mm and Point & shoot, `645` → 645 and Medium format, `trix` → Tri-X and B&W. If a name doesn't say, the size is guessed from the images' proportions and the frame count.
- **Subfolders** decide which version of each frame is shown:
  - `compressed`, `LOW_RES` and `digital finals` win;
  - `raw`, `scans` and `masters` are hidden;
  - `selects`, `favs` and `prints` mark frames as ★ selects.
- **Overrides** fix individual rolls by path.

## Private view

1. Go to `/<SPOOL_UNLOCK_PATH>` and enter the password.
2. Press `p` in the viewer, or press `s` to select (click, shift-click, drag, or **Select roll**), then choose **Make private**.
3. Refreshing the page locks it again. The unlock lasts only in page memory, and also expires after 30 idle minutes or a server restart.

Private photos are filtered out on the server: they're missing from guests' data, filter counts and roll pages, and their image addresses return 404. Every change is backed up to `backups/`. If the database ever holds fewer private markings than the backup, guests see **nothing** until it's restored:

```sh
npm run privacy:status
npm run privacy:backup
npm run privacy:restore [file]   # default: backups/privacy-latest.json
```

## Commands

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run index` | Index now (it also runs automatically on startup and every `SPOOL_RESCAN_MINUTES`) |
| `npm run review` | Parse-only report at `data/review.md`. Writes nothing to the archive. |
| `npm test` | Parser, privacy and lockdown tests |

## Layout

```
spool.config.ts         folder → filter rules
src/lib/archive/        read-only archive access + parsing (fs.ts is the only file that opens archive files)
src/lib/indexer/        incremental indexer + rescan schedule
src/lib/privacy*.ts     private list, backups, lockdown
src/components/         grid, viewer, filters, timeline, private-view tools
app/                    pages + API routes (thumbnails, viewer images, originals, unlock)
```

Git ignores `data/`, `backups/`, `notes/` and `.env.local`.

## Status

This is a personal project, run on a Raspberry Pi 5 with the NAS attached and reached over Tailscale. Next steps are in [TODO.md](TODO.md); the main one is a Docker image for the Pi.
