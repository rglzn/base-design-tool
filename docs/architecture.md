# architecture.md
# Base Design Tool
# Version: 2.0
# Last Updated: 2026-05-08

A browser-based 3D base planner for Dune Awakening guild bases. Single-user, no auth, persisted to Supabase.

This document is the source of truth for project facts: state shape, file layout, object types, sidebar, schemas, conventions, migration status. Workflow rules live in the project instructions.

---

## 0. Status

Living snapshot of where the project is and what's left to do. Updated as work progresses. Covers everything: code, docs, deployment, infrastructure.

### Done

- Initial design discussions and direction agreed (3D-first, kill 2D, kill levels, walls as first-class, eight object types, autosave to Supabase).
- Folder structure created: `base_planner/architecture/`, `base_planner/prod/`, empty placeholder files for `index.html`, `style.css`, `app.js`, `scene.js`, `ui.js`.
- `architecture.md` written (this document).

### To Do

- Update project instructions in Claude (manual, by user) to the cleaner workflow-only version proposed in chat.
- Delete leftover `base_planner/architecture.md` at the root (superseded by `architecture/architecture.md`).
- **Step 1 — Cloudflare deploy of v1 single-file tool.** Set up Cloudflare Pages project pointed at `prod/`. Put a working v1 single-file `index.html` in `prod/` for the initial deploy. Confirm the tool loads at the deployed URL.
- **Step 2 — Supabase project + persistence.** Create separate Supabase project for Base Design Tool. Create `projects`, `app_state`, `stamps` tables. Wire up autosave + Save Project + Load Project in the v1 tool. Remove JSON export/import buttons.
- **Step 3 — Refactor v1 single-file into split files** (`index.html`, `style.css`, `app.js`, `scene.js`, `ui.js`). Same behaviour, modular structure.
- **Step 4 — State shape rewrite.** Sparse cells map, kill levels, kill ghost-below, kill 2D grid view. Update Three.js render to use the new state.
- **Step 5 — Object sidebar.** Eight object types selectable. Build tool places by type. Cube becomes the default. SVG thumbnails baked.
- **Step 6 — Walls.** Plain, window, doorway placeable on edges. Walls inherit cell colour at paint time.
- **Step 7 — Inclines refactor.** Solid stairs/wedges as 1×1×1 cube objects. Then thin variants. Q/E rotation HUD.
- **Step 8 — Stamps.** Selection → save → place with R/T modifiers. Red ghost when blocked. Supabase stamps table active.
- **Step 9 — Perimeter selection (F key).** Polygon-fill select.
- **Step 10 — X-ray toggle.** Whole-design see-through.
- **Step 11 — Clear all button.** Top bar or footprint panel, with destructive modal.

---

## 1. Project Context

- **User:** Single user, personal tool. No auth, no sharing, no public view.
- **Stack:** Plain HTML, CSS, JavaScript. No framework, no build step. Three.js r128 from cdnjs. Google Fonts (Rajdhani + Share Tech Mono).
- **Hosting:** Cloudflare Pages.
- **Storage:** Supabase (separate project from `innovation-records`).
- **Filesystem MCP** is the source of truth. All docs and code live on disk.
- **Working directory:** `base_planner/` only. Never read or edit outside this directory.

---

## 2. File Structure

```
base_planner/
├── architecture/
│   └── architecture.md     # this document
├── prod/                   # working files, deployed directly to Cloudflare
│   ├── index.html          # skeleton, script tags, Three.js + fonts
│   ├── style.css           # all styling
│   ├── app.js              # state, persistence, Supabase, top-level init
│   ├── scene.js            # Three.js: scene, render, picking, geometry
│   └── ui.js               # sidebar, modals, footprint editor, hotkeys
└── snapshots/              # ad-hoc backups, not part of any workflow
```

**Concern split between JS files:**

| File | Owns | Does not touch |
|---|---|---|
| `app.js` | state object, mutations, Supabase load/save, JSON export, init bootstrap | DOM beyond `document.getElementById` for top-bar buttons, Three.js |
| `scene.js` | Three.js scene, materials, geometry, render loop, raycasting, camera | DOM (writes only to canvas), Supabase |
| `ui.js` | sidebar panels, top bar, modals, footprint editor, hotkeys, HUD | Three.js (reads scene state via app), Supabase |

