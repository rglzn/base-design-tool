# Base Design Tool — Spec v2

Deep reference for v2 implementation. Read sections as needed — do not read this file in full unless explicitly asked.

---

## § Geometry

v2 uses a 12-rotation set. Rotation index 0–11 maps to angles 0°, 30°, 60°, 90°, 120°, 150°, 180°, 210°, 240°, 270°, 300°, 330° around the Y axis. **Rotation is Y-axis only.** No roll or pitch. Vertical stacking is via piece position (y component) only.

**Piece types:**
- `square` — 1×1×1 unit cube. 6 faces (4 lateral + top + bottom). Centre at piece position.
- `triangle` — equilateral triangular prism, 1 unit side length, 1 unit height. 5 faces (3 lateral rectangular faces + top equilateral triangle + bottom equilateral triangle). Centred at piece position; centroid of the triangle cross-section is at (0, 0, 0) in local space.

One triangle type only — no variants.

**Coordinate convention:**
- Local space origin is the piece's geometric centre.
- Unit scale: 1 world unit = 1 piece edge length.
- World axes: x east, y up, z south (unchanged from v1).
- `localPosition` of a face is the centre point of that face in the piece's local coordinate space.
- `outwardNormal` is a unit vector in local space pointing away from the piece body across that face.
- `edgeVector` is a unit vector in local space lying *in the plane of the face*, pointing toward a designated "up" edge of the face. Its purpose is to disambiguate rotation when two faces are mated: when face g attaches to face f, B is rotated so that g's `edgeVector` aligns with f's `edgeVector` after the normals are made antiparallel.

**Face descriptors** — each piece type defines its faces as an array of `{ index, localPosition, outwardNormal, edgeVector }`. Face index is stable across the lifetime of the piece type and used in the connection graph. Square faces are indexed 0=north, 1=east, 2=south, 3=west, 4=top, 5=bottom. Triangle faces are indexed 0=side-A, 1=side-B, 2=side-C (going clockwise viewed from above, starting from the face whose outward normal in local rotation 0 points north), 3=top, 4=bottom.

**Attachment transform** — given piece A at world transform T_A, face f on A, and face g on piece B, the world transform T_B is computed so that face g sits flush against face f (touching, opposite normals, edge vectors aligned). Function signature: `getAttachmentTransform(T_A, faceDescA, faceDescB) → { position, rotationIndex }`. The function snaps the resulting rotation to the nearest valid index 0–11; if the snap error exceeds 1° the attachment is invalid and the function returns null.

**Ground attachment** — the ground plane is treated as a virtual face with outward normal +Y, edge vector +Z, at the integer-floored XZ position under the cursor. Only square pieces may attach to the ground (triangles must attach to a piece face). This is the seed mechanism for the first piece in a base.

---

## § State Shape

Persisted: `pieces`, `connections`, `colors`, `building`.
Editor-only: `tool`, `selection`, `ghost`, `xray`, `placingStamp`.

**pieces** — `Map<pieceId, piece>`. Each piece: `{ id, type, position: { x, y, z }, rotationIndex: 0–11, colorId }`.

**connections** — `Map<pieceId, Array<{ faceIndex, connectedPieceId, connectedFaceIndex }>>`. Sparse — only connected faces recorded. A single piece may have connections to multiple pieces on different faces. When piece B is connected to piece A, both directions are recorded (A's entry lists B, B's entry lists A).

**building** — unchanged from v1. Array of footprint landclaims, each 10×10 world units, max 6, must stay connected.

**colors** — unchanged from v1.

**project** — unchanged from v1.

**stamps** — saved subgraphs. Each stamp: `{ name, pieces: [...], connections: [...], rootPieceId, rootFaceIndex }`. Root face designated at save time and used as the attachment point during placement.

Piece IDs: incrementing integers, never reused within a session. Counter persists in serialised state so IDs remain unique across save/load.

### Serialisation format

`_serialize()` returns:
```
{
  building: [...],
  colors:   [...],
  nextPieceId: <integer>,
  pieces: [
    { id, type, position: { x, y, z }, rotationIndex, colorId },
    ...
  ],
  connections: [
    { pieceId, faceIndex, connectedPieceId, connectedFaceIndex },
    ...
  ]
}
```

Connections are stored as a flat list of half-edges; both directions are persisted. On load, Maps are reconstructed; positions are trusted as-is (no recomputation from graph at load time). Validation runs after load — any connection referencing a missing piece is dropped; any piece whose stored position deviates from the position implied by its connections by more than 0.001 logs a warning but is kept.

---

## § Collision

Two pieces collide if their footprint polygons (projected to XZ plane) intersect with overlapping area > 0.001. Uses polygon intersection test. Checked on every ghost move.

---

## § Footprint

A piece is valid if its footprint polygon lies within the union of landclaim squares. Square pieces: AABB test. Triangle pieces: polygon-in-union test. Both checked per piece on placement.

---

## § Ghost

A ghost is a connected subgraph of pieces with internal face connections preserved, attached to the world via one designated root face. Q/E cycles the rotation index of the root attachment. **Y** cycles which face of the subgraph is the root face (key remap from v1 — T is reserved for the delete tool).

**Validity colour rules** carry over from v1:
- Single-piece placement ghost and multi-ghost (duplicate / pick-up): red only when *every* target piece would collide or fall outside the footprint. Green if at least one piece could be placed.
- Stamp ghost: red if *any* target piece would collide or fall outside the footprint. All-or-nothing placement.

---

## § CSS

Same variables as v1. See `architecture.md § CSS Variables`.
