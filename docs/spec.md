# Base Design Tool — Spec
# v2.0 · 2026-05-09

Deep reference. Read only sections relevant to the current task. Step tags indicate when each section first becomes relevant.

---

## CSS
<!-- Steps: all -->

Variable values for style.css:
--bg #090b0e · --panel #0e1218 · --panel2 #121820
--border #1c2530 · --border2 #243040
--accent #4a9fd4 · --accent2 #2a6496
--text #a8c0d6 · --text-dim #445566 · --text-bright #d0e8f8
--danger #c0392b · --danger2 #922b21 · --success #27ae60
--sidebar 264px · --topbar 48px

---

## Visual Identity
<!-- Steps: all · favicon + shortcuts strip + N/S/E/W compass: Step 3+ -->

Reference screenshot at docs/v1-reference.png. Match it loosely — KISS.

Dark near-black background. Sidebar left, fixed width. Top bar single row, logo left, actions right. Compass bottom-left of viewport showing N/S/E/W cardinal directions — no X/Y/Z labels. Grid plane always visible at y=0. EdgesGeometry outlines on every cube — part of the identity. Flat-shaded cubes, no textures, no shadows, no animations. Ambient + directional lighting only.

Favicon: lucide `hammer` icon rendered as SVG favicon.

Keyboard shortcuts strip: a single always-visible row directly below the top bar (above the viewport), showing all active shortcuts as pill labels. Never hidden.

---

## Default Colours
<!-- Steps: 3+ -->