`app.js` is loaded first and exposes a `window.App` object that `scene.js` and `ui.js` both call into. `scene.js` exposes `window.Scene`. `ui.js` exposes `window.UI`. State lives in `App` and is mutated only through `App` methods so autosave can hook every mutation.

---

## 3. State Shape

```javascript
state = {
  project: {
    id: uuid,                     // Supabase row id; null if never saved
    name: string,                 // user-given name; null until first save
    created_at, updated_at        // ISO strings
  },

  building: {
    blocks: [{ bx, bz }]          // 10×10 footprint blocks; same model as v1
  },

  // 3D world content — sparse maps keyed by coordinate strings.

  cells: Map<"x,y,z", {
    object: 'cube' | 'stair-solid' | 'stair-thin'
          | 'wedge-solid' | 'wedge-thin',
    direction: 'N' | 'E' | 'S' | 'W' | null,    // null for cube
    colorId: int                                 // → state.colors
  }>,

  walls: Map<"x,y,z,edge", {                     // edge ∈ 'N' | 'W'
    type: 'plain' | 'window' | 'doorway',
    colorId: int                                 // inherits parent cell colour at paint time
  }>,

  colors: [
    { id: int, hex: string }                     // unnamed, colour only
  ],
  selectedColorId: int,

  stamps: [                                      // local cache of Supabase stamps table
    { id: uuid, name, data, thumbnail }
  ],

  // ─── Editor state (not persisted) ───────────────────────────────
  tool: 'build' | 'delete' | 'select',
  selectedObject: 'cube' | 'wall-plain' | 'wall-window' | 'wall-doorway'
               | 'stair-solid' | 'stair-thin' | 'wedge-solid' | 'wedge-thin',
  placeDirection: 'N' | 'E' | 'S' | 'W',         // for inclines; rotated via Q/E
  selection: Set<"x,y,z" | "x,y,z,edge">,        // current selection
  perimeterClicks: ["x,y,z"],                    // for F-perimeter selection
  xray: bool,
  placingStamp: { stampId, ghostPosition, rotation, anchorCorner } | null
}
```

### Key choices

- **Sparse maps, not arrays.** Cells and walls only exist where placed. `cells.get("3,2,5")` returns undefined for empty space. Y can be any non-negative integer; no fixed building height.
- **Walls owned by N and W edges only.** A wall on the east side of cell (3,0,5) is stored as the W edge of (4,0,5). Symmetrical, no duplication.
- **Stairs and wedges occupy the cube fully.** They are stored in `cells`, not separately. A 1×1×1 stair at (0,0,0) facing N replaces the cube that would be at (0,0,0).
- **Walls inherit cell colour at paint time, then become independent.** Repainting a cell does not repaint its existing walls. (User can select the walls and repaint them too.)
- **No levels, no level height, no ghost-below.** All gone. Replaced by xray for whole-design see-through.

### Coordinate system

- `x`: east-positive, matches Three.js +X.
- `y`: up-positive (vertical), matches Three.js +Y.
- `z`: south-positive, matches Three.js +Z.
- The footprint sits at `y=0`. Building goes upward.
- Coordinates are integers. Each cell is 1×1×1 in world units.

### Footprint bounds

The building footprint determines which `(x, z)` positions are valid for placement. A cell can only be placed if `(x, z)` falls within an active 10×10 block. Y has no upper bound (build as tall as you want).

### Direction semantics

For inclines, `direction` is the direction the slope rises *toward*. A stair facing N at (0, 0, 0) means the low end is at the south edge of the cube and the high end is at the north edge. To stack: place stair at (0, 0, 0) facing N, then place a cube at (0, 0, -1), then place a stair at (0, 1, -1) facing N.

---

## 4. Object Types

Eight placeable object types, organised in the sidebar.

