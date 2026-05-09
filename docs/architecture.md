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
- **Step 4** — Full object sidebar: all four types, SVG thumbnails, Q/E HUD. Fixed duplicate polygon in wedge-solid-inverted icon.
- **Step 5a** — Bug fixes (scene.js): z-fighting edge lines, inverted wedge geometry (vertically flipped), 8-step stair geometry.
- **Step 5b** — Bug fixes (ui.js + scene.js): stale render on hotkey rotation, W/S camera swap, remap R=Select/T=Delete, shortcuts strip update, red ghost suppression on placement, remove SVG sprite and switch object buttons to text-only.
- **Step 5c** — Area Select tool: new tool in sidebar after Select (Build → Delete → Select → Area Select). Left-drag draws 2D rect overlay; on mouse-up selects all pieces whose cell falls within the rect including occluded pieces. Click without drag = single select. Shift+click/drag adds/removes. Shares selection state with Select tool.
- **Step 5e** — Bug fixes + settings: (1) Area Select left-drag must not pan — only rect-select; (2) right-click must not deselect when objects are selected; (3) kill autosave entirely — save only on explicit Save Project click; (4) Settings modal (top bar, next to Save Project): three sliders — Pan speed (left-drag + WASD), Rotate speed (right-drag), Zoom speed (scroll). (ui.js, scene.js, app.js)
- **Step 5e.1** — Settings modal fixes: overflow/clipping fix; UI Scale slider (0.5–2.0, default 1.0) scales sidebar, panels, text, compass, HUD, shortcuts strip — not the 3D viewport. Persists in localStorage.
- **Step 5d** — Multi-ghost: Duplicate and Pick Up actions in sidebar. Ghost follows cursor, Q/E rotates 90°, T cycles anchor corner through 4 footprint corners, Z/X shifts ghost up/down one level. Occupied cells silently skipped on placement; ghost red only when every target cell is occupied. On placement, placed pieces become active selection. ESC cancels; Pick Up restores originals on ESC.
- **Step 5f** — Multi-ghost fixes: Z/X level shifting, skip occupied on placement, post-placement selection.

### To Do
<!-- Step sizing rule: each step should touch ≤3 files and <=5 fixes/features and be completable in one focused session. If a planned step touches more, split it before greenlighting. Prefer narrow correctness over broad ambition. -->
- **Step 5g** — Paint tool: new tool in sidebar after Area Select (Build → Delete → Select → Area Select → Paint). Click any placed piece to repaint it to the active colour swatch. With ≥1 pieces selected, a Paint button in the sidebar repaints the whole selection to the active colour. (app.js, ui.js, scene.js)
- **Step 6** — Stamps: creation: select region, name it, save to Supabase. (app.js, ui.js)
- **Step 7** — Stamps: placement: ghost preview, Q/E rotation, T anchor-corner cycling, red-if-blocked. Reuses multi-ghost infrastructure from 5d. (scene.js, ui.js, app.js)
- **Step 8** — Perimeter selection (F key).
- **Step 9** — X-ray toggle.
- **Step 10** — Clear all (destructive modal).
- **Step 11** — Hotkey strip rework: fully dynamic display based on active tool and selected object type. Resolves all known info-bar conflicts.

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
├── docs/
│   ├── architecture.md   ← this file, always read first
│   ├── architect.md      ← Architect role rules (this Desktop chat)
│   ├── dev.md            ← Dev role rules (fresh Desktop chat per step)
│   ├── spec.md           ← deep reference, read sections as needed
│   ├── v1-reference.png  ← visual reference for v2
│   └── v1-reference.html ← html reference for v2
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

Steps 5a–5g prerequisites all complete (5a, 5b, 5c, 5d, 5e, 5e.1, 5f). Multi-ghost, Area Select, settings modal, and UI scale all done. Next step is 5g — Paint tool.
