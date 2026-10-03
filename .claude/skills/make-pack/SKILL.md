---
name: make-pack
description: Make Vedant's weekly album pack of 3 or 4 sealed, unheard albums. Use when he says "make this week's pack", "new pack" or similar.
---

# Make a weekly pack

1. Work out the ISO week (`YYYY-Www`). If `packs/<week>.json` exists, say so and ask whether to replace or add to it.
2. Propose 3 or 4 albums he has not catalogued (check `albums/`). Unless he names them, choose from his taste: read `albums/*.json` for what he rates highly and the briefs he writes, and spread the pack across at least two kingdoms. One line each on why.
3. Let him swap any. When he confirms, for each album: Spotify lookup as in add-album step 1, a provisional kingdom, `pack` set to the week, `first: null`, `person: {"brief": "", "traits": []}`.
4. Write `packs/<week>.json` and the album files. Validate both schemas.
5. Do not create Logseq pages unless he asks; offer once.
6. Run `npm run build` and show the pack shelf.