| Object | Position | Orientation | Notes |
|---|---|---|---|
| Cube | cell | none | solid 1×1×1, painted with current colour |
| Wall — plain | edge (N or W) | edge implies orientation | solid wall slab |
| Wall — window | edge | edge implies orientation | plain wall + darker square inset (raised pane) |
| Wall — doorway | edge | edge implies orientation | plain wall + darker doorway-shaped inset (taller, reaches floor) |
| Stair — solid | cell | N/E/S/W | filled triangular volume + step geometry |
| Stair — thin | cell | N/E/S/W | step geometry only, hollow underneath |
| Wedge — solid | cell | N/E/S/W | filled triangular volume, smooth surface |
| Wedge — thin | cell | N/E/S/W | smooth slope plane only, hollow underneath (primitive roof) |

**Wall colour:** Inherits the colour of the cell that owns the edge at paint time. Window/doorway insets are always rendered darker than the wall colour (HSL lightness reduced by ~40%) regardless of the colour itself, so they read as openings even on dark walls.

**Incline rotation:** Q (counterclockwise) and E (clockwise) rotate `placeDirection` while an incline object is selected. The HUD showing N/E/S/W direction appears only when an incline is the selected object. Walls do not rotate (the edge clicked determines the orientation).

**Sidebar thumbnails:** Each object has a pre-baked SVG thumbnail rendered alongside its label. SVGs live inline in `index.html` as a sprite (`<symbol id="thumb-cube">…</symbol>`) and are referenced via `<use>`. Generated once during development and committed.

---

## 5. Tools

Three modes, exposed in the Tools section of the sidebar.

| Tool | Click action |
|---|---|
| Build | Place the currently selected object at the clicked location, in the current colour |
| Delete | Remove the object the click hits |
| Select | Add or remove the object the click hits from the selection |

**Build tool target resolution:**
- Click on the ground plane → place at that (x, 0, z), if (x, z) is in the footprint.
- Click on the top face of a cube → place above (same x, z, y+1).
- Click on a side face of a cube → for cube/incline objects, place adjacent (x±1 or z±1). For wall objects, place a wall on that edge.
- Click on a side face when wall is selected → wall placed on that edge regardless of which cell owns it (resolves to the N or W edge of the appropriate cell).

**Build tool, occupied target:** If the target cell already has an object, do nothing. (No silent overwrites.)

**Delete tool:** Click any object to remove it. For walls, click the wall slab itself, not the cell behind it.

**Select tool:**
- Click empty space → clear selection.
- Click an object → if not in selection, set selection to just that object. If already in selection, remove from selection.
- Shift+click → add to / remove from selection without clearing.
- F key with active perimeter clicks → see Perimeter Selection below.
- Once a selection exists, the Stamps panel shows a "Save selection as stamp" button.

**Select operations on the selection:**
- Paint with current colour (toolbar action button while selection exists).
- Delete selection (Delete key).
- Save as stamp (Stamps panel button → name prompt → Supabase write).

**Perimeter selection:**
- In Select mode, click cells on the same Y level to define polygon vertices (in click order).
- Press F. The system attempts to form a closed polygon from the clicks (last vertex connects back to first).
- Validation: ≥3 vertices, all on the same Y, polygon is simple (non-self-intersecting).
- On valid: select all cells inside the polygon, plus the perimeter cells themselves. Adds to existing selection.
- On invalid: HUD message, do nothing.
- Clicks accumulate into `state.perimeterClicks` while in select mode. Cleared on F (success or fail), on tool change, or on ESC.

**Hotkeys:**

| Key | Action |
|---|---|
| Q | Rotate `placeDirection` counterclockwise (inclines only) |
| E | Rotate `placeDirection` clockwise (inclines only) |
| F | Trigger perimeter selection (select mode) |
| R | Rotate stamp ghost 90° (during stamp placement) |
| T | Cycle stamp anchor corner (during stamp placement) |
| Delete | Delete current selection (select mode) |
| ESC | Cancel stamp placement / clear perimeter clicks |

**Stamp placement when blocked.** If the ghost overlaps any non-empty cell or edge, the ghost renders red and clicks do nothing. Once moved to a fully empty area, the ghost returns to normal colour and click commits.

---

## 6. Sidebar Layout

Top to bottom:

