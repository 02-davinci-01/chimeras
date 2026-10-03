# Catalogue — build spec

Version 1.0, 2 Oct 2026. Owner: Vedant. This file is the single source of truth for the build; everything else in the bundle supports it.

## 0. How to use this bundle

Read this spec top to bottom once, then open `design/card-reference.html` in a browser; it is the visual contract for the card. `config/` holds the real config files to copy into the repo, `schema/` the JSON Schemas the builder validates against, `examples/` sample albums, a pack and a Logseq page, `skills/` the three Claude skills to install under `.claude/skills/`, and `reference/` the v2 prototype code (art pipeline; the old PS1 renderer is kept for history only) to port from. Placeholder art in `design/placeholder-art/` is a stand-in pattern, not album covers.

Where this spec and the reference code disagree, the spec wins.

## 1. What we are building

A personal, hand-curated RYM. Every album Vedant has listened to becomes a trading card floating in one of four kingdoms (rock, electronic, hip-hop, indie), each a nebula of its own colour in space. Albums enter only when he tells Claude to add them, so there is no cron, poller or live sync. Logseq stays the source of truth for words: each album's review and rating live on its Logseq page, and the catalogue links to that page instead of copying the thinking.

It runs only on his machine. Two views share one data file: the binder (cards, search, packs, the review reader) and the world (four nebulae in space, the cards adrift inside them, and threads running between kingdoms wherever an album belongs to more than one). The world is soft and glowing but cheap to draw.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Kingdoms | Rock, Electronic, Hip-hop, Indie (indie replaces pop). |
| Kingdom colours | Rock `#2D4B8E` (dusky cinematic blue), Electronic `#8C8F94` (grey), Hip-hop `#C62F2B` (red), Indie `#F0CF3A` (yellow). |
| Genres outside the four | Folded in by default: shoegaze, dream pop, post-rock and art rock into rock; ambient, drone, modern classical and jazz into electronic; folk, singer-songwriter and pop into indie. The album's own `kingdom` field always decides. |
| Card design | Obi, on white, with subtle cassette cues. Section 8. |
| Rarity | Divine, rare, elite, special, common, highest first. Follows the Logseq rating by default; a `rarity::` property overrides. |
| Stats | Replay, Sonic, Meaning, Influence; whole stars, 1 to 5; stored as Logseq page properties. |
| Pixel art | 32×32 grid, 8 colours from the cover itself. |
| Abstract art | From the cover's colour map; mark per kingdom: rock smear, electronic grid, hip-hop halftone, indie strings. |
| Packs | Weekly, 3 or 4 sealed albums. Claude proposes, Vedant swaps. |
| Where judgement lives | Logseq: rating, rarity override, stats, review. |
| Where appearance lives | The repo: kingdom, other kingdoms (`also`), first-listen date, pack. |
| Rendering | three.js: instanced card quads, billboard nebulae in a half-size glow layer, shader-driven threads. No people, no PS1/PS2 styling. |
| Hosting | Local only, served on 127.0.0.1. No deployment in v1. |
| Colour rule | No blue or gold anywhere in the UI except the rock kingdom's own colour. |

## 3. Repo layout and stack

```
catalogue/
  albums/<id>.json            one per album (schema/album.schema.json)
  packs/<week>.json           one per weekly pack (schema/pack.schema.json)
  config/                     kingdoms.json, rarity.json, catalogue.config.json
  schema/                     JSON Schemas
  covers/  art/               downloaded covers and baked art (git-ignored)
  build/                      the builder (TypeScript, Node 20+)
    logseq/                   file-graph reader, DB-graph API reader, markdown block parser
    art/                      pixel + abstract art (port of reference/cover-art.js)
    index.ts                  build + watch entry points
  server/                     local HTTP server + SSE reload
  web/
    shared/                   card component (card.css from design/), fonts, search, data loading
    binder/                   binder page
    world/                    world page: nebulae, cards, threads, camera
  dist/                       catalogue.json, search.json (generated)
  .claude/skills/             add-album, make-pack, open-card
```

