# Base Design Tool — Architecture
# v3.2 · 2026-05-11

Browser-based 3D voxel base planner for Dune Awakening guild bases.
Single user, no auth, Supabase persistence, Cloudflare Pages hosting.

This project has two active versions:
- **v1** — cubic integer voxel grid, live on `main`. Finishing remaining steps now.
- **v2** — full graph model supporting square-triangle hybrid tiling, planned on `v2` branch. See `spec-v2.md` for design detail.

---

# V1

**Tools:** Build, Delete, Select, Area Select [shift+click/drag adds/removes], Paint [bulk repaint via sidebar], Duplicate, Pick Up [multi-ghost with Q/E rotate, Z/X level shift, T anchor cycle]

**Objects:** Cube, Stair, Wedge, Wedge Inverted, Corner Wedge, Corner Wedge Inverted, Doorway, Window, Pentashield Side, Pentashield Top, ½ Wedge, ½ Wedge + Block, ½ Wedge Inverted, ½ Wedge + Block Inverted

**Features:** Save/Load projects [Supabase], Stamps [save selection, place via ghost], welcome splash [load or new project], inline footprint editor [up to 6 connected 10×10 landclaims], camera [left-drag pan, right-drag rotate, scroll zoom, WASD pan], Settings modal [pan/rotate/zoom/UI scale sliders], X-ray toggle, placement ghost, N/S/E/W 2D compass, shortcuts strip, selection actions bar [duplicate/pick up/paint/delete, confirmation modal >10 pieces]

## V1 Status

### Done
- **Step 6c** — Two new directional object types: `pentashield-side` and `pentashield-top`. Identical to `cube-window`/`cube-doorway` in all respects (BoxGeometry base, N/E/S/W rotation, sidebar registration). Decoration: 7 solid diagonal lines, centre line anchored bottom-left → top-right corner, 3 lines evenly spaced either side. `pentashield-side`: decoration on south face. `pentashield-top`: decoration on top face. Decoration lines visible on ghost for window, doorway, and both pentashields. (app.js, ui.js, scene.js)

### To Do
- **Step 10** — X-ray toggle.
- **Step 11** — Clear all (destructive modal).

## V1 Current State
<!-- Keep ≤5 sentences: (a) last completed step, (b) anything known to be broken, (c) what the next step must accomplish. -->

Steps 6a–6d and Step 12 complete. All fourteen object types, hotkey strip, and save overwrite fix working. Step 14 (new objects + sidebar reorder) in progress. Step 10 (X-ray toggle) is next after that.

---

# Shared

## Project

- **Stack:** Vanilla HTML/CSS/JS. No framework, no build step. Three.js r128 via cdnjs. Rajdhani + Share Tech Mono via Google Fonts.
- **Hosting:** Cloudflare Pages from `src/`. URL: https://base-design-tool.pages.dev/
- **Storage:** Supabase project `base-design`. URL: https://ekrlymbgjduczogvskox.supabase.co
- **Repo:** GitHub-connected. Branches: `main` (v1 live), `dev` (v1 in progress), `v2` (v2 in progress).

---

## Files

```
base_planner/
├── docs/
│   ├── architecture.md   ← this file, always read first
│   ├── architect.md      ← Architect role rules (this Desktop chat)
│   ├── dev.md            ← Dev role rules (fresh Desktop chat per step)
│   ├── spec.md           ← v1 deep reference
│   └── spec-v2.md        ← v2 deep reference
└── src/
    ├── index.html        ← shell, CDN tags
    ├── style.css         ← all styles
    ├── app.js            ← state, mutations, Supabase, init
    ├── scene.js          ← Three.js scene, render, raycasting
    └── ui.js             ← sidebar, modals, footprint editor, hotkeys
```

v1 and v2 share the same `src/` files on different branches. `app.js` exposes `window.App`, `scene.js` exposes `window.Scene`, `ui.js` exposes `window.UI`. State lives in `App` only — all mutations go through `App` methods so autosave hooks centrally.
The user manages git completely and changes the active branch accordingly, remind the user of this. All work is to be done on `src/` regardless of the branch.

---

## State Shape

Persisted: `building`, `cells`, `colors`.
Editor-only (not persisted): `tool`, `selectedObject`, `placeDirection`, `selection`, `perimeterClicks`, `xray`, `showPlacementGhost`, `placingStamp`.

**building** — array of footprint landclaims. Each landclaim is 10×10 world units. Max 6 landclaims, must stay connected.

**cells** — sparse Map keyed by "x,y,z". Each entry: object type, direction, colorId. Object is one of: cube, stair-solid, wedge-solid, wedge-solid-inverted, corner-wedge, corner-wedge-inverted, cube-doorway, cube-window, pentashield-side, pentashield-top, half-wedge, half-wedge-block, half-wedge-inverted, half-wedge-block-inverted. Direction is N/E/S/W for all types except cube, which is null.

**colors** — array of unnamed hex swatches. Index 0 is the default colour, never deletable.

**project** — Supabase row reference for the active project: id and name.

**stamps** — local cache of the Supabase stamps table.