```
TOOLS
  • Build
  • Delete
  • Select

COLOURS
  [+ Add]
  [grid of colour swatches]      ← unnamed, colour only

OBJECTS
  • Cube                          [thumbnail]
  • Wall — plain                  [thumbnail]
  • Wall — window                 [thumbnail]
  • Wall — doorway                [thumbnail]
  • Stair — solid                 [thumbnail]
  • Stair — thin                  [thumbnail]
  • Wedge — solid                 [thumbnail]
  • Wedge — thin                  [thumbnail]

STAMPS
  [+ Save selection as stamp]     ← only enabled when selection ≥ 1
  [stamp tile with thumbnail + name + delete] (one per saved stamp)

FOOTPRINT
  Size: 20 × 20  (2 blocks)
  [Edit Footprint]                ← opens 2D footprint editor modal
```

**Selected items:** Selected tool, colour, and object are highlighted with the same accent border as v1. Only one of each can be selected at a time.

**Top bar:**

```
[Base Design Tool]                           [Save Project] [Load Project]
```

That's it. No view toggle (3D only), no JSON import/export buttons, no save settings (default colours and objects are baked into the code).

---

## 7. Persistence

### Autosave model

- **Active project:** there is always exactly one active project. On `App.init()`, the most recently updated project is loaded as active.
- **Autosave:** every state mutation triggers a debounced save (2-second delay). The active project's row in `projects` is upserted with the latest state.
- **No autosave indicator.** No "saved 3s ago" UI. Trust the system.

### Save Project

Creates a *named* save, distinct from the autosaving active project.

- Top bar "Save Project" button → modal prompts for a name (defaults to "Untitled" or the existing name).
- On confirm: writes a new row with `is_named=true`, name, current state, fresh `id`. The named save is independent — further edits to the active session do not modify the named save.
- The newly named save becomes the active project (further autosaves go to it).

### Load Project

- Top bar "Load Project" button → modal lists all rows from `projects` where `is_named=true`, ordered by `updated_at` desc. Each row shows name, last-modified date, and a 3D thumbnail.
- Click a row → that project becomes active. Current active project remains saved (never lost).
- Each row has a delete button → modal confirmation → deletes the row.

### Implementation note on "active"

The active project is whichever row was most recently set active. Simplest implementation: a `is_active` boolean column with at most one row true at a time, OR a single-row `app_state` table holding `active_project_id`. The second is cleaner. Decide at build time.

If the user has never saved anything, on first load create an empty row with `name = 'Untitled'`, `is_named = false`, and make it active. F5 reload always restores the active project.

### JSON export/import

Removed from the UI. Supabase is the persistence layer. If a backup is needed, it can be re-added as a hidden dev tool, but not as a primary feature.

---

## 8. Supabase Schema

Two tables. No auth, no RLS (or permissive RLS — single user).

### `projects`

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, auto |
| name | text | nullable; null for the unsaved active project |
| is_named | boolean | true once user has explicitly saved with a name |
| data | jsonb | full state: `{ building, cells, walls, colors }` |
| thumbnail | text | base64 PNG, captured on save and on autosave at most every 30s |
| created_at | timestamptz | auto |
| updated_at | timestamptz | auto |

**`data` JSON shape:**
```json
{
  "building": { "blocks": [{ "bx": 0, "bz": 0 }] },
  "cells": [
    { "x": 0, "y": 0, "z": 0, "object": "cube", "direction": null, "colorId": 1 }
  ],
  "walls": [
    { "x": 0, "y": 0, "z": 0, "edge": "N", "type": "plain", "colorId": 1 }
  ],
  "colors": [
    { "id": 1, "hex": "#1a3d5c" }
  ]
}
```

Maps are serialised as arrays for JSON. Reconstructed into Maps on load.

### `app_state`

Single-row table for global app state. Single `key, value` shape, like innovation_app's `settings`.

| Column | Type | Notes |
|---|---|---|
| key | text | primary key |
| value | text | |

Known keys:
- `active_project_id` — the uuid of the currently active project.

### `stamps`

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, auto |
| name | text | user-given |
| data | jsonb | `{ cells, walls }` normalised to origin (min x, y, z = 0) |
| thumbnail | text | base64 PNG, captured on save |
| created_at | timestamptz | auto |
| updated_at | timestamptz | auto |

Stamps are global (reusable across all projects). No reference to project id.

### Supabase write patterns