Eight swatches loaded for every new project. First swatch (#3a6b8c, muted steel blue) is the default — pre-selected on init, never deletable. The rest are starting suggestions, user can change them.

---

## Sidebar Layout
<!-- Steps: 3+ -->

Top to bottom: Tools → Colours → Objects → Stamps → View → Footprint.

Tools: Build, Delete, Select.
Colours: unnamed swatches grid, Add button.
Objects: four types (Cube, Stair solid, Wedge solid, Wedge solid inverted), text labels only — no icons or thumbnails. All four shown from Step 3 onward.
Stamps: Save selection button (enabled when selection non-empty), list of saved stamps.
View: toggles for editor-only state. Contains: Show placement ghost (default on), X-ray (default off). X-ray renders all objects at reduced opacity so occluded structure is visible — implemented in Step 7.
Footprint: landclaim count readout, Edit button.

Top bar: logo left · Save Project + Load Project right. Nothing else.

---

## Object Types
<!-- Steps: 3+ -->

Eight types. All occupy a full 1×1×1 cell. No edge objects.

Cube — solid block, no direction.
Stair solid — filled block with an 8-step staircase profile.
Wedge solid — filled block with a smooth diagonal slope from low-front to high-back.
Wedge solid inverted — filled block with a smooth diagonal slope from high-front to low-back (mirror of wedge solid). No inverted stair type exists.
Corner wedge — square pyramid. Full square base, no top face. Apex at the local NW top corner. North and west faces are right triangles (vertical right-angle edges meeting at the apex). South and east faces are long diagonal slopes. Directional N/E/S/W — apex corner rotates with direction.
Corner wedge inverted — same as corner wedge, flipped vertically. Apex at the local NW bottom corner. Full square top face, no base. Right-angle faces on north and west. Directional N/E/S/W.
Cube doorway — cube geometry with a decorative doorway arch outline (~70% of face) drawn flat on the local south face. Directional N/E/S/W — marked face rotates with direction.
Cube window — cube geometry with a decorative rectangle outline (~70% of face) drawn flat on the local south face. Directional N/E/S/W — marked face rotates with direction.

All types except Cube are directional (N/E/S/W). Rotate with Q/E before placing. HUD shows current direction only when a directional type is selected.

No SVG thumbnails. Object buttons show text labels only.

---

## Tools
<!-- Steps: 3+ -->

Build — click ground plane or cube face to place selected object in current colour. No overwrite: if target is occupied, do nothing. While hovering, a placement ghost occupies the target cell: green when placement is valid, red when illegal (occupied or out of footprint). The ghost is only shown when `showPlacementGhost` is enabled (editor-only state, default on).
Delete — click any object to remove it.
Select — click to select, shift+click to add/remove, click empty to clear. Delete key removes selection. F key triggers perimeter selection.

Build placement rules: ground plane click → place at y=0. Top face click → place above. Side face click → place adjacent. All placement targets are cell coordinates — no edge targets exist.

---

## Perimeter Selection
<!-- Steps: 6+ -->

In Select mode, click cells on the same Y level to mark polygon vertices. Press F to flood-fill select everything inside the polygon plus the perimeter cells. Needs 3+ vertices forming a valid closed non-self-intersecting polygon. If invalid, HUD message and no action. Clicks clear on F, tool change, or ESC.

---

## Stamps
<!-- Steps: 5+ -->

A stamp is a saved multi-cell structure: a named snapshot of a selection's cells (cubes, stairs, wedges), normalised to origin.

Saving: select objects → Save selection as stamp button → name prompt → written to Supabase stamps table.
Placing: click stamp in sidebar → ghost follows cursor → R rotates 90° → T cycles anchor corner through the stamp's footprint corners → click to place. Ghost turns red when any target cell is occupied; click does nothing. ESC cancels.
Stamps are global across projects.

---

## Persistence
<!-- Steps: 2+ -->

One active project at all times. On load, fetch active_project_id from app_state table.

**Has saved projects (is_named rows exist):** Show load-or-new screen — a centred modal-style choice: list of saved projects (name, relative date, thumbnail) plus a "Start Fresh" option. Choosing a project loads it. Choosing Start Fresh silently creates an unnamed project then shows the footprint builder.

**No saved projects at all:** Skip the choice screen entirely — silently create an unnamed project and go straight to the footprint builder.

The footprint builder is always the first thing shown for a new/empty project — no separate welcome step.

Autosave: 2-second debounce after any state mutation. Upserts the active project row. No indicator shown.

Save Project: user-named snapshot. Writes a new row with is_named=true. That row becomes the active project going forward.

Load Project (top bar button): modal listing all is_named rows, newest first. Each row shows name, relative date, thumbnail, delete button. Delete requires danger modal confirmation. Clicking a row loads it as active.

---

## Supabase Schema
<!-- Steps: 2+ -->

projects: id (uuid pk), name (text), is_named (bool), data (jsonb), thumbnail (text), created_at, updated_at.
app_state: key (text pk), value (text). One row: active_project_id.
stamps: id (uuid pk), name (text), data (jsonb), thumbnail (text), created_at, updated_at.

data shape: { building: [{bx,bz}], cells: [{x,y,z,object,direction,colorId}], colors: [{id,hex}] }

Note: `building` array entries are landclaims. The key name `building` is retained for Supabase schema compatibility.

No walls or floors in the data shape.

Supabase client at window._sb. Publishable key used (sb_publishable_...). RLS enabled with permissive anon policy — revisit if tool ever goes public.

---

## Footprint Editor
<!-- Steps: 3+ -->

Inline panel — replaces the viewport canvas. Never a modal. Shown in two cases:
1. New/empty project on first load — shown immediately, no preceding welcome screen.
2. User clicks Edit in the Footprint sidebar section on an existing project.

2D grid of 10×10 landclaims. Title "Building Footprint". Instruction line: "Click + on an edge to add a 10×10 landclaim. Max 6 landclaims total. Click ✕ on a landclaim to remove it."

Landclaim cells are 60×60px. Filled cells: accent-tinted background, show ✕ button on hover (danger modal if landclaim has content). Ghost slots (adjacent to filled, not yet filled): dashed border, accent-tinted on hover. Empty non-adjacent slots: inert.

Rules: max 6 landclaims, must stay connected (BFS check on remove). Removing a landclaim with content requires a danger modal.

Done button confirms and shows the 3D viewport. The viewport canvas is not rendered/visible while the footprint editor is showing.

The footprint editor and 3D viewport are both children of #viewport. Only one is visible at a time.

---

## Three.js Render
<!-- Steps: 1+ -->

Dirty-flag render loop — only re-render when state changes or camera moves. Instanced meshes per colour for cubes (threshold ~50). Edge lines via EdgesGeometry on all cell objects. All inclines use FrontSide material. Ground plane as line grid at y=0 across the footprint — minor grid lines every 1 unit, major grid lines every 10 units (landclaim boundaries) rendered slightly lighter than minor lines so each 10×10 landclaim is visually distinct. Camera: spherical orbit, left-drag pan, right-drag rotate/tilt, scroll zoom. WASD keys pan the camera.

---

## Raycasting
<!-- Steps: 3+ (face-only from Step 3) -->

pickAt(x, y) returns the hit object type, its state key, the face normal, and a precomputed buildTarget (the cell key that would receive a Build action). Build tool acts only when buildTarget is non-null and the slot is empty. Raycast targets: cube meshes, incline meshes, ground plane. No wall or edge targets.

---

## Modals
<!-- Steps: all -->

ESC closes. Overlay click closes. Clone template before binding events. Destructive modals include .modal-danger-banner and use .btn-danger for confirm. Required danger modals: delete colour, delete stamp, delete project, remove occupied footprint block, overwrite named project, clear all.
