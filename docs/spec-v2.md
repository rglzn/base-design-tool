# Base Design Tool — Spec v2

Deep reference for v2 implementation. Read sections as needed — do not read this file in full unless explicitly asked.

---

## § Geometry

v2 uses a 12-rotation set. Rotation index 0–11 maps to angles 0°, 30°, 60°, 90°, 120°, 150°, 180°, 210°, 240°, 270°, 300°, 330° around the Y axis.

**Piece types:** `square` (1×1×1 unit cube), `triangle` (equilateral triangle prism, 1 unit side, 1 unit tall). One triangle type only — no variants.

**Face descriptors** — each piece type defines its faces as an array of `{ index, localPosition, outwardNormal, edgeVector }`. Face index is stable and used in the connection graph.

**Attachment transform** — given piece A at world transform T_A, face f on A, and face g on piece B, the world transform T_B is computed so that face g sits flush against face f. Function signature: `getAttachmentTransform(T_A, faceDescA, faceDescB) → T_B`.

**Square-family geometry origin convention** — all square-family geometry must be built with its origin at the cell corner (0,0,0), not the centre. `_rebuildPieces` applies a uniform `+0.5` offset on all axes to move the piece to its visual centre at render time. Every current and future square-family type must follow this convention — no per-type offset exceptions.

**Triangle attachment edge** — the triangle has one canonical attachment edge: the north long side (one of its three rectangular side faces). This is the only face used for attachment in all placement contexts. The apex always points away from the attachment edge.

**Triangle placement rules by context:**

- *Empty footprint or top/bottom face of a non-triangle piece:* default position is the attachment edge flush against the north edge of the target surface. Q/E cycles through 4 axis-aligned positions (N/E/S/W) — in each position the attachment edge sits flush against that edge of the target surface. The 4 edges of a top/bottom face are its N, E, S, W sides.
- *Side face of any piece:* attachment edge snaps flush to the hovered face. No Q/E rotation allowed — orientation is fully determined by the face.
- *Top/bottom face of a triangle piece:* ghost inherits the triangle's own rotation index exactly, placing directly above or below it. No Q/E rotation allowed.

**Square placement rules by context:**

- *All contexts except top/bottom of a triangle piece:* no rotation — square always placed at rotation index 0.
- *Top/bottom face of a triangle piece:* Q/E cycles through 3 positions, one per triangle edge (N face, SE face, SW face). In each position one face of the square aligns flush against the corresponding triangle edge. Default is alignment to the triangle's N edge.

---

## § Piece Types

All piece types and their family membership. `getPieceFamily(type)` in geometry.js is the single source of truth — throws on unknown type.

**square-family** — placement logic identical for all: integer grid position, rotationIndex 0–11, attachment transform via face descriptors. Render geometry differs per type.
- `square` — solid 1×1×1 cube, no direction.
- `stair-solid` — 8-step staircase profile, directional.
- `wedge-solid` — smooth diagonal slope low-front to high-back, directional.
- `wedge-solid-inverted` — mirror of wedge-solid, directional.
- `corner-wedge` — square pyramid, apex at NW top corner, directional.
- `corner-wedge-inverted` — square pyramid flipped, apex at NW bottom corner, directional.
- `cube-doorway` — cube with doorway outline decal on south face, directional.
- `cube-window` — cube with window rect decal on south face, directional.
- `pentashield-side` — cube with 7 diagonal lines on south face, directional.
- `pentashield-top` — cube with 7 diagonal lines on top face, directional.
- `half-wedge` — directional.
- `half-wedge-block` — directional.
- `half-wedge-inverted` — directional.
- `half-wedge-block-inverted` — directional.

**triangle-family**
- `triangle` — equilateral triangle prism, 1 unit side, 1 unit tall. Must connect to an existing piece face; cannot be placed on empty footprint.

---

## § State Shape

Persisted: `pieces`, `connections`, `colors`, `building`.
Editor-only: `tool`, `selection`, `ghost`, `xray`, `placingStamp`.

