/* ui.js — sidebar, modals, footprint editor, hotkeys, event wiring. */
(function () {

  // ── Modal state ────────────────────────────────────────────────
  let _activeModal = null;

  function _openModal(templateId) {
    if (_activeModal) _closeModal();
    const tmpl = document.getElementById(templateId);
    const overlay = tmpl.content.cloneNode(true).querySelector('.modal-overlay');
    document.body.appendChild(overlay);
    _activeModal = overlay;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) _closeModal();
    });
    return overlay;
  }

  function _closeModal() {
    if (_activeModal) {
      _activeModal.remove();
      _activeModal = null;
    }
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

  // ── Tool buttons ───────────────────────────────────────────────
  function _updateToolButtons() {
    const tool = App.state.tool;
    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  // ── Object buttons ─────────────────────────────────────────────
  function _updateObjectButtons() {
    const obj = App.state.selectedObject;
    document.querySelectorAll('.btn-object').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.object === obj);
    });
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
      minBx = Math.min(minBx, bx);
      maxBx = Math.max(maxBx, bx);
      minBz = Math.min(minBz, bz);
      maxBz = Math.max(maxBz, bz);
    });
    minBx--; maxBx++; minBz--; maxBz++;

    const cols = maxBx - minBx + 1;
    const rows = maxBz - minBz + 1;
    container.style.gridTemplateColumns = `repeat(${cols}, 44px)`;
    container.innerHTML = '';

    for (let bz = minBz; bz <= maxBz; bz++) {
      for (let bx = minBx; bx <= maxBx; bx++) {
        const key = `${bx},${bz}`;
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
    // Ignore HUD
    if (e.target.closest('#hud')) return;
    // Ignore if mouse moved (drag vs click)
    const dx = e.clientX - _mouseDownX;
    const dy = e.clientY - _mouseDownY;
    if (dx * dx + dy * dy > 16) return;

    const hit = Scene.pickAt(e.clientX, e.clientY);
    if (!hit) return;

    const tool = App.state.tool;

    if (tool === 'build') {
      if (hit.buildTarget) {
        const [x, y, z] = hit.buildTarget.split(',').map(Number);
        App.placeCell(x, y, z);
      }

    } else if (tool === 'delete') {
      if (hit.key) {
        const [x, y, z] = hit.key.split(',').map(Number);
        App.deleteCell(x, y, z);
      }

    } else if (tool === 'select') {
      if (hit.key) {
        if (e.shiftKey) {
          if (App.state.selection.has(hit.key)) {
            App.removeFromSelection(hit.key);
          } else {
            App.addToSelection(hit.key);
          }
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

      case 'Delete':
        if (App.state.tool === 'select' && App.state.selection.size > 0) {
          App.deleteSelection();
        }
        break;

      case 'Escape':
        if (_activeModal) { _closeModal(); return; }
        App.clearSelection();
        break;
    }
  }

  // ── Sidebar wiring ─────────────────────────────────────────────
  function _wireSidebar() {
    // Tool buttons
    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.addEventListener('click', () => App.setTool(btn.dataset.tool));
    });

    // Object buttons
    document.querySelectorAll('.btn-object').forEach(btn => {
      btn.addEventListener('click', () => App.setSelectedObject(btn.dataset.object));
    });

    // Add colour
    document.getElementById('btn-add-colour').addEventListener('click', () => {
      _showColourModal('Add Colour', '#3a6b8c', hex => App.addColor(hex));
    });

    // Footprint editor
    document.getElementById('btn-edit-footprint').addEventListener('click', () => {
      const overlay = _openModal('tmpl-modal-footprint');
      const grid = overlay.querySelector('.footprint-grid');
      _buildFootprintGrid(grid);
      overlay.querySelectorAll('.js-modal-close')
        .forEach(el => el.addEventListener('click', _closeModal));
    });
  }

  // ── Viewport wiring ────────────────────────────────────────────
  function _wireViewport() {
    const viewport = document.getElementById('viewport');
    viewport.addEventListener('mousedown', e => {
      _mouseDownX = e.clientX;
      _mouseDownY = e.clientY;
    });
    viewport.addEventListener('click', _onViewportClick);
  }

  // ── Public refresh — called by App after every mutation ────────
  function refresh() {
    _renderSwatches();
    _updateToolButtons();
    _updateObjectButtons();
    _updateFootprintLabel();
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    _wireSidebar();
    _wireViewport();
    document.addEventListener('keydown', _onKeyDown);
    refresh();
  }

  window.UI = { init, refresh, showDangerModal };

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
