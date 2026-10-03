---
name: add-album
description: Add an album to Vedant's catalogue, or open a sealed one. Use when he says "add <album>", names an album with a kingdom, a person description or a Logseq page, or says he has listened to a sealed album.
---

# Add an album

Goal: one new or updated `albums/<id>.json`, a successful build, and the finished card shown to him. Ask at most three questions, and only for what is missing.

1. Identify the album. Search Spotify (the Spotify connector, or the Web API search endpoint). Confirm in one line: title, artist, year. If there are several editions, prefer the original release unless he names one. Record `spotify`, `cover` (the 640 px image URL), `year`, `title`, `artist` exactly as Spotify gives them.
2. Fill what he gave you: kingdom (`rock`, `electronic`, `hiphop`, `indie`), the person's characteristic, the Logseq page name, the first-listen date.
3. Ask only for what is still missing, in one message:
   - Kingdom: suggest one from `config/kingdoms.json` tags and let him confirm.
   - Person: ask "what is this album as a person?" if he gave nothing.
   - Logseq page: default to the album title; confirm only if no page by that name exists.
   - First-listen date: default to today; do not ask unless he hints otherwise.
4. Read the Logseq page (see SPEC.md section 6.2). Report what you found in one line: rating, rarity it maps to, the four stats. If the page or a property is missing, say which, and offer to scaffold the page with empty properties (`rating::`, `replay::`, `sonic::`, `meaning::`, `influence::`). Never write review text and never change an existing value.
5. Write the person. Put his words verbatim in `person.brief`. Translate them into `base`, `build`, `head`, `traits`, `motion` and `colours` using only modules that exist in `web/world/traits/`. If something he described has no module, write the module (SPEC.md section 10.5), then use it. Tell him in one line what you mapped and what you added.
6. Write `albums/<id>.json` (slug from the title; never rename an existing id). Validate against `schema/album.schema.json`.
7. Run `npm run build`. Fix anything it reports about this album.
8. Show the card: a screenshot of the binder's enlarged view for this album, or the path to open.

Opening a sealed album uses the same steps: keep its `pack`, set `first` (default today), fill the person if empty, and confirm the rating now exists on the page.
