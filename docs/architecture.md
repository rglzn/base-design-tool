# Base Design Tool — Architecture
# v3.0 · 2026-05-08

Browser-based 3D voxel base planner for Dune Awakening guild bases.
Single user, no auth, Supabase persistence, Cloudflare Pages hosting.

---

## Status

### Done
- Architecture agreed. Repo, Cloudflare Pages, Supabase all live.
- v1 preserved in git history. v2 build not yet started.
- **Step 1** — v2 core: footprint editor, 3D scene, cube placement, Build/Delete/Select tools, colour swatches. End-to-end usable.
- **Step 2** — Supabase: autosave, Save/Load Project, first-run modal.

### To Do
- **Step 2** — Supabase: autosave, Save/Load Project, first-run modal.
- **Step 3** — Full object sidebar: all eight types, SVG thumbnails, Q/E HUD.
- **Step 4** — Walls: plain, window, doorway on edges.
- **Step 5** — Inclines: solid + thin stairs/wedges.
- **Step 6** — Stamps: select → save → place, R/T modifiers, red ghost when blocked.
- **Step 7** — Perimeter selection (F key).
- **Step 8** — X-ray toggle.
- **Step 9** — Clear all (destructive modal).

---

## Project

- **Stack:** Vanilla HTML/CSS/JS. No framework, no build step. Three.js r128 via cdnjs. Rajdhani + Share Tech Mono via Google Fonts.
- **Hosting:** Cloudflare Pages from `src/`. URL: https://base-design-tool.pages.dev/
- **Storage:** Supabase project `base-design`. URL: https://ekrlymbgjduczogvskox.supabase.co
- **Repo:** GitHub-connected.

---

## Files

```
base_planner/
├── CLAUDE.md
├── docs/
│   ├── architecture.md   ← this file, always read
│   ├── spec.md           ← deep reference, read sections as needed
│   └── v1-reference.png  ← visual reference for v2
└── src/
    ├── index.html        ← shell, CDN tags
    ├── style.css         ← all styles
    ├── app.js            ← state, mutations, Supabase, init
    ├── scene.js          ← Three.js scene, render, raycasting
    └── ui.js             ← sidebar, modals, footprint editor, hotkeys
```

`app.js` exposes `window.App`, `scene.js` exposes `window.Scene`, `ui.js` exposes `window.UI`. State lives in `App` only — all mutations go through `App` methods so autosave hooks centrally.

---

## State Shape

Persisted: `building`, `cells`, `walls`, `colors`.
Editor-only (not persisted): `tool`, `selectedObject`, `placeDirection`, `selection`, `perimeterClicks`, `xray`, `placingStamp`.

**building** — array of footprint blocks. Each block is 10×10 world units. Max 6 blocks, must stay connected.

**cells** — sparse Map keyed by "x,y,z". Each entry: object type, direction, colorId. Object is one of: cube, stair-solid, stair-thin, wedge-solid, wedge-thin. Direction is N/E/S/W for inclines, null for cubes.

**walls** — sparse Map keyed by "x,y,z,edge" where edge is N or W only (owned-edge model). Each entry: type (plain, window, doorway) and colorId.

**colors** — array of unnamed hex swatches. Index 0 is the default colour, never deletable.

**project** — Supabase row reference for the active project: id and name.

**stamps** — local cache of the Supabase stamps table.

Coordinates: x east, y up, z south. Integer units. Footprint at y=0, no upper bound.
Maps serialise to arrays for Supabase JSON and are reconstructed on load.

---

## CSS Variables

Full palette — never hardcode colours. See spec.md for values.
Keys: --bg --panel --panel2 --border --border2 --accent --accent2
      --text --text-dim --text-bright --danger --danger2 --success
      --sidebar --topbar

---

## Conventions

- British spelling everywhere.
- CSS variables only, no hardcoded colours.
- Rajdhani for labels. Share Tech Mono for numbers.
- All destructive actions require a danger modal with .modal-danger-banner.
- Supabase: try/catch every call, surface errors via banner, never silent.
- State mutations through App methods only.

---

## Current State

Step 2 complete. Supabase client live (window._sb). Autosave on 2s debounce after any mutation. Save Project (named snapshot, danger modal if overwriting named save), Load Project modal with thumbnails and relative dates, First-run modal on blank state. project state shape: { id, name, isNamed }. Next: Step 3 (full object sidebar).
