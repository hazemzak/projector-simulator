/* PS.FrameUI: frame controls (#panel-frames) and per-frame results (#panel-frame-results). Owned by F05.
 * Called by PS.Panels.init, so it needs PS.Panels (panels.js) loaded first. Formats pure results from
 * PS.App.result.frames; it never recomputes geometry. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};
  var Model = PS.Model;

  var SHADOW_LABEL = 'Potential geometric shadow; other obstructions can overlap it.';
  var DIMS = [
    ['u', 'u (left edge from left wall)', 'm'], ['bottom', 'Bottom edge above floor', 'm'],
    ['width', 'Width', 'm'], ['height', 'Height', 'm'], ['depth', 'Depth (stands out from wall)', 'm']
  ];

  var App = null, kit = null, h = null, fmt = null;
  var frameRefreshers = [];       // refreshers of the per-frame numeric fields; rebuilt with the rows
  var rowsHost = null, addMsg = null, addBtn = null, resultsBody = null, rowKey = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function pct(f) { return fmt(f * 100, 1) + ' %'; }
  function pt(p) { return p ? '(' + fmt(p[0], 2) + ', ' + fmt(p[1], 2) + ')' : 'n/a'; }

  // Smallest unused "frame-N" id.
  function nextId(frames) {
    var used = {};
    frames.forEach(function (f) { used[f.id] = true; });
    for (var n = 1; ; n++) if (!used['frame-' + n]) return 'frame-' + n;
  }

  // Example 0.8 x 0.5 m frame, depth 0.03 m, centred in the target (or the wall when the target is off).
  function exampleFrame(state) {
    var t = state.target, r = state.room;
    var x0, x1, z0, z1;
    if (t && t.enabled) { x0 = t.x0; x1 = t.x1; z0 = t.z0; z1 = t.z1; }
    else { x0 = 0; x1 = r.width; z0 = 0; z1 = r.ceiling || r.height || 2.5; }
    var w = 0.8, hh = 0.5;
    return {
      id: nextId(state.frames || []), name: 'Frame ' + ((state.frames || []).length + 1),
      u: (x0 + x1) / 2 - w / 2, bottom: (z0 + z1) / 2 - hh / 2, width: w, height: hh, depth: 0.03
    };
  }

  function addFrame() {
    var frames = App.state.frames || [];
    if (frames.length >= Model.MAX_FRAMES) {
      addMsg.textContent = 'At most ' + Model.MAX_FRAMES + ' frames are allowed.';
      return { ok: false };
    }
    var f = exampleFrame(App.state);
    var r = App.update(function (d) { d.frames = (d.frames || []).concat([f]); }, 'panel');
    addMsg.textContent = r.ok ? '' : r.errors[0];
    return r;
  }

  function removeFrame(id) {
    App.update(function (d) { d.frames = (d.frames || []).filter(function (f) { return f.id !== id; }); }, 'panel');
    addMsg.textContent = '';
  }

  function frameOf(state, id) {
    var list = state.frames || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function buildRow(frame, index) {
    var id = frame.id, n = index + 1, msg = h('div', { class: 'fmsg' });
    var name = h('input', { type: 'text', class: 'num frame-name', 'aria-label': 'Frame ' + n + ' name', maxlength: '40' });
    name.addEventListener('change', function () {
      var r = App.update(function (d) { var f = frameOf(d, id); if (f) f.name = name.value; }, 'panel');
      msg.textContent = r.ok ? '' : r.errors[0];
      name.classList.toggle('invalid', !r.ok);
    });
    frameRefreshers.push(function (state) {
      var f = frameOf(state, id);
      if (f && document.activeElement !== name) { name.value = f.name; name.classList.remove('invalid'); }
    });
    var rows = DIMS.map(function (dim) {
      var key = dim[0];
      return kit.numField({
        label: dim[1], aria: 'Frame ' + n + ' ' + key, step: 0.01, dec: 3, unit: dim[2], reg: frameRefreshers,
        get: function (s) { var f = frameOf(s, id); return f ? f[key] : NaN; },
        set: function (d, v) { var f = frameOf(d, id); if (f) f[key] = v; }
      }).row;
    });
    return h('div', { class: 'frame-row', 'data-frame': id }, [
      h('div', { class: 'frame-head' }, [
        h('label', { class: 'flabel', text: 'Frame ' + n }),
        name,
        kit.button('Remove', function () { removeFrame(id); }, 'xbtn', 'Remove frame ' + n)
      ]),
      rows, msg
    ]);
  }

  function refreshRows(state, result) {
    var frames = state.frames || [];
    var key = frames.map(function (f) { return f.id; }).join('|');
    if (key !== rowKey) {
      rowKey = key;
      frameRefreshers = [];
      rowsHost.textContent = '';
      frames.forEach(function (f, i) { rowsHost.appendChild(buildRow(f, i)); });
      if (!frames.length) rowsHost.appendChild(h('div', { class: 'note', text: 'No frames yet. Add up to ' + Model.MAX_FRAMES + '.' }));
    }
    frameRefreshers.forEach(function (fn) { fn(state, result); });
    addBtn.setAttribute('aria-disabled', String(frames.length >= Model.MAX_FRAMES));
  }

  // ------------------------------------------------------------------ results
  function rect(r) {
    if (!r) return 'none';
    return '[' + r.x0 + ', ' + r.x1 + ') × [' + r.y0 + ', ' + r.y1 + '), ' + (r.x1 - r.x0) + ' × ' + (r.y1 - r.y0) + ' px';
  }

  function cornerTable(title, pix, note) {
    var body;
    if (!pix) body = h('div', { class: 'note', text: 'n/a: the frame cannot be mapped to the image.' });
    else {
      body = h('table', { class: 'rd frame-corners' }, ['TL', 'TR', 'BR', 'BL'].map(function (k) {
        return h('tr', null, [h('td', { class: 'rl', text: k }), h('td', { class: 'rv', text: pt(pix[k]) })]);
      }));
    }
    return h('div', { class: 'frame-block' }, [h('div', { class: 'subhead', text: title }), body, note ? h('div', { class: 'note', text: note }) : null]);
  }

  function row(label, value) {
    return h('tr', null, [h('td', { class: 'rl', text: label }), h('td', { class: 'rv', text: value })]);
  }

  function frameResult(fr) {
    var native = fr.panelPixels, content = fr.contentPixels;
    var correctedActive = !!(content && native && content !== native && JSON.stringify(content) !== JSON.stringify(native));
    var cover = fr.coveringPixelRect || {};
    var sh = fr.shadow;
    var kids = [
      h('div', { class: 'subhead frame-title', text: fr.name || fr.frameId }),
      cornerTable('Native image pixel corners', native, 'Pixel coordinates of the projector image, origin top-left; assumes hardware keystone is off.')
    ];
    if (correctedActive) {
      kids.push(cornerTable('Corrected content pixel corners', content, 'Theoretical simulator correction, not a measured projector setting.'));
    }
    kids.push(h('table', { class: 'rd frame-bounds' }, [
      row('Covering pixel rectangle (clipped)', rect(cover.clipped)),
      row('Covering pixel rectangle (unclipped)', rect(cover.unclipped))
    ]));
    kids.push(h('table', { class: 'rd frame-measures' }, [
      row('Coverage (share of frame front inside the native image)', typeof fr.nativeCoverage === 'number' ? pct(fr.nativeCoverage) : 'n/a'),
      row('Sampled lighting (share of sample points lit)', typeof fr.litSampleFraction === 'number' ? pct(fr.litSampleFraction) : 'n/a'),
      row(SHADOW_LABEL, sh ? 'exposed ' + fmt(sh.exposedArea, 3) + ' m² of ' + fmt(sh.silhouetteArea, 3) + ' m² silhouette' : 'n/a')
    ]));
    (fr.issues || []).forEach(function (issue) {
      kids.push(h('div', { class: 'w frame-issue', 'data-code': issue.code, text: issue.message }));
    });
    return h('div', { class: 'frame-result', 'data-frame': fr.frameId }, kids);
  }

  function refreshResults(state, result) {
    resultsBody.textContent = '';
    var list = result.frames || [];
    if (!list.length) {
      resultsBody.appendChild(h('div', { class: 'note', text: 'No frames. Add a frame in the Frames panel to see pixel corners, coverage and shadow.' }));
      return;
    }
    list.forEach(function (fr) { resultsBody.appendChild(frameResult(fr)); });
    if (result.body && result.body.collides) {
      resultsBody.appendChild(h('div', { class: 'w', text: 'Projector body intersects ' + result.body.collidesWith + '; this position is not physically possible.' }));
    }
  }

  // ------------------------------------------------------------------ init
  function init(app) {
    App = app;
    kit = PS.Panels && PS.Panels.kit;
    if (!kit) return;
    h = kit.h; fmt = kit.fmt;
    frameRefreshers = []; rowKey = null;

    var framesHost = document.getElementById('panel-frames');
    var resultsHost = document.getElementById('panel-frame-results');

    if (framesHost) {
      addMsg = h('div', { class: 'fmsg frame-add-msg', role: 'status' });
      addBtn = kit.button('Add frame', addFrame, 'primary', 'Add an example frame, up to ' + Model.MAX_FRAMES);
      rowsHost = h('div', { class: 'frame-rows' });
      kit.section(framesHost, 'Frames', true, [
        h('div', { class: 'note', text: 'Up to ' + Model.MAX_FRAMES + ' frames, in metres. u is the left edge from the left wall; bottom is the outer bottom edge.' }),
        rowsHost,
        h('div', { class: 'btnrow' }, [addBtn]), addMsg,
        kit.checkbox('White on frames', function (s) { return !!(s.display && s.display.whiteOnFrames); },
          function (d, v) { d.display.whiteOnFrames = v; }, 'frames-white'),
        h('div', { class: 'subhead', text: 'Display notes' }),
        h('div', { class: 'note session-note', text: 'Images are session-only; reload them after reopening.' }),
        h('div', { class: 'note ambient-note', text: 'Projection side dark; opposite side lit. Opposite-side spill is not simulated.' })
      ]);
    }
    if (resultsHost) {
      resultsBody = h('div', { class: 'frame-results-body' });
      kit.section(resultsHost, 'Frame results', true, [resultsBody]);
    }
    App.on('change', function (e) {
      if (rowsHost) refreshRows(e.state, e.result);
      if (resultsBody) refreshResults(e.state, e.result);
    });
    if (rowsHost) refreshRows(App.state, App.result);
    if (resultsBody) refreshResults(App.state, App.result);
  }

  PS.FrameUI = { init: init, SHADOW_LABEL: SHADOW_LABEL };

  // ------------------------------------------------------------------ browser probes (run by PS.SelfTest)
  (function () {
    var pending = (PS.pendingSelfTests = PS.pendingSelfTests || []);
    function check(rows) {
      var bad = rows.filter(function (r) { return !r[1]; }).map(function (r) { return r[0]; });
      return { ok: !bad.length, detail: bad.length ? 'failed: ' + bad.join('; ') : rows.length + ' assertions' };
    }
    function fresh(A) { A.replaceState(Model.startMainHall(Model.defaultState()), 'selftest'); }
    function typeInto(label, text) {
      var i = document.querySelector('[aria-label="' + label + '"]');
      i.value = text;
      i.dispatchEvent(new root.Event('change', { bubbles: true }));
      return i;
    }
    function host() { return document.getElementById('panel-frames'); }
    function clickAdd() {
      var b = Array.prototype.filter.call(host().querySelectorAll('button'), function (x) { return x.textContent === 'Add frame'; })[0];
      b.click();
    }

    pending.push(['frames.controls-update-state', function (A) {
      if (!host()) return { ok: false, detail: '#panel-frames missing' };
      fresh(A);
      var rows = [];
      clickAdd();
      rows.push(['frame added to state', A.state.frames.length === 1]);
      typeInto('Frame 1 width', '1.2');
      rows.push(['width stored in state', A.state.frames[0].width === 1.2]);
      typeInto('Frame 1 depth', '-1');
      var depthBox = document.querySelector('[aria-label="Frame 1 depth"]');
      rows.push(['bad depth rejected, state kept', A.state.frames[0].depth === 0.03 && depthBox.classList.contains('invalid')]);
      typeInto('Frame 1 height', '0');
      rows.push(['zero height rejected, state kept', A.state.frames[0].height === 0.5]);
      typeInto('Frame 1 u', '0.4'); typeInto('Frame 1 bottom', '0.9');
      rows.push(['u and bottom stored', A.state.frames[0].u === 0.4 && A.state.frames[0].bottom === 0.9]);
      host().querySelector('[data-frame] .xbtn').click();
      rows.push(['frame removed', A.state.frames.length === 0]);
      return check(rows);
    }]);

    pending.push(['frames.fourth-frame-rejected', function (A) {
      if (!host()) return { ok: false, detail: '#panel-frames missing' };
      fresh(A);
      clickAdd(); clickAdd(); clickAdd();
      var before = JSON.stringify(A.state.frames);
      clickAdd();
      var msg = host().querySelector('.frame-add-msg').textContent;
      var rows = [
        ['three frames admitted', JSON.parse(before).length === 3],
        ['fourth not admitted', A.state.frames.length === 3 && JSON.stringify(A.state.frames) === before],
        ['reason shown', msg.indexOf('At most 3') === 0],
        ['unique ids', new Set(A.state.frames.map(function (f) { return f.id; })).size === 3]
      ];
      return check(rows);
    }]);

    pending.push(['frames.result-labels', function (A) {
      var out = document.getElementById('panel-frame-results');
      if (!out) return { ok: false, detail: '#panel-frame-results missing' };
      fresh(A);
      A.update(function (d) { d.frames = [{ id: 'frame-1', name: 'K2', u: 2.6, bottom: 1.2, width: 0.8, height: 0.5, depth: 0.03 }]; }, 'selftest');
      var text = out.textContent;
      var rows = [
        ['corner names', ['TL', 'TR', 'BR', 'BL'].every(function (k) { return out.querySelector('.frame-corners') && text.indexOf(k) >= 0; })],
        ['bounds row', text.indexOf('Covering pixel rectangle') >= 0],
        ['coverage labelled', text.indexOf('Coverage') >= 0],
        ['sampled lighting labelled', text.indexOf('Sampled lighting') >= 0],
        ['shadow labelled as potential', text.indexOf(SHADOW_LABEL) >= 0],
        ['no bare "Shadow" row claiming a measurement', text.indexOf('Measured') < 0]
      ];
      return check(rows);
    }]);

    pending.push(['frames.main-reset-keeps-main-hall', function (A) {
      var room = document.getElementById('panel-room');
      if (!room) return { ok: false, detail: '#panel-room missing' };
      fresh(A);
      A.update(function (d) { d.room.width = 6.0; }, 'selftest');
      var b = Array.prototype.filter.call(room.querySelectorAll('button'), function (x) { return /^Reset room/.test(x.textContent); })[0];
      b.click();
      var rows = [
        ['still plain', PS.Room.isPlain(A.state.room)],
        ['Main hall width restored', A.state.room.width === PS.Room.mainHall().width],
        ['not Ubuntu fixtures', A.state.room.name === 'Main hall' && A.state.room.featureSet === 'plain']
      ];
      return check(rows);
    }]);

    pending.push(['frames.phone-layout-360', function (A) {
      if (root.innerWidth > 820) return { ok: true, detail: 'phone layout skipped' };
      fresh(A);
      clickAdd();
      var bad = [];
      ['panel-frames', 'panel-frame-results'].forEach(function (id) {
        var p = document.getElementById(id);
        if (!p) { bad.push(id + ' missing'); return; }
        Array.prototype.forEach.call(p.querySelectorAll('details'), function (d) { d.open = true; });
        var edge = root.innerWidth;
        Array.prototype.forEach.call(p.querySelectorAll('input, button'), function (el) {
          var r = el.getBoundingClientRect();
          if (!r.width) return;
          if (r.left < -1 || r.right > edge + 1) bad.push(id + ' clipped ' + (el.getAttribute('aria-label') || el.textContent));
          if (el.type !== 'checkbox' && r.height < 44) bad.push(id + ' touch target ' + Math.round(r.height) + 'px');
        });
      });
      if (document.documentElement.scrollWidth > root.innerWidth) bad.push('horizontal scroll');
      return { ok: !bad.length, detail: bad.length ? bad.join('; ') : 'controls fit and are at least 44px' };
    }]);
  })();
})(window);