Stack: TypeScript everywhere, Vite for the two web pages with no UI framework, three.js from npm (pin one current release; the reference used r128, and the shader patch in section 10.2 must be checked against the pinned version's chunk names), `sharp` for image decoding and resizing, `@napi-rs/canvas` for drawing abstract marks in Node, `chokidar` for watching, `ajv` for schema validation. Fonts are vendored from `design/fonts/`. Nothing loads from a CDN at runtime.

Scripts: `npm run build` (one build), `npm run dev` (build, watch, serve, open the binder), `npm run check` (validate every album and pack file).

## 4. Configuration

`config/catalogue.config.json`:

| Key | Meaning |
| --- | --- |
| `logseq.graphPath` | Absolute path to the Logseq graph folder (holds `pages/`, `journals/`, `assets/`). |
| `logseq.graphName` | Graph name as Logseq shows it; used in `logseq://graph/<name>?page=<page>` links. |
| `logseq.mode` | `file` (read markdown files) or `api` (Logseq's local HTTP API, for a database graph). |
| `logseq.api` | URL and the name of the env var holding the API token, for `api` mode. |
| `server` | Host and port. Host must stay `127.0.0.1`. |
| `art` | Pixel grid (32), pixel colours (8), abstract size (640), cover size (640). |

## 5. Data model

### 5.1 Album file

One file per album, `albums/<id>.json`, validated by `schema/album.schema.json`. The id is a slug of the title, set once and never changed. Fields: `id`, `title`, `artist`, `year`, `spotify`, `cover` (Spotify 640 px URL), optional `runtime`, `kingdom`, `logseq.page`, `added` (date the entry was created), `first` (date Vedant first listened; null while sealed), `pack` (ISO week or null), and optional `also`: other kingdoms the album belongs to as well (never its own), each drawn as a thread in the world (section 10.4). Optional `track`: the song the world plays when you meet the card (section 10.6). See `examples/albums/`.

### 5.2 Kingdoms

`config/kingdoms.json`, in display order. Each kingdom has `key`, `name`, `colour` (border and obi strip), `ink` (text on the strip), `mark` (abstract-art style), `body` (base body plan) and `tags` (only used to suggest a kingdom when adding).

### 5.3 Rarity

`config/rarity.json`, highest first. The first tier whose `minRating` the album's rating meets wins: divine 10, rare 9 and up, elite 8 and up, special 7 and up, common below. A `rarity::` property on the Logseq page overrides. Each tier carries its symbol (a 24×24 SVG path) and its finish (section 8.3). The star path for stats is in the same file.

### 5.4 Packs

`packs/<week>.json` with `week` (`2026-W40`), `made`, optional `note` and 3 or 4 album ids. Album files in a pack carry the same week in `pack`.

### 5.5 Derived state

State is computed by the build, never stored:

- **open** when the Logseq page has a rating.
- **sealed** when there is no rating and the album belongs to a pack.
- **unrated** when there is no rating and no pack. It shows as an open card with empty stars, no rarity badge and "Unrated" in place of the rarity name.

Card number is the album's position when every album is sorted by `added` then `id`, zero-padded to three digits. It is stable as long as files are only added.

### 5.6 Build output

`dist/catalogue.json`:

```json
{
  "generated": "2026-10-02T12:00:00Z",
  "kingdoms": [ ...config/kingdoms.json entries... ],
  "rarity": [ ...config/rarity.json tiers... ],
  "packs": [ { "week": "2026-W40", "made": "2026-09-28", "note": null, "albums": ["carrie-and-lowell"] } ],
  "albums": [ {
    "id": "loveless", "no": "017", "title": "loveless", "artist": "my bloody valentine", "year": 1991,
    "spotify": "3USQKOw0se5pBNEndu82Rb", "kingdom": "rock", "also": [], "added": "2026-10-02", "first": "2023-11-14", "pack": null,
    "state": "open", "rating": 9.5, "rarity": "rare",
    "stats": { "replay": 4, "sonic": 5, "meaning": 4, "influence": 5 },
    "art": { "cover": "art/loveless.cover.webp", "pixel": "art/loveless.pixel.png", "abstract": "art/loveless.abstract.webp",
             "palette": ["#..", "#..", "#..", "#..", "#..", "#..", "#..", "#.."] },
    "excerpt": "First ~280 characters of the review, plain text.",
    "logseq": { "page": "loveless", "url": "logseq://graph/music?page=loveless" }
  } ],
  "warnings": [ "crumbling: page has no `meaning::` property" ]
}
```

`dist/search.json` would map album id to the full review; in this public build it is empty and every `excerpt` is `""`, so no review text leaves the graph. The catalogue carries no graph name and no Logseq URLs either. Ratings and stats are still read from the pages.

## 6. Builder

### 6.1 Pipeline

`npm run build` runs these steps:

1. Load the config and every album and pack file. Validate each against its schema, and stop with a clear message on the first invalid file.
2. Read each album's Logseq page (section 6.2).
3. Download any missing covers (section 6.3).
4. Bake art when it is missing or stale (section 6.3).
5. Derive state, rarity and card numbers; drop any `also` entry that repeats the album's own kingdom.
6. Write `dist/catalogue.json` and `dist/search.json` atomically: write to a temp file, then rename.

The build never writes to the Logseq graph.

Warnings are collected in the output and printed. They cover a missing page, a missing or out-of-range property, an `also` that repeats the album's own kingdom, and a pack/album mismatch. Warnings never fail the build. A fatal error (invalid JSON, a schema failure, an unreadable graph path) does.

### 6.2 Reading Logseq

**File mode.**

- *Index.* Scan `<graphPath>/pages/*.md` once per build and build a case-insensitive page-name index. A page's name is its `title::` property if present. Otherwise it is the file name decoded the way Logseq names files: `___` becomes `/` (the triple-lowbar format) and percent-escapes are decoded. Legacy graphs that use `.` for namespaces should be detected and handled too.
- *Properties.* Page properties are the leading `key:: value` lines before the first block. They may also be the first block itself, when every line of that block is `key:: value`.
  - Keys are lowercased.
  - `rating` parses as a number from 0 to 10; accept `9.5` and `9.5/10`.
  - `replay`, `sonic`, `meaning` and `influence` parse as integers from 1 to 5; accept `4` and `4/5`.
  - `rarity` must be a tier key.
- *Blocks.* A block starts with `- ` after its indentation. Depth comes from leading tabs, or from 2 spaces per level. Lines without a dash continue the previous block. Block property lines (`id::`, `collapsed::` and so on) are stripped from content but `id::` is kept for block references.

The reader returns `{ name, properties, blocks: [{ id, content, children }] }`.

**API mode.** This is for a Logseq database graph. Call Logseq's local HTTP API (enabled in Logseq's settings; bearer token from the env var named in the config) with `logseq.Editor.getPage` and `logseq.Editor.getPageBlocksTree`. Map the results to the same shape. Verify method names against the installed Logseq version before relying on them.

**Excerpt.** The excerpt is the text of the first top-level blocks after the properties, with markup stripped, joined and cut at a word boundary near 280 characters.

**Inline syntax, rendered by the reader (section 9.5).**

- `[[Page]]` is a link; when it names a catalogued album's page, it opens that album.
- A `[[Oct 2nd, 2026]]`-style journal link shows as a date.
- `#tag` is a quiet tag.
- `((uuid))` resolves to the referenced block's text when found, otherwise it shows as a small reference marker.
- `{{embed ...}}` becomes a link.
- Bold, italic, inline code and markdown links render normally.
- Images in `../assets/` are served by the server from the graph's `assets/` folder.

### 6.3 Covers and art

Download each `cover` once into `covers/<id>.jpg`. Port the core of `reference/cover-art.js` to Node, feeding it raw RGBA from `sharp` as `{ width, height, data }`.

- **Pixel art** (`art/<id>.pixel.png`, 32×32):
  - Area-average the cover down to 32×32 (resize to 64 with `sharp`, then average 2×2 blocks).
  - Quantise to 8 colours with seeded k-means++ in OKLab (10 iterations; the seed is a hash of the id).
  - Apply ordered 4×4 Bayer dithering only where a pixel sits between its two nearest cluster colours (`mix = max(0, (t − 0.12) / 0.38) × 0.5`, where `t = d1 / (d1 + d2)`), so flat areas stay flat.
  - Save at 32×32; viewers scale it with nearest-neighbour.
- **Palette.** The 8 pixel-art cluster colours as hex, ordered by share. Accents use this.
- **Abstract art** (`art/<id>.abstract.webp`, 640×640, WebP quality 88):
  - Sample the cover at 48×48 and run k-means with 6 colours.
  - Redraw with the kingdom's mark from `MARKS` in the reference: `smear` for rock, `grid` for electronic, `halftone` for hip-hop, `strings` for indie.
  - Draw with `@napi-rs/canvas`. Its `filter: blur()` support may differ from browsers, so implement blur with a box blur if needed.
- **Cover for the pages** (`art/<id>.cover.webp`, WebP quality 82): the pages never load `covers/<id>.jpg`, which is only the source.
- **Pruning.** A full build deletes covers, art and previews of albums that no longer exist.
- **Caching.** Keep `art/.cache.json` keyed by album id, recording cover file hash + art algorithm version + kingdom. Skip unchanged entries. Output is deterministic: the same inputs always produce identical files.

### 6.4 Watch mode

`npm run dev` watches `albums/`, `packs/`, `config/` and the graph's `pages/`. It debounces for 300 ms, rebuilds only what changed (one album's page edit only re-reads that page), and then emits an SSE `build` event.