Match innovation_app PATTERNS.md §5: shared `window.supabase` client, try/catch every call, errors via `showBanner`. Never silent.

```javascript
// Active project autosave
const { error } = await window.supabase
  .from('projects')
  .update({ data: serialiseState(), updated_at: new Date().toISOString() })
  .eq('id', state.project.id);
```

---

## 9. Footprint Editor

Unchanged from v1 conceptually. Stays as a 2D grid editor (modal, opened from sidebar). Same rules:
- Max 6 blocks of 10×10.
- Connectivity required (BFS check).
- Removing a block with content → danger modal.
- Adding a block adjacent to existing.

**One enhancement:** when editing post-build, render a faint silhouette on each occupied block showing whether it has cells/walls placed on it (in any Y level). A simple darkened tint or a small dot. Helps user see what they'd lose by removing a block.

---

## 10. CSS Variables (locked palette)

```css
:root {
  --bg:           #090b0e;
  --panel:        #0e1218;
  --panel2:       #121820;
  --border:       #1c2530;
  --border2:      #243040;
  --accent:       #4a9fd4;
  --accent2:      #2a6496;
  --text:         #a8c0d6;
  --text-dim:     #445566;
  --text-bright:  #d0e8f8;
  --danger:       #c0392b;
  --danger2:      #922b21;
  --success:      #27ae60;
  --sidebar:      264px;
  --topbar:       48px;
}
```

Never hardcode hex/rgb in CSS or inline styles. Three.js material colours are the only place hex literals appear (converted from preset hex strings).

---

## 11. Default Colours and Objects

Default colour swatches loaded for a brand-new project. The first entry is the **default colour** — every object placed without an explicit colour selection takes this colour. It cannot be deleted from a project (the delete button on it is disabled or hidden).

```javascript
const DEFAULT_COLOURS = [
  '#3a6b8c',  // default — muted steel blue, fits the dark theme
  '#1a3d5c', '#c44536', '#8c86aa', '#1a2535',
  '#495f41', '#b7990d', '#909cc2'
];
```

The default colour is `state.colors[0]`. On `App.init()`, `state.selectedColorId` is set to the default colour's id so a brand-new build click always produces a visible cube.

Objects are fixed (the eight types). Not user-editable.

---

## 12. Three.js Render Notes

- Single render loop. `requestAnimationFrame` only when something changed (dirty-flag rebuild) or when camera is moving. Never busy-loop.
- **Instanced meshes for cubes** (`THREE.InstancedMesh`) when more than ~50 cubes exist. Each colour gets its own instanced mesh.
- **Walls** rendered as flat planes (BoxGeometry with thin Z), positioned on edges.
- **Window/doorway insets** rendered as a second darker quad slightly inset (z-fighting avoided by ~0.001 offset).
- **Stair-thin / wedge-thin** rendered with `THREE.DoubleSide` materials so the slope is visible from both sides.
- **Edge lines** kept (the `EdgesGeometry` outlining each cube). They're part of the visual identity.
- **Ground plane:** the same 10×10 block grid we have today, drawn as line segments at y=0. Always visible.
- **X-ray:** toggle button on the 3D HUD. When on, all materials get `transparent: true, opacity: 0.25`. Edges stay opaque.
- **Camera:** spherical orbit, same as v1. Right-drag to pan, left-drag to rotate, scroll to zoom. Compass HUD bottom-left.
- **Lighting:** ambient + directional sun + fill, same as v1. No shadows from sun for performance (or `shadowMap.enabled = false` initially, enable if cheap enough).

---

## 13. Picking and Raycasting

`scene.js` exposes a `pickAt(clientX, clientY)` function that returns:

```javascript
{
  type: 'cell' | 'wall' | 'ground' | 'face',
  cellKey: "x,y,z" | null,
  wallKey: "x,y,z,edge" | null,
  faceNormal: Vector3,           // world-space normal of the face hit
  worldPoint: Vector3,           // point of intersection
  buildTarget: {                 // computed target for the build tool
    type: 'cell' | 'wall',
    key: string                  // the cell or wall key that would receive
  } | null
}
```

The `buildTarget` is precomputed using:
- Selected object type.
- Face hit (top, bottom, side).
- Whether the target slot is already occupied.

