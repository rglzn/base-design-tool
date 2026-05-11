# Base Design Tool — Spec v2

Deep reference for v2 implementation. Read sections as needed — do not read this file in full unless explicitly asked.

---

## § Geometry

v2 uses a 12-rotation set. Rotation index 0–11 maps to angles 0°, 30°, 60°, 90°, 120°, 150°, 180°, 210°, 240°, 270°, 300°, 330° around the Y axis.

**Piece types:** `square` (1×1×1 unit cube), `triangle` (equilateral triangle, 1 unit side). One triangle type only — no variants.

**Face descriptors** — each piece type defines its faces as an array of `{ index, localPosition, outwardNormal, edgeVector }`. Face index is stable and used in the connection graph.

**Attachment transform** — given piece A at world transform T_A, face f on A, and face g on piece B, the world transform T_B is computed so that face g sits flush against face f. Function signature: `getAttachmentTransform(T_A, faceDescA, faceDescB) → T_B`.

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
