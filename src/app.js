/* app.js — state, mutations, init. No Supabase (Step 2). */
(function () {

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

  let _nextColorId = DEFAULT_COLOURS.length;

  const state = {
    // persisted
    building:       [{ bx: 0, bz: 0 }],
    cells:          new Map(),   // key "x,y,z" → { object, direction, colorId }
    colors:         DEFAULT_COLOURS.map(c => ({ ...c })),
    project:        null,        // { id, name } — populated in Step 2

    // editor-only
    tool:           'build',
    selectedObject: 'cube',
    selectedColorId: 0,
    selection:      new Set(),   // Set of cell keys
  };

  // ── Internal helpers ───────────────────────────────────────────
  function _markDirty() {
    if (window.Scene) window.Scene.markDirty();
  }

  function _refreshUI() {
    if (window.UI) window.UI.refresh();
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
        const nb = `${bx + dx},${bz + dz}`;
        if (set.has(nb) && !visited.has(nb)) queue.push(nb);
      }
    }
    return visited.size === blocks.length;
  }

  function _inFootprint(x, z) {
    const bx = Math.floor(x / 10);
    const bz = Math.floor(z / 10);
    return state.building.some(b => b.bx === bx && b.bz === bz);
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

  function setColor(id) {
    state.selectedColorId = id;
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
    if (id === 0) return; // default is protected
    const idx = state.colors.findIndex(c => c.id === id);
    if (idx === -1) return;
    state.colors.splice(idx, 1);
    // cells using this colour fall back to the default
    state.cells.forEach(cell => {
      if (cell.colorId === id) cell.colorId = 0;
    });
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
    if (state.cells.has(key)) return false; // no overwrite
    if (!_inFootprint(x, z)) return false;
    state.cells.set(key, {
      object:    state.selectedObject,
      direction: null,
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
  function addToSelection(key) {
    state.selection.add(key);
    _refreshUI();
  }

  function removeFromSelection(key) {
    state.selection.delete(key);
    _refreshUI();
  }

  function clearSelection() {
    if (state.selection.size === 0) return;
    state.selection.clear();
    _refreshUI();
  }

  function deleteSelection() {
    state.selection.forEach(key => state.cells.delete(key));
    state.selection.clear();
    _markDirty();
    _refreshUI();
  }

  // ── Footprint ──────────────────────────────────────────────────
  function addBlock(bx, bz) {
    if (state.building.length >= 6) return false;
    if (state.building.some(b => b.bx === bx && b.bz === bz)) return false;
    // must be adjacent to an existing block
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

  // Returns { ok, reason?, hadContent? }
  // Caller must show danger modal before calling if blockHasContent returns true.
  function removeBlock(bx, bz) {
    const idx = state.building.findIndex(b => b.bx === bx && b.bz === bz);
    if (idx === -1) return { ok: false, reason: 'not-found' };
    const remaining = state.building.filter((_, i) => i !== idx);
    if (remaining.length > 0 && !_isConnected(remaining)) {
      return { ok: false, reason: 'disconnected' };
    }
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

  function blockHasContent(bx, bz) {
    return _blockHasContent(bx, bz);
  }

  function canRemoveBlock(bx, bz) {
    const remaining = state.building.filter(b => !(b.bx === bx && b.bz === bz));
    return remaining.length === 0 || _isConnected(remaining);
  }

  function footprintLabel() {
    const n = state.building.length;
    return `${n} block${n === 1 ? '' : 's'}`;
  }

  // ── Init ───────────────────────────────────────────────────────
  // Called once by ui.js after all scripts are loaded.
  function init() {
    state.building      = [{ bx: 0, bz: 0 }];
    state.cells         = new Map();
    state.colors        = DEFAULT_COLOURS.map(c => ({ ...c }));
    state.project       = null;
    state.tool          = 'build';
    state.selectedObject = 'cube';
    state.selectedColorId = 0;
    state.selection     = new Set();
    _nextColorId        = DEFAULT_COLOURS.length;
  }

  // ── Public API ─────────────────────────────────────────────────
  window.App = {
    state,
    setTool,
    setSelectedObject,
    setColor,
    addColor,
    updateColor,
    deleteColor,
    getColorHex,
    placeCell,
    deleteCell,
    addToSelection,
    removeFromSelection,
    clearSelection,
    deleteSelection,
    addBlock,
    removeBlock,
    blockHasContent,
    canRemoveBlock,
    footprintLabel,
    init,
  };

}());
