# Catalogue: agent bundle

Everything needed to build Vedant's music catalogue: a hand-curated RYM of trading cards adrift in four kingdom nebulae in space, threaded together where albums cross kingdoms.

Read in this order:

1. `SPEC.md`: the full spec; it wins over everything else here.
2. `design/card-reference.html` (open it in a browser) and `design/card.css`: the approved Obi card, with fonts in `design/fonts/`. `card-reference.png` is a render of it.
3. `config/`: kingdoms, rarity, and app config, ready to copy into the repo.
4. `schema/`: JSON Schemas for album and pack files.
5. `examples/`: five albums (one sealed), a pack, and a Logseq page showing the property format. Bracketed text is placeholder, not Vedant's words.
6. `skills/`: install as `.claude/skills/add-album`, `make-pack`, `open-card`.
7. `reference/`: v2 prototype code to port from: `cover-art.js` (pixel and abstract art) and `ps1-world-v2.html` (the old PS1 renderer with people; the world no longer uses it).

Placeholder art in `design/placeholder-art/` is a generated pattern, not album covers. Real art comes from the cover pipeline in SPEC.md section 6.3.

## Running it

```
npm install
npm run dev      # build, watch albums/, packs/, config/ and the Logseq pages, serve on http://127.0.0.1:5180
npm run build    # one build into dist/
npm run export   # build, then write site/: the public snapshot the live site serves (commit it)
npm run check    # validate every album and pack file
npm test         # Logseq parser and search grammar
```

## The live site

Vercel serves a static copy: `vercel.json` runs `npm run build:site` (Vite, then `site/` copied in) and serves `dist/web`.
Vercel can't read the Logseq graph, so `npm run export` on this Mac writes `site/`: the catalogue without warnings, the
WebP art, and Apple preview URLs that stream from Apple. The full songs in `sounds/` stay local; online, every scene plays
its generative loop. Run `npm run export` and commit `site/` before pushing album changes.

`npm run build -- --root examples` builds the five example albums as a fixture. `web/card-test/` is a dev-only
harness that renders the card component with the reference data, for pixel-diffing against `design/card-reference.html`.
