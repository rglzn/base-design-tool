/* scene.js — Three.js scene, orbit camera, raycasting, compass HUD. */
(function () {

  let _renderer, _scene, _camera, _controls;
  let _groundGroup, _cubeGroup, _inclineGroup, _ghostGroup;
  let _groundPlane;
  let _cubeGeo, _edgeGeo, _edgeMat, _selEdgeMat;
  let _incGeos = {}, _incEdgeGeos = {};
  let _ghostMatValid, _ghostMatInvalid;
  let _dirty = false;
  let _hoverHit = null;
  let _mgOrigin = null;  // { x, z } integer grid cell under cursor for multi-ghost
  let _ctrlModified = false;  // true when Ctrl is held alongside another modifier

  const _INCLINE_TYPES = new Set(['stair-solid', 'wedge-solid', 'wedge-solid-inverted', 'corner-wedge', 'corner-wedge-inverted', 'cube-doorway', 'cube-window', 'pentashield-side', 'pentashield-top', 'half-wedge', 'half-wedge-block', 'half-wedge-inverted', 'half-wedge-block-inverted']);
  const _DIR_ROT = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };
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

    _groundGroup  = new THREE.Group();
    _cubeGroup    = new THREE.Group();
    _inclineGroup = new THREE.Group();
    _ghostGroup   = new THREE.Group();
    _scene.add(_groundGroup);
    _scene.add(_cubeGroup);
    _scene.add(_inclineGroup);
    _scene.add(_ghostGroup);

    const planeGeo = new THREE.PlaneGeometry(2000, 2000);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    _groundPlane = new THREE.Mesh(planeGeo, planeMat);
    _groundPlane.rotation.x = -Math.PI / 2;
    _groundPlane.userData.isGround = true;
    _scene.add(_groundPlane);

    _cubeGeo      = new THREE.BoxGeometry(1, 1, 1);
    _edgeGeo      = new THREE.EdgesGeometry(_cubeGeo);
    _edgeMat      = new THREE.LineBasicMaterial({ color: 0x000000 });
    _selEdgeMat   = new THREE.LineBasicMaterial({ color: 0xf0c040 });
    _ghostMatValid   = new THREE.MeshLambertMaterial({ color: 0x33ff66, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
    _ghostMatInvalid = new THREE.MeshLambertMaterial({ color: 0xff3333, transparent: true, opacity: 0.38, side: THREE.DoubleSide });

    _INCLINE_TYPES.forEach(type => {
      _incGeos[type]     = _makeInclineGeo(type);
      _incEdgeGeos[type] = new THREE.EdgesGeometry(_incGeos[type]);
    });
    const _boxGeo = new THREE.BoxGeometry(1, 1, 1);
    _incGeos['cube-doorway']      = _boxGeo;
    _incGeos['cube-window']       = _boxGeo;
    _incGeos['pentashield-side']  = _boxGeo;
    _incGeos['pentashield-top']   = _boxGeo;
    _incEdgeGeos['cube-doorway']     = new THREE.EdgesGeometry(_boxGeo);
    _incEdgeGeos['cube-window']      = new THREE.EdgesGeometry(_boxGeo);
    _incEdgeGeos['pentashield-side'] = new THREE.EdgesGeometry(_boxGeo);
    _incEdgeGeos['pentashield-top']  = new THREE.EdgesGeometry(_boxGeo);
    // half-wedge types use custom geometry from _makeInclineGeo — already built above in forEach

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
      _rebuildCubes();
      _rebuildInclines();
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

  // ── Cube meshes ────────────────────────────────────────────────
  function _rebuildCubes() {
    _cubeGroup.traverse(obj => { if (obj.isMesh && obj.material) obj.material.dispose(); });
    _cubeGroup.clear();

    App.state.cells.forEach((cell, key) => {
      if (cell.object !== 'cube') return;
      const [x, y, z] = key.split(',').map(Number);
      const selected = App.state.selection.has(key);
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(App.getColorHex(cell.colorId)), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(_cubeGeo, mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      mesh.userData.key    = key;
      mesh.userData.isCube = true;
      mesh.add(new THREE.LineSegments(_edgeGeo, selected ? _selEdgeMat : _edgeMat));
      _cubeGroup.add(mesh);
    });
  }

  // ── Incline geometry builder ───────────────────────────────────
  // All inclines oriented for N (slope rises toward -z). Rotation applied per-mesh.
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

  // ── Incline meshes ─────────────────────────────────────────────
  function _rebuildInclines() {
    _inclineGroup.traverse(obj => { if (obj.isMesh && obj.material) obj.material.dispose(); });
    _inclineGroup.clear();

    App.state.cells.forEach((cell, key) => {
      if (!_INCLINE_TYPES.has(cell.object)) return;
      const [x, y, z] = key.split(',').map(Number);
      const selected = App.state.selection.has(key);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(App.getColorHex(cell.colorId)),
        side:  THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(_incGeos[cell.object], mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      mesh.rotation.y         = _DIR_ROT[cell.direction] ?? 0;
      mesh.userData.key       = key;
      mesh.userData.isIncline = true;
      mesh.add(new THREE.LineSegments(_incEdgeGeos[cell.object], selected ? _selEdgeMat : _edgeMat));
      if (cell.object === 'cube-doorway' || cell.object === 'cube-window' ||
          cell.object === 'pentashield-side' || cell.object === 'pentashield-top') {
        _addDecalLines(mesh, cell.object);
      }
      // half-wedge types: mesh position is cell-centre but geometry occupies only half the cell height;
      // no offset needed — geometry vertices already encode the correct y range.
      _inclineGroup.add(mesh);
    });
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

  // ── Raycasting ─────────────────────────────────────────────────
  /*
   * Returns null on miss.
   * On hit: { type, key, normal, targetKey, buildTarget }
   *   targetKey:   always the cell where build would land (occupied or not)
   *   buildTarget: targetKey if cell is empty, null if occupied
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

    const solidHits = ray.intersectObjects([..._cubeGroup.children, ..._inclineGroup.children], false);
    if (solidHits.length > 0) {
      const hit  = solidHits[0];
      const key  = hit.object.userData.key;
      const [x, y, z] = key.split(',').map(Number);
      const type = hit.object.userData.isIncline ? 'incline' : 'cube';
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
      // Diagonal faces (slope/corner types) can produce a rounded normal with magnitude > 1
      // (two axes both round to ±1), or the dominant-axis of the normal can disagree with
      // which face the cursor is actually nearest to.  Use the hit point's offset from the
      // cell centre as the ground truth: whichever axis shows the largest absolute deviation
      // from the cell centre is the face that was hit, and its sign gives the direction.
      let tx, ty, tz;
      if (Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) > 1) {
        const cellCx = x + 0.5, cellCy = y + 0.5, cellCz = z + 0.5;
        const dx = hit.point.x - cellCx;
        const dy = hit.point.y - cellCy;
        const dz = hit.point.z - cellCz;
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        if (ax >= ay && ax >= az)      { tx = x + Math.sign(dx); ty = y; tz = z; }
        else if (az >= ax && az >= ay) { tx = x; ty = y; tz = z + Math.sign(dz); }
        else                           { tx = x; ty = y + Math.sign(dy); tz = z; }
      } else {
        tx = x + Math.round(normal.x);
        ty = y + Math.round(normal.y);
        tz = z + Math.round(normal.z);
      }
      const targetKey   = `${tx},${ty},${tz}`;
      const buildTarget = App.state.cells.has(targetKey) ? null : targetKey;
      return { type, key, normal, targetKey, buildTarget };
    }

    const groundHits = ray.intersectObject(_groundPlane);
    if (groundHits.length > 0) {
      const pt = groundHits[0].point;
      const gx = Math.floor(pt.x);
      const gz = Math.floor(pt.z);
      const bx = Math.floor(gx / 10);
      const bz = Math.floor(gz / 10);
      if (!App.state.building.some(b => b.bx === bx && b.bz === bz)) return null;
      const targetKey   = `${gx},0,${gz}`;
      const buildTarget = App.state.cells.has(targetKey) ? null : targetKey;
      return { type: 'ground', key: null, normal: new THREE.Vector3(0, 1, 0), targetKey, buildTarget };
    }

    return null;
  }

  // ── Placement ghost ────────────────────────────────────────────
  function setHoverHit(hit) {
    _hoverHit = hit;
    markDirty();
  }

  function _rebuildGhost() {
    _ghostGroup.clear();

    // ── Multi-ghost ────────────────────────────────────────────────
    const mg = App.state.placingMultiGhost;
    if (mg && _mgOrigin) {
      const targets = App.getMultiGhostTargets(_mgOrigin.x, _mgOrigin.z);
      const valid   = App.multiGhostValid(_mgOrigin.x, _mgOrigin.z);
      const mat     = valid ? _ghostMatValid : _ghostMatInvalid;
      if (targets) {
        targets.forEach(({ key, cell }) => {
          const [x, y, z] = key.split(',').map(Number);
          let mesh;
          if (cell.object === 'cube') {
            mesh = new THREE.Mesh(_cubeGeo, mat);
          } else if (_INCLINE_TYPES.has(cell.object)) {
            mesh = new THREE.Mesh(_incGeos[cell.object], mat);
            mesh.rotation.y = _DIR_ROT[cell.direction] ?? 0;
            if (cell.object === 'cube-doorway' || cell.object === 'cube-window' ||
                cell.object === 'pentashield-side' || cell.object === 'pentashield-top') {
              _addDecalLines(mesh, cell.object);
            }
            // half-wedge types need no decal lines
          } else {
            return;
          }
          mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
          _ghostGroup.add(mesh);
        });
      }
      return;
    }

    // ── Single placement ghost ──────────────────────────────────────
    if (!App.state.showPlacementGhost) return;
    if (App.state.tool !== 'build') return;
    if (!_hoverHit) return;

    const targetKey = _hoverHit.targetKey;
    if (!targetKey) return;
    const valid = !App.state.cells.has(targetKey);
    const [x, y, z] = targetKey.split(',').map(Number);
    const bx = Math.floor(x / 10);
    const bz = Math.floor(z / 10);
    const inFP = App.state.building.some(b => b.bx === bx && b.bz === bz);

    const obj = App.state.selectedObject;
    const mat = (valid && inFP) ? _ghostMatValid : _ghostMatInvalid;
    let mesh;

    if (obj === 'cube') {
      mesh = new THREE.Mesh(_cubeGeo, mat);
    } else if (_INCLINE_TYPES.has(obj)) {
      mesh = new THREE.Mesh(_incGeos[obj], mat);
      mesh.rotation.y = _DIR_ROT[App.state.placeDirection] ?? 0;
      if (obj === 'cube-doorway' || obj === 'cube-window' ||
          obj === 'pentashield-side' || obj === 'pentashield-top') {
        _addDecalLines(mesh, obj);
      }
      // half-wedge types need no decal lines
    } else {
      return;
    }

    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
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

  // ── Area select — project all cells to screen, return keys within rect ──
  /*
   * screenX1/Y1, screenX2/Y2 are client-space corners (order doesn't matter).
   * Returns an array of cell keys whose centre projects within the rectangle.
   * Occlusion is intentionally ignored — we project world→NDC→screen only.
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

    App.state.cells.forEach((_cell, key) => {
      const [x, y, z] = key.split(',').map(Number);
      v.set(x + 0.5, y + 0.5, z + 0.5);
      v.project(_camera);
      const sx = (v.x * 0.5 + 0.5) * rect.width  + rect.left;
      const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        result.push(key);
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

  function setMultiGhostOrigin(x, z) {
    _mgOrigin = (x === null) ? null : { x, z };
    markDirty();
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

  window.Scene = { init, markDirty, pickAt, setHoverHit, setMultiGhostOrigin, getSnapshot, selectInScreenRect, applySettings, setAreaSelectMode };

}());
