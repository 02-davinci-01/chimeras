---
name: open-card
description: Update an existing card in Vedant's catalogue, e.g. "move Kid A to electronic", "Kid A is also electronic", "drop the thread from Yeezus", "change the first-listen date", "Kid A should play Idioteque".
---

# Edit a card

1. Find the album by title, id or card number. If more than one matches, ask which.
2. Change only what he asked. Appearance (kingdom, `also`, `track`, first date, pack) is edited in `albums/<id>.json`. Judgement (rating, rarity override, stats, review) lives in Logseq: tell him which property to change on which page; never edit it yourself.
3. Threads: "X is also <kingdom>" adds to `also`; "X isn't <kingdom>" removes it. `also` never holds the album's own kingdom, so moving a card into a kingdom that is in its `also` swaps the two.
4. Track: "X should play <song>" sets `track` to the song's name as it appears on the album; the build fetches its preview.
5. Validate, run `npm run export` (it refreshes `site/`, the live site's snapshot; commit it with the change), show the result.