## 7. Server

A small Node HTTP server bound to `127.0.0.1` only:

| Route | Returns |
| --- | --- |
| `GET /` | Binder page. |
| `GET /world` | World page. |
| `GET /catalogue.json`, `GET /search.json` | Build output. |
| `GET /art/*`, `GET /covers/*` | Baked art and covers. |
| `GET /logseq/page?name=<page>` | The parsed page as JSON (section 6.2), read live, so the reader always shows the latest text. |
| `GET /logseq/assets/*` | Files from the graph's `assets/` folder; path traversal rejected. |
| `GET /events` | Server-sent events; `build` tells open pages to refetch data. |

## 8. The card (Obi)

`design/card.css` and `design/card-reference.html` are the contract; build the shared card component from them. All sizes below are at 1×.

### 8.1 Anatomy

**Frame.**

- 280×392 px, 5:7.
- 4 px border in the kingdom colour, 8 px radius.
- White body (`#FFFFFF`).
- Soft shadow: `0 10px 24px rgba(0,0,0,.08)`.

**Obi strip.** The left 62 px is filled with the kingdom colour. Its text, top to bottom:

- The album title, set vertically in Dela Gothic One, 18 px, in the kingdom ink colour.
- In the middle, the first-listen date hand-written in Reenie Beanie, 27 px. It is dark pen ink (`#141210`) at 90% opacity, rotated 5°, formatted `DD.MM.YY`.
- At the foot, the kingdom name and card number in Instrument Sans Bold 10 px with 0.08 em tracking, above a small barcode.

