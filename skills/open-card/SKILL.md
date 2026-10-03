---
name: open-card
description: Update an existing card or person in Vedant's catalogue, e.g. "make the loveless person taller", "move Kid A to electronic", "change the first-listen date".
---

# Edit a card or person

1. Find the album by title, id or card number. If more than one matches, ask which.
2. Change only what he asked. Appearance (kingdom, person, first date, pack) is edited in `albums/<id>.json`. Judgement (rating, rarity override, stats, review) lives in Logseq: tell him which property to change on which page; never edit it yourself.
3. Person edits: append his new words to `person.brief` (keep the old text), then adjust the structured fields to match.
4. Validate, run `npm run build`, show the result.
