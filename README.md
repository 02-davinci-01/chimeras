# Catalogue: agent bundle

Everything needed to build Vedant's music catalogue: a hand-curated RYM of trading cards and album-people living in four kingdoms in space.

Read in this order:

1. `SPEC.md`: the full spec; it wins over everything else here.
2. `design/card-reference.html` (open it in a browser) and `design/card.css`: the approved Obi card, with fonts in `design/fonts/`. `card-reference.png` is a render of it.
3. `config/`: kingdoms, rarity, and app config, ready to copy into the repo.
4. `schema/`: JSON Schemas for album and pack files.
5. `examples/`: five albums (one sealed), a pack, and a Logseq page showing the property format. Bracketed text is placeholder, not Vedant's words.
6. `skills/`: install as `.claude/skills/add-album`, `make-pack`, `open-card`.
7. `reference/`: v2 prototype code to port from: `cover-art.js` (pixel and abstract art) and `ps1-world-v2.html` (PS1 renderer and body plans; its navigation is obsolete).

Placeholder art in `design/placeholder-art/` is a generated pattern, not album covers. Real art comes from the cover pipeline in SPEC.md section 6.3.
