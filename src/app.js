/* app.js — state, mutations, Supabase persistence, init. */
/* v2 — pieces + connections graph replaces cells Map.      */
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

  let _nextColorId  = DEFAULT_COLOURS.length;
  let _nextPieceId  = 0;
  let _autosaveTimer = null;

  const state = {
    // persisted
    building:    [{ bx: 0, bz: 0 }],
    pieces:      new Map(),   // Map<pieceId, { id, type, position:{x,y,z}, rotationIndex, colorId }>
    connections: new Map(),   // Map<pieceId, Array<{ faceIndex, connectedPieceId, connectedFaceIndex }>>
    colors:      DEFAULT_COLOURS.map(c => ({ ...c })),
    project:     null,        // { id, name, isNamed }

    // editor-only
    tool:               'build',
    selectedObject:     'square',
    selectedColorId:    0,
    selection:          new Set(),
    showPlacementGhost: true,
    ghost:              null,
    xray:               false,
    placingStamp:       null,
    stamps:             [],   // local cache of Supabase stamps table
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
      pieces: [...state.pieces.values()].map(p => ({
        id:            p.id,
        type:          p.type,
        position:      { x: p.position.x, y: p.position.y, z: p.position.z },
        rotationIndex: p.rotationIndex,
        colorId:       p.colorId,
      })),
      connections: [...state.connections.entries()].map(([pieceId, edges]) => ({
        pieceId,
        edges: edges.map(e => ({
          faceIndex:          e.faceIndex,
          connectedPieceId:   e.connectedPieceId,
          connectedFaceIndex: e.connectedFaceIndex,
        })),
      })),
      colors: state.colors,
    };
  }

  function _deserialize(data) {
    if (!data) return;
    state.building = (data.building && data.building.length > 0) ? data.building : [{ bx: 0, bz: 0 }];

    state.pieces = new Map();
    (data.pieces || []).forEach(p => {
      if (!['square', 'triangle'].includes(p.type)) return;
      state.pieces.set(p.id, {
        id:            p.id,
        type:          p.type,
        position:      { x: p.position.x, y: p.position.y, z: p.position.z },
        rotationIndex: p.rotationIndex,
        colorId:       p.colorId,
      });
    });

    state.connections = new Map();
    (data.connections || []).forEach(({ pieceId, edges }) => {
      if (!state.pieces.has(pieceId)) return;
      state.connections.set(pieceId, (edges || []).filter(e =>
        state.pieces.has(e.connectedPieceId)
      ).map(e => ({
        faceIndex:          e.faceIndex,
        connectedPieceId:   e.connectedPieceId,
        connectedFaceIndex: e.connectedFaceIndex,
      })));
    });

    state.colors             = data.colors || DEFAULT_COLOURS.map(c => ({ ...c }));
    _nextColorId             = state.colors.reduce((m, c) => Math.max(m, c.id), -1) + 1;
    _nextPieceId             = (data.pieces || []).reduce((m, p) => Math.max(m, p.id), -1) + 1;
    state.selectedColorId    = state.colors[0]?.id ?? 0;
    state.selection          = new Set();
    state.tool               = 'build';
    state.selectedObject     = 'square';
    state.showPlacementGhost = true;
    state.ghost              = null;
    state.xray               = false;
    state.placingStamp       = null;
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

  function setColor(id) {
    state.selectedColorId = id;
    _refreshUI();
  }

  function setShowPlacementGhost(val) {
    state.showPlacementGhost = val;
    _refreshUI();
  }

  // ── Colour management -------------------
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
    state.pieces.forEach(piece => { if (piece.colorId === id) piece.colorId = 0; });
    if (state.selectedColorId === id) state.selectedColorId = 0;
    _markDirty();
    _refreshUI();
  }

  function getColorHex(id) {
    const colour = state.colors.find(c => c.id === id);
    return colour ? colour.hex : state.colors[0].hex;
  }

  // ── Cell placement ---------------------------
  // ── Piece mutations ────────────────────────────────────────────
  /*
   * placePiece({ type, position, rotationIndex, colorId?,
   *              attachToPieceId?, attachFaceIndex?, selfFaceIndex? })
   *
   * Inserts a new piece and, if attachment params are supplied, records
   * the bidirectional connection. Returns the new piece's id, or null if
   * the attachment target is unknown.
   */
  function placePiece({ type, position, rotationIndex, colorId, attachToPieceId, attachFaceIndex, selfFaceIndex }) {
    if (attachToPieceId !== undefined && !state.pieces.has(attachToPieceId)) return null;

    const id = _nextPieceId++;
    state.pieces.set(id, {
      id,
      type,
      position: { x: position.x, y: position.y, z: position.z },
      rotationIndex: rotationIndex ?? 0,
      colorId: colorId ?? state.selectedColorId,
    });

    if (attachToPieceId !== undefined && attachFaceIndex !== undefined && selfFaceIndex !== undefined) {
      if (!state.connections.has(id)) state.connections.set(id, []);
      state.connections.get(id).push({
        faceIndex:          selfFaceIndex,
        connectedPieceId:   attachToPieceId,
        connectedFaceIndex: attachFaceIndex,
      });
      if (!state.connections.has(attachToPieceId)) state.connections.set(attachToPieceId, []);
      state.connections.get(attachToPieceId).push({
        faceIndex:          attachFaceIndex,
        connectedPieceId:   id,
        connectedFaceIndex: selfFaceIndex,
      });
    }

    _markDirty();
    return id;
  }

  /*
   * deletePiece(id)
   *
   * Removes the piece and all edges that reference it. Orphaned neighbours
   * stay in place — their other connections are preserved.
   */
  function deletePiece(id) {
    if (!state.pieces.has(id)) return false;
    const edges = state.connections.get(id) || [];
    edges.forEach(({ connectedPieceId }) => {
      const nb = state.connections.get(connectedPieceId);
      if (!nb) return;
      const filtered = nb.filter(e => e.connectedPieceId !== id);
      if (filtered.length) state.connections.set(connectedPieceId, filtered);
      else state.connections.delete(connectedPieceId);
    });
    state.connections.delete(id);
    state.pieces.delete(id);
    state.selection.delete(id);
    _markDirty();
    return true;
  }

  /* getPiece(id) → piece | undefined */
  function getPiece(id) { return state.pieces.get(id); }

  // ── Selection ──────────────────────────────────────────────────
  function _markSceneDirty() { if (window.Scene) window.Scene.markDirty(); _refreshUI(); }

  function addToSelection(id)      { state.selection.add(id);    _markSceneDirty(); }
  function removeFromSelection(id) { state.selection.delete(id); _markSceneDirty(); }
  function clearSelection()        { if (state.selection.size) { state.selection.clear(); _markSceneDirty(); } }

  // ── Footprint ──────────────────────────────────────────────────
  function _inFootprint(x, z) {
    const bx = Math.floor(x / 10);
    const bz = Math.floor(z / 10);
    return state.building.some(b => b.bx === bx && b.bz === bz);
  }

  function _blockHasContent(bx, bz) {
    for (const piece of state.pieces.values()) {
      if (Math.floor(piece.position.x / 10) === bx &&
          Math.floor(piece.position.z / 10) === bz) return true;
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
      for (const piece of [...state.pieces.values()]) {
        if (Math.floor(piece.position.x / 10) === bx &&
            Math.floor(piece.position.z / 10) === bz) {
          deletePiece(piece.id);
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

  // ── Ghost (v2 placeholder — implemented in Step 3+) ───────────
  function setGhost(ghost) {
    state.ghost = ghost;
    if (window.Scene) window.Scene.markDirty();
  }

  function clearGhost() {
    state.ghost = null;
    if (window.Scene) window.Scene.markDirty();
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
    // v2 stamp format: subgraph of pieces + connections
    if (!state.selection.size) return;
    const ids         = [...state.selection];
    const idSet       = new Set(ids);
    const pieces      = ids.map(id => ({ ...state.pieces.get(id) }));
    const connections = ids.map(id => ({
      pieceId: id,
      edges: (state.connections.get(id) || []).filter(e => idSet.has(e.connectedPieceId)),
    }));
    try {
      if (overwrite) {
        const existing = getStampByName(name);
        if (existing) {
          const { data, error } = await window._sb
            .from('stamps')
            .update({ data: { pieces, connections }, updated_at: new Date().toISOString() })
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
        .insert({ name, data: { pieces, connections } })
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
    // v2 stub — full implementation in Step 9
    if (!stamp) return;
    state.placingStamp = stamp;
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
    state.pieces          = new Map();
    state.connections     = new Map();
    state.colors          = DEFAULT_COLOURS.map(c => ({ ...c }));
    state.project         = null;
    state.tool            = 'build';
    state.selectedObject  = 'square';
    state.selectedColorId = 0;
    state.selection       = new Set();
    state.showPlacementGhost = true;
    state.ghost           = null;
    state.xray            = false;
    state.placingStamp    = null;
    state.stamps          = [];
    _nextColorId          = DEFAULT_COLOURS.length;
    _nextPieceId          = 0;
    loadStamps();
  }

  // ── Public API ─────────────────────────────────────────────────
  window.App = {
    state,
    setTool, setSelectedObject, setColor, setShowPlacementGhost,
    addColor, updateColor, deleteColor, getColorHex,
    placePiece, deletePiece, getPiece,
    addToSelection, removeFromSelection, clearSelection,
    setGhost, clearGhost,
    addBlock, removeBlock, blockHasContent, canRemoveBlock, footprintLabel,
    loadActiveProject, loadProject, createFirstProject,
    saveProject, saveProjectOverwrite, fetchNamedProjects, deleteProject, isCurrentProjectNamed,
    loadStamps, saveStamp, deleteStamp, getStampByName, activateStampPlacement,
    getSettings, saveSettings,
    init,
  };

}());
