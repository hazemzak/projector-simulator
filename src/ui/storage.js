/* PS.Storage: localStorage autosave, saved placements, JSON export/import and the Placements panel
 * (PLAN.md sections 4.4 and 6.4). Owned by P6. Called as PS.Storage.init(PS.App) by app.js.
 * With ?nostore=1 nothing is read from or written to localStorage; placements then live in memory only. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};
  var Model = PS.Model;

  var KEY_STATE = 'projsim.v1.state';
  var KEY_PLACEMENTS = 'projsim.v1.placements';
  var AUTOSAVE_MS = 500;
  var IMPORTED = ' (imported)';

  var App = null;
  var memory = [];            // placements when nostore is on (or localStorage is unusable)
  var lastName = '';          // name of the placement last saved or loaded
  var autosaveTimer = 0;
  var panel = null, ui = {};

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nostore() { return !!(App && App.nostore); }

  // ------------------------------------------------------------------ raw localStorage (all guarded)
  function lsGet(key) {
    if (nostore()) return null;
    try { return root.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    if (nostore()) return false;
    try { root.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function lsRemove(key) {
    if (nostore()) return;
    try { root.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ helpers
  function slug(name) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'placement';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function newId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  function download(filename, data, mime) {
    var blob = data instanceof root.Blob ? data : new root.Blob([data], { type: mime || 'text/plain' });
    var url = root.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 4000);
  }

  // ------------------------------------------------------------------ placements store
  function readPlacements() {
    if (nostore()) return memory;
    var raw = lsGet(KEY_PLACEMENTS);
    if (!raw) return memory;
    try {
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writePlacements(list) {
    memory = list;
    if (nostore()) return true;
    if (!list.length) { lsRemove(KEY_PLACEMENTS); return true; }
    return lsSet(KEY_PLACEMENTS, JSON.stringify(list));
  }

  function list() { return clone(readPlacements()); }

  function find(id) {
    var l = readPlacements();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function save(name, note) {
    var nm = String(name || '').trim();
    if (!nm) nm = 'Placement ' + (readPlacements().length + 1);
    var pl = Model.makePlacement(App.state, nm, note);
    var l = clone(readPlacements());
    l.push(pl);
    writePlacements(l);
    lastName = nm;
    changed();
    return clone(pl);
  }

  function rename(id, name) {
    var nm = String(name || '').trim();
    if (!nm) return false;
    var l = clone(readPlacements()), done = false;
    l.forEach(function (p) { if (p.id === id) { p.name = nm; done = true; } });
    if (done) { writePlacements(l); changed(); }
    return done;
  }

  function remove(id) {
    var l = clone(readPlacements()), n = l.length;
    l = l.filter(function (p) { return p.id !== id; });
    if (l.length === n) return false;
    writePlacements(l);
    changed();
    return true;
  }

  // Apply a saved placement to the app. restoreRoom decides whether room, room status and obstacles come
  // from the placement too. Returns {ok, errors}.
  function load(id, opts) {
    var pl = find(id);
    if (!pl) return { ok: false, errors: ['No such placement.'] };
    var next = Model.applyPlacement(App.state, pl, { restoreRoom: !!(opts && opts.restoreRoom) });
    var r = App.replaceState(next, 'placement');
    if (r.ok) { lastName = pl.name; changed(); }
    return r;
  }

  // ------------------------------------------------------------------ files: export
  function exportPlacementText(id) {
    var pl = find(id);
    if (!pl) throw new Error('No such placement.');
    var st = Model.applyPlacement(App.state, pl, { restoreRoom: true });
    return Model.serializeProject(st, [clone(pl)]);
  }

  function exportPlacement(id) {
    var pl = find(id);
    var text = exportPlacementText(id);
    var fname = 'projsim_' + slug(pl.name) + '.json';
    download(fname, text, 'application/json');
    return fname;
  }

  function exportProjectText() { return Model.serializeProject(App.state, clone(readPlacements())); }

  function exportProject() {
    var fname = 'projsim_project_' + stamp() + '.json';
    download(fname, exportProjectText(), 'application/json');
    return fname;
  }

  // ------------------------------------------------------------------ files: import
  // Merge incoming placements into current by id. A clashing id becomes a copy with a new id and
  // " (imported)" appended to the name. Returns {list, added, copies}.
  function mergePlacements(current, incoming) {
    var out = clone(current), ids = {}, copies = 0;
    out.forEach(function (p) { ids[p.id] = true; });
    clone(incoming).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      if (!p.id || ids[p.id]) {
        p.id = newId();
        p.name = String(p.name || 'Placement') + IMPORTED;
        copies++;
      }
      ids[p.id] = true;
      out.push(p);
    });
    return { list: out, added: out.length - current.length, copies: copies };
  }

  // Parse and import a project/placement file. opts.replaceRoom (true/false) answers the room question;
  // when omitted, confirm() asks it. Returns {ok, message, added, copies}; never throws.
  function importText(text, opts) {
    var parsed;
    try { parsed = Model.parseProject(text); }
    catch (e) { return { ok: false, message: e.message }; }

    var replaceRoom;
    if (opts && typeof opts.replaceRoom === 'boolean') replaceRoom = opts.replaceRoom;
    else replaceRoom = root.confirm('Replace room dimensions with the imported ones?');

    var next = clone(parsed.state);
    if (!replaceRoom) {
      next.room = clone(App.state.room);
      next.roomStatus = clone(App.state.roomStatus);
      next.obstacles = clone(App.state.obstacles);
    }
    var r = App.replaceState(next, 'import');
    if (!r.ok) return { ok: false, message: 'Imported state rejected: ' + r.errors.join(' ') };

    var merged = mergePlacements(readPlacements(), parsed.placements);
    writePlacements(merged.list);
    changed();
    var msg = 'Imported ' + merged.added + ' placement' + (merged.added === 1 ? '' : 's') +
      (merged.copies ? ' (' + merged.copies + ' renamed "' + IMPORTED.trim() + '")' : '') +
      '; room ' + (replaceRoom ? 'replaced' : 'kept') + '.';
    return { ok: true, message: msg, added: merged.added, copies: merged.copies };
  }

  // ------------------------------------------------------------------ autosave
  function flushAutosave() {
    if (autosaveTimer) { root.clearTimeout(autosaveTimer); autosaveTimer = 0; }
    if (nostore() || !App) return false;
    return lsSet(KEY_STATE, JSON.stringify(App.state));
  }

  function scheduleAutosave(source) {
    if (nostore() || source === 'init' || source === 'restore' || source === 'selftest') return;
    if (autosaveTimer) root.clearTimeout(autosaveTimer);
    autosaveTimer = root.setTimeout(flushAutosave, AUTOSAVE_MS);
  }

  // Restore the last autosaved state at start-up (not when a preset is requested in the URL).
  function restoreAutosave() {
    if (nostore() || (App.params && App.params.preset)) return null;
    var raw = lsGet(KEY_STATE);
    if (!raw) return null;
    try {
      var st = Model.parseProject(JSON.stringify({ schema: Model.SCHEMA, state: JSON.parse(raw), placements: [] })).state;
      var r = App.replaceState(st, 'restore');
      return r.ok ? null : r.errors.join(' ');
    } catch (e) { return e.message; }
  }

  // ------------------------------------------------------------------ Placements panel
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function button(label, cls, fn, title) {
    var b = el('button', { type: 'button', 'class': 'ps6-btn ' + (cls || '') }, label);
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  function injectStyle() {
    if (document.getElementById('ps6-style')) return;
    var css = [
      '#panel-placements h2{margin:0 0 6px;font-size:13px;font-weight:600}',
      '.ps6-save{display:flex;gap:4px;margin-bottom:6px}',
      '.ps6-save input{flex:1 1 auto;min-width:0;padding:3px 5px;border:1px solid #b8bec7;border-radius:3px;font:inherit}',
      '.ps6-btn{padding:3px 8px;border:1px solid #aeb5bf;border-radius:3px;background:#f2f4f7;color:#1d2026;font:inherit;cursor:pointer}',
      '.ps6-btn:hover{background:#e4e8ee}',
      '.ps6-btn.ps6-primary{background:#2a6fb0;border-color:#2a6fb0;color:#fff}',
      '.ps6-btn.ps6-primary:hover{background:#22598f}',
      '.ps6-btn.ps6-small{padding:1px 6px;font-size:12px}',
      '.ps6-list{list-style:none;margin:0 0 6px;padding:0}',
      '.ps6-list li{padding:4px 0;border-top:1px solid #e6e9ee}',
      '.ps6-list li:first-child{border-top:0}',
      '.ps6-name{font-weight:600;word-break:break-word}',
      '.ps6-meta{color:#5d6672;font-size:11px}',
      '.ps6-row{display:flex;flex-wrap:wrap;gap:3px;margin-top:3px}',
      '.ps6-empty{color:#5d6672;font-style:italic;margin:0 0 6px}',
      '.ps6-actions{display:flex;flex-wrap:wrap;gap:4px}',
      '.ps6-status{min-height:1.4em;margin-top:6px;font-size:12px;color:#1c6b2f}',
      '.ps6-status.ps6-err{color:#b3261e}',
      '.ps6-rename{flex:1 1 auto;min-width:0;padding:2px 4px;border:1px solid #2a6fb0;border-radius:3px;font:inherit}',
      '.ps6-modal{color:#1d2026}',
      '.ps6-modal h3{margin:0 0 8px;font-size:15px}',
      '.ps6-modal table{border-collapse:collapse;margin:6px 0 10px;font-size:12px}',
      '.ps6-modal th,.ps6-modal td{padding:2px 10px 2px 0;text-align:left}',
      '.ps6-modal textarea{width:100%;height:240px;font:12px/1.35 Consolas,monospace}',
      '.ps6-modal .ps6-buttons{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}'
    ].join('\n');
    var st = el('style', { id: 'ps6-style' });
    st.textContent = css;
    document.head.appendChild(st);
  }

  function setStatus(text, isErr) {
    if (!ui.status) return;
    ui.status.textContent = text || '';
    ui.status.className = 'ps6-status' + (isErr ? ' ps6-err' : '');
  }

  // Modal through PS.Panels.openModal (one at a time; Escape, backdrop, x and Close dismiss it; focus returns to
  // the opener). Resolves with the value passed to close() by the dialog's buttons, or null when dismissed.
  function modal(build) {
    return new Promise(function (resolve) {
      var body = el('div', { 'class': 'ps6-modal' }), done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      function close(v) { finish(v); PS.Panels.closeModal(); }
      build(body, close);
      PS.Panels.openModal({ title: 'Load placement', body: body, onClose: function () { finish(null); } });
    });
  }

  function fmtVal(v) { return typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v); }

  function labelOfRoomKey(key) {
    var ps = (PS.Room && PS.Room.PARAMS) || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].key === key) return ps[i].label || key;
    return key;
  }

  // Load via the UI: asks about the room when the saved room differs from the current one.
  function loadInteractive(id) {
    var pl = find(id);
    if (!pl) { setStatus('That placement no longer exists.', true); return Promise.resolve(); }
    var diff = Model.diffRoom(App.state.room, pl.room);
    var choice = diff.length ? modal(function (box, close) {
      box.appendChild(el('h3', {}, 'Room differs from "' + pl.name + '"'));
      box.appendChild(el('div', {}, 'The saved room has ' + diff.length + ' different value' + (diff.length === 1 ? '' : 's') + ' (current → saved):'));
      var t = el('table');
      diff.forEach(function (d) {
        var tr = el('tr');
        tr.appendChild(el('td', {}, labelOfRoomKey(d.key)));
        tr.appendChild(el('td', {}, fmtVal(d.a) + ' → ' + fmtVal(d.b)));
        t.appendChild(tr);
      });
      box.appendChild(t);
      var bar = el('div', { 'class': 'ps6-buttons' });
      var keep = button('Keep current room', 'ps6-primary', function () { close('keep'); });
      bar.appendChild(button('Restore saved room', '', function () { close('restore'); }));
      bar.appendChild(keep);
      box.appendChild(bar);
      root.setTimeout(function () { keep.focus(); }, 0);
    }) : Promise.resolve('keep');
    return choice.then(function (c) {
      if (c === null) return;   // Escape: do nothing
      var r = load(id, { restoreRoom: c === 'restore' });
      setStatus(r.ok ? 'Loaded "' + pl.name + '"' + (c === 'restore' ? ' with its saved room.' : '.') : 'Could not load: ' + r.errors.join(' '), !r.ok);
    });
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function startRename(li, pl, nameEl) {
    var input = el('input', { type: 'text', 'class': 'ps6-rename', value: pl.name, 'aria-label': 'Placement name' });
    var done = false;
    function finish(commit) {
      if (done) return;
      done = true;
      if (commit && input.value.trim()) rename(pl.id, input.value); else renderList();
    }
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function renderList() {
    if (!ui.list) return;
    var l = readPlacements();
    ui.list.textContent = '';
    ui.empty.style.display = l.length ? 'none' : '';
    l.forEach(function (pl) {
      var li = el('li');
      var nameEl = el('div', { 'class': 'ps6-name' }, pl.name);
      li.appendChild(nameEl);
      li.appendChild(el('div', { 'class': 'ps6-meta' }, fmtDate(pl.savedAt) + ' · lens ' +
        pl.projector.lens.x.toFixed(2) + ', ' + pl.projector.lens.y.toFixed(2) + ', ' + pl.projector.lens.z.toFixed(2) + ' m'));
      var row = el('div', { 'class': 'ps6-row' });
      row.appendChild(button('Load', 'ps6-small ps6-primary', function () { loadInteractive(pl.id); }));
      row.appendChild(button('Rename', 'ps6-small', function () { startRename(li, pl, nameEl); }));
      row.appendChild(button('Delete', 'ps6-small', function () {
        if (root.confirm('Delete placement "' + pl.name + '"?')) { remove(pl.id); setStatus('Deleted "' + pl.name + '".'); }
      }));
      row.appendChild(button('Export JSON', 'ps6-small', function () {
        setStatus('Saved ' + exportPlacement(pl.id) + ' to your downloads.');
      }));
      li.appendChild(row);
      ui.list.appendChild(li);
    });
  }

  function changed() { renderList(); }

  function onSave() {
    var pl = save(ui.name.value, '');
    ui.name.value = '';
    setStatus('Saved "' + pl.name + '".' + (nostore() ? ' (nostore: kept in memory only)' : ''));
  }

  function onImportFile(file) {
    if (!file) return;
    var reader = new root.FileReader();
    reader.onload = function () {
      var r = importText(String(reader.result));
      setStatus(r.message, !r.ok);
    };
    reader.onerror = function () { setStatus('Could not read ' + file.name + '.', true); };
    reader.readAsText(file);
  }

  function buildPanel() {
    panel = document.getElementById('panel-placements');
    if (!panel) return;
    injectStyle();
    panel.textContent = '';
    panel.appendChild(el('h2', {}, 'Placements'));

    var save_ = el('div', { 'class': 'ps6-save' });
    ui.name = el('input', { type: 'text', placeholder: 'Placement name', 'aria-label': 'Placement name', maxlength: '80' });
    ui.name.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') onSave(); });
    save_.appendChild(ui.name);
    save_.appendChild(button('Save', 'ps6-primary', onSave, 'Save the current placement (projector, target, calibration, room)'));
    panel.appendChild(save_);

    ui.empty = el('p', { 'class': 'ps6-empty' }, 'No saved placements yet.');
    panel.appendChild(ui.empty);
    ui.list = el('ul', { 'class': 'ps6-list' });
    panel.appendChild(ui.list);

    var actions = el('div', { 'class': 'ps6-actions' });
    actions.appendChild(button('Export project JSON', '', function () { setStatus('Saved ' + exportProject() + ' to your downloads.'); }));
    ui.file = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    ui.file.addEventListener('change', function () { onImportFile(ui.file.files[0]); ui.file.value = ''; });
    actions.appendChild(button('Import JSON', '', function () { ui.file.click(); }));
    actions.appendChild(button('Export wall PNG', '', function () { exportPng('wall'); }));
    actions.appendChild(button('Export top PNG', '', function () { exportPng('top'); }));
    actions.appendChild(button('Copy summary', '', copySummary));
    actions.appendChild(button('Download .txt', '', function () {
      if (PS.Export) setStatus('Saved ' + PS.Export.downloadSummary() + ' to your downloads.');
    }));
    actions.appendChild(ui.file);
    panel.appendChild(actions);

    ui.status = el('div', { 'class': 'ps6-status', role: 'status', 'aria-live': 'polite' });
    panel.appendChild(ui.status);
    renderList();
  }

  function exportPng(view) {
    if (!PS.Export) { setStatus('Export is not available.', true); return; }
    setStatus('Rendering ' + view + ' view…');
    // let the status text paint before the (blocking) 2400 px render
    root.setTimeout(function () {
      try { setStatus('Saved ' + PS.Export.downloadPng(view) + ' to your downloads.'); }
      catch (e) { setStatus('PNG export failed: ' + e.message, true); }
    }, 30);
  }

  function copySummary() {
    if (!PS.Export) { setStatus('Export is not available.', true); return Promise.resolve(); }
    return PS.Export.copySummary().then(function (how) {
      setStatus(how === 'clipboard' || how === 'execCommand' ? 'Summary copied to the clipboard.' : 'Select the summary and copy it (Ctrl+C).');
    }, function (e) { setStatus('Could not copy: ' + e.message, true); });
  }

  // ------------------------------------------------------------------ self test
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]); });
  }

  function sleep(ms) { return new Promise(function (res) { root.setTimeout(res, ms); }); }

  function lensOf(s) { return s.projector.lens.x.toFixed(3) + ',' + s.projector.lens.y.toFixed(3) + ',' + s.projector.lens.z.toFixed(3); }

  function registerChecks() {
    var reg = PS.SelfTest && PS.SelfTest.register;
    var checks = [
      ['storage.save-change-load', function (A) {
        var before = clone(A.state), n0 = list().length;
        var pl = save('selftest placement', 'p6');
        var want = lensOf(before);
        var moved = A.update(function (d) { d.projector.lens.x += 0.37; d.projector.lens.z -= 0.11; }, 'selftest');
        var movedLens = lensOf(A.state);
        var r = load(pl.id, { restoreRoom: false });
        var got = lensOf(A.state);
        var n1 = list().length;
        remove(pl.id);
        var n2 = list().length;
        A.replaceState(before, 'selftest');
        var ok = moved.ok && r.ok && movedLens !== want && got === want && n1 === n0 + 1 && n2 === n0;
        return { ok: ok, detail: 'lens saved ' + want + ', moved ' + movedLens + ', loaded ' + got + '; placements ' + n0 + '->' + n1 + '->' + n2 };
      }],
      ['storage.project-roundtrip', function (A) {
        var s = clone(A.state);
        s.projector.lens.y = 3.2;
        s.projector.yawDeg = 7.5;
        s.obstacles.push({ id: 'rt', name: 'round trip box', min: [1, 1, 0], max: [1.2, 1.3, 0.5], enabled: false });
        s.calibration['epson-pl955wh'] = { vOffset: 0.12, vOffsetStatus: 'measured', hOffset: 0, hOffsetStatus: 'assumed' };
        var pls = [Model.makePlacement(s, 'a', 'note a'), Model.makePlacement(A.state, 'b')];
        var text = Model.serializeProject(s, pls);
        var back = Model.parseProject(text);
        var okState = deepEqual(back.state, s), okPl = deepEqual(back.placements, pls);
        var again = Model.serializeProject(back.state, back.placements) === text;
        var bad = false;
        try { Model.parseProject(JSON.stringify({ schema: 'projsim/2', state: s })); } catch (e) { bad = /schema/.test(e.message); }
        return { ok: okState && okPl && again && bad, detail: 'state equal=' + okState + ', placements equal=' + okPl + ', text stable=' + again + ', wrong schema rejected=' + bad };
      }],
      ['storage.import-merge', function (A) {
        var a = Model.makePlacement(A.state, 'one'), b = Model.makePlacement(A.state, 'two');
        var m = mergePlacements([a], [clone(a), b]);
        var copy = m.list[1], ids = m.list.map(function (p) { return p.id; });
        var uniq = ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length === ids.length;
        var ok = m.list.length === 3 && m.copies === 1 && copy.name === 'one' + IMPORTED && copy.id !== a.id && m.list[2].id === b.id && m.list[2].name === 'two' && uniq;
        // a full file import through the same path, room kept
        var before = clone(A.state), n0 = list().length;
        var s2 = clone(A.state); s2.projector.pitchDeg = 3;
        var pl = Model.makePlacement(s2, 'imp');
        var r = importText(Model.serializeProject(s2, [pl]), { replaceRoom: false });
        var pitchOk = A.state.projector.pitchDeg === 3 && r.ok && list().length === n0 + 1;
        list().forEach(function (p) { if (p.id === pl.id) remove(p.id); });
        A.replaceState(before, 'selftest');
        var rejected = importText('{"schema":"projsim/9"}', { replaceRoom: true });
        return { ok: ok && pitchOk && !rejected.ok, detail: 'merge ' + m.list.length + ' items, ' + m.copies + ' copy; import ok=' + r.ok + ' pitch=' + pitchOk + '; bad file rejected=' + !rejected.ok };
      }],
      ['storage.no-trace-with-nostore', function (A) {
        var keys = [KEY_STATE, KEY_PLACEMENTS], proto = root.Storage.prototype, origSet = proto.setItem, origRemove = proto.removeItem;
        var writes = [], snap = {}, before = clone(A.state);
        keys.forEach(function (k) { try { snap[k] = root.localStorage.getItem(k); } catch (e) { snap[k] = null; } });
        proto.setItem = function (k, v) { if (String(k).indexOf('projsim.') === 0) writes.push('set ' + k); return origSet.call(this, k, v); };
        proto.removeItem = function (k) { if (String(k).indexOf('projsim.') === 0) writes.push('remove ' + k); return origRemove.call(this, k); };
        var pl;
        try {
          pl = save('no trace', '');
          A.update(function (d) { d.projector.lens.x += 0.2; }, 'storage-test');   // would arm the autosave
          load(pl.id, { restoreRoom: false });
          rename(pl.id, 'no trace 2');
          remove(pl.id);
        } catch (e) { proto.setItem = origSet; proto.removeItem = origRemove; throw e; }
        return sleep(AUTOSAVE_MS + 200).then(function () {
          proto.setItem = origSet; proto.removeItem = origRemove;
          var n = writes.length;
          // outside nostore mode the writes above are legitimate: put the stored values back
          if (!nostore()) keys.forEach(function (k) { if (snap[k] === null) origRemove.call(root.localStorage, k); else origSet.call(root.localStorage, k, snap[k]); });
          A.replaceState(before, 'selftest');
          return nostore()
            ? { ok: n === 0, detail: 'nostore=1: ' + n + ' writes to projsim.* keys' + (n ? ' (' + writes.join(', ') + ')' : '') }
            : { ok: true, detail: 'nostore off: ' + n + ' writes, stored values restored' };
        });
      }]
    ];
    checks.forEach(function (c) {
      // the checks save and load placements: do not let them change the name used for export files
      var fn = function (A) {
        var prev = lastName, r;
        function back(x) { lastName = prev; return x; }
        try { r = c[1](A); } catch (e) { back(); throw e; }
        return r && typeof r.then === 'function' ? r.then(back, function (e) { back(); throw e; }) : back(r);
      };
      if (reg) reg(c[0], fn);
      else (PS.pendingSelfTests = PS.pendingSelfTests || []).push([c[0], fn]);
    });
  }

  // ------------------------------------------------------------------ init
  function init(app) {
    App = app;
    buildPanel();
    app.on('change', function (ev) { scheduleAutosave(ev.source); });
    root.addEventListener('pagehide', function () { if (autosaveTimer) flushAutosave(); });
    var err = restoreAutosave();
    if (err) setStatus('Last session could not be restored: ' + err, true);
    registerChecks();
    renderList();
  }

  PS.Storage = {
    KEY_STATE: KEY_STATE, KEY_PLACEMENTS: KEY_PLACEMENTS,
    init: init,
    slug: slug, stamp: stamp, download: download,
    modal: modal, button: button, injectStyle: injectStyle,
    list: list, save: save, load: load, loadInteractive: loadInteractive, rename: rename, remove: remove,
    exportPlacement: exportPlacement, exportPlacementText: exportPlacementText,
    exportProject: exportProject, exportProjectText: exportProjectText,
    importText: importText, mergePlacements: mergePlacements,
    flushAutosave: flushAutosave,
    // name used in export file names and titles: the name field, else the last saved or loaded placement
    currentName: function () { return (ui.name && ui.name.value.trim()) || lastName || ''; },
    setStatus: setStatus
  };
})(window);
