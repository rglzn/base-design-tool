# Base Design Tool — Spec
# v1.0 · 2026-05-08

Deep reference. Read only the sections relevant to the current build step.

---

## CSS

Variable values for style.css:
--bg #090b0e · --panel #0e1218 · --panel2 #121820
--border #1c2530 · --border2 #243040
--accent #4a9fd4 · --accent2 #2a6496
--text #a8c0d6 · --text-dim #445566 · --text-bright #d0e8f8
--danger #c0392b · --danger2 #922b21 · --success #27ae60
--sidebar 264px · --topbar 48px

---

## Visual Identity

Reference screenshot at docs/v1-reference.png. Match it loosely — KISS.

Dark near-black background. Sidebar left, fixed width. Top bar single row, logo left, actions right. Compass bottom-left of viewport. Grid plane always visible at y=0. EdgesGeometry outlines on every cube — part of the identity. Flat-shaded cubes, no textures, no shadows, no animations. Ambient + directional lighting only.

---

## Default Colours

Eight swatches loaded for every new project. First swatch (#3a6b8c, muted steel blue) is the default — pre-selected on init, never deletable. The rest are starting suggestions, user can change them.

---

## Sidebar Layout

Top to bottom: Tools → Colours → Objects → Stamps → Footprint.

Tools: Build, Delete, Select.
Colours: unnamed swatches grid, Add button.
Objects: all eight types, each with SVG thumbnail. Only Cube shown in Step 1 — rest added in Step 3.
Stamps: Save selection button (enabled when selection non-empty), list of saved stamps.
Footprint: size readout, Edit button.

Top bar: logo left · Save Project + Load Project right. Nothing else.

---

## Object Types

Eight types. Cubes and inclines occupy a full cell. Walls sit on edges.

Cube — solid block, no direction.
Wall plain — flat slab on a cell edge.
Wall window — plain wall with a darker inset square pane.
Wall doorway — plain wall with a darker inset that reaches the floor.
Stair solid — filled wedge with stepped surface.
Stair thin — stepped surface only, hollow underneath.
Wedge solid — filled smooth wedge.
Wedge thin — smooth slope only, hollow underneath. Works as a primitive roof.

Walls go on N or W edges only (owned-edge model). East wall of a cell is stored as the W edge of the cell to the east. Wall colour inherits from the cell at paint time, then is independent. Window/doorway insets render ~40% darker than the wall colour.

Inclines have a direction (N/E/S/W) — the direction the slope rises toward. Rotate with Q/E before placing. HUD shows current direction only when an incline is selected.

SVG thumbnails are pre-baked inline in index.html as a sprite. Generated once.

---

## Tools

Build — click ground plane or cube face to place selected object in current colour. No overwrite: if target is occupied, do nothing.
Delete — click any object to remove it.
Select — click to select, shift+click to add/remove, click empty to clear. Delete key removes selection. F key triggers perimeter selection.

Build placement rules: ground plane click → place at y=0. Top face click → place above. Side face click → place adjacent (for cell objects) or on that edge (for wall objects).

---

## Perimeter Selection

In Select mode, click cells on the same Y level to mark polygon vertices. Press F to flood-fill select everything inside the polygon plus the perimeter cells. Needs 3+ vertices forming a valid closed non-self-intersecting polygon. If invalid, HUD message and no action. Clicks clear on F, tool change, or ESC.

---

## Stamps

A stamp is a saved multi-cell structure: a named snapshot of a selection's cells, walls, and inclines, normalised to origin.

Saving: select objects → Save selection as stamp button → name prompt → written to Supabase stamps table.
Placing: click stamp in sidebar → ghost follows cursor → R rotates 90° → T cycles anchor corner through the stamp's footprint corners → click to place. Ghost turns red when any target cell is occupied; click does nothing. ESC cancels.
Stamps are global across projects.

---

## Persistence

One active project at all times. On load, fetch active_project_id from app_state table and load that project. If none exists, show first-run modal.

Autosave: 2-second debounce after any state mutation. Upserts the active project row. No indicator shown.

Save Project: user-named snapshot. Writes a new row with is_named=true. That row becomes the active project going forward.

Load Project: modal listing all is_named rows, newest first. Each row shows name, relative date, thumbnail, delete button. Delete requires danger modal confirmation. Clicking a row loads it as active.

First-run modal: shown when no active project exists. Name input, Create button, no cancel. Creates the first project row.

---

## Supabase Schema

projects: id (uuid pk), name (text), is_named (bool), data (jsonb), thumbnail (text), created_at, updated_at.
app_state: key (text pk), value (text). One row: active_project_id.
stamps: id (uuid pk), name (text), data (jsonb), thumbnail (text), created_at, updated_at.

data shape: { building: [{bx,bz}], cells: [{x,y,z,object,direction,colorId}], walls: [{x,y,z,edge,type,colorId}], colors: [{id,hex}] }

Supabase client at window._sb. Publishable key used (sb_publishable_...). RLS enabled with permissive anon policy — revisit if tool ever goes public.

---

## Footprint Editor

Modal, opened from sidebar. 2D grid of 10×10 blocks. Rules: max 6 blocks, must stay connected (BFS check on remove). Adding a block: click an adjacent ghost slot. Removing a block with content: danger modal. When opened post-build, occupied blocks show a faint tint indicating they have content.

---

## Three.js Render

Dirty-flag render loop — only re-render when state changes or camera moves. Instanced meshes per colour for cubes (threshold ~50). Walls as thin box geometry on edges. Window/doorway insets as a second slightly-offset quad, rendered darker. Thin inclines use double-side materials. Edge lines via EdgesGeometry on all cell objects. Ground plane as line grid at y=0 across the footprint. Camera: spherical orbit, left-drag rotate, right-drag pan, scroll zoom.

---

## Raycasting

pickAt(x, y) returns the hit object type, its state key, the face normal, and a precomputed buildTarget (the cell or wall key that would receive a Build action). Build tool acts only when buildTarget is non-null and the slot is empty. Raycast targets: cube meshes, wall meshes, incline meshes, ground plane.

---

## Modals

ESC closes. Overlay click closes. Clone template before binding events. Destructive modals include .modal-danger-banner and use .btn-danger for confirm. Required danger modals: delete colour, delete stamp, delete project, remove occupied footprint block, overwrite named project, clear all.