Coordinates: x east, y up, z south. Integer units. Footprint at y=0, no upper bound.
Maps serialise to arrays for Supabase JSON and are reconstructed on load.

---

## CSS Variables

Never hardcode colours. Full values in spec.md § CSS.
--bg #090b0e · --panel #0e1218 · --panel2 #121820
--border #1c2530 · --border2 #243040
--accent #4a9fd4 · --accent2 #2a6496
--text #a8c0d6 · --text-dim #445566 · --text-bright #d0e8f8
--danger #c0392b · --danger2 #922b21 · --success #27ae60
--sidebar 264px · --topbar 48px

---

## Conventions

- British spelling everywhere.
- CSS variables only, no hardcoded colours.
- Rajdhani for labels. Share Tech Mono for numbers.
- All destructive actions require a danger modal with `.modal-danger-banner`.
- Supabase: try/catch every call, surface errors via banner, never silent.
- State mutations through `App` methods only.

---

## V1 Future Ideas
<!-- Parked v1 concepts. -->

- **Perimeter selection** (F key) — parked from Step 9.
- **Stair side face lines** — currently 8 per-step quads per side produce visible step lines on triangular side faces. Cosmetic fix: replace with single triangle per side. Needs care around EdgesGeometry and raycasting.

---

# V2

Full graph model replacing the cubic integer voxel grid. The game uses a square-triangle hybrid tiling system (Archimedean-style); entire base wings are built in rotated frames using dodecagonal modules. v2 models this accurately. See `spec-v2.md` for full design detail.

## V2 Decisions

- **Coordinate system:** float world position + integer rotation index (0–11). Connectivity graph is source of truth; positions recomputed from graph as needed.
- **Collision:** two pieces collide if their footprint polygons intersect with area > 0.001.
- **Branch:** `v2` off `main`. v1 stays live on `main` throughout.
- **Triangle type:** one only — equilateral, no variants. Must connect to an existing piece face; cannot be placed on empty footprint.
- **Connection rule:** any piece face can connect to any other piece face, flush and non-overlapping. A single piece may bridge two non-parallel faces simultaneously.

## V2 Status

### Done
- **V2 Step 1** — Geometry primitives & rotation algebra. geometry.js created with 12-rotation set, square and triangle face descriptors, attachment transform.
- **V2 Step 2** — State shape: pieces and connections. cells Map replaced with pieces Map and connection graph. Core App methods: placePiece, deletePiece, getPiece.
- **V2 Step 3** — Render pieces from new state. _rebuildPieces renders squares and triangles from pieces Map.
- **V2 Step 4** — Raycast + placement (squares only, axis-aligned).
- **V2 Step 5** — Triangles + rotation cycling. Full placement context rules implemented (CTX_FLAT, CTX_SIDE, CTX_TRI). Square-on-triangle top/bottom with 3-slot Q/E edge cycling also implemented here.

### To Do
- **V2 Step 6** — Piece family refactor. Define `PIECE_FAMILY` in geometry.js: `'square-family'` maps all 14 square-family types (square, stair-solid, wedge-solid, wedge-solid-inverted, corner-wedge, corner-wedge-inverted, cube-doorway, cube-window, pentashield-side, pentashield-top, half-wedge, half-wedge-block, half-wedge-inverted, half-wedge-block-inverted); `'triangle-family'` maps triangle. Export `getPieceFamily(type)` — throws on unknown type. Replace all raw type string checks in scene.js and ui.js with `getPieceFamily()` calls, preserving all existing logic exactly. Split `selectInScreenRect` into family-aware branches: square-family applies `+0.5` centroid offset, triangle-family uses raw position. No new piece types, no behaviour changes beyond the centroid fix. (geometry.js, scene.js, ui.js)
- **V2 Step 7** — Full shape library. Port all 13 remaining square-family types from v1 into v2. Each type: render geometry in scene.js (`_makeInclineGeo` / `_addDecalLines` as appropriate), face descriptors in geometry.js, sidebar registration in ui.js. All types use square-family placement logic — no new placement rules. Directional types (all except cube/square) use existing N/E/S/W rotation via rotationIndex. (geometry.js, scene.js, ui.js)
- **V2 Step 8** — Delete a piece. Orphaned connected pieces stay; connections to deleted piece are nulled.
- **V2 Step 9** — Select + single-piece operations (paint). Selection becomes Set<pieceId>.
- **V2 Step 10** — Duplicate / pick-up: ghost as connected subgraph with root face. Rotation cycles root face and attachment rotation.
- **V2 Step 11** — Stamps as saved subgraphs. Reuses Step 10 ghost infrastructure.
- **V2 Step 12** — Footprint test in world space. Polygon-in-landclaim test for squares and triangles.
- **V2 Step 13** — Direction HUD rework. N/E/S/W replaced with 12-rotation indicator.
- **V2 Step 14** — Save/load, project CRUD. Serialisation format update only; CRUD logic unchanged.

## V2 Current State

Steps 1–5 complete. Squares and triangles fully placeable with correct attachment, rotation, and ghost behaviour. Step 6 (piece family refactor) is next — required before any new piece types are introduced.
