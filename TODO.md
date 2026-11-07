# TODO

## Archive coverage
- [ ] Decide how to handle loose top-level folders (currently in `ignore` in spool.config.ts):
      Instagram, Polaroids, framed film pics, to print, all sorts of photo scans, thrift store slides,
      mom's film ×4, Raju tata's wedding, gabby may 2018, Sidda, street downtown, New Hi-Res Scans Feb 2018,
      ut provia 3 lightroom export, miami vice book, film dev, chans pictures. Options: own collections,
      a "shot by" filter (mom's film), or keep skipped.
- [ ] Rolls with only raw TIFs and no JPEG (`19.12.6. | panf`, `new PS test`, `winter 2018/crit 2`) — export JPEGs, or render TIFs?
- [ ] Undated folders inside collections (CRIT 1–5, spark, isabelle, polaroids…) — add dates via `overrides`?
- [ ] Polaroids: a size/type of their own?
- [ ] Should 35mm rolls that aren't point & shoot (SLR: F3, Canon, N90s) get a type, or stay untyped?

## App
- [x] Docker image + compose for the Pi (archive mounted read-only) — not yet tested on the Pi
- [ ] Copy `backups/` somewhere off the Pi periodically (NAS share that isn't the archive, or another machine)
- [ ] Extra tags UI (table exists: `tags`, keyed by content hash)
- [ ] Rescan report: private:yes rows that no longer match any photo (file renamed AND re-exported) so they can be re-marked
- [ ] Private roll + roll folder renamed: frames added *after* the rename aren't covered (the roll rule is by path)
- [ ] Collapsible / sticky filter bar — it's tall on desktop
- [ ] Optionally pre-generate viewer images during indexing (currently made on first view)
- [ ] Prune cached thumbnails/views whose photo no longer exists

## Later
- [ ] Open source: make filters ("facets") fully config-defined instead of fixed size/type/film fields;
      roll-detection path templates; review report as the onboarding flow.
