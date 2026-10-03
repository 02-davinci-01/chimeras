---
name: add-album
description: Add an album to Vedant's catalogue, or open a sealed one. Use when he says "add <album>", names an album with a kingdom (or several) or a Logseq page, or says he has listened to a sealed album.
---

# Add an album

Goal: one new or updated `albums/<id>.json`, a successful build, and the finished card shown to him. Ask at most three questions, and only for what is missing.

1. Identify the album. Search Spotify (the Spotify connector, or the Web API search endpoint). Confirm in one line: title, artist, year. If there are several editions, prefer the original release unless he names one. Record `spotify`, `cover` (the 640 px image URL), `year`, `title`, `artist` exactly as Spotify gives them.
2. Fill what he gave you: kingdom (`rock`, `electronic`, `hiphop`, `indie`), any other kingdoms it also belongs to, the Logseq page name, the first-listen date. If he names two kingdoms ("Kid A, rock and electronic"), the first is `kingdom` and the rest go in `also`.
3. Ask only for what is still missing, in one message:
   - Kingdom: suggest one from `config/kingdoms.json` tags and let him confirm. In the same line, suggest any other kingdoms its genres clearly cross into (`also`), or none; each one becomes a thread in the world.
   - Logseq page: default to the album title; confirm only if no page by that name exists.
   - First-listen date: default to today; do not ask unless he hints otherwise.
   - Track: if he names one, use it. Otherwise pick the album's signature track yourself and say which in the same line, as provisional; he may swap it. The world plays a 30-second preview of it when you meet the card. Skip it for sealed albums until they open.
4. Read the Logseq page (see SPEC.md section 6.2). Report what you found in one line: rating, rarity it maps to, the four stats. If the page or a property is missing, say which, and offer to scaffold the page with empty properties (`rating::`, `replay::`, `sonic::`, `meaning::`, `influence::`). Never write review text and never change an existing value.
5. Write `albums/<id>.json` (slug from the title; never rename an existing id). Validate against `schema/album.schema.json`.
6. Run `npm run build`. Fix anything it reports about this album. A "no preview for track" warning means Apple has no clip under that name: try the exact name from the album's tracklist, or tell him the card will play the kingdom's loop instead.
7. Show the card: a screenshot of the binder's enlarged view for this album, or the path to open.

Opening a sealed album uses the same steps: keep its `pack`, set `first` (default today), and confirm the rating now exists on the page.
