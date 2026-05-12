/* scene.js — Three.js scene, orbit camera, raycasting, compass HUD. */
/* v2 — renders from pieces Map; squares + triangles (Step 5).        */
(function () {

  let _renderer, _scene, _camera, _controls;
  let _groundGroup, _pieceGroup, _ghostGroup;
  let _groundPlane;
  let _squareGeo, _squareEdgeGeo, _triangleGeo, _triangleEdgeGeo, _edgeMat, _selEdgeMat;
  let _ghostMatValid, _ghostMatInvalid;
  let _dirty = false;
  let _hoverHit = null;
  let _ctrlModified = false;  // true when Ctrl is held alongside another modifier

  // Rotation index → Y-axis angle (radians). 0–11 → 0°, 30°, 60°, …, 330°.
  function _rotIndexToRad(idx) { return (idx ?? 0) * (Math.PI / 6); }

  const _keys = new Set();

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    const viewport = document.getElementById('viewport');

    _renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    _renderer.setPixelRatio(window.devicePixelRatio);
    _renderer.setClearColor(0x090b0e);
    viewport.appendChild(_renderer.domElement);

    _scene = new THREE.Scene();

    _camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    _camera.position.set(22, 16, 26);

    // Left drag = pan, right drag = rotate/tilt, scroll = zoom
    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.target.set(5, 0, 5);
    _controls.enableDamping  = true;
    _controls.dampingFactor  = 0.07;
    _controls.screenSpacePanning = true;
    _controls.mouseButtons = {
      LEFT:   THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  THREE.MOUSE.ROTATE,
    };
    _controls.zoomSpeed   = App.getSettings().zoomSpeed;
    _controls.rotateSpeed = App.getSettings().rotateSpeed;
    _controls.update();
    _controls.addEventListener('change', markDirty);

    _scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.80);
    sun.position.set(10, 20, 10);
    _scene.add(sun);

    _groundGroup = new THREE.Group();
    _pieceGroup  = new THREE.Group();
    _ghostGroup  = new THREE.Group();
    _scene.add(_groundGroup);
    _scene.add(_pieceGroup);
    _scene.add(_ghostGroup);

    const planeGeo = new THREE.PlaneGeometry(2000, 2000);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    _groundPlane = new THREE.Mesh(planeGeo, planeMat);
    _groundPlane.rotation.x = -Math.PI / 2;
    _groundPlane.userData.isGround = true;
    _scene.add(_groundPlane);

    _squareGeo     = new THREE.BoxGeometry(1, 1, 1);
    _squareEdgeGeo = new THREE.EdgesGeometry(_squareGeo);
    _triangleGeo   = _makeTriangleGeo();
    _triangleEdgeGeo = new THREE.EdgesGeometry(_triangleGeo);
    _edgeMat       = new THREE.LineBasicMaterial({ color: 0x000000 });
    _selEdgeMat    = new THREE.LineBasicMaterial({ color: 0xf0c040 });
    _ghostMatValid   = new THREE.MeshLambertMaterial({ color: 0x33ff66, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
    _ghostMatInvalid = new THREE.MeshLambertMaterial({ color: 0xff3333, transparent: true, opacity: 0.38, side: THREE.DoubleSide });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'e') return;
      if (k === ' ') e.preventDefault();
      if (k === 'control') _ctrlModified = e.altKey || e.shiftKey || e.metaKey;
      _keys.add(k);
    });
    document.addEventListener('keyup', e => { _keys.delete(e.key.toLowerCase()); if (e.key === 'Control') _ctrlModified = false; });

    new ResizeObserver(_resize).observe(viewport);
    _resize();

    _dirty = true;
    _loop();
  }

  // ── Resize ─────────────────────────────────────────────────────
  function _resize() {
    const viewport = document.getElementById('viewport');
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (!w || !h || !_renderer) return;
    _renderer.setSize(w, h, false);
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
    markDirty();
  }

  // ── WASD pan ──────────────────────────────────────────────────────
  function _applyWASD() {
    if (!_keys.size) return;
    const speed   = App.getSettings().panSpeed;
    const forward = new THREE.Vector3();
    _camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let dx = 0, dz = 0;
    if (_keys.has('w')) { dx += forward.x * speed; dz += forward.z * speed; }
    if (_keys.has('s')) { dx -= forward.x * speed; dz -= forward.z * speed; }
    if (_keys.has('a')) { dx -= right.x * speed;   dz -= right.z * speed; }
    if (_keys.has('d')) { dx += right.x * speed;   dz += right.z * speed; }

    let dy = 0;
    if (_keys.has(' '))       dy += speed;
    if (_keys.has('control') && !_ctrlModified) dy -= speed;

    if (dx !== 0 || dz !== 0 || dy !== 0) {
      _controls.target.x += dx;
      _controls.target.z += dz;
      _controls.target.y += dy;
      _camera.position.x += dx;
      _camera.position.z += dz;
      _camera.position.y += dy;
      markDirty();
    }
  }

  // ── Render loop ─────────────────────────────────────────────────
  function _loop() {
    requestAnimationFrame(_loop);
    _applyWASD();
    _controls.update();
    if (_dirty) {
      _rebuildGround();
      _rebuildPieces();
      _rebuildGhost();
      _renderer.render(_scene, _camera);
      _renderCompass();
      _dirty = false;
    }
  }

  function markDirty() { _dirty = true; }

  // ── Ground grid — minor 1-unit lines + major 10-unit landclaim borders ──
  function _rebuildGround() {
    _groundGroup.clear();
    const building = App.state.building;
    if (!building.length) return;

    const minorPts = [];
    const majorPts = [];

    building.forEach(({ bx, bz }) => {
      const x0 = bx * 10;
      const z0 = bz * 10;
      for (let i = 0; i <= 10; i++) {
        const pts = (i === 0 || i === 10) ? majorPts : minorPts;
        pts.push(x0,     0, z0 + i, x0 + 10, 0, z0 + i);
        pts.push(x0 + i, 0, z0,     x0 + i,  0, z0 + 10);
      }
    });

    const addLines = (pts, color) => {
      if (!pts.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      _groundGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color })));
    };

    addLines(minorPts, 0x1c2530);
    addLines(majorPts, 0x2d4060);
  }

  // ── Triangle prism geometry ──────────────────────────────────────
  // Equilateral triangle prism, side 1, height 1.
  // Matches the TRIANGLE_FACES descriptors in geometry.js:
  //   Apex A = (0, y, TRI_APEX_Z)   approx (0, y, +0.5774)  south
  //   NE   B = (0.5, y, TRI_BASE_Z) approx (0.5, y, -0.2887) north-east
  //   NW   C = (-0.5, y, TRI_BASE_Z) approx (-0.5, y, -0.2887) north-west
  // At rotation index 0 the attachment edge (BC, long north side) faces -z.
  // Piece occupies y: 0 -> 1 (bottom at 0, top at 1).
  function _makeTriangleGeo() {
    const SQRT3_2 = Math.sqrt(3) / 2;
    const TRI_APEX_Z =  (SQRT3_2 * 2 / 3);  // approx +0.5774 (south, apex)
    const TRI_BASE_Z = -(SQRT3_2 / 3);       // approx -0.2887 (north, attachment edge)

    // Vertices: bottom ring (y=0), top ring (y=1)
    const A0 = [  0,       0, TRI_APEX_Z ];
    const B0 = [  0.5,     0, TRI_BASE_Z ];
    const C0 = [ -0.5,     0, TRI_BASE_Z ];
    const A1 = [  0,       1, TRI_APEX_Z ];
    const B1 = [  0.5,     1, TRI_BASE_Z ];
    const C1 = [ -0.5,     1, TRI_BASE_Z ];

    const pos = [];
    function t(a, b, c) { pos.push(...a, ...b, ...c); }
    function q(a, b, c, d) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); }

    // Bottom face (CCW from below, normal -y)
    t(A0, C0, B0);
    // Top face (CCW from above, normal +y)
    t(A1, B1, C1);
    // North face: between B and C (normal -z, attachment edge)
    // Back face convention: top-left -> top-right -> bottom-right -> bottom-left from outside (-z)
    q(C1, B1, B0, C0);
    // Southwest face: between A and C (normal points SW)
    q(A0, A1, C1, C0);
    // Southeast face: between A and B (normal points SE)
    q(B0, B1, A1, A0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ── Piece meshes (v2) ──────────────────────────────────────────
  // Squares and triangles rendered at world position with Y-rotation
  // derived from rotationIndex (0–11 → 0°–330° in 30° steps).
  function _rebuildPieces() {
    _pieceGroup.traverse(obj => { if (obj.isMesh && obj.material) obj.material.dispose(); });
    _pieceGroup.clear();

    App.state.pieces.forEach(piece => {
      const isSquare   = piece.type === 'square';
      const isTriangle = piece.type === 'triangle';
      if (!isSquare && !isTriangle) return;

      const selected = App.state.selection.has(piece.id);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(App.getColorHex(piece.colorId)),
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });

      const geo     = isSquare ? _squareGeo     : _triangleGeo;
      const edgeGeo = isSquare ? _squareEdgeGeo : _triangleEdgeGeo;

      const mesh = new THREE.Mesh(geo, mat);
      // Square centre offset: +0.5 on all axes (BoxGeometry centred at origin).
      // Triangle geometry has its bottom at y=0, so y offset = 0; XZ origin at
      // centroid, so x/z offset = 0.
      if (isSquare) {
        mesh.position.set(
          piece.position.x + 0.5,
          piece.position.y + 0.5,
          piece.position.z + 0.5,
        );
      } else {
        mesh.position.set(
          piece.position.x,
          piece.position.y,
          piece.position.z,
        );
      }
      mesh.rotation.y = _rotIndexToRad(piece.rotationIndex);
      mesh.userData.pieceId = piece.id;
      mesh.userData.isPiece = true;
      mesh.add(new THREE.LineSegments(edgeGeo, selected ? _selEdgeMat : _edgeMat));
      _pieceGroup.add(mesh);
    });
  }

  // ── Incline geometry builder (v1 — retained for reference, unused in v2 Step 3) ──
  // Will be removed or repurposed when triangle geometry is introduced in Step 5.
  function _makeInclineGeo(type) {
    const pos = [];
    function q(a,b,c,d){ pos.push(...a,...b,...c,...a,...c,...d); }
    function t(a,b,c)  { pos.push(...a,...b,...c); }

    if (type === 'wedge-solid') {
      // High at back (-z), low at front (+z)
      t([-0.5,-0.5, 0.5],[-0.5, 0.5,-0.5],[-0.5,-0.5,-0.5]);
      t([ 0.5,-0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5, 0.5]);
      q([-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]);
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]);
      q([-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5]);
    }

    if (type === 'wedge-solid-inverted') {
      t([-0.5,+0.5,+0.5], [-0.5,+0.5,-0.5], [-0.5,-0.5,-0.5]);          // left tri
      t([+0.5,+0.5,+0.5], [+0.5,-0.5,-0.5], [+0.5,+0.5,-0.5]);          // right tri
      q([-0.5,-0.5,-0.5], [+0.5,-0.5,-0.5], [+0.5,+0.5,+0.5], [-0.5,+0.5,+0.5]); // slope
      q([-0.5,+0.5,+0.5], [+0.5,+0.5,+0.5], [+0.5,+0.5,-0.5], [-0.5,+0.5,-0.5]); // top flat
      q([-0.5,+0.5,-0.5], [+0.5,+0.5,-0.5], [+0.5,-0.5,-0.5], [-0.5,-0.5,-0.5]); // back
    }

    if (type === 'stair-solid') {
      // 8 uniform steps rising from front (+z) to back (-z).
      // Cell occupies x: [-0.5,0.5], y: [-0.5,0.5], z: [-0.5,0.5].
      // Each step: depth = 1/8 along z, height = 1/8 along y.
      const N  = 8;
      const sd = 1 / N;
      const sh = 1 / N;
      // Bottom face
      q([-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5,-0.5,-0.5],[-0.5,-0.5,-0.5]);
      // Back face (z = -0.5): full rectangle
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]);
      // Treads and risers.
      for (let i = 0; i < N; i++) {
        const z0 =  0.5 - i * sd;
        const z1 =  0.5 - (i + 1) * sd;
        const yB = -0.5 + i * sh;
        const yT = -0.5 + (i + 1) * sh;
        // Riser: normal toward +Z. CCW from +Z: BL→BR→TR, BL→TR→TL.
        t([-0.5, yB, z0], [ 0.5, yB, z0], [ 0.5, yT, z0]);
        t([-0.5, yB, z0], [ 0.5, yT, z0], [-0.5, yT, z0]);
        // Tread: normal toward +Y. CCW from +Y: FL→FR→BR, FL→BR→BL.
        t([-0.5, yT, z0], [ 0.5, yT, z0], [ 0.5, yT, z1]);
        t([-0.5, yT, z0], [ 0.5, yT, z1], [-0.5, yT, z1]);
      }
      // Left side (x = -0.5): one quad per step, y=-0.5 to tread top, normal toward -X.
      for (let i = 0; i < N; i++) {
        const z0 =  0.5 - i * sd;
        const z1 =  0.5 - (i + 1) * sd;
        const yT = -0.5 + (i + 1) * sh;
        q([-0.5,-0.5, z0],[-0.5,-0.5, z1],[-0.5, yT, z1],[-0.5, yT, z0]);
      }
      // Right side (x = +0.5): mirror, normal toward +X.
      for (let i = 0; i < N; i++) {
        const z0 =  0.5 - i * sd;
        const z1 =  0.5 - (i + 1) * sd;
        const yT = -0.5 + (i + 1) * sh;
        q([ 0.5,-0.5, z1],[ 0.5,-0.5, z0],[ 0.5, yT, z0],[ 0.5, yT, z1]);
      }
    }

    if (type === 'corner-wedge') {
      // Square pyramid. Base at y=-0.5, apex at local NW top corner (-0.5, +0.5, -0.5).
      // For direction N: NW = (-x, +y, -z). Apex corner rotates with _DIR_ROT.
      // Faces: base (bottom quad), south slope, east slope, north tri, west tri.
      const apex = [-0.5, 0.5, -0.5];
      // Base (y = -0.5), normal down
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]);
      // South face (z = +0.5 edge → apex): diagonal slope
      t([-0.5,-0.5, 0.5], [ 0.5,-0.5, 0.5], apex);
      // East face (x = +0.5 edge → apex): diagonal slope
      t([ 0.5,-0.5,-0.5], apex, [ 0.5,-0.5, 0.5]);
      // North face (z = -0.5 edge): right-angle vertical triangle
      t([-0.5,-0.5,-0.5], apex, [ 0.5,-0.5,-0.5]);
      // West face (x = -0.5 edge): right-angle vertical triangle
      t([-0.5,-0.5, 0.5], apex, [-0.5,-0.5,-0.5]);
    }

    if (type === 'corner-wedge-inverted') {
      // Corner wedge flipped vertically. Full top face, apex at local NW bottom corner (-0.5, -0.5, -0.5).
      const apex = [-0.5, -0.5, -0.5];
      // Top face (y = +0.5), normal up
      q([-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]);
      // South face (z = +0.5 edge → apex): diagonal slope
      t([ 0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], apex);
      // East face (x = +0.5 edge → apex): diagonal slope
      t([ 0.5, 0.5, 0.5], apex, [ 0.5, 0.5,-0.5]);
      // North face (z = -0.5 edge): right-angle vertical triangle
      t([ 0.5, 0.5,-0.5], apex, [-0.5, 0.5,-0.5]);
      // West face (x = -0.5 edge): right-angle vertical triangle
      t([-0.5, 0.5,-0.5], apex, [-0.5, 0.5, 0.5]);
    }

    if (type === 'half-wedge') {
      // Lower half of cell only (y: -0.5 → 0). High at back (-z, y=0), low front (+z, y=-0.5).
      // Faces: base, back wall, left tri, right tri, slope. No top.
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]); // base
      q([-0.5,-0.5,-0.5],[-0.5, 0.0,-0.5],[ 0.5, 0.0,-0.5],[ 0.5,-0.5,-0.5]); // back wall
      t([-0.5,-0.5, 0.5],[-0.5, 0.0,-0.5],[-0.5,-0.5,-0.5]);                   // left tri
      t([ 0.5,-0.5,-0.5],[ 0.5, 0.0,-0.5],[ 0.5,-0.5, 0.5]);                   // right tri
      q([-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0.0,-0.5],[-0.5, 0.0,-0.5]); // slope
    }

    if (type === 'half-wedge-block') {
      // Full cell. Lower half: cube (y: -0.5→0). Upper half: wedge (y: 0→+0.5), high at back (-z).
      // Faces: base, back full, front half (lower cube face), left pentagon, right pentagon, slope.
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]); // base
      q([-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5]); // back full
      q([-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0.0, 0.5],[-0.5, 0.0, 0.5]); // front half (cube portion)
      // Left side: pentagon = lower rect + upper tri
      q([-0.5,-0.5, 0.5],[-0.5, 0.0, 0.5],[-0.5, 0.0,-0.5],[-0.5,-0.5,-0.5]); // left lower rect
      t([-0.5, 0.0, 0.5],[-0.5, 0.5,-0.5],[-0.5, 0.0,-0.5]);                   // left upper tri
      // Right side: pentagon = lower rect + upper tri
      q([ 0.5,-0.5,-0.5],[ 0.5, 0.0,-0.5],[ 0.5, 0.0, 0.5],[ 0.5,-0.5, 0.5]); // right lower rect
      t([ 0.5, 0.0,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.0, 0.5]);                   // right upper tri
      q([-0.5, 0.0, 0.5],[ 0.5, 0.0, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]); // slope
    }

    if (type === 'half-wedge-inverted') {
      // Upper half of cell only (y: 0 → +0.5). Flat top, slope descends front (+z) to y=0.
      // Faces: top, back wall, left tri, right tri, slope. No base.
      q([-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]); // top
      q([-0.5, 0.0,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.0,-0.5]); // back wall
      t([-0.5, 0.5,-0.5],[-0.5, 0.0,-0.5],[-0.5, 0.5, 0.5]);                   // left tri (CCW from -x)
      t([ 0.5, 0.0,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0.5]);                   // right tri
      q([-0.5, 0.0,-0.5],[ 0.5, 0.0,-0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5]); // slope
    }

    if (type === 'half-wedge-block-inverted') {
      // Full cell. Upper half: cube (y: 0→+0.5). Lower half: inverted wedge (y: -0.5→0), slope at front.
      // Faces: top, back full, front half (upper cube face), left pentagon, right pentagon, slope.
      q([-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]); // top
      q([-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5]); // back full
      q([-0.5, 0.0, 0.5],[ 0.5, 0.0, 0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5]); // front half (cube portion)
      // Left side: pentagon = upper rect + lower tri
      q([-0.5, 0.0,-0.5],[-0.5, 0.0, 0.5],[-0.5, 0.5, 0.5],[-0.5, 0.5,-0.5]); // left upper rect
      t([-0.5,-0.5,-0.5],[-0.5, 0.0, 0.5],[-0.5, 0.0,-0.5]);                   // left lower tri
      // Right side: pentagon = upper rect + lower tri
      q([ 0.5, 0.0, 0.5],[ 0.5, 0.0,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0.5]); // right upper rect
      t([ 0.5, 0.0,-0.5],[ 0.5, 0.0, 0.5],[ 0.5,-0.5,-0.5]);                   // right lower tri
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5, 0.0, 0.5],[-0.5, 0.0, 0.5]); // slope
    }

    if (type === 'cube-doorway') {
      // Full cube geometry (same as BoxGeometry but manual, so EdgesGeometry works uniformly).
      // Decorative arch outline added as extra line geometry separately in _rebuildInclines.
      q([-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5],[-0.5,-0.5,-0.5]); // back
      q([-0.5,-0.5, 0.5],[-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5,-0.5, 0.5]); // front
      q([-0.5,-0.5,-0.5],[-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5,-0.5,-0.5]); // bottom
      q([-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5]); // top
      q([-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[-0.5, 0.5, 0.5],[-0.5,-0.5, 0.5]); // left
      q([ 0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5]); // right
    }

    if (type === 'cube-window') {
      // Same full cube geometry as cube-doorway.
      q([-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5],[-0.5,-0.5,-0.5]); // back
      q([-0.5,-0.5, 0.5],[-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5,-0.5, 0.5]); // front
      q([-0.5,-0.5,-0.5],[-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5,-0.5,-0.5]); // bottom
      q([-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5]); // top
      q([-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[-0.5, 0.5, 0.5],[-0.5,-0.5, 0.5]); // left
      q([ 0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5]); // right
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ── Decal lines — doorway arch / window rect on local south face (z=+0.5) ──
  // Attached as a child of the mesh; mesh rotation already handles direction.
  function _addDecalLines(mesh, type) {
    const pts = [];
    const z   =  0.501; // just in front of the south face to avoid z-fighting
    const hw  =  0.35;  // half-width  (~70% of face)
    const bot = -0.5;   // bottom of cell

    if (type === 'cube-doorway') {
      // Three edges only: left vertical, right vertical, top horizontal.
      // ~70% face width (hw = 0.35), full face height (-0.5 to +0.5). No bottom edge.
      const top = 0.40;
      const hw2 = hw - 0.05;
      pts.push(-hw,  bot, z,  -hw,  top, z);  // outer left
      pts.push( hw,  bot, z,   hw,  top, z);  // outer right
      pts.push(-hw,  top, z,   hw,  top, z);  // outer top
      const top2 = top - 0.05;
      pts.push(-hw2, bot,  z,  -hw2, top2, z);  // inner left
      pts.push( hw2, bot,  z,   hw2, top2, z);  // inner right
      pts.push(-hw2, top2, z,   hw2, top2, z);  // inner top
    }

    if (type === 'cube-window') {
      // Rectangle outline centred on the south face.
      const y0 = -0.175;
      const y1 =  0.35;
      const hw2 = hw - 0.05;
      const y02 = y0 + 0.05;
      const y12 = y1 - 0.05;
      pts.push(-hw,  y0,  z,   hw,  y0,  z);  // outer bottom
      pts.push( hw,  y0,  z,   hw,  y1,  z);  // outer right
      pts.push( hw,  y1,  z,  -hw,  y1,  z);  // outer top
      pts.push(-hw,  y1,  z,  -hw,  y0,  z);  // outer left
      pts.push(-hw2, y02, z,   hw2, y02, z);  // inner bottom
      pts.push( hw2, y02, z,   hw2, y12, z);  // inner right
      pts.push( hw2, y12, z,  -hw2, y12, z);  // inner top
      pts.push(-hw2, y12, z,  -hw2, y02, z);  // inner left
    }

    if (type === 'pentashield-side') {
      // 7 diagonal lines on the south face (z = +0.5).
      // Line 4 (i=3) runs exactly corner-to-corner: (-0.5,-0.5) → (+0.5,+0.5).
      // That means xBase = -0.5 (x = -0.5 + t at y = -0.5 + t, t in [0,1]).
      // The 3 lines either side are spaced by gap = 1/3 in xBase.
      const z = 0.501;
      const N = 7;
      const gap = 1 / 3;
      for (let i = 0; i < N; i++) {
        const xBase = -0.5 + (i - 3) * gap;
        const t0 = Math.max(0, -0.5 - xBase);
        const t1 = Math.min(1,  0.5 - xBase);
        if (t1 <= t0) continue;
        pts.push(xBase + t0, -0.5 + t0, z,  xBase + t1, -0.5 + t1, z);
      }
    }

    if (type === 'pentashield-top') {
      // 7 diagonal lines on the top face (y = +0.5).
      // Line 4 (i=3) runs exactly corner-to-corner: (-0.5,+0.5) → (+0.5,-0.5) in XZ.
      // That means xBase = -0.5 (x = -0.5 + t, z = 0.5 - t, t in [0,1]).
      // The 3 lines either side are spaced by gap = 1/3 in xBase.
      const y = 0.501;
      const N = 7;
      const gap = 1 / 3;
      for (let i = 0; i < N; i++) {
        const xBase = -0.5 + (i - 3) * gap;
        const t0 = Math.max(0, -0.5 - xBase);
        const t1 = Math.min(1,  0.5 - xBase);
        if (t1 <= t0) continue;
        pts.push(xBase + t0, y,  0.5 - t0,  xBase + t1, y,  0.5 - t1);
      }
    }

    if (!pts.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    mesh.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x000000 })));
  }

  // ── Raycasting (v2 — Step 4 will rework placement semantics) ───
  /*
   * Returns null on miss.
   * On piece hit: { type: 'piece', pieceId, faceNormal, hitPoint }
   * On ground hit: { type: 'ground', hitPoint, gridX, gridZ }
   *
   * NOTE: buildTarget / targetKey logic removed — Step 4 will handle
   * face-attachment placement using the connection graph.
   */
  function pickAt(screenX, screenY) {
    if (!_renderer || !_camera) return null;

    const rect = _renderer.domElement.getBoundingClientRect();
    const ndc = {
      x:  ((screenX - rect.left)  / rect.width)  * 2 - 1,
      y: -((screenY - rect.top)   / rect.height)  * 2 + 1,
    };

    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, _camera);

    const solidHits = ray.intersectObjects(_pieceGroup.children, false);
    if (solidHits.length > 0) {
      const hit    = solidHits[0];
      const pieceId = hit.object.userData.pieceId;
      const normal  = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
      return { type: 'piece', pieceId, faceNormal: normal, hitPoint: hit.point.clone() };
    }

    const groundHits = ray.intersectObject(_groundPlane);
    if (groundHits.length > 0) {
      const pt = groundHits[0].point;
      const gx = Math.floor(pt.x);
      const gz = Math.floor(pt.z);
      const bx = Math.floor(gx / 10);
      const bz = Math.floor(gz / 10);
      if (!App.state.building.some(b => b.bx === bx && b.bz === bz)) return null;
      return { type: 'ground', hitPoint: pt.clone(), gridX: gx, gridZ: gz };
    }

    return null;
  }

  // ── Ghost validity checks ─────────────────────────────────────
  /*
   * Returns true if the proposed square piece lies entirely within the
   * union of landclaim squares.  AABB corner test.
   */
  function _ghostInFootprintSquare(position) {
    const x0 = position.x;
    const z0 = position.z;
    const building = App.state.building;
    const corners = [
      [x0,        z0       ],
      [x0 + 0.99, z0       ],
      [x0,        z0 + 0.99],
      [x0 + 0.99, z0 + 0.99],
    ];
    return corners.every(([cx, cz]) => {
      const bx = Math.floor(cx / 10);
      const bz = Math.floor(cz / 10);
      return building.some(b => b.bx === bx && b.bz === bz);
    });
  }

  /*
   * Returns true if the proposed triangle piece lies within the union of
   * landclaim squares.  Polygon-in-union test: all three base vertices
   * must fall inside some landclaim block.
   */
  function _ghostInFootprintTriangle(position, rotationIndex) {
    const SQRT3_2   = Math.sqrt(3) / 2;
    const TRI_APEX_Z =  (SQRT3_2 * 2 / 3);  // approx +0.5774 (south, apex)
    const TRI_BASE_Z = -(SQRT3_2 / 3);       // approx -0.2887 (north, attachment edge)
    // Local vertices in XZ
    const localVerts = [
      { x:  0,    z: TRI_APEX_Z },
      { x:  0.5,  z: TRI_BASE_Z },
      { x: -0.5,  z: TRI_BASE_Z },
    ];
    const G = Geometry;
    const m = G.rotationMatrix(rotationIndex);
    const building = App.state.building;
    const EPS = 0.001;
    return localVerts.every(lv => {
      const rotated = G.Vec3.applyMat3({ x: lv.x, y: 0, z: lv.z }, m);
      const wx = position.x + rotated.x;
      const wz = position.z + rotated.z;
      // Use epsilon-tolerant landclaim test to avoid rejecting vertices that
      // land exactly on an east/south edge due to floating-point rounding.
      return building.some(b => {
        const x0 = b.bx * 10;
        const z0 = b.bz * 10;
        return wx >= x0 - EPS && wx <= x0 + 10 + EPS
            && wz >= z0 - EPS && wz <= z0 + 10 + EPS;
      });
    });
  }

  function _ghostInFootprint(type, position, rotationIndex) {
    if (type === 'triangle') return _ghostInFootprintTriangle(position, rotationIndex);
    return _ghostInFootprintSquare(position);
  }

  /*
   * Returns true if the proposed piece does NOT overlap any existing piece.
   * Collision is position-equality on (x,y,z) — valid for both squares
   * (integer-aligned) and triangles (float world positions).
   * For triangles at non-integer rotations the positions are set by
   * getAttachmentTransform and compared with === after rounding in _computeGhost.
   */
  function _ghostNoCollision(position) {
    for (const piece of App.state.pieces.values()) {
      if (Math.abs(piece.position.x - position.x) < 0.001 &&
          Math.abs(piece.position.y - position.y) < 0.001 &&
          Math.abs(piece.position.z - position.z) < 0.001) return false;
    }
    return true;
  }

  // ── Placement ghost (v2 — Step 5) ────────────────────────────
  /*
   * Placement contexts for triangles (spec § Geometry):
   *
   * CTX_FLAT  — ground hit, or top/bottom face of a non-triangle piece.
   *             Q/E cycles 4 axis-aligned positions (N/E/S/W): attachment
   *             edge flush against that cardinal edge of the target surface.
   *             rotationIndex values: N=0, E=3, S=6, W=9.
   *
   * CTX_SIDE  — side face of any piece.  Attachment edge snaps flush to the
   *             hovered face.  No Q/E cycling.
   *
   * CTX_TRI   — top or bottom face of a triangle piece.  Ghost inherits the
   *             triangle's exact rotationIndex.  No Q/E cycling.
   *
   * In all contexts the triangle's attachment face (index
   * TRIANGLE_ATTACHMENT_FACE_INDEX) is pinned as selfFaceIndex.
   *
   * _ghostRotationOffset — user Q/E delta, accumulated steps.
   *   In CTX_FLAT it selects among the 4 cardinal slots (mod 4 × 3 steps).
   *   In CTX_SIDE and CTX_TRI it is ignored.
   */
  let _ghostRotationOffset = 0; // accumulated Q/E steps
  let _ghostContext = 'flat';   // 'flat' | 'side' | 'tri'

  // Cardinal rotation indices for CTX_FLAT (N/E/S/W, 90° steps)
  // E uses rotIndex 9 and W uses rotIndex 3 so the apex points inward (into
  // the cell) and the attachment edge sits flush against the named wall.
  const _FLAT_ROTS = [0, 9, 6, 3];

  function _computeGhost(hit) {
    if (!hit || App.state.tool !== 'build') { App.clearGhost(); _ghostRotationOffset = 0; return; }

    const newType = App.state.selectedObject; // 'square' or 'triangle'
    let ghostPos, attachToPieceId, attachFaceIndex, selfFaceIndex, rotationIndex;

    if (hit.type === 'ground') {
      // ── CTX_FLAT: ground ───────────────────────────────────────
      _ghostContext = 'flat';
      if (newType === 'square') {
        ghostPos      = { x: hit.gridX, y: 0, z: hit.gridZ };
        rotationIndex = 0;
      } else {
        // Triangle on ground: attachment edge flush to the cardinal edge of the
        // target cell.  Rotate the attachment face localPosition (XZ only) by
        // the cardinal rotationIndex and subtract from the target edge midpoint.
        const slot    = ((_ghostRotationOffset % 4) + 4) % 4;
        rotationIndex = _FLAT_ROTS[slot];
        // Fix 3/6: compute ghost centroid position so the attachment edge sits
        // flush against the corresponding cell edge.  The triangle centroid is
        // |TRI_BASE_Z| ≈ 0.2887 inward from the attachment edge.
        const TRI_INSET = Math.sqrt(3) / 6; // |TRI_BASE_Z|
        const cx = hit.gridX + 0.5;
        const cz = hit.gridZ + 0.5;
        const edgeOffsets = [
          { x: cx,                   z: hit.gridZ + TRI_INSET   }, // N: attachment edge at north wall (z=gridZ), centroid inward
          { x: hit.gridX + 1 - TRI_INSET, z: cz               }, // E: attachment edge at east wall (x=gridX+1), centroid inward
          { x: cx,                   z: hit.gridZ + 1 - TRI_INSET }, // S: attachment edge at south wall (z=gridZ+1), centroid inward
          { x: hit.gridX + TRI_INSET, z: cz                    }, // W: attachment edge at west wall (x=gridX), centroid inward
        ];
        const off = edgeOffsets[slot];
        ghostPos = { x: off.x, y: 0, z: off.z };
      }
      attachToPieceId = undefined;

    } else if (hit.type === 'piece') {
      const piece  = App.getPiece(hit.pieceId);
      if (!piece) { App.clearGhost(); return; }

      const G      = Geometry;
      const facesA = G.getFaceDescriptors(piece.type);
      // Square piece.position is the SW-bottom corner; face descriptors assume
      // the XZ origin is the piece centroid, so offset by +0.5 on x and z.
      // For non-triangle pieces (square and future types) the stored position is
      // the SW-bottom corner; face descriptors are measured from the XZ centroid
      // at half-height, so offset by +0.5 on all axes to get the correct origin.
      // Triangle position IS the centroid (geometry.js uses that convention), so
      // no offset is applied.
      const pieceOrigin = piece.type === 'triangle'
        ? piece.position
        : { x: piece.position.x + 0.5, y: piece.position.y + 0.5, z: piece.position.z + 0.5 };
      const T_A    = { position: pieceOrigin, rotationIndex: piece.rotationIndex };

      // Find the face on piece A whose world normal best matches the hit face normal
      let bestFaceA = null, bestDot = -Infinity;
      facesA.forEach(fd => {
        const wf  = G.faceDescInWorld(fd, T_A);
        const dot = G.Vec3.dot(wf.worldNormal,
          { x: hit.faceNormal.x, y: hit.faceNormal.y, z: hit.faceNormal.z });
        if (dot > bestDot) { bestDot = dot; bestFaceA = fd; }
      });
      if (!bestFaceA) { App.clearGhost(); return; }

      attachFaceIndex = bestFaceA.index;
      attachToPieceId = piece.id;

      // Determine placement context from the hit face
      const isHorizFace = Math.abs(bestFaceA.outwardNormal.y) > 0.9;
      const isTriPiece  = piece.type === 'triangle';

      if (isTriPiece && isHorizFace) {
        // ── CTX_TRI: top/bottom of a triangle piece ───────────────
        _ghostContext  = 'tri';
        rotationIndex  = piece.rotationIndex; // inherit exactly
      } else if (isHorizFace) {
        // ── CTX_FLAT: top/bottom of a non-triangle piece ──────────
        _ghostContext = 'flat';
        if (newType === 'square') {
          // Square: use getAttachmentTransform normally
          const facesB  = G.getFaceDescriptors(newType);
          let bestFaceB = null, bestFaceBDot = -Infinity;
          const fAWorld = G.faceDescInWorld(bestFaceA, T_A);
          const reqN    = G.Vec3.scale(fAWorld.worldNormal, -1);
          facesB.forEach(fd => {
            for (let r = 0; r < 12; r++) {
              const m = G.rotationMatrix(r);
              const d = G.Vec3.dot(G.Vec3.applyMat3(fd.outwardNormal, m), reqN);
              if (d > bestFaceBDot) { bestFaceBDot = d; bestFaceB = fd; }
            }
          });
          if (!bestFaceB) { App.clearGhost(); return; }
          selfFaceIndex = bestFaceB.index;
          const T_B = G.getAttachmentTransform(T_A, bestFaceA, bestFaceB);
          rotationIndex = T_B.rotationIndex;
          // T_B.position is the centroid of the new square; ghost.position must
          // be the SW-bottom corner (_rebuildGhost adds +0.5 to render at centroid).
          ghostPos = {
            x: Math.round((T_B.position.x - 0.5) * 1000) / 1000,
            y: Math.round((T_B.position.y - 0.5) * 1000) / 1000,
            z: Math.round((T_B.position.z - 0.5) * 1000) / 1000,
          };
        } else {
          // Triangle on top/bottom face of non-triangle: cardinal rotation from offset
          const slot    = ((_ghostRotationOffset % 4) + 4) % 4;
          rotationIndex = _FLAT_ROTS[slot];
          const attachFaceDesc = G.TRIANGLE_FACES[G.TRIANGLE_ATTACHMENT_FACE_INDEX];
          selfFaceIndex = G.TRIANGLE_ATTACHMENT_FACE_INDEX;
          // Override rotation with cardinal slot, recompute position from face centre.
          // The attachment edge must sit flush against the cardinal edge of the top/
          // bottom face, which is 0.5 units from the face centre in the attachment
          // normal direction.  Shift the centroid by that 0.5 in XZ. (Fix 6)
          const fAWorld  = G.faceDescInWorld(bestFaceA, T_A);
          const mB       = G.rotationMatrix(rotationIndex);
          const rotLocal = G.Vec3.applyMat3(attachFaceDesc.localPosition, mB);
          const rotNorm  = G.Vec3.applyMat3(attachFaceDesc.outwardNormal,  mB);
          ghostPos = {
            x: Math.round((fAWorld.worldPosition.x - rotLocal.x + rotNorm.x * 0.5) * 1000) / 1000,
            y: Math.round((fAWorld.worldPosition.y - rotLocal.y) * 1000) / 1000,
            z: Math.round((fAWorld.worldPosition.z - rotLocal.z + rotNorm.z * 0.5) * 1000) / 1000,
          };
        }
      } else {
        // ── CTX_SIDE: side face of any piece ──────────────────────
        _ghostContext = 'side';
        if (newType !== 'triangle') {
          const facesB  = G.getFaceDescriptors(newType);
          let bestFaceB = null, bestFaceBDot = -Infinity;
          const fAWorld = G.faceDescInWorld(bestFaceA, T_A);
          const reqN    = G.Vec3.scale(fAWorld.worldNormal, -1);
          facesB.forEach(fd => {
            for (let r = 0; r < 12; r++) {
              const m = G.rotationMatrix(r);
              const d = G.Vec3.dot(G.Vec3.applyMat3(fd.outwardNormal, m), reqN);
              if (d > bestFaceBDot) { bestFaceBDot = d; bestFaceB = fd; }
            }
          });
          if (!bestFaceB) { App.clearGhost(); return; }
          selfFaceIndex = bestFaceB.index;
          const T_B = G.getAttachmentTransform(T_A, bestFaceA, bestFaceB);
          rotationIndex = T_B.rotationIndex;
          // T_B.position is the centroid of the new square (measured from piece
          // origin conventions).  When piece A is a square its pieceOrigin has a
          // +0.5 Y offset baked in, so T_B.position.y is already centroid Y and
          // we subtract 0.5 to get the SW-bottom corner.  When piece A is a
          // triangle (no Y offset) T_B.position.y is already the SW-bottom Y, so
          // we add 0.5 back before subtracting — net zero change. (Fix 2)
          const yOffsetB = piece.type === 'triangle' ? 0.5 : 0;
          ghostPos = {
            x: Math.round((T_B.position.x - 0.5) * 1000) / 1000,
            y: Math.round((T_B.position.y - 0.5 + yOffsetB) * 1000) / 1000,
            z: Math.round((T_B.position.z - 0.5) * 1000) / 1000,
          };
        } else {
          // Triangle on side face: pin attachment face, use T_B.position directly.
          // When piece A is a square its pieceOrigin inflates worldPosition.y by
          // 0.5, so T_B.position.y is 0.5 too high — subtract it. (Fix 1)
          const attachFaceDesc = G.TRIANGLE_FACES[G.TRIANGLE_ATTACHMENT_FACE_INDEX];
          selfFaceIndex = G.TRIANGLE_ATTACHMENT_FACE_INDEX;
          const T_B = G.getAttachmentTransform(T_A, bestFaceA, attachFaceDesc);
          rotationIndex = T_B.rotationIndex;
          const yFixTri = piece.type === 'square' ? 0.5 : 0;
          ghostPos = {
            x: Math.round(T_B.position.x * 1000) / 1000,
            y: Math.round((T_B.position.y - yFixTri) * 1000) / 1000,
            z: Math.round(T_B.position.z * 1000) / 1000,
          };
        }
      }

      // For CTX_TRI triangle: inherit existing triangle's position and rotationIndex
      // directly — place flush above (y+1) or below (y-1) without going through
      // getAttachmentTransform, which gives incorrect half-height results.
      if (_ghostContext === 'tri' && newType === 'triangle') {
        selfFaceIndex = G.TRIANGLE_ATTACHMENT_FACE_INDEX;
        const isTop = bestFaceA.outwardNormal.y > 0;
        ghostPos = {
          x: piece.position.x,
          y: piece.position.y + (isTop ? 1 : -1),
          z: piece.position.z,
        };
        // rotationIndex already set to piece.rotationIndex above
      }

    } else {
      App.clearGhost();
      return;
    }

    if (!ghostPos) { App.clearGhost(); return; }

    const valid = _ghostInFootprint(newType, ghostPos, rotationIndex ?? 0)
               && _ghostNoCollision(ghostPos);
    App.setGhost({
      type: newType,
      position: ghostPos,
      rotationIndex: rotationIndex ?? 0,
      valid,
      attachToPieceId,
      attachFaceIndex,
      selfFaceIndex,
    });
  }

  /*
   * Cycle the ghost's rotation by dir (+1 or -1).
   * Only active in CTX_FLAT (4 cardinal slots).  No-op in CTX_SIDE / CTX_TRI.
   */
  function cycleGhostRotation(dir) {
    if (!_hoverHit) return;
    if (_ghostContext !== 'flat') return;
    _ghostRotationOffset = ((_ghostRotationOffset + dir) % 4 + 4) % 4;
    _computeGhost(_hoverHit);
    markDirty();
  }

  function setHoverHit(hit) {
    // Reset rotation offset when the hover target changes so the user
    // starts fresh on each new face, but preserve it while hovering the same face.
    if (!hit) _ghostRotationOffset = 0;
    _hoverHit = hit;
    _computeGhost(hit);
    markDirty();
  }

  function _rebuildGhost() {
    _ghostGroup.clear();
    const ghost = App.state.ghost;
    if (!ghost || !App.state.showPlacementGhost) return;

    const mat      = ghost.valid ? _ghostMatValid : _ghostMatInvalid;
    const isSquare = ghost.type !== 'triangle';
    const geo      = isSquare ? _squareGeo : _triangleGeo;
    const mesh     = new THREE.Mesh(geo, mat);

    if (isSquare) {
      mesh.position.set(
        ghost.position.x + 0.5,
        ghost.position.y + 0.5,
        ghost.position.z + 0.5,
      );
    } else {
      mesh.position.set(
        ghost.position.x,
        ghost.position.y,
        ghost.position.z,
      );
    }
    mesh.rotation.y = _rotIndexToRad(ghost.rotationIndex ?? 0);
    _ghostGroup.add(mesh);
  }

  // ── Compass HUD (2D N/S/E/W) ──────────────────────────────────
  function _renderCompass() {
    const canvas = document.getElementById('compass-canvas');
    if (!canvas || !_camera) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const r  = 28;

    // Yaw from camera forward projected onto XZ plane
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_camera.quaternion);
    fwd.y = 0;
    if (fwd.length() < 0.001) fwd.set(0, 0, -1);
    fwd.normalize();
    const yaw = Math.atan2(fwd.x, -fwd.z);

    // Ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(28,37,48,0.85)';
    ctx.lineWidth = 18;
    ctx.stroke();

    // North indicator line
    const na = -yaw - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(na) * (r - 2), cy + Math.sin(na) * (r - 2));
    ctx.strokeStyle = 'rgba(231,76,60,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cardinal labels
    const cardinals = [
      { label: 'N', offset: 0,            bold: true,  color: '#e74c3c' },
      { label: 'E', offset: Math.PI / 2,  bold: false, color: '#a8c0d6' },
      { label: 'S', offset: Math.PI,      bold: false, color: '#a8c0d6' },
      { label: 'W', offset: -Math.PI / 2, bold: false, color: '#a8c0d6' },
    ];

    cardinals.forEach(({ label, offset, bold, color }) => {
      const a = offset - yaw - Math.PI / 2;
      const tx = cx + Math.cos(a) * (r - 5);
      const ty = cy + Math.sin(a) * (r - 5);
      ctx.font = bold ? 'bold 10px Rajdhani,sans-serif' : '9px Rajdhani,sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tx, ty);
    });
  }

  // ── Area select — project all pieces to screen, return ids within rect ──
  /*
   * screenX1/Y1, screenX2/Y2 are client-space corners (order doesn't matter).
   * Returns an array of piece ids whose centre projects within the rectangle.
   * Occlusion is intentionally ignored — world→NDC→screen projection only.
   */
  function selectInScreenRect(screenX1, screenY1, screenX2, screenY2) {
    if (!_renderer || !_camera) return [];

    const rect = _renderer.domElement.getBoundingClientRect();
    const minX = Math.min(screenX1, screenX2);
    const maxX = Math.max(screenX1, screenX2);
    const minY = Math.min(screenY1, screenY2);
    const maxY = Math.max(screenY1, screenY2);

    const result = [];
    const v = new THREE.Vector3();

    App.state.pieces.forEach(piece => {
      v.set(piece.position.x + 0.5, piece.position.y + 0.5, piece.position.z + 0.5);
      v.project(_camera);
      const sx = (v.x * 0.5 + 0.5) * rect.width  + rect.left;
      const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        result.push(piece.id);
      }
    });

    return result;
  }

  // ── Snapshot for thumbnails ────────────────────────────────────
  function getSnapshot() {
    if (!_renderer) return null;
    _renderer.render(_scene, _camera);
    return _renderer.domElement.toDataURL('image/jpeg', 0.6);
  }

  function applySettings(settings) {
    if (!_controls) return;
    if (settings.zoomSpeed   !== undefined) _controls.zoomSpeed   = settings.zoomSpeed;
    if (settings.rotateSpeed !== undefined) _controls.rotateSpeed = settings.rotateSpeed;
    // panSpeed is read live in _applyWASD and OrbitControls pan uses its own internal factor;
    // for left-drag pan speed, scale via panSpeed setting applied through a multiplier.
    markDirty();
  }

  function setAreaSelectMode(active) {
    if (!_controls) return;
    _controls.mouseButtons.LEFT = active ? THREE.MOUSE.NONE : THREE.MOUSE.PAN;
  }

  window.Scene = { init, markDirty, pickAt, setHoverHit, cycleGhostRotation, getSnapshot, selectInScreenRect, applySettings, setAreaSelectMode };

}());