**Label (the body).**

- 16 px padding.
- Four 7 px screw heads in the corners.
- The pixel art at 160×160 (exactly 5× of 32), with a black "A" side badge on its top-left corner and the rarity symbol in a white round badge on its bottom-right corner.
- Under the art:
  - The artist in Instrument Serif italic, 19 px.
  - A meta line: the rarity name in bold, then the year and the card number.
  - The four stats as ruled rows: label at left; five outlined stars at right, filled in the kingdom colour.
  - "Read the full review", underlined 2 px in the kingdom colour.
- At the foot, the faint outline of a cassette's bottom ridge with its two holes and two squares.

Stars and rarity symbols always carry a 0.8 to 1.4 px `#161616` outline, so pale kingdom colours (yellow, grey) stay readable on white.

### 8.2 Faces and states

- **Front:** as in section 8.1.
- **Back:**
  - The same obi strip.
  - The abstract art in the art window, with a "B" side badge.
  - In place of the review excerpt, the private-review note in muted italic.
  - "Read the full review".
  - The ridge.
- **Sealed:**
  - The strip shows "Sealed" as the title, "not yet" hand-written as the date, and the pack week at the foot.
  - The art window is a blank ruled label with a dashed edge.
  - The text below reads "Week NN pack" and "Card n of N".
  - No stats, no rarity, no album identity anywhere.
- **Unrated:** the front with empty stars, no rarity badge and "Unrated" in the meta line.

The card back and the sealed design shown in the reference are proposals; the front was approved.

### 8.3 Rarity finishes

Finishes sit on the frame and type, never on the art.

| Tier | Finish |
| --- | --- |
| Divine | A pearly sheen sweeps across the whole card on hover and loops slowly in the enlarged view. |
| Rare | Holo border: a conic gradient of the kingdom colour, its light tint and its dark shade. |
| Elite | Etched border: fine diagonal lines in the kingdom colour and its dark shade. |
| Special | Foil title: a vertical shimmer gradient clipped to the obi title. |
| Common | Matte; no finish. |

With reduced motion, the sheen is static.

### 8.4 Scaling

The card is authored at 1× and scaled with a CSS transform: 1× in the binder grid, 2× (560×784) enlarged and in the world's reveal panel, and 1.5× when the viewport is too short for 2×. The art stays crisp because it is 160 px of 32-px art scaled with nearest-neighbour.

## 9. Binder

### 9.1 Look

