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
    walls:           new Map(),
    colors:          DEFAULT_COLOURS.map(c => ({ ...c })),
    project:         null,   // { id, name, isNamed }

    // editor-only
    tool:            'build',
    selectedObject:  'cube',
    placeDirection:  'N',
    selectedColorId: 0,
    selection:       new Set(),
  };

  // Supabase client
  window._sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── Internal helpers ───────────────────────────────────────────
  function _markDirty() {
    if (window.Scene) window.Scene.markDirty();
    _scheduleAutosave();
  }

  function _refreshUI() {
    if (window.UI) window.UI.refresh();
  }

  // ── Autosave ───────────────────────────────────────────────────
  function _scheduleAutosave() {
    if (!state.project) return;
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(_autosave, 2000);
  }

  async function _autosave() {
    if (!state.project) return;
    try {
      const thumbnail = window.Scene ? window.Scene.getSnapshot() : null;
      await window._sb.from('projects').upsert({
        id:       state.project.id,
        name:     state.project.name,
        is_named: state.project.isNamed,
        data:     _serialize(),
        thumbnail,
      }, { onConflict: 'id' });
    } catch (_) {
      // autosave is silent — spec: "no indicator shown"
    }
  }

  // ── Serialise / deserialise ────────────────────────────────────
  function _serialize() {
    return {
      building: state.building,
      cells: [...state.cells.entries()].map(([key, cell]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, object: cell.object, direction: cell.direction, colorId: cell.colorId };
      }),
      walls: [...state.walls.entries()].map(([key, wall]) => {
        const [x, y, z, edge] = key.split(',');
        return { x: +x, y: +y, z: +z, edge, type: wall.type, colorId: wall.colorId };
      }),
      colors: state.colors,
    };
  }

  function _deserialize(data) {
    if (!data) return;
    state.building = (data.building && data.building.length > 0) ? data.building : [{ bx: 0, bz: 0 }];
    state.cells    = new Map();
    (data.cells || []).forEach(({ x, y, z, object, direction, colorId }) => {
      state.cells.set(`${x},${y},${z}`, { object, direction, colorId });
    });
    state.walls    = new Map();
    (data.walls || []).forEach(({ x, y, z, edge, type, colorId }) => {
      state.walls.set(`${x},${y},${z},${edge}`, { type, colorId });
    });
    state.colors  = data.colors || DEFAULT_COLOURS.map(c => ({ ...c }));
    _nextColorId  = state.colors.reduce((m, c) => Math.max(m, c.id), -1) + 1;
    state.selectedColorId = state.colors[0]?.id ?? 0;
    state.walls           = new Map();
    state.selection       = new Set();
    state.tool            = 'build';
    state.selectedObject  = 'cube';
    state.placeDirection  = 'N';
  }

  // ── Tool / object / colour ─────────────────────────────────────
  function setTool(tool) {
    if (state.tool === tool) return;
    state.tool = tool;
    state.selection.clear();
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

  // ── Colour management ──────────────────────────────────────────
  function addColor(hex) {
    const id = _nextColorId++;
    state.colors.push({ id, hex });
    _scheduleAutosave();
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
    const isIncline = ['stair-solid','stair-thin','wedge-solid','wedge-thin'].includes(state.selectedObject);
    state.cells.set(key, {
      object:    state.selectedObject,
      direction: isIncline ? state.placeDirection : null,
      colorId:   state.selectedColorId,
    });
    _markDirty();
    return true;
  }

  // ── Wall placement ─────────────────────────────────────────────
  // wallKey is canonical: "x,y,z,N" or "x,y,z,W"
  function placeWall(wallKey) {
    if (state.walls.has(wallKey)) return false;
    const [x, y, z] = wallKey.split(',').map(Number);
    if (!_inFootprint(x, z)) return false;
    state.walls.set(wallKey, { type: state.selectedObject, colorId: state.selectedColorId });
    _markDirty();
    return true;
  }

  function deleteWall(wallKey) {
    if (!state.walls.has(wallKey)) return false;
    state.walls.delete(wallKey);
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
  function addToSelection(key) { state.selection.add(key);    _refreshUI(); }
  function removeFromSelection(key) { state.selection.delete(key); _refreshUI(); }
  function clearSelection() { if (state.selection.size) { state.selection.clear(); _refreshUI(); } }

  function deleteSelection() {
    state.selection.forEach(key => state.cells.delete(key));
    state.selection.clear();
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
      for (const key of [...state.walls.keys()]) {
        const [wx, , wz] = key.split(',').map(Number);
        if (Math.floor(wx / 10) === bx && Math.floor(wz / 10) === bz) {
          state.walls.delete(key);
        }
      }
    }
    _markDirty();
    _refreshUI();
    return { ok: true, hadContent };
  }

  function blockHasContent(bx, bz)  { return _blockHasContent(bx, bz); }
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
    try {
      const { data, error } = await window._sb
        .from('app_state')
        .select('value')
        .eq('key', 'active_project_id')
        .maybeSingle();
      if (error) throw error;
      if (!data?.value) { window.UI.showFirstRunModal(); return; }
      await loadProject(data.value);
    } catch (_) {
      window.UI.showFirstRunModal();
    }
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

  // ── Init — resets state; loadActiveProject called from UI.init ─
  function init() {
    state.building        = [{ bx: 0, bz: 0 }];
    state.cells           = new Map();
    state.walls           = new Map();
    state.colors          = DEFAULT_COLOURS.map(c => ({ ...c }));
    state.project         = null;
    state.tool            = 'build';
    state.selectedObject  = 'cube';
    state.placeDirection  = 'N';
    state.selectedColorId = 0;
    state.selection       = new Set();
    _nextColorId          = DEFAULT_COLOURS.length;
  }

  // ── Public API ─────────────────────────────────────────────────
  window.App = {
    state,
    setTool, setSelectedObject, setPlaceDirection, rotatePlaceDirection, setColor,
    addColor, updateColor, deleteColor, getColorHex,
    placeCell, deleteCell, placeWall, deleteWall,
    addToSelection, removeFromSelection, clearSelection, deleteSelection,
    addBlock, removeBlock, blockHasContent, canRemoveBlock, footprintLabel,
    loadActiveProject, loadProject, createFirstProject,
    saveProject, fetchNamedProjects, deleteProject, isCurrentProjectNamed,
    init,
  };

}());
