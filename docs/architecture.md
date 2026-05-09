# Base Design Tool — Architecture
# v3.1 · 2026-05-09

Browser-based 3D voxel base planner for Dune Awakening guild bases.
Single user, no auth, Supabase persistence, Cloudflare Pages hosting.

---

## Status

### Done
- Architecture agreed. Repo, Cloudflare Pages, Supabase all live.
- v1 preserved in git history. v2 build not yet started.
- **Step 1** — v2 core: footprint editor, 3D scene, cube placement, Build/Delete/Select tools, colour swatches. End-to-end usable.
- **Step 2** — Supabase: autosave, Save/Load Project, first-run modal.
- **Step 3** — Simplify + rework startup flow. Remove walls, floors, thin inclines. Solid objects only (cube, stair-solid, wedge-solid, wedge-solid-inverted). Inline footprint builder replaces modal. Load-or-new startup screen replaces first-run modal. Face-only raycasting.
- **Step 3.1** — Bug fixes and polish: load-or-new on every F5; Select tool with yellow highlight; left-drag pan / right-drag rotate / WASD pan; placement ghost (showPlacementGhost toggle); wedge-solid-inverted type + geometry + SVG; corrected stair/wedge SVGs; shortcuts strip; X-ray moved to View sidebar section; N/S/E/W 2D compass; landclaim boundary grid lines.

### To Do 
- **Step 4** — Full object sidebar: all four types, SVG thumbnails, Q/E HUD.
- **Step 5** — Stamps: select → save → place, R/T modifiers, red ghost when blocked.
- **Step 6** — Perimeter selection (F key).
- **Step 7** — X-ray toggle.
- **Step 8** — Clear all (destructive modal).

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
│   ├── v1-reference.png  ← visual reference for v2
│   └── v1-reference.html  ← html reference for v2
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

Persisted: `building`, `cells`, `colors`.
Editor-only (not persisted): `tool`, `selectedObject`, `placeDirection`, `selection`, `perimeterClicks`, `xray`, `showPlacementGhost`, `placingStamp`.

**building** — array of footprint landclaims. Each landclaim is 10×10 world units. Max 6 landclaims, must stay connected.

**cells** — sparse Map keyed by "x,y,z". Each entry: object type, direction, colorId. Object is one of: cube, stair-solid, wedge-solid, wedge-solid-inverted. Direction is N/E/S/W for inclines, null for cubes.

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

## Current State
<!-- Keep ≤5 sentences: (a) last completed step, (b) what is broken and why, (c) what current step must accomplish. -->

Step 3.1 complete. All four object types work (cube, stair-solid, wedge-solid, wedge-solid-inverted). Load-or-new screen appears on every F5. Select tool shows yellow edge highlight. Camera is left-drag pan / right-drag rotate with WASD pan. Placement ghost, shortcuts strip, View section, N/S/E/W compass, and landclaim grid all implemented. Codebase is clean and ready for Step 4.
