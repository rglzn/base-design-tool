/* ui.js — sidebar, modals, footprint editor, hotkeys, event wiring. */
(function () {

  // ── Modal state ────────────────────────────────────────────────
  let _activeModal  = null;
  let _errorTimer   = null;

  function _openModal(templateId) {
    if (_activeModal) _closeModal();
    const tmpl    = document.getElementById(templateId);
    const overlay = tmpl.content.cloneNode(true).querySelector('.modal-overlay');
    document.body.appendChild(overlay);
    _activeModal = overlay;
    // Locked overlays (e.g. first-run) do not close on backdrop click
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

  // ── First-run modal (locked — no cancel, no ESC) ───────────────
  function showFirstRunModal() {
    const overlay = _openModal('tmpl-modal-first-run');
    const input   = overlay.querySelector('.js-project-name');
    const btn     = overlay.querySelector('.js-first-run-create');

    input.addEventListener('input', () => {
      btn.disabled = input.value.trim().length === 0;
    });

    btn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      btn.disabled    = true;
      btn.textContent = 'Creating…';
      _closeModal();
      await App.createFirstProject(name);
    });

    setTimeout(() => input.focus(), 60);
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
      list.innerHTML = '';

      if (!projects.length) {
        list.innerHTML = '<p class="project-list-empty">No saved projects yet.</p>';
        return;
      }

      projects.forEach(proj => {
        const item = _buildProjectItem(proj, list);
        list.appendChild(item);
      });
    } catch (_) {
      list.innerHTML = '<p class="project-list-empty">Failed to load projects.</p>';
    }
  }

  function _buildProjectItem(proj, list) {
    const item = document.createElement('div');
    item.className = 'project-item';

    // Thumbnail
    if (proj.thumbnail) {
      const img = document.createElement('img');
      img.className = 'project-thumbnail';
      img.src = proj.thumbnail;
      img.alt = '';
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'project-thumbnail project-thumbnail--empty';
      ph.textContent = '□';
      item.appendChild(ph);
    }

    // Info
    const info = document.createElement('div');
    info.className = 'project-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'project-item-name';
    nameEl.textContent = proj.name;
    const dateEl = document.createElement('div');
    dateEl.className = 'project-item-date';
    dateEl.textContent = _relativeDate(proj.updated_at);
    info.append(nameEl, dateEl);
    item.appendChild(info);

    // Delete button
    const del = document.createElement('button');
    del.className = 'project-item-delete';
    del.textContent = '×';
    del.title = 'Delete project';
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

    // Click row to load
    item.addEventListener('click', async () => {
      _closeModal();
      await App.loadProject(proj.id);
    });

    return item;
  }

  function _relativeDate(iso) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30)  return `${days}d ago`;
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
        del.className = 'swatch-delete';
        del.textContent = '×';
        del.title = 'Delete colour';
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
  }

  function _updateObjectButtons() {
    const obj = App.state.selectedObject;
    document.querySelectorAll('.btn-object').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.object === obj);
    });
  }

  const _INCLINE_TYPES = new Set(['stair-solid','stair-thin','wedge-solid','wedge-thin']);

  function _updateDirectionHud() {
    const hud   = document.getElementById('hud-direction');
    const isInc = _INCLINE_TYPES.has(App.state.selectedObject);
    hud.hidden  = !isInc;
    if (isInc) document.getElementById('hud-direction-value').textContent = App.state.placeDirection;
  }

  // ── Footprint label ────────────────────────────────────────────
  function _updateFootprintLabel() {
    document.getElementById('footprint-size').textContent = App.footprintLabel();
  }

  // ── Footprint editor grid ──────────────────────────────────────
  function _buildFootprintGrid(container) {
    const building = App.state.building;
    const filledSet = new Set(building.map(b => `${b.bx},${b.bz}`));

    let minBx = 0, maxBx = 0, minBz = 0, maxBz = 0;
    building.forEach(({ bx, bz }) => {
      minBx = Math.min(minBx, bx); maxBx = Math.max(maxBx, bx);
      minBz = Math.min(minBz, bz); maxBz = Math.max(maxBz, bz);
    });
    minBx--; maxBx++; minBz--; maxBz++;

    container.style.gridTemplateColumns = `repeat(${maxBx - minBx + 1}, 44px)`;
    container.innerHTML = '';

    for (let bz = minBz; bz <= maxBz; bz++) {
      for (let bx = minBx; bx <= maxBx; bx++) {
        const key  = `${bx},${bz}`;
        const cell = document.createElement('div');
        cell.className = 'fp-cell';

        if (filledSet.has(key)) {
          const hasContent = App.blockHasContent(bx, bz);
          cell.classList.add('fp-cell--filled');
          if (hasContent) cell.classList.add('has-content');
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
          const adjacent = [[1,0],[-1,0],[0,1],[0,-1]].some(
            ([dx, dz]) => filledSet.has(`${bx+dx},${bz+dz}`)
          );
          if (adjacent) {
            cell.classList.add('fp-cell--ghost');
            cell.addEventListener('click', () => {
              if (App.addBlock(bx, bz)) _buildFootprintGrid(container);
            });
          } else {
            cell.classList.add('fp-cell--empty');
          }
        }
        container.appendChild(cell);
      }
    }
  }

  // ── Viewport click handling ────────────────────────────────────
  let _mouseDownX = 0, _mouseDownY = 0;

  function _onViewportClick(e) {
    if (e.target.closest('#hud')) return;
    const dx = e.clientX - _mouseDownX;
    const dy = e.clientY - _mouseDownY;
    if (dx * dx + dy * dy > 16) return;

    const hit  = Scene.pickAt(e.clientX, e.clientY);
    if (!hit) return;
    const tool = App.state.tool;

    if (tool === 'build') {
      if (hit.buildTarget) {
        const parts = hit.buildTarget.split(',');
        if (parts.length === 4) {
          App.placeWall(hit.buildTarget);
        } else {
          App.placeCell(+parts[0], +parts[1], +parts[2]);
        }
      }
    } else if (tool === 'delete') {
      if (hit.type === 'wall' && hit.key) {
        App.deleteWall(hit.key);
      } else if (hit.key && hit.type !== 'wall') {
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
    }
  }

  // ── Hotkeys ────────────────────────────────────────────────────
  function _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'b': case 'B': App.setTool('build');  break;
      case 'd': case 'D': App.setTool('delete'); break;
      case 's': case 'S': App.setTool('select'); break;
      case 'q': case 'Q':
        if (_INCLINE_TYPES.has(App.state.selectedObject)) App.rotatePlaceDirection(-1);
        break;
      case 'e': case 'E':
        if (_INCLINE_TYPES.has(App.state.selectedObject)) App.rotatePlaceDirection(1);
        break;
      case 'Delete':
        if (App.state.tool === 'select' && App.state.selection.size > 0)
          App.deleteSelection();
        break;
      case 'Escape':
        if (_activeModal && !_activeModal.classList.contains('modal-overlay--locked')) {
          _closeModal(); return;
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
      const overlay = _openModal('tmpl-modal-footprint');
      const grid    = overlay.querySelector('.footprint-grid');
      _buildFootprintGrid(grid);
      overlay.querySelectorAll('.js-modal-close')
        .forEach(el => el.addEventListener('click', _closeModal));
    });
  }

  // ── Viewport wiring ────────────────────────────────────────────
  function _wireViewport() {
    const viewport = document.getElementById('viewport');
    viewport.addEventListener('mousedown', e => { _mouseDownX = e.clientX; _mouseDownY = e.clientY; });
    viewport.addEventListener('click', _onViewportClick);
  }

  // ── Public refresh ─────────────────────────────────────────────
  function refresh() {
    _renderSwatches();
    _updateToolButtons();
    _updateObjectButtons();
    _updateDirectionHud();
    _updateFootprintLabel();
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    _wireTopBar();
    _wireSidebar();
    _wireViewport();
    document.addEventListener('keydown', _onKeyDown);
    refresh();
    App.loadActiveProject(); // async — shows first-run modal or loads saved state
  }

  window.UI = { init, refresh, showDangerModal, showFirstRunModal, showError };

  // ── Startup sequence ───────────────────────────────────────────
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
