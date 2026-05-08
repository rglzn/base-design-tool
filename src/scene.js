/* scene.js — Three.js scene, orbit camera, raycasting, compass HUD. */
(function () {

  let _renderer, _scene, _camera, _controls;
  let _groundGroup, _cubeGroup;
  let _groundPlane;          // invisible, raycasting target at y=0
  let _cubeGeo, _edgeGeo, _edgeMat;
  let _dirty = false;

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    const viewport = document.getElementById('viewport');

    // Renderer
    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(window.devicePixelRatio);
    _renderer.setClearColor(0x090b0e);
    viewport.appendChild(_renderer.domElement);

    // Scene
    _scene = new THREE.Scene();

    // Camera
    _camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    _camera.position.set(22, 16, 26);

    // Orbit controls — left drag: rotate, right drag: pan, scroll: zoom
    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.target.set(5, 0, 5);
    _controls.enableDamping  = true;
    _controls.dampingFactor  = 0.08;
    _controls.screenSpacePanning = false;
    _controls.mouseButtons = {
      LEFT:   THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  THREE.MOUSE.PAN,
    };
    _controls.update();
    _controls.addEventListener('change', markDirty);

    // Lighting — ambient + single directional, no shadows
    _scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.80);
    sun.position.set(10, 20, 10);
    _scene.add(sun);

    // Groups
    _groundGroup = new THREE.Group();
    _cubeGroup   = new THREE.Group();
    _scene.add(_groundGroup);
    _scene.add(_cubeGroup);

    // Invisible ground plane for raycasting
    const planeGeo = new THREE.PlaneGeometry(2000, 2000);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    _groundPlane = new THREE.Mesh(planeGeo, planeMat);
    _groundPlane.rotation.x = -Math.PI / 2;
    _groundPlane.userData.isGround = true;
    _scene.add(_groundPlane);

    // Shared cube geometry (never disposed)
    _cubeGeo  = new THREE.BoxGeometry(1, 1, 1);
    _edgeGeo  = new THREE.EdgesGeometry(_cubeGeo);
    _edgeMat  = new THREE.LineBasicMaterial({ color: 0x000000 });

    // Resize
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

  // ── Render loop ─────────────────────────────────────────────────
  function _loop() {
    requestAnimationFrame(_loop);
    _controls.update(); // needed for damping
    if (_dirty) {
      _rebuild();
      _renderer.render(_scene, _camera);
      _renderCompass();
      _dirty = false;
    }
  }

  function markDirty() {
    _dirty = true;
  }

  // ── Scene rebuild ──────────────────────────────────────────────
  function _rebuild() {
    _rebuildGround();
    _rebuildCubes();
  }

  // ── Ground grid ────────────────────────────────────────────────
  function _rebuildGround() {
    _groundGroup.clear();
    const building = App.state.building;
    if (!building.length) return;

    const points = [];
    building.forEach(({ bx, bz }) => {
      const x0 = bx * 10;
      const z0 = bz * 10;
      // lines parallel to X (rows)
      for (let i = 0; i <= 10; i++) {
        points.push(x0,     0, z0 + i,
                    x0 + 10, 0, z0 + i);
      }
      // lines parallel to Z (columns)
      for (let i = 0; i <= 10; i++) {
        points.push(x0 + i, 0, z0,
                    x0 + i, 0, z0 + 10);
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x1c2530 });
    _groundGroup.add(new THREE.LineSegments(geo, mat));
  }

  // ── Cube meshes ────────────────────────────────────────────────
  function _rebuildCubes() {
    // Dispose only per-cube materials (shared geo/edgeMat are kept)
    _cubeGroup.traverse(obj => {
      if (obj.isMesh && obj.material) obj.material.dispose();
    });
    _cubeGroup.clear();

    App.state.cells.forEach((cell, key) => {
      const [x, y, z] = key.split(',').map(Number);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(App.getColorHex(cell.colorId)),
      });
      const mesh = new THREE.Mesh(_cubeGeo, mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      mesh.userData.key    = key;
      mesh.userData.isCube = true;

      // EdgesGeometry outline — part of the visual identity
      mesh.add(new THREE.LineSegments(_edgeGeo, _edgeMat));

      _cubeGroup.add(mesh);
    });
  }

  // ── Raycasting ─────────────────────────────────────────────────
  /*
   * Returns null on miss.
   * On hit: { type, key, normal, buildTarget }
   *   type:        'cube' | 'ground'
   *   key:         "x,y,z" of the hit cube, or null for ground
   *   normal:      THREE.Vector3 face normal (world space, axis-aligned)
   *   buildTarget: "x,y,z" where Build would place, or null if occupied
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

    // Cubes first (non-recursive — outlines are children, not needed here)
    const cubeHits = ray.intersectObjects(_cubeGroup.children, false);
    if (cubeHits.length > 0) {
      const hit  = cubeHits[0];
      const key  = hit.object.userData.key;
      const [x, y, z] = key.split(',').map(Number);

      const normal = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld)
        .round();

      const tx = x + Math.round(normal.x);
      const ty = y + Math.round(normal.y);
      const tz = z + Math.round(normal.z);
      const targetKey  = `${tx},${ty},${tz}`;
      const buildTarget = App.state.cells.has(targetKey) ? null : targetKey;

      return { type: 'cube', key, normal, buildTarget };
    }

    // Ground plane
    const groundHits = ray.intersectObject(_groundPlane);
    if (groundHits.length > 0) {
      const pt = groundHits[0].point;
      const gx = Math.floor(pt.x);
      const gz = Math.floor(pt.z);
      const bx = Math.floor(gx / 10);
      const bz = Math.floor(gz / 10);
      const inFP = App.state.building.some(b => b.bx === bx && b.bz === bz);
      if (!inFP) return null;

      const targetKey  = `${gx},0,${gz}`;
      const buildTarget = App.state.cells.has(targetKey) ? null : targetKey;
      return {
        type: 'ground',
        key:  null,
        normal: new THREE.Vector3(0, 1, 0),
        buildTarget,
      };
    }

    return null;
  }

  // ── Compass HUD ────────────────────────────────────────────────
  function _renderCompass() {
    const canvas = document.getElementById('compass-canvas');
    if (!canvas || !_camera) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx  = w / 2;
    const cy  = h / 2;
    const len = 26;

    // Camera basis vectors in world space
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(_camera.quaternion);
    const camUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(_camera.quaternion);

    const axes = [
      { dir: new THREE.Vector3(1, 0, 0), color: '#e74c3c', label: 'X' },
      { dir: new THREE.Vector3(0, 1, 0), color: '#a8c0d6', label: 'Y' },
      { dir: new THREE.Vector3(0, 0, 1), color: '#4a9fd4', label: 'Z' },
    ];

    // Draw back-facing axes first (dimmed) so front-facing sit on top
    const projected = axes.map(a => ({
      ...a,
      rx: a.dir.dot(camRight),
      ry: a.dir.dot(camUp),
    }));

    // Sort: draw axes pointing away from camera (negative Z dot) first
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_camera.quaternion);
    projected.sort((a, b) => b.dir.dot(camFwd) - a.dir.dot(camFwd));

    projected.forEach(({ rx, ry, color, label, dir }) => {
      const facing = dir.dot(camFwd);
      const sx = cx + rx * len;
      const sy = cy - ry * len;
      const alpha = facing < 0 ? 0.30 : 1.0;

      ctx.globalAlpha = alpha;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sx, sy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.fillStyle = color;
      ctx.font = 'bold 10px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx + rx * 10, sy - ry * 10);
    });

    ctx.globalAlpha = 1;
  }

  // ── Public API ─────────────────────────────────────────────────
  window.Scene = {
    init,
    markDirty,
    pickAt,
  };

}());
