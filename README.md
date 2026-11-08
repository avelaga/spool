<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-white.png">
    <img src="assets/logo-colour.png" width="140" alt="Spool logo">
  </picture>
</p>

# Spool

A calm, self-hosted viewer for a film photography archive. Point it at the folders of scans you already have, and it becomes a fast, filterable archive you browse roll by roll. It's **read-only**: it never moves, renames or writes a single file in your archive.

I built it to replace Flickr for my own ~6,000 film scans. It runs on a Raspberry Pi next to the NAS that holds them.

## What it does

- **Your folder names become filters.** Format (35mm, 645, 6×7, 4×5), type (point & shoot, medium or large format), film stock, black & white or colour, and year all come from how you already name your folders. Each dated folder is a roll.
- **One clean photo per frame.** For each frame it shows the shareable JPEG, preferring a compressed or edited copy, and hides raw TIFF scans and duplicate versions.
- **Fast at thousands of photos:**
  - a justified grid that only renders what's on screen;
  - filters you can combine, kept in the URL;
  - three grid sizes;
  - a timeline down the right edge for jumping between years and rolls;
  - a full-screen viewer with keyboard and swipe navigation.
- **Rolls first:** a page for every roll, with its date, format, film and frames.
- **Stays up to date by itself.** New scans copied onto the NAS appear within minutes.
- **Private photos.** Some frames or rolls can be hidden from guests ([details](docs/private-view.md)).

**Keyboard shortcuts:**

| Key | Action |
|---|---|
| `←` `→` | Previous / next photo |
| `Esc` `Space` | Close the viewer |
| `o` | Open the original |
| `[` `]` | Previous / next roll |
| `-` `=` | Smaller / larger grid |

## How folders are read

The rules live in [`spool.config.ts`](spool.config.ts), and are meant to be edited to match how you name things. `npm run review` writes a report of how every roll parsed, and flags anything it had to guess.

- **Rolls** are folders named `YY.M.D title`, like `22.9.6 august f3` or `18.2.21 | 1st Bronica Ektar Arch`. They can sit at the top level or inside collection folders such as `2022`, `summer 2018` or `Photoshoots`.
- **Keywords** in a roll's name set its format, type and film. For example, `ps` means 35mm point & shoot, `645` means 645 medium format, and `trix` means Tri-X, black & white. If a name doesn't say, the format is guessed from the photos' proportions and the frame count.
- **Subfolders** decide which version of each frame to show:
  - `compressed` or `digital finals` win;
  - `raw`, `scans` and `masters` are skipped;
  - `selects` and `favs` mark frames with a ★.
- **Overrides** fix individual rolls by path.

## Run it locally

Requires **Node 23.6+**. It uses Node's built-in TypeScript and SQLite, so there's no database to install.

```sh
npm install
cp .env.example .env.local     # set SPOOL_ARCHIVE to your scans folder
npm run review                 # dry run: how every roll parses → data/review.md
npm run index                  # index + make thumbnails
npm run build && npm start     # http://localhost:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `SPOOL_ARCHIVE` | set in `spool.config.ts` | Your scans folder. It is only ever read. |
| `SPOOL_DATA` | `./data` | Index, thumbnails and viewer images. Must be outside the archive. |
| `SPOOL_RESCAN_MINUTES` | `10` | How often to pick up new photos (`0` = off). |

## Run it on a Raspberry Pi

Spool runs in Docker with the archive mounted **read-only**. Then, from home, it's just `http://spool.local`.

```sh
# on the Pi
git clone https://github.com/avelaga/spool.git ~/spool
cd ~/spool && ./scripts/setup-pi.sh

# later, to update
./scripts/update-pi.sh
```

`setup-pi.sh` asks a few questions and handles the rest:
- installs Docker;
- finds your NAS shares and checks Spool can read the film folder;
- chooses who can reach it (home network, WireGuard, or both);
- optionally uses port 80 and a `spool.local` name;
- builds and starts Spool;
- confirms the archive is mounted read-only.

It's safe to re-run. `update-pi.sh` rebuilds only when something changed. To bring over an index and thumbnails you already built on another machine, run `./scripts/send-to-pi.sh user@pi` first, so the Pi doesn't have to regenerate them.

## How it's built

- **Next.js** (App Router) with **React 19** and plain CSS. No UI framework.
- **SQLite** through Node's built-in `node:sqlite`.
- **sharp** for thumbnails and viewer images, cached outside the archive.
- **An incremental indexer:** only new or changed files are read, and files still being copied are skipped until they settle.

```
spool.config.ts       folder → filter rules
src/lib/archive/      read-only archive access + parsing (fs.ts is the only code that opens archive files)
src/lib/indexer/      incremental indexer + rescan schedule
src/components/       grid, viewer, filters, timeline
app/                  pages + API routes for thumbnails, viewer images and originals
scripts/              Pi setup, update and copy scripts
```

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Run the app |
| `npm run index` | Index now (also runs on startup and on a schedule) |
| `npm run review` | Parse-only report; writes nothing to the archive |
| `npm test` | Parser and privacy tests |

## Status

A personal project, running on a Raspberry Pi 5 alongside the NAS and reached over WireGuard. What's next is in [TODO.md](TODO.md).
