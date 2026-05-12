/* app.js — state, mutations, Supabase persistence, init. */
(function () {

  const SUPABASE_URL = 'https://ekrlymbgjduczogvskox.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_d-nCBT9nVSi81_CYv4GUHw_h1_wc96F';

  const DEFAULT_COLOURS = [
    { id: 0, hex: '#3a6b8c' }, // default — pre-selected, never deletable
    { id: 1, hex: '#c0392b' },
    { id: 2, hex: '#d35400' },
    { id: 3, hex: '#f39c12' },
    { id: 4, hex: '#27ae60' },
    { id: 5, hex: '#8e44ad' },
    { id: 6, hex: '#2c3e50' },
    { id: 7, hex: '#bdc3c7' },
  ];

  let _nextColorId   = DEFAULT_COLOURS.length;
  let _autosaveTimer = null;

  const state = {
    // persisted
    building:        [{ bx: 0, bz: 0 }],
    cells:           new Map(),
    colors:          DEFAULT_COLOURS.map(c => ({ ...c })),
    project:         null,   // { id, name, isNamed }

    // editor-only
    tool:               'build',
    selectedObject:     'cube',
    placeDirection:     'N',
    selectedColorId:    0,
    selection:          new Set(),
    showPlacementGhost: true,
    placingMultiGhost:  null,   // null | { cells, anchorIdx, rotation, pickUpKeys }
    stamps:             [],     // local cache of Supabase stamps table
  };

  // Supabase client
  window._sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── Internal helpers ───────────────────────────────────────────
  function _markDirty() {
    if (window.Scene) window.Scene.markDirty();
  }

  function _refreshUI() {
    if (window.UI) window.UI.refresh();
  }

  // ── Serialise / deserialise ────────────────────────────────────
  function _serialize() {
    return {
      building: state.building,
      cells: [...state.cells.entries()].map(([key, cell]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, object: cell.object, direction: cell.direction, colorId: cell.colorId };
      }),
      colors: state.colors,
    };
  }

  function _deserialize(data) {
    if (!data) return;
    state.building = (data.building && data.building.length > 0) ? data.building : [{ bx: 0, bz: 0 }];
    state.cells    = new Map();
    (data.cells || []).forEach(({ x, y, z, object, direction, colorId }) => {
      if (!['cube', 'stair-solid', 'wedge-solid', 'wedge-solid-inverted', 'corner-wedge', 'corner-wedge-inverted', 'cube-doorway', 'cube-window', 'pentashield-side', 'pentashield-top', 'half-wedge', 'half-wedge-block', 'half-wedge-inverted', 'half-wedge-block-inverted'].includes(object)) return;
      state.cells.set(`${x},${y},${z}`, { object, direction, colorId });
    });
    state.colors  = data.colors || DEFAULT_COLOURS.map(c => ({ ...c }));
    _nextColorId  = state.colors.reduce((m, c) => Math.max(m, c.id), -1) + 1;
    state.selectedColorId = state.colors[0]?.id ?? 0;
    state.selection       = new Set();
    state.tool               = 'build';
    state.selectedObject     = 'cube';
    state.placeDirection     = 'N';
    state.showPlacementGhost = true;
    state.placingMultiGhost  = null;
  }

  // ── Tool / object / colour ─────────────────────────────────────
  function setTool(tool) {
    if (state.tool === tool) return;
    state.tool = tool;
    if (tool !== 'paint') state.selection.clear();
    _refreshUI();
  }

  function setSelectedObject(type) {
    state.selectedObject = type;
    _refreshUI();
  }

  const _DIRS = ['N', 'E', 'S', 'W'];
  function setPlaceDirection(dir) {
    state.placeDirection = dir;
    _refreshUI();
  }
  function rotatePlaceDirection(delta) {
    const i = _DIRS.indexOf(state.placeDirection);
    state.placeDirection = _DIRS[(i + delta + 4) % 4];
    _refreshUI();
  }

  function setColor(id) {
    state.selectedColorId = id;
    _refreshUI();
  }

  function setShowPlacementGhost(val) {
    state.showPlacementGhost = val;
    _refreshUI();
  }

  // ── Colour management ──────────────────────────────────────────
  function addColor(hex) {
    const id = _nextColorId++;
    state.colors.push({ id, hex });
    _refreshUI();
    return id;
  }

  function updateColor(id, hex) {
    const colour = state.colors.find(c => c.id === id);
    if (!colour) return;
    colour.hex = hex;
    _markDirty();
    _refreshUI();
  }

  function deleteColor(id) {
    if (id === 0) return;
    const idx = state.colors.findIndex(c => c.id === id);
    if (idx === -1) return;
    state.colors.splice(idx, 1);
    state.cells.forEach(cell => { if (cell.colorId === id) cell.colorId = 0; });
    if (state.selectedColorId === id) state.selectedColorId = 0;
    _markDirty();
    _refreshUI();
  }

  function getColorHex(id) {
    const colour = state.colors.find(c => c.id === id);
    return colour ? colour.hex : state.colors[0].hex;
  }

  // ── Cell placement ─────────────────────────────────────────────
  function placeCell(x, y, z) {
    const key = `${x},${y},${z}`;
    if (state.cells.has(key)) return false;
    if (!_inFootprint(x, z)) return false;
    const isIncline = ['stair-solid', 'wedge-solid', 'wedge-solid-inverted', 'corner-wedge', 'corner-wedge-inverted', 'cube-doorway', 'cube-window', 'pentashield-side', 'pentashield-top', 'half-wedge', 'half-wedge-block', 'half-wedge-inverted', 'half-wedge-block-inverted'].includes(state.selectedObject);
    state.cells.set(key, {
      object:    state.selectedObject,
      direction: isIncline ? state.placeDirection : null,
      colorId:   state.selectedColorId,
    });
    _markDirty();
    return true;
  }

  function deleteCell(x, y, z) {
    const key = `${x},${y},${z}`;
    if (!state.cells.has(key)) return false;
    state.cells.delete(key);
    state.selection.delete(key);
    _markDirty();
    return true;
  }

  // ── Selection ──────────────────────────────────────────────────
  function _markSceneDirty() { if (window.Scene) window.Scene.markDirty(); _refreshUI(); }

  function addToSelection(key)      { state.selection.add(key);    _markSceneDirty(); }
  function removeFromSelection(key) { state.selection.delete(key); _markSceneDirty(); }
  function clearSelection()         { if (state.selection.size) { state.selection.clear(); _markSceneDirty(); } }

  function deleteSelection() {
    state.selection.forEach(key => state.cells.delete(key));
    state.selection.clear();
    _markDirty();
    _refreshUI();
  }

  function repaintCells(keys, colorId) {
    keys.forEach(key => {
      const cell = state.cells.get(key);
      if (cell) cell.colorId = colorId;
    });
    _markDirty();
    _refreshUI();
  }

  // ── Footprint ──────────────────────────────────────────────────
  function _inFootprint(x, z) {
    const bx = Math.floor(x / 10);
    const bz = Math.floor(z / 10);
    return state.building.some(b => b.bx === bx && b.bz === bz);
  }

  function _blockHasContent(bx, bz) {
    for (const key of state.cells.keys()) {
      const [cx, , cz] = key.split(',').map(Number);
      if (Math.floor(cx / 10) === bx && Math.floor(cz / 10) === bz) return true;
    }
    return false;
  }

  function _isConnected(blocks) {
    if (blocks.length <= 1) return true;
    const set = new Set(blocks.map(b => `${b.bx},${b.bz}`));
    const visited = new Set();
    const queue = [`${blocks[0].bx},${blocks[0].bz}`];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const [bx, bz] = cur.split(',').map(Number);
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nb = `${bx+dx},${bz+dz}`;
        if (set.has(nb) && !visited.has(nb)) queue.push(nb);
      }
    }
    return visited.size === blocks.length;
  }

  function addBlock(bx, bz) {
    if (state.building.length >= 6) return false;
    if (state.building.some(b => b.bx === bx && b.bz === bz)) return false;
    const adjacent = state.building.some(b =>
      (Math.abs(b.bx - bx) === 1 && b.bz === bz) ||
      (b.bx === bx && Math.abs(b.bz - bz) === 1)
    );
    if (!adjacent && state.building.length > 0) return false;
    state.building.push({ bx, bz });
    _markDirty();
    _refreshUI();
    return true;
  }

  function removeBlock(bx, bz) {
    const idx = state.building.findIndex(b => b.bx === bx && b.bz === bz);
    if (idx === -1) return { ok: false, reason: 'not-found' };
    const remaining = state.building.filter((_, i) => i !== idx);
    if (remaining.length === 0) return { ok: false, reason: 'last-block' };
    if (!_isConnected(remaining)) return { ok: false, reason: 'disconnected' };
    const hadContent = _blockHasContent(bx, bz);
    state.building.splice(idx, 1);
    if (hadContent) {
      for (const key of [...state.cells.keys()]) {
        const [cx, , cz] = key.split(',').map(Number);
        if (Math.floor(cx / 10) === bx && Math.floor(cz / 10) === bz) {
          state.cells.delete(key);
          state.selection.delete(key);
        }
      }
    }
    _markDirty();
    _refreshUI();
    return { ok: true, hadContent };
  }

  function blockHasContent(bx, bz) { return _blockHasContent(bx, bz); }
  function canRemoveBlock(bx, bz) {
    const remaining = state.building.filter(b => !(b.bx === bx && b.bz === bz));
    return remaining.length > 0 && _isConnected(remaining);
  }

  function footprintLabel() {
    const n = state.building.length;
    return `${n} block${n === 1 ? '' : 's'}`;
  }

  // ── Project CRUD ───────────────────────────────────────────────
  async function loadActiveProject() {
    window.UI.showFirstRunModal();
  }

  async function loadProject(id) {
    try {
      const { data, error } = await window._sb
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      _deserialize(data.data);
      state.project = { id: data.id, name: data.name, isNamed: data.is_named };
      await window._sb
        .from('app_state')
        .upsert({ key: 'active_project_id', value: id });
      if (window.Scene) window.Scene.markDirty();
      if (window.UI)    window.UI.refresh();
    } catch (_) {
      window.UI.showError('Failed to load project.');
    }
  }

  async function createFirstProject(name) {
    try {
      const { data, error } = await window._sb
        .from('projects')
        .insert({ name, is_named: false, data: _serialize(), thumbnail: null })
        .select()
        .single();
      if (error) throw error;
      state.project = { id: data.id, name: data.name, isNamed: false };
      await window._sb
        .from('app_state')
        .upsert({ key: 'active_project_id', value: data.id });
      if (window.UI) window.UI.refresh();
    } catch (err) {
      window.UI.showError('Failed to create project: ' + err.message);
    }
  }

  async function saveProject(name) {
    try {
      const thumbnail = window.Scene ? window.Scene.getSnapshot() : null;
      const { data, error } = await window._sb
        .from('projects')
        .insert({ name, is_named: true, data: _serialize(), thumbnail })
        .select()
        .single();
      if (error) throw error;
      state.project = { id: data.id, name: data.name, isNamed: true };
      await window._sb
        .from('app_state')
        .upsert({ key: 'active_project_id', value: data.id });
      if (window.UI) window.UI.refresh();
    } catch (err) {
      window.UI.showError('Failed to save: ' + err.message);
    }
  }

  async function saveProjectOverwrite(id, name) {
    try {
      const thumbnail = window.Scene ? window.Scene.getSnapshot() : null;
      const { data, error } = await window._sb
        .from('projects')
        .update({ name, is_named: true, data: _serialize(), thumbnail })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      state.project = { id: data.id, name: data.name, isNamed: true };
      await window._sb
        .from('app_state')
        .upsert({ key: 'active_project_id', value: data.id });
      if (window.UI) window.UI.refresh();
    } catch (err) {
      window.UI.showError('Failed to save: ' + err.message);
    }
  }

  async function fetchNamedProjects() {
    const { data, error } = await window._sb
      .from('projects')
      .select('id, name, thumbnail, updated_at')
      .eq('is_named', true)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function deleteProject(id) {
    const { error } = await window._sb.from('projects').delete().eq('id', id);
    if (error) throw error;
    if (state.project?.id === id) {
      state.project = null;
      await window._sb.from('app_state').delete().eq('key', 'active_project_id');
    }
  }

  function isCurrentProjectNamed() {
    return state.project?.isNamed === true;
  }

  // ── Multi-ghost ────────────────────────────────────────────────
  /*
   * placingMultiGhost shape:
   *   cells:      [{ dx, dy, dz, object, direction, colorId }]  offsets from normalised origin
   *   anchorIdx:  0-3 — which bounding-box corner snaps to cursor
   *   rotation:   0-3 (×90° CW around Y)
   *   pickUpKeys: [{ key, cell }] snapshots to restore on ESC, or null for Duplicate
   */
  function startMultiGhost(pickUp) {
    if (!state.selection.size) return;

    const keys      = [...state.selection];
    const snapshots = keys.map(k => ({ key: k, cell: { ...state.cells.get(k) } }));
    const coords    = keys.map(k => k.split(',').map(Number));

    const minX = Math.min(...coords.map(c => c[0]));
    const minY = Math.min(...coords.map(c => c[1]));
    const minZ = Math.min(...coords.map(c => c[2]));

    const cells = keys.map((k, i) => {
      const [x, y, z] = coords[i];
      return { dx: x - minX, dy: y - minY, dz: z - minZ, ...state.cells.get(k) };
    });

    if (pickUp) {
      keys.forEach(k => state.cells.delete(k));
      state.selection.clear();
      _markDirty();
    } else {
      state.selection.clear();
    }

    state.placingMultiGhost = {
      cells,
      anchorIdx:  0,
      rotation:   0,
      pickUpKeys: pickUp ? snapshots : null,
    };
    _refreshUI();
  }

  function cancelMultiGhost() {
    if (!state.placingMultiGhost) return;
    const { pickUpKeys } = state.placingMultiGhost;
    state.placingMultiGhost = null;
    if (pickUpKeys) {
      pickUpKeys.forEach(({ key, cell }) => state.cells.set(key, cell));
      _markDirty();
    }
    _refreshUI();
    if (window.Scene) window.Scene.markDirty();
  }

  function commitMultiGhost(originX, originZ) {
    const mg = state.placingMultiGhost;
    if (!mg) return false;
    const targets = _multiGhostTargets(mg, originX, originZ);
    if (!targets) return false;
    // Stamp: block placement if any target is occupied or out of footprint
    if (mg.isStamp) {
      const allClear = targets.every(({ key }) => {
        if (state.cells.has(key)) return false;
        const [x, , z] = key.split(',').map(Number);
        return _inFootprint(x, z);
      });
      if (!allClear) return false;
    }
    const placedKeys = [];
    targets.forEach(({ key, cell }) => {
      if (state.cells.has(key)) return;
      const [x, , z] = key.split(',').map(Number);
      if (!_inFootprint(x, z)) return;
      state.cells.set(key, cell);
      placedKeys.push(key);
    });
    if (!placedKeys.length) return false;
    state.placingMultiGhost = null;
    state.selection = new Set(placedKeys);
    _markDirty();
    _refreshUI();
    return true;
  }

  function rotateMultiGhost(delta) {
    const mg = state.placingMultiGhost;
    if (!mg) return;
    mg.rotation = (mg.rotation + delta + 4) % 4;
    if (window.Scene) window.Scene.markDirty();
  }

  function shiftMultiGhostLevel(delta) {
    const mg = state.placingMultiGhost;
    if (!mg) return;
    const minDY = Math.min(...mg.cells.map(c => c.dy));
    if (delta < 0 && minDY + delta < 0) return;
    mg.cells.forEach(c => { c.dy += delta; });
    if (window.Scene) window.Scene.markDirty();
  }

  function cycleMultiGhostAnchor() {
    const mg = state.placingMultiGhost;
    if (!mg) return;
    mg.anchorIdx = (mg.anchorIdx + 1) % 4;
    if (window.Scene) window.Scene.markDirty();
  }

  /*
   * Rotation: CW 90° per step around Y: (dx, dz) → (dz, -dx).
   * Anchor corners (after rotation, XZ bounding box):
   *   0 = (rxMin, rzMin)  1 = (rxMax, rzMin)
   *   2 = (rxMax, rzMax)  3 = (rxMin, rzMax)
   */
  function _multiGhostTargets(mg, originX, originZ) {
    if (!mg) return null;
    const { cells, anchorIdx, rotation } = mg;

    const rotated = cells.map(c => {
      let dx = c.dx, dz = c.dz;
      for (let r = 0; r < rotation; r++) { const t = dx; dx = dz; dz = -t; }
      return { ...c, rdx: dx, rdz: dz };
    });

    const rxMin = Math.min(...rotated.map(c => c.rdx));
    const rxMax = Math.max(...rotated.map(c => c.rdx));
    const rzMin = Math.min(...rotated.map(c => c.rdz));
    const rzMax = Math.max(...rotated.map(c => c.rdz));

    const corners = [[rxMin, rzMin], [rxMax, rzMin], [rxMax, rzMax], [rxMin, rzMax]];
    const [anchorDX, anchorDZ] = corners[anchorIdx];

    const _DIR_CW = { N: 'W', W: 'S', S: 'E', E: 'N' };
    return rotated.map(c => {
      let dir = c.direction;
      if (dir) {
        for (let r = 0; r < rotation; r++) dir = _DIR_CW[dir];
      }
      return {
        key:  `${originX + c.rdx - anchorDX},${c.dy},${originZ + c.rdz - anchorDZ}`,
        cell: { object: c.object, direction: dir, colorId: c.colorId },
      };
    });
  }

  function multiGhostValid(originX, originZ) {
    const mg = state.placingMultiGhost;
    if (!mg) return false;
    const targets = _multiGhostTargets(mg, originX, originZ);
    if (!targets || !targets.length) return false;
    if (mg.isStamp) {
      // Stamp: red if any target cell is occupied or out of footprint
      return targets.every(({ key }) => {
        if (state.cells.has(key)) return false;
        const [x, , z] = key.split(',').map(Number);
        return _inFootprint(x, z);
      });
    }
    // Multi-ghost: red only when every target cell is occupied
    return targets.some(({ key }) => {
      if (state.cells.has(key)) return false;
      const [x, , z] = key.split(',').map(Number);
      return _inFootprint(x, z);
    });
  }

  function getMultiGhostTargets(originX, originZ) {
    return _multiGhostTargets(state.placingMultiGhost, originX, originZ);
  }

  // ── Stamps ────────────────────────────────────────────────────────
  async function loadStamps() {
    try {
      const { data, error } = await window._sb
        .from('stamps')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      state.stamps = data || [];
      _refreshUI();
    } catch (err) {
      if (window.UI) window.UI.showError('Failed to load stamps: ' + err.message);
    }
  }

  function getStampByName(name) {
    return state.stamps.find(s => s.name === name) || null;
  }

  async function saveStamp(name, overwrite) {
    if (!state.selection.size) return;
    const keys   = [...state.selection];
    const coords = keys.map(k => k.split(',').map(Number));
    const minX   = Math.min(...coords.map(c => c[0]));
    const minY   = Math.min(...coords.map(c => c[1]));
    const minZ   = Math.min(...coords.map(c => c[2]));
    const cells  = keys.map((k, i) => {
      const [x, y, z] = coords[i];
      const cell = state.cells.get(k);
      return { x: x - minX, y: y - minY, z: z - minZ,
               object: cell.object, direction: cell.direction, colorId: cell.colorId };
    });
    try {
      if (overwrite) {
        const existing = getStampByName(name);
        if (existing) {
          const { data, error } = await window._sb
            .from('stamps')
            .update({ data: { cells }, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select()
            .single();
          if (error) throw error;
          const idx = state.stamps.findIndex(s => s.id === existing.id);
          if (idx !== -1) state.stamps[idx] = data;
          _refreshUI();
          return;
        }
      }
      const { data, error } = await window._sb
        .from('stamps')
        .insert({ name, data: { cells } })
        .select()
        .single();
      if (error) throw error;
      state.stamps.unshift(data);
      _refreshUI();
    } catch (err) {
      window.UI.showError('Failed to save stamp: ' + err.message);
    }
  }

  function activateStampPlacement(stamp) {
    if (!stamp || !stamp.data || !stamp.data.cells || !stamp.data.cells.length) return;
    if (state.placingMultiGhost) {
      const { pickUpKeys } = state.placingMultiGhost;
      if (pickUpKeys) {
        pickUpKeys.forEach(({ key, cell }) => state.cells.set(key, cell));
        _markDirty();
      }
    }
    state.selection.clear();
    const cells = stamp.data.cells.map(c => ({
      dx: c.x, dy: c.y, dz: c.z,
      object: c.object, direction: c.direction, colorId: c.colorId,
    }));
    state.placingMultiGhost = {
      cells,
      anchorIdx:  0,
      rotation:   0,
      pickUpKeys: null,
      isStamp:    true,
    };
    _refreshUI();
  }

  async function deleteStamp(id) {
    try {
      const { error } = await window._sb.from('stamps').delete().eq('id', id);
      if (error) throw error;
      state.stamps = state.stamps.filter(s => s.id !== id);
      _refreshUI();
    } catch (err) {
      window.UI.showError('Failed to delete stamp: ' + err.message);
    }
  }

  // ── Settings ─────────────────────────────────────────────────────
  const _SETTINGS_KEY = 'bdt_settings';
  const _SETTINGS_DEFAULTS = { panSpeed: 0.15, rotateSpeed: 1.00, zoomSpeed: 1.00, uiScale: 1.0 };

  function getSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(_SETTINGS_KEY) || 'null');
      return Object.assign({}, _SETTINGS_DEFAULTS, stored || {});
    } catch (_) {
      return Object.assign({}, _SETTINGS_DEFAULTS);
    }
  }

  function saveSettings(patch) {
    const current = getSettings();
    const updated = Object.assign(current, patch);
    try { localStorage.setItem(_SETTINGS_KEY, JSON.stringify(updated)); } catch (_) {}
    if (window.Scene) window.Scene.applySettings(updated);
    if (patch.uiScale !== undefined && window.UI) window.UI.applyUiScale(updated.uiScale);
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    state.building        = [{ bx: 0, bz: 0 }];
    state.cells           = new Map();
    state.colors          = DEFAULT_COLOURS.map(c => ({ ...c }));
    state.project         = null;
    state.tool            = 'build';
    state.selectedObject  = 'cube';
    state.placeDirection  = 'N';
    state.selectedColorId = 0;
    state.selection       = new Set();
    state.placingMultiGhost = null;
    state.stamps          = [];
    _nextColorId          = DEFAULT_COLOURS.length;
    loadStamps();
  }

  // ── Public API ─────────────────────────────────────────────────
  window.App = {
    state,
    setTool, setSelectedObject, setPlaceDirection, rotatePlaceDirection, setColor, setShowPlacementGhost,
    addColor, updateColor, deleteColor, getColorHex,
    placeCell, deleteCell,
    addToSelection, removeFromSelection, clearSelection, deleteSelection, repaintCells,
    startMultiGhost, cancelMultiGhost, commitMultiGhost,
    rotateMultiGhost, cycleMultiGhostAnchor, shiftMultiGhostLevel, multiGhostValid, getMultiGhostTargets,
    addBlock, removeBlock, blockHasContent, canRemoveBlock, footprintLabel,
    loadActiveProject, loadProject, createFirstProject,
    saveProject, saveProjectOverwrite, fetchNamedProjects, deleteProject, isCurrentProjectNamed,
    loadStamps, saveStamp, deleteStamp, getStampByName, activateStampPlacement,
    getSettings, saveSettings,
    init,
    _serialize, _deserialize,
  };

}());
