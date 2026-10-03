# Catalogue — build spec

Version 1.0, 2 Oct 2026. Owner: Vedant. This file is the single source of truth for the build; everything else in the bundle supports it.

## 0. How to use this bundle

Read this spec top to bottom once, then open `design/card-reference.html` in a browser; it is the visual contract for the card. `config/` holds the real config files to copy into the repo, `schema/` the JSON Schemas the builder validates against, `examples/` sample albums, a pack and a Logseq page, `skills/` the three Claude skills to install under `.claude/skills/`, and `reference/` the v2 prototype code (art pipeline and PS1 renderer) to port from. Placeholder art in `design/placeholder-art/` is a stand-in pattern, not album covers.

Where this spec and the reference code disagree, the spec wins.

## 1. What we are building

A personal, hand-curated RYM. Every album Vedant has listened to becomes a trading card and a person living in one of four kingdoms (rock, electronic, hip-hop, indie) that float in space. Albums enter only when he tells Claude to add them, so there is no cron, poller or live sync. Logseq stays the source of truth for words: each album's review and rating live on its Logseq page, and the catalogue links to that page instead of copying the thinking.

It runs only on his machine. Two views share one data file: the binder (cards, search, packs, the review reader) and the world (four islands in space, album-people he clicks to meet). Rendering in the world is PS1-style low-poly.

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
| Where appearance lives | The repo: kingdom, person, first-listen date, pack. |
| Rendering | three.js, PS1 style. Sprite people are the fallback only if per-album 3D authoring proves too slow. |
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
    world/                    world page; world/traits/ holds trait modules
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

One file per album, `albums/<id>.json`, validated by `schema/album.schema.json`. The id is a slug of the title, set once and never changed. Fields: `id`, `title`, `artist`, `year`, `spotify`, `cover` (Spotify 640 px URL), optional `runtime`, `kingdom`, `logseq.page`, `added` (date the entry was created), `first` (date Vedant first listened; null while sealed), `pack` (ISO week or null), and `person` (section 10.4). See `examples/albums/`.

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
    "spotify": "3USQKOw0se5pBNEndu82Rb", "kingdom": "rock", "added": "2026-10-02", "first": "2023-11-14", "pack": null,
    "state": "open", "rating": 9.5, "rarity": "rare",
    "stats": { "replay": 4, "sonic": 5, "meaning": 4, "influence": 5 },
    "art": { "pixel": "art/loveless.pixel.png", "abstract": "art/loveless.abstract.png",
             "palette": ["#..", "#..", "#..", "#..", "#..", "#..", "#..", "#.."] },
    "excerpt": "First ~280 characters of the review, plain text.",
    "logseq": { "page": "loveless", "url": "logseq://graph/music?page=loveless" },
    "person": { "...": "resolved: base defaulted, colours turned into hex" }
  } ],
  "warnings": [ "crumbling: page has no `meaning::` property" ]
}
```

`dist/search.json` maps album id to the full review as plain text, so search covers reviews without bloating `catalogue.json`.

## 6. Builder

### 6.1 Pipeline

`npm run build` runs these steps:

1. Load the config and every album and pack file. Validate each against its schema, and stop with a clear message on the first invalid file.
2. Read each album's Logseq page (section 6.2).
3. Download any missing covers (section 6.3).
4. Bake art when it is missing or stale (section 6.3).
5. Derive state, rarity and card numbers.
6. Resolve person colours.
7. Write `dist/catalogue.json` and `dist/search.json` atomically: write to a temp file, then rename.

The build never writes to the Logseq graph.

Warnings are collected in the output and printed. They cover a missing page, a missing or out-of-range property, an unknown trait or head, and a pack/album mismatch. Warnings never fail the build. A fatal error (invalid JSON, a schema failure, an unreadable graph path) does.

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
- **Palette.** The 8 pixel-art cluster colours as hex, ordered by share. People's colours and any accents use this.
- **Abstract art** (`art/<id>.abstract.png`, 640×640):
  - Sample the cover at 48×48 and run k-means with 6 colours.
  - Redraw with the kingdom's mark from `MARKS` in the reference: `smear` for rock, `grid` for electronic, `halftone` for hip-hop, `strings` for indie.
  - Draw with `@napi-rs/canvas`. Its `filter: blur()` support may differ from browsers, so implement blur with a box blur if needed.
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
  - The review excerpt in Instrument Serif 15/1.35, clamped to six lines.
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

### 9.5 Reader

`R`, or "Read the full review", opens a panel on the right, 600 px wide (full screen on narrow windows).

**Header.**

- The title in Dela Gothic One, 24 px.
- The artist in Instrument Serif italic, 20 px.
- One quiet line in Instrument Sans 12 px, muted: rating, rarity, the four stats and the first-listen date.

**Body.**

- The page from `GET /logseq/page`, as nested blocks.
- Text in Instrument Serif 18/1.55.
- Each nesting level indents 18 px and draws a 1 px `#E0E0DC` rule on its left.
- Links are underlined in the album's kingdom colour; when a link points at another catalogued album, it opens that album.

