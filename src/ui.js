/* ui.js — sidebar, modals, footprint editor, hotkeys, event wiring. */
(function () {

  // ── View state ─────────────────────────────────────────────────
  // 'canvas' | 'setup-screen' | 'footprint-editor' | null (initial loading)
  let _currentView = null;

  function _showView(id) {
    _currentView = id;
    const overlays = ['setup-screen', 'footprint-editor'];
    overlays.forEach(v => {
      const el = document.getElementById(v);
      if (el) el.style.display = (v === id) ? 'flex' : 'none';
    });
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = (id === 'canvas') ? '' : 'none';
    if (id === 'canvas' && window.Scene) window.Scene.markDirty();
  }

  // ── Setup screen ───────────────────────────────────────────────
  function showSetupScreen(projects) {
    _showView('setup-screen');
    const screen = document.getElementById('setup-screen');
    const list   = screen.querySelector('.js-project-list');
    list.innerHTML = '';

    projects.forEach(proj => list.appendChild(_buildSetupItem(proj)));

    screen.querySelector('.js-start-fresh').onclick = async () => {
      await App.createFirstProject('Untitled');
      showFootprintEditor();
    };
  }

  function _buildSetupItem(proj) {
    const item = document.createElement('div');
    item.className = 'project-item';

    if (proj.thumbnail) {
      const img = document.createElement('img');
      img.className = 'project-thumbnail';
      img.src       = proj.thumbnail;
      img.alt       = '';
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className  = 'project-thumbnail project-thumbnail--empty';
      ph.textContent = '□';
      item.appendChild(ph);
    }

    const info   = document.createElement('div');
    info.className = 'project-item-info';
    const nameEl = document.createElement('div');
    nameEl.className  = 'project-item-name';
    nameEl.textContent = proj.name;
    const dateEl = document.createElement('div');
    dateEl.className  = 'project-item-date';
    dateEl.textContent = _relativeDate(proj.updated_at);
    info.append(nameEl, dateEl);
    item.appendChild(info);

    item.addEventListener('click', async () => {
      await App.loadProject(proj.id);
      _showView('canvas');
    });

    return item;
  }

  // ── Footprint editor ───────────────────────────────────────────
  function showFootprintEditor() {
    _showView('footprint-editor');
    _buildFootprintGrid(document.getElementById('block-grid'));
  }

  // Called by App.loadActiveProject when there is no active project.
  // Fetches named projects; shows setup screen if any exist, otherwise
  // silently creates an untitled project and opens the footprint builder.
  async function showFirstRunModal() {
    try {
      const projects = await App.fetchNamedProjects();
      if (projects.length > 0) {
        showSetupScreen(projects);
      } else {
        await App.createFirstProject('Untitled');
        showFootprintEditor();
      }
    } catch (_) {
      showError('Failed to connect. Please refresh.');
    }
  }

  // ── Modal state ────────────────────────────────────────────────
  let _activeModal = null;
  let _errorTimer  = null;

  function _openModal(templateId) {
    if (_activeModal) _closeModal();
    const tmpl    = document.getElementById(templateId);
    const overlay = tmpl.content.cloneNode(true).querySelector('.modal-overlay');
    document.body.appendChild(overlay);
    _activeModal  = overlay;
    if (!overlay.classList.contains('modal-overlay--locked')) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) _closeModal();
      });
    }
    return overlay;
  }

  function _closeModal() {
    if (_activeModal) { _activeModal.remove(); _activeModal = null; }
  }

  // ── Danger modal ───────────────────────────────────────────────
  function showDangerModal(message, onConfirm) {
    const overlay = _openModal('tmpl-modal-danger');
    overlay.querySelector('.js-danger-message').textContent = message;
    overlay.querySelector('.js-modal-cancel').addEventListener('click', _closeModal);
    overlay.querySelector('.js-modal-confirm').addEventListener('click', () => {
      _closeModal();
      onConfirm();
    });
  }

  // ── Error banner ───────────────────────────────────────────────
  function showError(msg) {
    const banner = document.getElementById('error-banner');
    banner.textContent = msg;
    banner.classList.add('visible');
    clearTimeout(_errorTimer);
    _errorTimer = setTimeout(() => banner.classList.remove('visible'), 4500);
  }

  // ── Colour modal ───────────────────────────────────────────────
  function _showColourModal(title, initialHex, onApply) {
    const overlay = _openModal('tmpl-modal-colour');
    overlay.querySelector('.js-colour-modal-title').textContent = title;
    const input = overlay.querySelector('#colour-picker-input');
    input.value = initialHex;
    overlay.querySelectorAll('.js-modal-close, .js-modal-cancel')
      .forEach(el => el.addEventListener('click', _closeModal));
    overlay.querySelector('.js-colour-confirm').addEventListener('click', () => {
      const hex = input.value;
      _closeModal();
      onApply(hex);
    });
  }

  // ── Save Stamp modal ─────────────────────────────────────────────
  function _showSaveStampModal() {
    const overlay = _openModal('tmpl-modal-save-stamp');
    const input   = overlay.querySelector('.js-stamp-name');
    const btn     = overlay.querySelector('.js-stamp-confirm');

    btn.disabled = true;
    input.addEventListener('input', () => {
      btn.disabled = input.value.trim().length === 0;
    });

    overlay.querySelectorAll('.js-modal-close')
      .forEach(el => el.addEventListener('click', _closeModal));

    btn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      btn.disabled    = true;
      btn.textContent = 'Saving…';
      _closeModal();
      await App.saveStamp(name);
    });

    setTimeout(() => input.focus(), 60);
  }

  // ── Stamp list ────────────────────────────────────────────────────
  function _renderStampList() {
    const list = document.getElementById('stamp-list');
    if (!list) return;
    list.innerHTML = '';
    const stamps = App.state.stamps;
    if (!stamps.length) {
      const empty = document.createElement('p');
      empty.className  = 'sidebar-readout';
      empty.textContent = 'No stamps yet.';
      list.appendChild(empty);
      return;
    }
    stamps.forEach(stamp => {
      const item = document.createElement('div');
      item.className   = 'stamp-item';
      const label = document.createElement('span');
      label.className  = 'stamp-item-name';
      label.textContent = stamp.name;
      item.appendChild(label);
      list.appendChild(item);
    });
  }

  // ── Settings modal
  function _showSettingsModal() {
    const overlay = _openModal('tmpl-modal-settings');
    overlay.querySelectorAll('.js-modal-close').forEach(el => el.addEventListener('click', _closeModal));

    // Apply current UI scale to the modal box itself
    const scale = App.getSettings().uiScale;
    const box = overlay.querySelector('.modal-box');
    if (box) box.style.zoom = scale;

    const settings = App.getSettings();
    const sliders = [
      { id: 'settings-pan-speed',    key: 'panSpeed',    min: 0.02, max: 0.40, step: 0.01 },
      { id: 'settings-rotate-speed', key: 'rotateSpeed', min: 0.20, max: 3.00, step: 0.05 },
      { id: 'settings-zoom-speed',   key: 'zoomSpeed',   min: 0.20, max: 3.00, step: 0.05 },
      { id: 'settings-ui-scale',     key: 'uiScale',     min: 0.50, max: 2.00, step: 0.05 },
    ];

    sliders.forEach(({ id, key, min, max, step }) => {
      const input  = overlay.querySelector(`#${id}`);
      const valEl  = overlay.querySelector(`#${id}-value`);
      if (!input || !valEl) return;
      input.min    = min;
      input.max    = max;
      input.step   = step;
      input.value  = settings[key];
      valEl.textContent = Number(settings[key]).toFixed(2);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        valEl.textContent = v.toFixed(2);
        App.saveSettings({ [key]: v });
      });
    });
  }

  // ── Save Project modal ─────────────────────────────────────────
  function _showSaveProjectModal() {
    const overlay = _openModal('tmpl-modal-save-project');
    const input   = overlay.querySelector('.js-project-name');
    const btn     = overlay.querySelector('.js-save-confirm');

    if (App.state.project?.name) input.value = App.state.project.name;
    btn.disabled = input.value.trim().length === 0;

    input.addEventListener('input', () => {
      btn.disabled = input.value.trim().length === 0;
    });

    overlay.querySelectorAll('.js-modal-close')
      .forEach(el => el.addEventListener('click', _closeModal));

    btn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      btn.disabled    = true;
      btn.textContent = 'Saving…';
      _closeModal();
      await App.saveProject(name);
    });

    setTimeout(() => { input.focus(); input.select(); }, 60);
  }

  // ── Load Project modal ─────────────────────────────────────────
  async function _showLoadProjectModal() {
    const overlay = _openModal('tmpl-modal-load-project');
    overlay.querySelectorAll('.js-modal-close')
      .forEach(el => el.addEventListener('click', _closeModal));

    const list = overlay.querySelector('.js-project-list');
    list.innerHTML = '<p class="project-list-empty">Loading…</p>';

    try {
      const projects = await App.fetchNamedProjects();
      list.innerHTML  = '';

      if (!projects.length) {
        list.innerHTML = '<p class="project-list-empty">No saved projects yet.</p>';
        return;
      }

      projects.forEach(proj => list.appendChild(_buildProjectItem(proj, list)));
    } catch (_) {
      list.innerHTML = '<p class="project-list-empty">Failed to load projects.</p>';
    }
  }

  function _buildProjectItem(proj, list) {
    const item = document.createElement('div');
    item.className = 'project-item';

    if (proj.thumbnail) {
      const img = document.createElement('img');
      img.className = 'project-thumbnail';
      img.src       = proj.thumbnail;
      img.alt       = '';
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className  = 'project-thumbnail project-thumbnail--empty';
      ph.textContent = '□';
      item.appendChild(ph);
    }

    const info   = document.createElement('div');
    info.className = 'project-item-info';
    const nameEl = document.createElement('div');
    nameEl.className  = 'project-item-name';
    nameEl.textContent = proj.name;
    const dateEl = document.createElement('div');
    dateEl.className  = 'project-item-date';
    dateEl.textContent = _relativeDate(proj.updated_at);
    info.append(nameEl, dateEl);
    item.appendChild(info);

    const del = document.createElement('button');
    del.className  = 'project-item-delete';
    del.textContent = '×';
    del.title      = 'Delete project';
    del.addEventListener('click', e => {
      e.stopPropagation();
      showDangerModal(
        `Delete "${proj.name}"? This cannot be undone.`,
        async () => {
          try {
            await App.deleteProject(proj.id);
            item.remove();
            if (!list.querySelector('.project-item')) {
              list.innerHTML = '<p class="project-list-empty">No saved projects yet.</p>';
            }
          } catch (_) { showError('Failed to delete project.'); }
        }
      );
    });
    item.appendChild(del);

    item.addEventListener('click', async () => {
      _closeModal();
      await App.loadProject(proj.id);
      _showView('canvas');
    });

    return item;
  }

  function _relativeDate(iso) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  // ── Swatches ───────────────────────────────────────────────────
  function _renderSwatches() {
    const container = document.getElementById('colour-swatches');
    container.innerHTML = '';

    App.state.colors.forEach(({ id, hex }) => {
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      if (id === App.state.selectedColorId) swatch.classList.add('active');
      swatch.style.background = hex;
      swatch.title = hex;
      swatch.addEventListener('click', () => App.setColor(id));

      if (id !== 0) {
        const del = document.createElement('button');
        del.className  = 'swatch-delete';
        del.textContent = '×';
        del.title      = 'Delete colour';
        del.addEventListener('click', e => {
          e.stopPropagation();
          showDangerModal(
            'Delete this colour? Objects using it will revert to the default colour.',
            () => App.deleteColor(id)
          );
        });
        swatch.appendChild(del);
      }
      container.appendChild(swatch);
    });
  }

  // ── Tool / object buttons ──────────────────────────────────────
  function _updateToolButtons() {
    const tool = App.state.tool;
    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    if (tool !== 'build' && window.Scene) Scene.setHoverHit(null);
    if (window.Scene) Scene.setAreaSelectMode(tool === 'area-select' || tool === 'paint');
  }

  function _updateSelectionActions() {
    const hasSel = App.state.selection.size > 0;
    const inMG   = !!App.state.placingMultiGhost;
    document.getElementById('selection-actions-bar')
      .classList.toggle('visible', hasSel && !inMG);
    const stampBtn = document.getElementById('btn-save-stamp');
    if (stampBtn) stampBtn.disabled = !hasSel || inMG;
  }

  function _updateObjectButtons() {
    const obj = App.state.selectedObject;
    document.querySelectorAll('.btn-object').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.object === obj);
    });
  }

  const _INCLINE_TYPES = new Set(['stair-solid', 'wedge-solid', 'wedge-solid-inverted']);

  function _updateDirectionHud() {
    const hud  = document.getElementById('hud-direction');
    const isInc = _INCLINE_TYPES.has(App.state.selectedObject);
    hud.hidden = !isInc;
    if (isInc) document.getElementById('hud-direction-value').textContent = App.state.placeDirection;
  }

  // ── Footprint label ────────────────────────────────────────────
  function _updateFootprintLabel() {
    document.getElementById('footprint-size').textContent = App.footprintLabel();
  }

  // ── Footprint editor grid ──────────────────────────────────────
  function _buildFootprintGrid(container) {
    const building  = App.state.building;
    const filledSet = new Set(building.map(b => `${b.bx},${b.bz}`));

    let minBx = 0, maxBx = 0, minBz = 0, maxBz = 0;
    building.forEach(({ bx, bz }) => {
      minBx = Math.min(minBx, bx); maxBx = Math.max(maxBx, bx);
      minBz = Math.min(minBz, bz); maxBz = Math.max(maxBz, bz);
    });
    minBx--; maxBx++; minBz--; maxBz++;

    container.style.gridTemplateColumns = `repeat(${maxBx - minBx + 1}, 60px)`;
    container.innerHTML = '';

    for (let bz = minBz; bz <= maxBz; bz++) {
      for (let bx = minBx; bx <= maxBx; bx++) {
        const key  = `${bx},${bz}`;
        const cell = document.createElement('div');
        cell.className = 'block-cell';

        if (filledSet.has(key)) {
          const hasContent = App.blockHasContent(bx, bz);
          const canRemove  = App.canRemoveBlock(bx, bz);
          cell.classList.add('block-cell--filled');
          if (!canRemove) cell.classList.add('block-cell--locked');

          const removeBtn = document.createElement('button');
          removeBtn.className  = 'block-remove';
          removeBtn.textContent = '✕';
          removeBtn.setAttribute('aria-label', 'Remove block');
          cell.appendChild(removeBtn);

          cell.addEventListener('click', () => {
            if (!App.canRemoveBlock(bx, bz)) return;
            if (hasContent) {
              showDangerModal(
                'This footprint block contains objects. Removing it will delete them permanently.',
                () => { App.removeBlock(bx, bz); _buildFootprintGrid(container); }
              );
            } else {
              App.removeBlock(bx, bz);
              _buildFootprintGrid(container);
            }
          });
        } else {
          const adjacent = building.length === 0
            ? (bx === 0 && bz === 0)
            : [[1,0],[-1,0],[0,1],[0,-1]].some(
                ([dx, dz]) => filledSet.has(`${bx+dx},${bz+dz}`)
              );
          if (adjacent) {
            cell.classList.add('block-cell--ghost');
            cell.addEventListener('click', () => {
              if (App.addBlock(bx, bz)) _buildFootprintGrid(container);
            });
          } else {
            cell.classList.add('block-cell--empty');
          }
        }
        container.appendChild(cell);
      }
    }
  }

  // ── Area select state ───────────────────────────────────────────
  let _asDragging  = false;   // true once drag threshold exceeded
  let _asStartX    = 0;
  let _asStartY    = 0;
  let _asRectEl    = null;

  function _asCreateRect() {
    const el = document.createElement('div');
    el.className = 'area-select-rect';
    document.body.appendChild(el);
    return el;
  }

  function _asUpdateRect(x1, y1, x2, y2) {
    if (!_asRectEl) return;
    _asRectEl.style.left   = Math.min(x1, x2) + 'px';
    _asRectEl.style.top    = Math.min(y1, y2) + 'px';
    _asRectEl.style.width  = Math.abs(x2 - x1) + 'px';
    _asRectEl.style.height = Math.abs(y2 - y1) + 'px';
  }

  function _asRemoveRect() {
    if (_asRectEl) { _asRectEl.remove(); _asRectEl = null; }
    _asDragging = false;
  }

  // ── Viewport hover (placement ghost) ──────────────────────────
  let _lastPlacedKey = null;

  function _onViewportMove(e) {
    if (_currentView !== 'canvas') return;

    // Multi-ghost tracking
    if (App.state.placingMultiGhost) {
      const hit = Scene.pickAt(e.clientX, e.clientY);
      if (hit) {
        // Use targetKey for ground hits, key's neighbour for solid hits
        const refKey = hit.targetKey || hit.key;
        if (refKey) {
          const [gx, , gz] = refKey.split(',').map(Number);
          Scene.setMultiGhostOrigin(gx, gz);
        }
      }
      return;
    }

    if (App.state.tool === 'area-select' && (e.buttons & 1)) {
      const dx = e.clientX - _mouseDownX;
      const dy = e.clientY - _mouseDownY;
      if (!_asDragging && dx * dx + dy * dy > 25) {
        _asDragging = true;
        _asStartX   = _mouseDownX;
        _asStartY   = _mouseDownY;
        _asRectEl   = _asCreateRect();
      }
      if (_asDragging) {
        _asUpdateRect(_asStartX, _asStartY, e.clientX, e.clientY);
      }
      return;
    }

    if (App.state.tool !== 'build') return;
    const hit = Scene.pickAt(e.clientX, e.clientY);
    if (_lastPlacedKey && hit && hit.buildTarget !== _lastPlacedKey) {
      _lastPlacedKey = null;
    }
    const suppressedHit = (_lastPlacedKey && hit && hit.buildTarget === _lastPlacedKey) ? null : hit;
    Scene.setHoverHit(suppressedHit);
  }

  // ── Viewport click handling ────────────────────────────────────
  let _mouseDownX = 0, _mouseDownY = 0;

  function _onViewportPointerDown(e) {
    _mouseDownX = e.clientX;
    _mouseDownY = e.clientY;
    _asDragging = false;
  }

  function _onViewportPointerUp(e) {
    if (_currentView !== 'canvas') return;
    // Right-click (button 2) is camera rotate — never touches selection.
    if (e.button === 2) return;
    if (e.target.closest('#hud')) { _asRemoveRect(); return; }

    // Multi-ghost click to place
    if (App.state.placingMultiGhost) {
      const hit = Scene.pickAt(e.clientX, e.clientY);
      if (hit) {
        const refKey = hit.targetKey || hit.key;
        if (refKey) {
          const [gx, , gz] = refKey.split(',').map(Number);
          App.commitMultiGhost(gx, gz);
          Scene.setMultiGhostOrigin(null, null);
        }
      }
      return;
    }

    if (App.state.tool === 'area-select') {
      if (_asDragging) {
        const keys = Scene.selectInScreenRect(_asStartX, _asStartY, e.clientX, e.clientY);
        _asRemoveRect();
        if (e.shiftKey) {
          keys.forEach(k => {
            App.state.selection.has(k) ? App.removeFromSelection(k) : App.addToSelection(k);
          });
          if (keys.length) Scene.markDirty();
        } else {
          App.clearSelection();
          keys.forEach(k => App.addToSelection(k));
        }
      } else {
        const hit = Scene.pickAt(e.clientX, e.clientY);
        if (hit && hit.key) {
          if (e.shiftKey) {
            App.state.selection.has(hit.key)
              ? App.removeFromSelection(hit.key)
              : App.addToSelection(hit.key);
          } else {
            App.clearSelection();
            App.addToSelection(hit.key);
          }
        } else if (!e.shiftKey) {
          App.clearSelection();
        }
      }
      return;
    }

    _asRemoveRect();

    const dx = e.clientX - _mouseDownX;
    const dy = e.clientY - _mouseDownY;
    if (dx * dx + dy * dy > 25) return;

    const hit  = Scene.pickAt(e.clientX, e.clientY);
    if (!hit) return;
    const tool = App.state.tool;

    if (tool === 'build') {
      if (hit.buildTarget) {
        const [x, y, z] = hit.buildTarget.split(',').map(Number);
        App.placeCell(x, y, z);
        _lastPlacedKey = hit.buildTarget;
      }
    } else if (tool === 'delete') {
      if (hit.key) {
        const [x, y, z] = hit.key.split(',').map(Number);
        App.deleteCell(x, y, z);
      }
    } else if (tool === 'select') {
      if (hit.key) {
        if (e.shiftKey) {
          App.state.selection.has(hit.key)
            ? App.removeFromSelection(hit.key)
            : App.addToSelection(hit.key);
        } else {
          App.clearSelection();
          App.addToSelection(hit.key);
        }
      } else if (!e.shiftKey) {
        App.clearSelection();
      }
    } else if (tool === 'paint') {
      if (hit.key) {
        App.repaintCells([hit.key], App.state.selectedColorId);
      }
    }
  }

  // ── Hotkeys ────────────────────────────────────────────────────
  function _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'b': case 'B': App.setTool('build');  break;
      case 'r': case 'R': App.setTool('select'); break;
      case 'q': case 'Q':
        if (App.state.placingMultiGhost) { App.rotateMultiGhost(-1); }
        else if (_INCLINE_TYPES.has(App.state.selectedObject)) { App.rotatePlaceDirection(-1); Scene.markDirty(); }
        break;
      case 'e': case 'E':
        if (App.state.placingMultiGhost) { App.rotateMultiGhost(1); }
        else if (_INCLINE_TYPES.has(App.state.selectedObject)) { App.rotatePlaceDirection(1); Scene.markDirty(); }
        break;
      case 't': case 'T':
        if (App.state.placingMultiGhost) { App.cycleMultiGhostAnchor(); }
        else App.setTool('delete');
        break;
      case 'z': case 'Z':
        if (App.state.placingMultiGhost) { App.shiftMultiGhostLevel(1); }
        break;
      case 'x': case 'X':
        if (App.state.placingMultiGhost) { App.shiftMultiGhostLevel(-1); }
        break;
      case 'Delete':
        if ((App.state.tool === 'select' || App.state.tool === 'area-select') && App.state.selection.size > 0)
          App.deleteSelection();
        break;
      case 'Escape':
        if (_activeModal && !_activeModal.classList.contains('modal-overlay--locked')) {
          _closeModal(); return;
        }
        if (App.state.placingMultiGhost) {
          App.cancelMultiGhost();
          Scene.setMultiGhostOrigin(null, null);
          return;
        }
        App.clearSelection();
        break;
    }
  }

  // ── Top bar wiring ─────────────────────────────────────────────
  function _wireTopBar() {
    document.getElementById('btn-save-project').addEventListener('click', () => {
      if (App.isCurrentProjectNamed()) {
        showDangerModal(
          `"${App.state.project.name}" is already a named save. Create a new save?`,
          () => _showSaveProjectModal()
        );
      } else {
        _showSaveProjectModal();
      }
    });

    document.getElementById('btn-load-project').addEventListener('click', () => {
      _showLoadProjectModal();
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
      _showSettingsModal();
    });
  }

  // ── Sidebar wiring ─────────────────────────────────────────────
  function _wireSidebar() {
    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.addEventListener('click', () => App.setTool(btn.dataset.tool));
    });
    document.querySelectorAll('.btn-object').forEach(btn => {
      btn.addEventListener('click', () => App.setSelectedObject(btn.dataset.object));
    });
    document.getElementById('btn-add-colour').addEventListener('click', () => {
      _showColourModal('Add Colour', '#3a6b8c', hex => App.addColor(hex));
    });
    document.getElementById('btn-edit-footprint').addEventListener('click', () => {
      showFootprintEditor();
    });
    document.getElementById('btn-duplicate').addEventListener('click', () => {
      if (!App.state.selection.size) return;
      App.startMultiGhost(false);
    });
    document.getElementById('btn-pick-up').addEventListener('click', () => {
      if (!App.state.selection.size) return;
      App.startMultiGhost(true);
    });
    document.getElementById('btn-paint-selection').addEventListener('click', () => {
      if (!App.state.selection.size) return;
      App.repaintCells([...App.state.selection], App.state.selectedColorId);
    });
    document.getElementById('btn-delete-selection').addEventListener('click', () => {
      if (!App.state.selection.size) return;
      App.deleteSelection();
    });

    document.getElementById('btn-save-stamp').addEventListener('click', () => {
      if (!App.state.selection.size) return;
      _showSaveStampModal();
    });

    document.getElementById('toggle-ghost').addEventListener('change', e => {
      App.setShowPlacementGhost(e.target.checked);
      if (!e.target.checked) Scene.setHoverHit(null);
    });
  }

  // ── Viewport wiring ────────────────────────────────────────────
  function _wireViewport() {
    const viewport = document.getElementById('viewport');
    viewport.addEventListener('pointerdown',  _onViewportPointerDown);
    viewport.addEventListener('pointerup',    _onViewportPointerUp);
    viewport.addEventListener('pointermove',  _onViewportMove);
    viewport.addEventListener('pointerleave', () => { Scene.setHoverHit(null); Scene.setMultiGhostOrigin(null, null); _asRemoveRect(); });
  }

  // ── Footprint "Done" wiring ────────────────────────────────────
  function _wireFootprintDone() {
    document.querySelector('.js-fp-done').addEventListener('click', () => {
      _showView('canvas');
    });
  }

  // ── Public refresh ─────────────────────────────────────────────
  function refresh() {
    // When a project loads via app.js (e.g. active project found on startup),
    // switch to canvas the first time refresh is called with _currentView still null.
    if (App.state.project && _currentView === null) {
      _showView('canvas');
    }
    _renderSwatches();
    _updateToolButtons();
    _updateSelectionActions();
    _updateObjectButtons();
    _updateDirectionHud();
    _updateFootprintLabel();
    _renderStampList();
  }

  function applyUiScale(scale) {
    const els = [
      document.getElementById('sidebar'),
      document.getElementById('topbar'),
      document.getElementById('shortcuts-strip'),
      document.getElementById('hud'),
      document.getElementById('compass-canvas'),
    ];
    els.forEach(el => {
      if (!el) return;
      el.style.transformOrigin = '';
      el.style.zoom = scale;
    });
    // Sidebar width: keep the grid column in sync so the viewport never overlaps
    document.documentElement.style.setProperty('--sidebar', (264 * scale) + 'px');
    // Scale any open settings modal
    const modal = document.querySelector('.modal-overlay .modal-box');
    if (modal) modal.style.zoom = scale;
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    _wireTopBar();
    _wireSidebar();
    _wireViewport();
    _wireFootprintDone();
    document.addEventListener('keydown', _onKeyDown);
    applyUiScale(App.getSettings().uiScale);
    refresh();
    App.loadActiveProject(); // async — calls showFirstRunModal or loads saved project
  }

  window.UI = { init, refresh, showDangerModal, showFirstRunModal, showFootprintEditor, showError, applyUiScale };

  // ── Startup ────────────────────────────────────────────────────
  function _startup() {
    App.init();
    Scene.init();
    UI.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startup);
  } else {
    _startup();
  }

}());