The Build tool only places if `buildTarget` is non-null and the slot is empty.

Raycast targets:
- Cube meshes (instanced).
- Wall meshes.
- Stair/wedge meshes.
- The ground plane (a single large mesh at y=0 covering the footprint).

---

## 14. Modals

Pattern follows innovation_app PATTERNS.md §14 (clone confirm/cancel before binding, ESC closes, overlay click closes).

Destructive modals always include a `.modal-danger-banner` element. Confirm button uses `.btn-danger`.

**Required confirmations:**
- Delete a colour swatch (cells using it fall back to the default colour, `state.colors[0]`).
- Delete a stamp.
- Delete a project (in Load Project modal).
- Remove a footprint block with content.
- Save Project under an existing name (overwrite prompt).
- Clear the whole design (top bar or footprint panel button — wipes `cells` and `walls`, keeps building footprint and colours).

**Note on terminology.** A "destructive warning" or "danger modal" is a standard modal containing a `.modal-danger-banner` element (the red-tinted strip with the warning text) plus a `.btn-danger` confirm button. Same pattern across the whole app.

---

## 15. Migration Path

| Step | Goal | Outcome |
|---|---|---|
| 1 | Cloudflare Pages deploy of current v1 single-file tool | Tool live at a URL, no behaviour change |
| 2 | Add Supabase persistence to v1 single-file tool | F5 restores state, save/load work, JSON export removed |
| 3 | Refactor v1 single-file into `prod/{index.html, style.css, app.js, scene.js, ui.js}` | Same behaviour, modular structure |
| 4 | State shape rewrite — sparse cells map, kill levels, kill ghost-below | 3D-first state model, builds upward freely |
| 5 | Object sidebar — eight object types selectable, build tool places by type | Cubes still work, but now via Build + Cube object |
| 6 | Walls — plain, window, doorway placeable on edges | Walls render, paint inherits colour |
| 7 | Inclines refactor — solid stairs/wedges as 1×1×1 cube objects, then thin variants | All four incline types working |
| 8 | Stamps — selection → save → place with R/T modifiers | Stamps panel functional, Supabase stamps table |
| 9 | Perimeter selection (F key) | Polygon-fill select working |
| 10 | X-ray toggle | Whole-design see-through |
| 11 | Clear-all button with destructive modal | Wipes design content, keeps footprint |

Each step is one chat session's worth of work. Each step leaves a working deployed tool. Steps 1 and 2 happen against the current single-file tool, before the refactor in step 3.

---

## 16. Conventions Summary

- British spelling everywhere (UI text, code comments, doc).
- CSS variables only — never hardcode colours.
- All number displays use `Share Tech Mono`. Labels and prose use `Rajdhani`.
- Destructive actions always confirmed with a `.modal-danger-banner` modal.
- Supabase errors surfaced via banner — never silent.
- Try/catch every Supabase call.
- State mutations only through `App` methods (so autosave is hooked centrally).
- One file per response in build chats.
- The user's name for this tool is **Base Design Tool**.

---

## 17. Project State

### Current

Single-file `base-planner.html` from v1 still works as a snapshot reference (in `snapshots/`) but is not the active tool. The new `prod/` files are empty placeholders. No Cloudflare deployment yet. No Supabase project yet.

### Next

Step 1 of the migration path: Cloudflare Pages deployment of the current v1 single-file tool. This requires:
1. Setting up the Cloudflare Pages project pointed at the `prod/` folder.
2. Putting a working version of the v1 tool into `prod/index.html` for the initial deploy (single file is fine here — refactor happens in step 3).
3. Confirming the tool loads and works at the deployed URL.

Once that's confirmed, step 2 (add Supabase persistence) can begin.

### Open Decisions (revisit at build time)

All prior open decisions resolved:
- Default colour: a muted steel blue, fixed as colour index 0, not deletable.
- Colour swatch deletion: cells using a deleted colour fall back to the default colour.
- Clear all: yes, included as step 11 of the migration path.
- Stamp placement when blocked: red ghost, click does nothing.
- Measure tool: removed from scope entirely.

### Snapshots

`snapshots/` holds ad-hoc safety copies. Not part of any formal workflow. Add to it before a risky change if you want a rollback point.