**Footer.** "Open in Logseq" (`logseq://graph/<graph>?page=<page>`).

The reader never edits the page.

## 10. World

### 10.1 Scene

The world is black space (`#050507`, never blue) with a star field: 3,000 points in a shell 400 to 900 units out, 1 to 2 px at render resolution, and about 5% of them twinkling.

**Islands.** The four islands sit on a horizontal ring of radius 90, at 45°, 135°, 225° and 315°, at heights −10, +8, −4 and +12. Each one rotates at 0.005 rad/s and bobs ±1.5 units over 20 s.

Each island is a low-poly floating rock:

- A flat top that is a 12- to 14-sided polygon of radius 24, with jittered vertices.
- A jagged cone underneath, 18 units deep.
- Its top is tinted with its kingdom colour mixed 35% into dark ground.
- A thin rim of kingdom-coloured light runs around its edge.

In the space view, each island shows its name in Dela Gothic One with its album count, as a sprite.

### 10.2 Rendering

PS1 style, ported from `reference/ps1-world-v2.html`:

- Render to a target 240 px tall, with width set by the aspect ratio, and upscale with nearest-neighbour. No antialiasing.
- Snap vertices to that grid in the vertex shader (the `ps1()` patch on `project_vertex`).
- Quantise colour to 15 bits in the fragment shader.
- Lambert (Gouraud) lighting from one directional light and one ambient light.
- Distance fog only in the kingdom and person views (near 30, far 140).
- Textures use NearestFilter with no mipmaps.

### 10.3 Camera and controls

The viewer is always floating; there is no walking.

| State | Camera | Input |
| --- | --- | --- |
| Space | 230 units from the origin, 25° elevation, orbiting by itself at 0.02 rad/s. | Hovering an island brightens its rim; a click or keys `1`–`4` fly to it. |
| Kingdom | Orbits the island centre at radius 46 (scroll from 24 to 70) and 28° elevation (drag from 10° to 60°). Its own slow orbit (0.05 rad/s) resumes after 4 s idle. | Clicking a person goes to the person view. `Esc` or clicking empty space goes back to space. |
| Person | 5.5 units from the person, along the island-centre-to-person direction turned 25°, at 2.4 × the person's height scale, looking at the chest. | `←` / `→` move to the previous or next person on the island, in card order. `R` opens the reader. `Esc` goes back. |

**Transitions.**

- Space to kingdom: 1.6 s.
- Kingdom to person: 1.1 s.
- Both ease in and out cubically, along an arc that rises above the straight line.

**Reveal.** 0.5 s after the camera arrives at a person, their Obi card slides in from the right at 2×, vertically centred. The person turns slowly toward the camera and keeps animating. Hovering a person shows only a pointer cursor and a faint white rim (an inverted hull at 60%). It never shows a name, because the click is the reveal.

**Search.** The world accepts `?q=` with the binder's grammar. Matching people glow in their kingdom colour and the rest dim to 30%. `N` steps through matches.

### 10.4 People

Every album is one person.

**Structure.** People are built from boxes, cylinders and icosahedra, at most 300 triangles each, with this rig:

- `root` → `hips` → `torso`, with `head`, `armL` and `armR` (pivoting at the shoulders), and `legL` and `legR` (pivoting at the hips).

**Base bodies**, one per kingdom:

| Base | Shape | Default head | Default gait |
| --- | --- | --- | --- |
| rock | Lanky: height scale 1.15, narrow torso, long arms and legs, small head. | default | stride |
| electronic | Built from 0.3-unit voxel cubes: two-cube-wide torso, cube limbs, a 0.46 cube head. | cube | hop (one grid step every 0.45 s) |
| hiphop | Heavy and square: wide torso (1.3 × 1.1 × 0.78), short thick legs, thick arms. | default (large cube) | stride, slow |
| indie | Slight: height scale 0.95, narrow shoulders, an 8° forward hunch, arms tucked as if hands in pockets, a slightly large head. | default | shuffle |

**Heads:**

- `default`: plain, with no features.
- `static`: the front face is live noise; one shared texture, updated every 3 frames.
- `faceless`: a smooth icosahedron.
- `cover`: the front face is the album's pixel art.
- `skull`: a wireframe icosahedron.
- `cube`: a voxel cube.

**Motion:**

