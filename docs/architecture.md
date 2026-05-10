# Base Design Tool — Architecture
# v3.1 · 2026-05-09

Browser-based 3D voxel base planner for Dune Awakening.
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
- **Step 5g** — Paint tool: new tool in sidebar after Area Select (Build → Delete → Select → Area Select → Paint). Click any placed piece to repaint it to the active colour swatch. With ≥1 pieces selected, a Paint button in the sidebar repaints the whole selection to the active colour. (app.js, ui.js, scene.js)
- **Step 5g.1** — Paint tool selection fix: switching to Paint tool preserves current selection so sidebar Paint button can immediately repaint it.

- **Step 5h** — Selection actions bar: persistent bar in sidebar showing whenever ≥1 pieces are selected (regardless of active tool). Four buttons: Duplicate, Pick Up, Paint (bulk repaint to active swatch), Delete. Bar hidden when selection is empty.
- **Step 5i** — Confirmation modal for large selections: Delete and Paint (bulk) actions affecting >10 pieces show a confirmation modal before proceeding. ≤10 pieces proceed immediately.

- **Step 6a** — Register four new object types in app.js + ui.js: corner-wedge, corner-wedge-inverted, cube-doorway, cube-window. Added to state valid types, direction handling (all four directional N/E/S/W), and Objects sidebar (text labels, eight types total).
- **Step 6b** — Geometry for all four new types in scene.js: corner-wedge, corner-wedge-inverted, cube-doorway, cube-window.

- **Step 6b.1** — Bug fix (scene.js): winding order investigation, partial.
- **Step 6b.2** — Bug fixes (scene.js): doorway decoration corrected to three-edge door frame; further winding investigation.
- **Step 6b.3** — Bug fix (scene.js): all winding order issues resolved. cube-doorway and cube-window replaced with THREE.BoxGeometry. Three manual face flips on wedge-solid-inverted (right tri, slope, back) and one on corner-wedge-inverted (top). All eight types now fully correct.

- **Step 7** — Stamps: creation and management. Save selection → name prompt → normalise to origin → Supabase. Stamp list in sidebar with Place (no-op) and Delete (danger modal). Name uniqueness check. style.css stamp row styles.
- **Step 8** — Stamps: placement + 2-column grid UI. Ghost follows cursor, Q/E rotates, T cycles anchor corner, red-if-blocked, click to place. Clicking tile activates placement ghost. Delete × on tile corner with danger modal. Thumbnails removed. Reuses multi-ghost infrastructure from 5d.

### To Do
- **Step 9** — Perimeter selection (F key).
- **Step 10** — X-ray toggle.
- **Step 11** — Clear all (destructive modal).
- **Step 12** — Hotkey strip rework: fully dynamic display based on active tool and selected object type. Resolves all known info-bar conflicts.
- **Step 13** — Stair side face lines: currently drawn as 8 per-step quads per side, producing visible step lines on the triangular side faces. Cosmetic only — replace with single triangle per side. Needs careful handling to avoid breaking EdgesGeometry or raycasting.

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

**cells** — sparse Map keyed by "x,y,z". Each entry: object type, direction, colorId. Object is one of: cube, stair-solid, wedge-solid, wedge-solid-inverted, corner-wedge, corner-wedge-inverted, cube-doorway, cube-window. Direction is N/E/S/W for all types except cube, which is null.

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

Steps 6a through 6b.3 and Steps 7–8 complete. All eight object types working. Stamps fully implemented (save, list, delete, placement, no thumbnails). Zoom damping tuned. Ready for Step 9 (Perimeter selection).

---

## Future Ideas
<!-- Parked concepts that would require significant architectural change or are out of scope for now. -->

- **Triangular objects** — equilateral triangles that attach to existing object faces and create half-unit offsets, with other objects inheriting those offsets. Would break the cubic voxel grid (integer x,y,z keys), raycasting, placement, stamps, and footprint systems. Requires a parallel coordinate system or adjacency graph. Significant partial rebuild — revisit if the tool evolves beyond rectangular base planning.
