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

  const _INCLINE_TYPES = new Set(['stair-solid', 'wedge-solid', 'wedge-solid-inverted']);
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
    _controls.dampingFactor  = 0.08;
    _controls.screenSpacePanning = true;
    _controls.mouseButtons = {
      LEFT:   THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  THREE.MOUSE.ROTATE,
    };
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
    _ghostMatValid   = new THREE.MeshLambertMaterial({ color: 0x33ff66, transparent: true, opacity: 0.38, side: THREE.FrontSide });
    _ghostMatInvalid = new THREE.MeshLambertMaterial({ color: 0xff3333, transparent: true, opacity: 0.38, side: THREE.FrontSide });

    _INCLINE_TYPES.forEach(type => {
      _incGeos[type]     = _makeInclineGeo(type);
      _incEdgeGeos[type] = new THREE.EdgesGeometry(_incGeos[type]);
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      _keys.add(e.key.toLowerCase());
    });
    document.addEventListener('keyup', e => _keys.delete(e.key.toLowerCase()));

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

  // ── WASD pan ───────────────────────────────────────────────────
  function _applyWASD() {
    if (!_keys.size) return;
    const speed   = 0.12;
    const forward = new THREE.Vector3();
    _camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let dx = 0, dz = 0;
    if (_keys.has('w')) { dx -= forward.x * speed; dz -= forward.z * speed; }
    if (_keys.has('s')) { dx += forward.x * speed; dz += forward.z * speed; }
    if (_keys.has('a')) { dx -= right.x * speed;   dz -= right.z * speed; }
    if (_keys.has('d')) { dx += right.x * speed;   dz += right.z * speed; }

    if (dx !== 0 || dz !== 0) {
      _controls.target.x += dx;
      _controls.target.z += dz;
      _camera.position.x += dx;
      _camera.position.z += dz;
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
      const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(App.getColorHex(cell.colorId)) });
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
      // High at front (+z), low at back (-z) — mirror of wedge-solid
      t([-0.5,-0.5,-0.5],[-0.5, 0.5, 0.5],[-0.5,-0.5, 0.5]);
      t([ 0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5,-0.5,-0.5]);
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5]);
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]);
      q([-0.5,-0.5, 0.5],[-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5,-0.5, 0.5]);
    }

    if (type === 'stair-solid') {
      q([-0.5, 0.5, 0  ],[ 0.5, 0.5, 0  ],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]);
      q([-0.5, 0,   0  ],[ 0.5, 0,   0  ],[ 0.5, 0.5, 0  ],[-0.5, 0.5, 0  ]);
      q([-0.5, 0,   0.5],[ 0.5, 0,   0.5],[ 0.5, 0,   0  ],[-0.5, 0,   0  ]);
      t([-0.5,-0.5,-0.5],[-0.5,-0.5, 0.5],[-0.5, 0,   0.5]);
      t([-0.5,-0.5,-0.5],[-0.5, 0,   0.5],[-0.5, 0,   0  ]);
      t([-0.5,-0.5,-0.5],[-0.5, 0,   0  ],[-0.5, 0.5, 0  ]);
      t([-0.5,-0.5,-0.5],[-0.5, 0.5, 0  ],[-0.5, 0.5,-0.5]);
      t([ 0.5,-0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0  ]);
      t([ 0.5,-0.5,-0.5],[ 0.5, 0.5, 0  ],[ 0.5, 0,   0  ]);
      t([ 0.5,-0.5,-0.5],[ 0.5, 0,   0  ],[ 0.5, 0,   0.5]);
      t([ 0.5,-0.5,-0.5],[ 0.5, 0,   0.5],[ 0.5,-0.5, 0.5]);
      q([-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]);
      q([-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5,-0.5,-0.5]);
      q([-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0,   0.5],[-0.5, 0,   0.5]);
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
        side:  THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(_incGeos[cell.object], mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      mesh.rotation.y         = _DIR_ROT[cell.direction] ?? 0;
      mesh.userData.key       = key;
      mesh.userData.isIncline = true;
      mesh.add(new THREE.LineSegments(_incEdgeGeos[cell.object], selected ? _selEdgeMat : _edgeMat));
      _inclineGroup.add(mesh);
    });
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
      const tx = x + Math.round(normal.x);
      const ty = y + Math.round(normal.y);
      const tz = z + Math.round(normal.z);
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

  // ── Snapshot for thumbnails ────────────────────────────────────
  function getSnapshot() {
    if (!_renderer) return null;
    _renderer.render(_scene, _camera);
    return _renderer.domElement.toDataURL('image/jpeg', 0.6);
  }

  window.Scene = { init, markDirty, pickAt, setHoverHit, getSnapshot };

}());