- `gait` is one of walk, shuffle, stride, drift, hop or still.
- `tempo` scales speed and limb swing.
- `bpm` drives any trait that keeps time.

**Colours.** `palette:N` resolves to the N-th cover palette colour. The defaults are body `palette:0`, accent `palette:2`, and skin at 60% of `palette:0`'s lightness.

**Wandering.** People pick random targets on their island's top (inside radius 20), pause for 1 to 6 s, keep at least 1.2 units apart, and never step off the rim.

### 10.5 Traits

A trait is one module in `web/world/traits/<name>.ts`, registered in `traits/index.ts`:

```ts
export interface PersonRig {
  root: THREE.Group;
  parts: { hips; torso; head; armL; armR; legL; legR };   // THREE.Object3D
  materials: { body; accent; skin };                       // THREE.Material
  palette: string[];                                       // 8 hex, by share
  album: AlbumOut;                                         // the catalogue.json entry
}
export interface Trait {
  name: string;
  apply(p: PersonRig): void;                    // once, after the base body and head
  update?(p: PersonRig, t: number, dt: number): void;
}
```

Traits apply in the order listed. An unknown name is a build warning and is skipped at runtime.

Ship these ten in v1:

| Trait | What it does |
| --- | --- |
| `bowed` | Head pitched about 0.55 rad down, eyes on the ground. |
| `trailing-noise` | Two or three after-images that lag behind by 0.15 s and fade. |
| `skeleton` | Replaces the body with 0.07-thick bones and three ribs. |
| `translucent` | Body and head at 55% opacity. |
| `hover` | Floats 0.35 above the ground and bobs slowly. |
| `voxel-glitch` | Every 0.14 s, a few parts jump by one quantised step and snap back. |
| `halo` | A thin low-poly ring above the head in the accent colour, spinning slowly. |
| `nod` | The head nods on the beat at `motion.bpm` (default 90). |
| `cape` | A two-segment cloth plane that sways with the gait. |
| `flicker` | Turns invisible for one or two frames at random intervals. |

New traits get added when Vedant describes something no module covers (see the add-album skill). Each trait stays small and works on any base body.

### 10.6 Sealed albums

Sealed albums stand at their island's rim as unlit black silhouettes (MeshBasic, `#0A0A0A`) in the base body of their provisional kingdom, facing outward and not moving. Clicking one shows the sealed card. When its card opens, the silhouette takes on its colours and walks in.

### 10.7 Performance

Hold 60 fps with 300 people on integrated graphics.

- People of one base share geometry.
- One static-noise texture is shared by everyone.
- Raycast only against bounding boxes on the current island.
- In the space view, people further than 150 units render as single coloured points.

## 11. Workflows

Every change starts as a sentence from Vedant to Claude running in Claude Code or Cowork on this repo; claude.ai chat cannot write to the disk. The steps are the skills in `skills/`:

- **add-album:** identify the album on Spotify, ask at most three questions, read the Logseq page, translate his description into the person, write the file, build, show the card.
- **make-pack:** propose 3 or 4 unheard albums, let him swap any, then write the pack and its sealed album entries.
- **open-card:** edit a card or person in place.

Judgement is never written by Claude: rating, stats and review stay in Logseq.

## 12. Build order and acceptance

1. **Data and builder.** Configs, schemas, the Logseq reader (file mode first), art baking, `catalogue.json`. Done when `npm run build` on the five example albums writes valid output and 10 art files (sealed albums are baked too, ready for when they open) in under 30 s, and a second run with nothing changed takes under 2 s.
2. **Card component.** Done when it matches `design/card-reference.html` pixel-for-pixel at 1× in Chrome, for front, back, sealed and unrated, and for all five finishes.
3. **Binder.** Done when every search term in section 9.4 returns what it says; packs fan and collapse; sealed cards show no album identity; reveal plays once.
4. **Reader and server.** Done when nested blocks, properties, links and journal dates render, and "Open in Logseq" opens the right page.
5. **Skills.** Done when "add Kid A, rock, the review is on the Kid A page" in a fresh Claude Code session ends with the card visible after at most three questions.
6. **World.** Done when the three camera states and their transitions work; clicking a person reveals their card; the ten traits work on all four bases; and the world holds 60 fps with 300 people.

The whole thing must work offline after the first build: fonts, three.js, covers and art are all local.

## 13. Still open

These have working defaults above; change them in config or here.

- **Rock blue:** `#2D4B8E` is a guess at the "motion picture soundtrack" blue: dusky and cinematic. Vedant to confirm or give a reference.
- **Rarity order:** rare above elite, as Vedant listed them.
- **Logseq graph:** the real path, name, and whether it is a file graph or a database graph.
- **Card back and sealed design:** both are in the reference but not yet reviewed by Vedant.