- **Page ground:** `#E7E7E4`.
- **Ink:** `#161616`.
- **Type:**
  - "Catalogue" wordmark in Dela Gothic One, 28 px.
  - Interface text in Instrument Sans.
  - Reading text in Instrument Serif.
- **Colour:** no blue or gold except rock's kingdom colour. The only saturated colours on screen are the kingdom colours and the art.

### 9.2 Layout

**Header.**

- Wordmark at left, with a count line under it ("212 albums, 3 sealed").
- At right, the search field: white, 1 px `#D6D6D2` border, 6 px radius, 40 px tall, Instrument Sans 15, placeholder "Search albums, artists, reviews". The `/` key focuses it.
- Under the header, four kingdom chips. Each chip is a small white pill with a 10 px colour bar on its left, the kingdom name and its count; chips toggle as filters.
- A sort control: card number (default), rarity, year, each stat, first listened.

**Pack shelf.** It shows only when sealed cards exist.

- The current week's pack is its sealed cards, overlapped and fanned at −6°, 0°, 6° and 12°. They spread apart on hover; a click lays them out.
- Older packs with sealed cards left collapse into one "Still sealed" stack with a count.

**Grid.**

- `repeat(auto-fill, minmax(280px, 1fr))` with a 32 px gap, cards at 1×.
- Hover lifts a card 4 px.
- Arrow keys move focus across the grid.
- Rows virtualise past about 400 cards.

**"See in world".** A link that opens the world with the current search applied.

### 9.3 Enlarged card

Click or `Enter` opens it.

- The card sits at 2× over a `rgba(20,20,20,.55)` scrim and tilts toward the pointer by up to ±8°.
- `F` or a click flips it (rotateY, 600 ms).
- `R` opens the reader.
- `←` / `→` go to the next card in the current order.
- `Esc` closes.

**Reveal.** The first time a card is seen open after being sealed, it plays one reveal: the sealed face flips to the front, then the pen date writes itself in left to right (a 600 ms clip-path reveal). Seen ids are kept in `localStorage`. Reduced motion skips the animation.

### 9.4 Search

Terms are case-insensitive, combine with AND, and update as you type. Non-matching cards fade to 25% opacity, so the grid keeps its shape; a toggle hides them instead. The query is mirrored to `?q=` so it can be shared with the world.

| Term | Matches |
| --- | --- |
| plain words | title, artist, full review text |
| `k:rock`, `k:electronic`, `k:hiphop` or `k:hip-hop`, `k:indie` | kingdom |
| `r:divine`, `r>=elite` | rarity, or that tier and above |
| `replay>=4`, `sonic=5`, `meaning<3`, `influence>=4` | a stat compared |
| `rating>=9` | the rating |
| `year<2000`, `year:1990s` | release year or decade |
| `first:2023` | year first listened |
| `artist:radiohead` | artist only |
| `sealed`, `open`, `unrated` | state |
| `pack:2026-W40` | one pack |

### 9.4b Phones

Below 820 px the binder drops its rails and runs one column; below 560 px the masthead hand scales down, the title band drops its note and the dock centres. On phones the enlarged card moves up and its notes come back as a compact sheet beneath it (label, title, artist, rating, rarity, release, first heard, and "read the review").

### 9.5 Reader

`R`, or "Read the full review", opens a panel on the right, 600 px wide (full screen on narrow windows).

**Header.**

- The title in Dela Gothic One, 24 px.
- The artist in Instrument Serif italic, 20 px.
- One quiet line in Instrument Sans 12 px, muted: rating, rarity, the four stats and the first-listen date.

**Body.** Reviews are private: this is the version that gets posted, and the reviews stay in Vedant's Logseq graph. Wherever a full review would appear (the reader, the card's back, the world's liner notes) it says, in Instrument Serif italic, *reviews stay local at my logseq for they are personal :p*. Nothing links to Logseq (no `logseq://` links, no "Open in Logseq"), and the server has no `/logseq/*` endpoints.

## 10. World

The world is a place to wander the catalogue by kingdom. There are no people: the cards themselves float in space, each inside its kingdom's nebula, and threads run from a card into every other kingdom it also belongs to. Kid A is rock and electronic, so a thread leaves the Kid A card in the blue rock cloud and runs into the grey electronic one, with a shooting star passing along it now and then.

The rule is that it stays cheap to draw. Everything soft goes into a small offscreen layer, and every kind of thing is one instanced draw.

### 10.1 Scene