**pieces** — `Map<pieceId, piece>`. Each piece: `{ id, type, position: Vector3, rotationIndex: 0–11, colorId }`.

**connections** — `Map<pieceId, Array<{ faceIndex, connectedPieceId, connectedFaceIndex }>>`. Sparse — only connected faces recorded. A single piece may have connections to multiple pieces on different faces.

**building** — unchanged from v1. Array of footprint landclaims, each 10×10 world units, max 6, must stay connected.

**colors** — unchanged from v1.

**project** — unchanged from v1.

**stamps** — saved subgraphs. Each stamp: `{ name, pieces: [...], connections: [...] }`. Root face designated at save time.

Piece IDs: incrementing integers, never reused within a session. Serialise Map to array for Supabase JSON.

---


## Geometry Winding Order Reference
<!-- Read this before writing any new _makeInclineGeo geometry. All faces must be CCW when viewed from outside (Three.js FrontSide convention). Wrong winding = inverted normals = ghost placement on opposite face. Not all shapes are represented in this reference, use as a guide. The empirical test with user (as last resort for bug fixes): temporarily set material to FrontSide — any invisible face has wrong winding. -->

The helper functions:
- `q(a,b,c,d)` — emits △(a,b,c) + △(a,c,d). Vertices must be CCW from outside.
- `t(a,b,c)` — emits △(a,b,c). Vertices must be CCW from outside.

Correct winding per face orientation (viewed from outside):

**Bottom face (y = constant, normal points −Y):**
`q([L,y,B],[R,y,B],[R,y,F],[L,y,F])` — back-left → back-right → front-right → front-left

**Top face (y = constant, normal points +Y):**
`q([L,y,F],[R,y,F],[R,y,B],[L,y,B])` — front-left → front-right → back-right → back-left

**Back face (z = −0.5, normal points −Z):**
`q([L,T,z],[R,T,z],[R,B,z],[L,B,z])` — top-left → top-right → bottom-right → bottom-left

**Front face (z = +0.5, normal points +Z):**
`q([L,B,z],[R,B,z],[R,T,z],[L,T,z])` — bottom-left → bottom-right → top-right → top-left

**Left face (x = −0.5, normal points −X):**
`q([x,B,F],[x,T,F],[x,T,B],[x,B,B])` — bottom-front → top-front → top-back → bottom-back

**Right face (x = +0.5, normal points +X):**
`q([x,B,B],[x,T,B],[x,T,F],[x,B,F])` — bottom-back → top-back → top-front → bottom-front

**Left triangle (x = −0.5, normal points −X):**
`t([x,yA,zA],[x,yB,zB],[x,yC,zC])` — must be CCW from −X. Cross-check: (B−A)×(C−A) should point in −X direction.

**Right triangle (x = +0.5, normal points +X):**
`t([x,yA,zA],[x,yB,zB],[x,yC,zC])` — must be CCW from +X. Cross-check: (B−A)×(C−A) should point in +X direction.

**Slope face (diagonal, normal points up-and-outward):**
Start from the low-front edge, go across, then up to the high-back edge. For a slope rising toward −Z:
`q([L,yLow,zFront],[R,yLow,zFront],[R,yHigh,zBack],[L,yHigh,zBack])`


---

## § Collision

Two pieces collide if their footprint polygons (projected to XZ plane) intersect with overlapping area > 0.001. Uses polygon intersection test. Checked on every ghost move.

---

## § Footprint

A piece is valid if its footprint polygon lies within the union of landclaim squares. Square pieces: AABB test. Triangle pieces: polygon-in-union test. Both checked per piece on placement.

---

## § Ghost

A ghost is a connected subgraph of pieces with internal face connections preserved, attached to the world via one designated root face. Q/E cycles the rotation index of the root attachment. T cycles which face of the subgraph is the root face. Ghost renders red if any piece collides or falls outside the footprint.

---

## § CSS

Same variables as v1. See `architecture.md § CSS Variables`.
