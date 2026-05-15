/**
 * geometry.js — v2 geometry primitives & rotation algebra
 *
 * No Three.js dependency. All vectors and matrices are plain objects.
 * Exposed as window.Geometry.
 *
 * Coordinate system: x east, y up, z south (right-handed, y-up).
 */

'use strict';

(() => {

  // ---------------------------------------------------------------------------
  // § Vec3 — minimal 3-vector utilities
  // ---------------------------------------------------------------------------

  const Vec3 = {
    create(x = 0, y = 0, z = 0) { return { x, y, z }; },

    clone({ x, y, z }) { return { x, y, z }; },

    add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },

    sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },

    scale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; },

    dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },

    cross(a, b) {
      return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
      };
    },

    length(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); },

    normalise(v) {
      const l = Vec3.length(v);
      if (l < 1e-10) return Vec3.create();
      return Vec3.scale(v, 1 / l);
    },

    /** Apply a 3×3 rotation matrix (row-major, 9-element array) to a vector. */
    applyMat3(v, m) {
      return {
        x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
        y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
        z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
      };
    },
  };

  // ---------------------------------------------------------------------------
  // § Transform — { position: Vec3, rotationIndex: 0–11 }
  // ---------------------------------------------------------------------------
  //
  // A Transform represents a piece's world placement.
  // position  — world-space origin of the piece (Vec3).
  // rotationIndex — integer 0–11, mapping to 0°, 30°, 60°, … 330° around Y.

  /**
   * Build a Y-axis rotation matrix for a given rotation index.
   * Returns a row-major 9-element Float64Array.
   * rot(0) = identity, rot(1) = 30°, …, rot(11) = 330°.
   */
  function rotationMatrix(rotationIndex) {
    const angle = (rotationIndex % 12) * (Math.PI / 6); // 30° steps
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Y-axis rotation: [c, 0, s], [0, 1, 0], [-s, 0, c]
    return new Float64Array([
      c,  0,  s,
      0,  1,  0,
     -s,  0,  c,
    ]);
  }

  /**
   * Compose two rotation indices (mod 12).
   */
  function addRotations(a, b) {
    return ((a + b) % 12 + 12) % 12;
  }

  /**
   * Negate a rotation index (additive inverse mod 12).
   */
  function negateRotation(r) {
    return ((12 - (r % 12)) % 12);
  }

  // ---------------------------------------------------------------------------
  // § Face Descriptors
  // ---------------------------------------------------------------------------
  //
  // Each face descriptor is:
  //   index         — stable integer face ID for this piece type
  //   localPosition — Vec3: centre of the face in piece-local space
  //   outwardNormal — Vec3: unit outward normal in piece-local space
  //   edgeVector    — Vec3: unit vector along the "up" reference edge of the
  //                   face (used to align rotations when attaching pieces)
  //
  // All descriptors are defined for a piece at the origin with rotationIndex 0.
  // To get world-space descriptors, apply the piece's rotationMatrix to
  // localPosition, outwardNormal, and edgeVector, then add position.
  //
  // Square piece: 1×1×1 unit cube centred at (0, 0.5, 0) so the bottom face
  // sits at y=0 (floor level). Faces: bottom(0), top(1), north(2), east(3),
  // south(4), west(5).
  //
  // Triangle piece: equilateral triangle, side length 1, lying flat.
  // Centred at origin (XZ plane). Height of equilateral triangle = sqrt(3)/2.
  // Faces: bottom(0), top(1), north(2), southwest(3), southeast(4).
  // "North" face (index 2) is the canonical attachment edge; normal points -z
  // at rotation index 0, apex pointing south (+z).

  const SQRT3_2 = Math.sqrt(3) / 2; // ≈ 0.8660

  // Square piece centre is at y = 0.5 (bottom face at y = 0).
  const SQUARE_CY = 0.5;

  const SQUARE_FACES = Object.freeze([
    {
      index: 0,
      localPosition: Vec3.create(0, 0, 0),
      outwardNormal:  Vec3.create(0, -1, 0),
      edgeVector:     Vec3.create(1, 0, 0),
    },
    {
      index: 1,
      localPosition: Vec3.create(0, 1, 0),
      outwardNormal:  Vec3.create(0, 1, 0),
      edgeVector:     Vec3.create(1, 0, 0),
    },
    {
      index: 2,
      localPosition: Vec3.create(0, SQUARE_CY, -0.5),
      outwardNormal:  Vec3.create(0, 0, -1),
      edgeVector:     Vec3.create(1, 0, 0),
    },
    {
      index: 3,
      localPosition: Vec3.create(0.5, SQUARE_CY, 0),
      outwardNormal:  Vec3.create(1, 0, 0),
      edgeVector:     Vec3.create(0, 0, 1),
    },
    {
      index: 4,
      localPosition: Vec3.create(0, SQUARE_CY, 0.5),
      outwardNormal:  Vec3.create(0, 0, 1),
      edgeVector:     Vec3.create(-1, 0, 0),
    },
    {
      index: 5,
      localPosition: Vec3.create(-0.5, SQUARE_CY, 0),
      outwardNormal:  Vec3.create(-1, 0, 0),
      edgeVector:     Vec3.create(0, 0, -1),
    },
  ].map(f => Object.freeze(f)));

  // Triangle piece: equilateral, side 1, height SQRT3_2.
  // At rotation index 0 the canonical attachment edge (long side) sits at
  // the north (-z) side; the apex points south (+z).
  //
  // Vertices (local XZ, y=0 for bottom / y=1 for top):
  //   A = (0, y, +SQRT3_2 * 2/3)    south apex
  //   B = (0.5, y,  -SQRT3_2 * 1/3) north-east (attachment edge)
  //   C = (-0.5, y, -SQRT3_2 * 1/3) north-west (attachment edge)
  //
  // Face centres are at midpoints of edges, at y=0.5 for vertical faces.
  //
  // North face (index 2, attachment edge): outward normal -z
  // Southwest face (index 3): outward normal pointing SW
  // Southeast face (index 4): outward normal pointing SE

  const TRI_APEX_Z  =  (SQRT3_2 * 2 / 3); // approx +0.5774  (south, apex)
  const TRI_BASE_Z  = -(SQRT3_2 / 3);      // approx -0.2887  (north, attachment edge)
  const TRI_HALF_CY = 0.5;

  // North face (attachment edge): between B=(0.5, _, TRI_BASE_Z) and C=(-0.5, _, TRI_BASE_Z)
  // Normal: -z direction.  Edge vector C->B (+x direction).
  const TRI_NORTH_NORMAL = Vec3.create(0, 0, -1);
  const TRI_NORTH_EDGE   = Vec3.create(1, 0, 0); // C->B direction

  // Southwest face: between A=(0, _, TRI_APEX_Z) and C=(-0.5, _, TRI_BASE_Z)
  // Outward normal points SW: (-sqrt(3)/2, 0, 0.5) normalised = (-0.8660, 0, 0.5)
  // edgeVector is vertical reference (+y), decoupled from normal derivation.
  const TRI_SW_NORMAL = Vec3.normalise(Vec3.create(-SQRT3_2, 0, 0.5));
  const TRI_SW_EDGE   = Vec3.create(0, 1, 0);
  // Midpoint of A->C edge
  const TRI_SW_POS = Vec3.create(-0.25, TRI_HALF_CY, (TRI_APEX_Z + TRI_BASE_Z) / 2);

  // Southeast face: between A=(0, _, TRI_APEX_Z) and B=(0.5, _, TRI_BASE_Z)
  // Outward normal points SE: (sqrt(3)/2, 0, 0.5) normalised = (0.8660, 0, 0.5)
  // edgeVector is vertical reference (+y), decoupled from normal derivation.
  const TRI_SE_NORMAL = Vec3.normalise(Vec3.create(SQRT3_2, 0, 0.5));
  const TRI_SE_EDGE   = Vec3.create(0, 1, 0);
  const TRI_SE_POS = Vec3.create(0.25, TRI_HALF_CY, (TRI_APEX_Z + TRI_BASE_Z) / 2);

  // The face index of the canonical attachment edge (north long side at rot 0).
  // Exposed on window.Geometry so scene.js can pin this face for all triangle
  // placement contexts without re-deriving it.
  const TRIANGLE_ATTACHMENT_FACE_INDEX = 2;

  const TRIANGLE_FACES = Object.freeze([
    {
      // Bottom face (index 0)
      index: 0,
      localPosition: Vec3.create(0, 0, 0),
      outwardNormal:  Vec3.create(0, -1, 0),
      edgeVector:     Vec3.create(1, 0, 0),
    },
    {
      // Top face (index 1)
      index: 1,
      localPosition: Vec3.create(0, 1, 0),
      outwardNormal:  Vec3.create(0, 1, 0),
      edgeVector:     Vec3.create(1, 0, 0),
    },
    {
      // North face -- canonical attachment edge (index 2)
      index: 2,
      localPosition: Vec3.create(0, TRI_HALF_CY, TRI_BASE_Z),
      outwardNormal:  TRI_NORTH_NORMAL,
      edgeVector:     TRI_NORTH_EDGE,
    },
    {
      // Southwest face (index 3)
      index: 3,
      localPosition: TRI_SW_POS,
      outwardNormal:  TRI_SW_NORMAL,
      edgeVector:     TRI_SW_EDGE,
    },
    {
      // Southeast face (index 4)
      index: 4,
      localPosition: TRI_SE_POS,
      outwardNormal:  TRI_SE_NORMAL,
      edgeVector:     TRI_SE_EDGE,
    },
  ].map(f => Object.freeze(f)));

  /**
   * Return the face descriptor array for a given piece type.
   * @param {'square'|'triangle'} type
   * @returns {ReadonlyArray}
   */
  function getFaceDescriptors(type) {
    if (type === 'triangle') return TRIANGLE_FACES;
    if (PIECE_FAMILY[type] === 'square-family') return SQUARE_FACES;
    throw new Error(`geometry.getFaceDescriptors: unknown type "${type}"`);
  }

  /**
   * Transform a local-space face descriptor into world space.
   * @param {{ localPosition, outwardNormal, edgeVector }} faceDesc
   * @param {{ position: Vec3, rotationIndex: number }} transform
   * @returns {{ worldPosition, worldNormal, worldEdge }}
   */
  function faceDescInWorld(faceDesc, transform) {
    const m = rotationMatrix(transform.rotationIndex);
    return {
      worldPosition: Vec3.add(transform.position, Vec3.applyMat3(faceDesc.localPosition, m)),
      worldNormal:   Vec3.applyMat3(faceDesc.outwardNormal, m),
      worldEdge:     Vec3.applyMat3(faceDesc.edgeVector, m),
    };
  }

  // ---------------------------------------------------------------------------
  // § Attachment Transform
  // ---------------------------------------------------------------------------
  //
  // Given piece A at transform T_A, face fA on A, and face fB on piece B,
  // return T_B such that fB sits flush against fA:
  //
  //   1. The centre of fB's world position equals the centre of fA's world
  //      position (faces share the same point in space).
  //   2. fB's outward normal is the negation of fA's outward normal (faces
  //      point toward each other).
  //   3. The edgeVector of fB is aligned to the edgeVector of fA
  //      (edges line up — no in-plane spin).
  //
  // The function returns the Transform { position, rotationIndex } for piece B.
  //
  // Algorithm:
  //   a. Compute fA in world space using T_A.
  //   b. The required world normal for fB is -fA.worldNormal.
  //   c. Find the rotationIndex r such that rotationMatrix(r) applied to
  //      fB.localOutwardNormal yields -fA.worldNormal AND rotationMatrix(r)
  //      applied to fB.edgeVector aligns with fA.worldEdge.
  //      Because only Y-axis rotations are used, this is solved analytically.
  //   d. With r known, B's position is:
  //      T_B.position = fA.worldPosition − rot(r) * fB.localPosition
  //
  // For cases where no single rotation index achieves perfect alignment
  // (faces with normals that cannot be reached by a pure Y rotation, e.g.
  // top/bottom horizontal faces of one piece attaching to a vertical face of
  // another), rotationIndex is chosen to minimise the angular error on the
  // normal axis, and the caller is responsible for interpreting the result.

  /**
   * Find the rotation index (0–11) that best maps srcVec onto tgtVec
   * using only Y-axis rotations.
   * Both srcVec and tgtVec must be unit vectors.
   * Returns the index with the smallest angular error.
   */
  function _bestRotationIndex(srcVec, tgtVec) {
    let bestIdx = 0;
    let bestDot = -Infinity;
    for (let r = 0; r < 12; r++) {
      const m = rotationMatrix(r);
      const rotated = Vec3.applyMat3(srcVec, m);
      const d = Vec3.dot(rotated, tgtVec);
      if (d > bestDot) {
        bestDot = d;
        bestIdx = r;
      }
    }
    return bestIdx;
  }

  /**
   * Compute the world transform for piece B so that face fB sits flush
   * against face fA of piece A.
   *
   * @param {{ position: Vec3, rotationIndex: number }} T_A  — piece A transform
   * @param {{ localPosition: Vec3, outwardNormal: Vec3, edgeVector: Vec3 }} faceDescA
   * @param {{ localPosition: Vec3, outwardNormal: Vec3, edgeVector: Vec3 }} faceDescB
   * @returns {{ position: Vec3, rotationIndex: number }}
   */
  function getAttachmentTransform(T_A, faceDescA, faceDescB) {
    // Step 1: world-space properties of face A
    const fAWorld = faceDescInWorld(faceDescA, T_A);

    // Step 2: required world normal for B's face = opposite of A's face normal
    const requiredNormal = Vec3.scale(fAWorld.worldNormal, -1);

    // Step 3: find rotation index that maps faceDescB.outwardNormal → requiredNormal
    // Primary constraint: normal alignment.
    const rNormal = _bestRotationIndex(faceDescB.outwardNormal, requiredNormal);

    // Step 4: among rotations that satisfy the normal constraint (for Y-axis
    // rotations, horizontal normals are exact; vertical normals are invariant),
    // refine using edge alignment. For vertical faces, walk the 12 candidates
    // and pick the one with best combined score.
    let bestIdx = rNormal;
    {
      const mBest = rotationMatrix(rNormal);
      const rotatedNormal = Vec3.applyMat3(faceDescB.outwardNormal, mBest);
      const normalDot = Vec3.dot(rotatedNormal, requiredNormal);

      // If normal alignment is good (dot > 0.99), try to also align edges.
      if (normalDot > 0.99) {
        let bestEdgeDot = Vec3.dot(
          Vec3.applyMat3(faceDescB.edgeVector, mBest),
          fAWorld.worldEdge
        );
        for (let r = 0; r < 12; r++) {
          if (r === rNormal) continue;
          const m = rotationMatrix(r);
          const rn = Vec3.applyMat3(faceDescB.outwardNormal, m);
          if (Vec3.dot(rn, requiredNormal) < 0.99) continue; // must keep normal aligned
          const edgeDot = Vec3.dot(Vec3.applyMat3(faceDescB.edgeVector, m), fAWorld.worldEdge);
          if (edgeDot > bestEdgeDot) {
            bestEdgeDot = edgeDot;
            bestIdx = r;
          }
        }
      }
    }

    // Step 5: compute B's world position
    // faceDescB.localPosition rotated by bestIdx, then:
    //   B.position = fAWorld.worldPosition - rot(bestIdx) * faceDescB.localPosition
    const mB = rotationMatrix(bestIdx);
    const rotatedFaceBLocal = Vec3.applyMat3(faceDescB.localPosition, mB);
    const position = Vec3.sub(fAWorld.worldPosition, rotatedFaceBLocal);

    return { position, rotationIndex: bestIdx };
  }

  // ---------------------------------------------------------------------------
  // § Piece Family
  // ---------------------------------------------------------------------------

  const PIECE_FAMILY = Object.freeze({
    'square':                    'square-family',
    'stair-solid':               'square-family',
    'wedge-solid':               'square-family',
    'wedge-solid-inverted':      'square-family',
    'corner-wedge':              'square-family',
    'corner-wedge-inverted':     'square-family',
    'cube-doorway':              'square-family',
    'cube-window':               'square-family',
    'pentashield-side':          'square-family',
    'pentashield-top':           'square-family',
    'half-wedge':                'square-family',
    'half-wedge-block':          'square-family',
    'half-wedge-inverted':       'square-family',
    'half-wedge-block-inverted': 'square-family',
    'triangle':                  'triangle-family',
  });

  /**
   * Return the family string for a given piece type.
   * Throws on unknown type.
   * @param {string} type
   * @returns {'square-family'|'triangle-family'}
   */
  function getPieceFamily(type) {
    const family = PIECE_FAMILY[type];
    if (!family) throw new Error(`geometry.getPieceFamily: unknown type "${type}"`);
    return family;
  }

  // ---------------------------------------------------------------------------
  // § Public API
  // ---------------------------------------------------------------------------

  window.Geometry = Object.freeze({
    // Rotation algebra
    ROTATION_COUNT: 12,
    rotationMatrix,
    addRotations,
    negateRotation,

    // Face descriptors
    SQUARE_FACES,
    TRIANGLE_FACES,
    TRIANGLE_ATTACHMENT_FACE_INDEX,
    getFaceDescriptors,
    faceDescInWorld,

    // Attachment transform
    getAttachmentTransform,

    // Vec3 utilities (exposed for use by scene.js / app.js)
    Vec3: Object.freeze(Vec3),

    // Piece family
    PIECE_FAMILY,
    getPieceFamily,
  });

})();