- **Space:** `#050507`, with 3,000 far stars in a shell that follows the camera (no parallax). About 5% of them twinkle.
- **Nebulae.** One per kingdom, on a horizontal ring of radius 100 at 45°, 135°, 225° and 315°, at heights −10, +8, −4 and +12, with a cloud radius of about 26. Each nebula has:
  - 64 soft billboards ("puffs") cut from one baked fractal-noise texture (four variants in a 2×2 atlas). They sit in 3 or 4 seeded lobes and turn very slowly.
  - A hot core of 8 brighter puffs.
  - A colour taken from the kingdom's own colour, lifted so dark ones still glow. A third of the outer puffs drift a few degrees of hue toward a neighbour.
  - 16 dust puffs that subtract the cloud's own colour in proportion, which carves dark lanes without shifting the hue.
  - 160 stars inside the cloud, denser toward the core and tinted between white and the kingdom colour.
- **Labels.** In the space view, each kingdom shows its name in Dela Gothic One and its card count, as an HTML label above the cloud.

### 10.2 Rendering

- Two layers. The **glow layer** holds the nebula puffs, the dust and a soft copy of the threads. It renders into a target half the CSS size (half-float where supported) and is composited additively with a soft shoulder (`1 − e^−x`), so stacked clouds glow toward white instead of clipping. The **sharp layer** holds the stars, the cards, the crisp threads and the comets, at the device pixel ratio (capped at 2) with MSAA.
- No PS1 or PS2 styling: no vertex snapping, no low-res target for the sharp layer, no colour quantising.
- Puffs fade out as the camera comes close to them, so nothing reads as a flat sprite up close.

### 10.3 Cards

Every album is one card in its kingdom's cloud.

- **Faces.** Each face is a faithful miniature of the Obi card (cover, obi strip with title, pen date and foot, stats, rarity badge; the sealed face for sealed albums), drawn once into one canvas atlas. The atlas is the smallest power of two that fits, up to 4096 px, with cells up to 256 px wide.
- **Drawing.** All cards draw as two instanced quads: the opaque card (a rounded-rect SDF, depth-writing), then an additive glow around it in the kingdom colour.
- **Placement.** Each card is placed by a seed of its id, inside the cloud and at least 9.5 units from any other card. Adding a card never moves the others.
- **Motion.** Cards always face the camera, sway a little in yaw and roll, and bob ±0.35. The bob formula is shared with the thread shader, so threads stay pinned to their cards.
- **Finishes.** Divine cards get a pearly sheen sweeping across them now and then. Rare cards get a shimmering border.
- **Search.** The world accepts `?q=` with the binder's grammar. Matching cards glow, and the rest dim to silhouettes. `N` steps through matches.
- **Sealed.** Sealed albums float in their provisional kingdom showing the sealed face.

### 10.4 Threads

For every kingdom in an album's `also`, one thread runs from its card into that kingdom's cloud:

- **Strands.** Three quadratic-curve strands leave the card together, arc above the straight line, and fan apart as they land on the near side of the far cloud. Four short tendrils then spread from the landing points.
- **Colour.** The kingdom colour of the source, blending into the destination's.
- **Shooting star.** Every 8 to 14 s, a comet runs the length of the main strand in about a quarter of that time, then breaks into sparks along the tendrils.
- **Brightness.** Threads are faint at rest. They brighten when their card is hovered or met, when it matches a search, and in the kingdom view when they touch the current kingdom.
- **Cost.** All of it is evaluated in the vertex shader from three control points per strand. That is one draw for the lines, one for the comets and one for the glow copy. Per-thread brightness goes through a one-row texture, so nothing per-vertex is uploaded per frame.

### 10.5 Camera and controls

The viewer is always floating.

| State | Camera | Input |
| --- | --- | --- |
| Space | 300 units from the origin, 22° elevation, orbiting by itself at 0.018 rad/s. | Hovering a cloud brightens it; a click or keys `1`–`4` fly to it. |
| Kingdom | Orbits the cloud centre at radius 64 (scroll from 26 to 120) and 16° elevation (drag from −40° to 70°). Its own slow orbit resumes after 4 s idle. | Click a card (in any cloud in view) to meet it. `Esc` or clicking empty space goes back to space. |
| Card | Backs off until the 3D card is exactly as tall on screen as the big card, and slides sideways so it sits under it. If the card has a thread, the camera stands about 32° off the line to the far cloud, so the thread runs off across the open half of the screen. | `←` / `→` move to the previous or next card in the kingdom. `T` follows a thread to the kingdom it leads to. `F` flips, `R` opens the reader, `Esc` goes back. |

**Transitions.** 1.7 s into or out of space, and 1.15 s otherwise, easing in and out along an arc that rises above the straight line.

**Reveal.** 0.25 s after the camera lands, the big Obi card fades in on the right (centred on narrow screens) and the 3D card dissolves underneath it into small squares with a kingdom-coloured edge. Any card nearer the camera than twice the focused card's distance dissolves out of the way, with slack either side so it never flickers. Hovering a card brightens its glow and its threads.

**Liner notes.** The open side of the card view carries the album's notes over a soft dark scrim: number, kingdom and rarity; the title lowercased with a full stop, the way *Velocity : Design : Comfort* writes everything; artist and year; rating and first-listen date; the four stats as a five-step sequencer whose playhead walks with the music; the private-review note; buttons for each thread and for the reader and flip. Lines stutter in one after another. Cards drifting behind the notes fade out. Hidden below 720 px wide or when there is less than 300 px of room.

### 10.6 Sound

Each scene loops a song from `sounds/` (git-ignored, Vedant's own files), named in `config/sounds.json` with its title, artist and measured loudness (`lufs`, from ffmpeg's `ebur128`), so every scene plays at the same level. Open space plays Aphex Twin's *Rhubarb*; rock *Keep On Lying* (Tame Impala), electronic *In the Fog II* (Tim Hecker), hip-hop Madvillain's *Accordion* instrumental, indie *Dsco* (Sweet Trip). Songs stream through `<audio>` elements wired into WebAudio, so nothing large is decoded into memory; the server honours byte ranges so they seek and loop. Leaving a scene fades its song out and pauses it in place, so coming back picks up where it was. A scene with no song (or a missing file, which is a build warning) falls back to a generative WebAudio loop: a glitch-pop drift for space, and for the kingdoms a shoegaze wall, an IDM pattern, a swung boom-bap and jangling arpeggios. Scenes crossfade over about 2 s. The reader muffles the music behind a low-pass while it is open; a hidden tab pauses it. Beats are detected from jumps in low-end energy, and the notes' step sequencer walks on them.

**The album's own track.** Each album can name a `track`. A file in `sounds/` whose name holds the track name (whole words, so *In the Fog II* is not *In the Fog I*) is played whole for that album; Yeezus plays *On Sight* this way. Otherwise the build finds it through Apple's public search API (the album first, then the song by that artist), downloads the 30-second preview once into `previews/<id>.m4a` (git-ignored, cached by the name asked for) and puts `track: { name, no, preview }` in the catalogue. A track it can't find is a build warning, never a failure. The clip is fetched while the camera flies to the card; when the card arrives, the loops duck out and the clip fades in, a level just above them. Moving to a neighbour crossfades clip to clip. If the card's track is the song already looping in its kingdom (Velocity : Design : Comfort and *Dsco*), it simply carries on. When the clip plays out, or you leave the card, the kingdom's loop comes back. Sealed cards play nothing. The notes show `trk 01. everything in its right place.` over a hairline that fills as it plays, and the toggle shows the same name while it sounds.

The toggle sits top right: five bars that follow the spectrum and what is playing, lowercased with a full stop (`rhubarb.`; the generative loops have colon names like `drift : design : comfort.`). `M` toggles it. On by default, remembered in `localStorage` (`world.sound`). Browsers start audio only after a gesture, so it begins with the first click or key.

**Phones and tablets (up to 960 px).** The big card is centred in the space above a sheet along the bottom (the camera lifts the 3D card to match, so the hand-over still lines up). The sheet carries the essentials and the controls: number, kingdom, rarity, the lowercased title, artist and year, the track line, threads, and ‹ read flip ›. A sideways swipe on the card moves to the next or previous one; two fingers pinch to near or far in a kingdom. The status line hides at a card, and the sound toggle shows only its bars.

### 10.7 Performance

- Hold 60 fps with 300 cards on integrated graphics.
- The whole world is 10 draw calls, whatever the catalogue size: 3 in the glow layer (puffs, dust, thread glow) and 7 in the sharp layer (composite, stars, cloud stars, cards, card glow, threads, comets). The `?fps` readout counts the sharp layer only.
- Picking projects card centres to the screen and tests their rectangles. Nothing is raycast against geometry.
- `?stress=300` builds a synthetic catalogue, a third of it threaded, and `?fps` shows a readout.

### 10.8 Between the views

The binder and the world are joined by a warp drawn from the cover of *Velocity : Design : Comfort*: a blue perspective grid running to a horizon, a rainbow fan opening from the vanishing point, glitch bars, and lowercase words with a full stop (`the world.` / `trk 02. drift : thread : listen.`). It replaces the old Lain-style title cards (`Index:0N`, scanlines, RGB flicker). One 2D canvas draws it; it costs nothing at rest.

- **Binder → world** (1 s). The sheet's grid tips back into a floor, the sky goes from VDC blue to black, the floor races toward you under the fan, then everything settles to a black horizon. A short riser plays if sound is on.
- **World arriving.** This is the world's boot on every load. It starts on the exact frame the warp ended on and holds there until the world is ready, then the camera looks up off the floor into space and the overlay lets go. A direct visit fades the floor and words in first. Any click or key skips it.
- **World → binder** (0.95 s). The music fades, the camera looks back down at the floor, which rises up to face you and turns back into paper with the sheet's faint grid.
- **Binder arriving** (after a warp only). That paper lifts off as the ink comes in.

**Loading screen.** Any load that didn't come through the warp (a reload, a first visit) opens on the cover itself: VDC-blue sky with drifting cumulus, the white floor with its blue grid gliding toward you, the rainbow fan turning to the right of the vanishing point, and in white, top left, *It's all a dream, / A dream in death* over `drl 136. loading : catalogue : comfort.` and a rainbow progress hairline. It holds for at least 1.9 s and until the page is ready, then turns into the page in the warp's language: for the world, dusk falls, the fan sweeps shut and the camera looks up into space; for the binder, the floor rises into the sheet's paper and lifts off as the ink comes in. A click or key cuts the hold short.

A note in `sessionStorage` tells the next page it came through the warp. Reduced motion skips straight to the page. In development, `warpFrame('toWorld', 500)` freezes any timeline at a given millisecond for tuning.

In the binder the same language shows in the title band (`trk 01.` / `the binder.`, which stutters once and opens a rainbow fan the first time it scrolls into view), the masthead wordmark's one-off glitch, and the link to the world (`into the world.`, with a rainbow underline and a pink-and-cyan skip on hover).

## 11. Workflows

Every change starts as a sentence from Vedant to Claude running in Claude Code or Cowork on this repo; claude.ai chat cannot write to the disk. The steps are the skills in `skills/`:

- **add-album:** identify the album on Spotify, ask at most three questions, read the Logseq page, note any other kingdoms it belongs to (`also`), write the file, build, show the card.
- **make-pack:** propose 3 or 4 unheard albums, let him swap any, then write the pack and its sealed album entries.
- **open-card:** edit a card in place, including its kingdom and threads.

Judgement is never written by Claude: rating, stats and review stay in Logseq.

## 12. Build order and acceptance

1. **Data and builder.** Configs, schemas, the Logseq reader (file mode first), art baking, `catalogue.json`. Done when `npm run build` on the five example albums writes valid output and 10 art files (sealed albums are baked too, ready for when they open) in under 30 s, and a second run with nothing changed takes under 2 s.
2. **Card component.** Done when it matches `design/card-reference.html` pixel-for-pixel at 1× in Chrome, for front, back, sealed and unrated, and for all five finishes.
3. **Binder.** Done when every search term in section 9.4 returns what it says; packs fan and collapse; sealed cards show no album identity; reveal plays once.
4. **Reader and server.** Done when nested blocks, properties, links and journal dates render, and "Open in Logseq" opens the right page.
5. **Skills.** Done when "add Kid A, rock, the review is on the Kid A page" in a fresh Claude Code session ends with the card visible after at most three questions.
6. **World.** Done when the three camera states and their transitions work; clicking a card hands over to the big card in place; every `also` draws a thread with its shooting star; and the world holds 60 fps with 300 cards in 10 draw calls.

The whole thing must work offline after the first build: fonts, three.js, covers and art are all local.

## 13. Still open

These have working defaults above; change them in config or here.

- **Rock blue:** `#2D4B8E` is a guess at the "motion picture soundtrack" blue: dusky and cinematic. Vedant to confirm or give a reference.
- **Rarity order:** rare above elite, as Vedant listed them.
- **Logseq graph:** the real path, name, and whether it is a file graph or a database graph.
- **Card back and sealed design:** both are in the reference but not yet reviewed by Vedant.
