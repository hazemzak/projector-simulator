/* P12 FAST cross-module checkpoint probes (F06). Run by PS.SelfTest with ?selftest=1.
 * Every expected value is a literal copied from PLAN_P12_FAST.md section 5 (K2, K5), rounded the way the
 * export prints it; none is computed from simulator code. Each probe restores the state and view it found. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};

  function probe(name, fn) {
    if (PS.SelfTest && PS.SelfTest.register) PS.SelfTest.register(name, fn);
    else (PS.pendingSelfTests = PS.pendingSelfTests || []).push([name, fn]);
  }
  function check(rows) {
    var bad = rows.filter(function (r) { return !r[1]; }).map(function (r) { return r[0]; });
    return { ok: !bad.length, detail: bad.length ? 'failed: ' + bad.join('; ') : rows.length + ' assertions' };
  }
  // Run body(A) and put back the state and view that were there before, whatever happens.
  function guarded(body) {
    return function (A) {
      var before = JSON.parse(JSON.stringify(A.state)), view = A.getView();
      try { return body(A); }
      finally { A.replaceState(before, 'selftest'); if (A.getView() !== view) A.setView(view); }
    };
  }
  var K2 = { id: 'f1', name: 'K2', u: 2.5, bottom: 1.25, width: 0.8, height: 0.5, depth: 0.1 };
  function mainHallWithK2(A) {
    A.replaceState(PS.Model.startMainHall(A.state), 'selftest');
    A.update(function (d) { d.frames = [JSON.parse(JSON.stringify(K2))]; }, 'selftest');
  }
  function darkIn(c, x, y, w, h) {
    var d = c.getContext('2d').getImageData(x, y, w, h).data, n = 0;
    for (var i = 0; i < d.length; i += 4) if (d[i] < 140 && d[i + 1] < 140 && d[i + 2] < 140) n++;
    return n;
  }

  probe('p12fast.hosts-initialized', function (A) {
    var rows = [['Frames core loaded', !!PS.Frames], ['FrameEffects core loaded', !!PS.FrameEffects], ['FrameUI loaded', !!(PS.FrameUI && PS.FrameUI.init)]];
    ['panel-frames', 'panel-frame-results'].forEach(function (id) {
      var h = document.getElementById(id);
      rows.push([id + ' present', !!h]);
      rows.push([id + ' initialized with controls', !!h && h.querySelectorAll('button, details, input').length > 0]);
    });
    var add = Array.prototype.filter.call((document.getElementById('panel-frames') || document.body).querySelectorAll('button'),
      function (b) { return b.textContent === 'Add frame'; });
    rows.push(['Add frame control exists', add.length === 1]);
    return check(rows);
  });

  probe('p12fast.main-hall-opens-wall-view', guarded(function (A) {
    A.replaceState(PS.Model.defaultState(), 'selftest');
    A.setView('persp');
    var rows = [['legacy start is not Main hall', A.state.room.name !== 'Main hall']];
    A.replaceState(PS.Model.startMainHall(A.state), 'selftest');
    rows.push(['non-panel change leaves the view alone', A.getView() === 'persp']);
    A.replaceState(PS.Model.defaultState(), 'selftest');
    A.replaceState(PS.Model.startMainHall(A.state), 'panel');
    rows.push(['panel start opens wall view', A.getView() === 'wall']);
    rows.push(['target enabled on start', A.state.target.enabled === true]);
    A.setView('top');
    A.update(function (d) { d.projector.lens.x = 3.2; }, 'panel');
    rows.push(['editing inside Main hall keeps the chosen view', A.getView() === 'top']);
    return check(rows);
  }));

  probe('p12fast.export-text-k2-corners', guarded(function (A) {
    mainHallWithK2(A);
    var t = PS.Export.summaryText();
    return check([
      ['TL corner', t.indexOf('TL 311.79, 307.69') >= 0],
      ['TR corner', t.indexOf('TR 836.92, 307.69') >= 0],
      ['BR corner', t.indexOf('BR 836.92, 635.90') >= 0],
      ['BL corner', t.indexOf('BL 311.79, 635.90') >= 0],
      ['integer covering rectangle', t.indexOf('[311, 837) × [307, 636)') >= 0],
      ['integer size', t.indexOf('526 × 329 px') >= 0],
      ['coverage 100%', t.indexOf('native coverage 100.0%') >= 0],
      ['shadow worded as potential', t.indexOf('Potential geometric shadow') >= 0],
      ['Main hall provenance, not photographic estimates', t.indexOf('Room: Main hall') >= 0 && t.indexOf('photographic estimates') < 0],
      ['assumed ceiling labelled', t.indexOf('assumed') >= 0],
      ['no grey-line wording on Main hall', t.toLowerCase().indexOf('grey') < 0]
    ]);
  }));

  probe('p12fast.export-text-k5-shadow-area', guarded(function (A) {
    A.replaceState(PS.Model.startMainHall(A.state), 'selftest');
    A.update(function (d) {
      delete d.room.column;
      d.projector.lens = { x: 4, y: 4, z: 1.5 };
      d.calibration['epson-pl955wh'] = { vOffset: -0.5, vOffsetStatus: 'measured', hOffset: -0.5, hOffsetStatus: 'assumed' };
      d.frames = [JSON.parse(JSON.stringify(K2))];
    }, 'selftest');
    var t = PS.Export.summaryText();
    return check([
      ['K5 exposed area 0.0299 m2', t.indexOf('exposed 0.0299 m²') >= 0],
      ['K5 silhouette 0.4299 m2', t.indexOf('silhouette 0.4299 m²') >= 0]
    ]);
  }));

  probe('p12fast.export-png-three-frames-not-clipped', guarded(function (A) {
    mainHallWithK2(A);
    A.update(function (d) {
      d.frames = [
        { id: 'f1', name: 'K2 frame with a deliberately long name to force wrapping of the first row in the footer', u: 2.5, bottom: 1.25, width: 0.8, height: 0.5, depth: 0.1 },
        { id: 'f2', name: 'Second', u: 2.1, bottom: 1.1, width: 0.3, height: 0.3, depth: 0.05 },
        { id: 'f3', name: 'Third', u: 3.4, bottom: 1.6, width: 0.4, height: 0.4, depth: 0.05 }
      ];
    }, 'selftest');
    var c = PS.Export.annotatedCanvas('wall'), base = A.renderToCanvas('wall', 2400);
    var fh = c.height - base.height, w = c.width;
    var entries = PS.Export.summaryEntries();
    return check([
      ['width 2400', w === 2400],
      ['footer grows beyond the legacy 264 px', fh > 264],
      ['every entry has at least one row', c.footerRows >= entries.length],
      ['footer fits its rows', fh >= 36 + (c.footerRows - 1) * 24 + 28],
      ['text drawn in footer', darkIn(c, 0, base.height + 4, w, fh - 4) > 800],
      ['nothing in right margin', darkIn(c, w - 20, base.height + 4, 20, fh - 4) === 0],
      ['nothing cut at the bottom edge', darkIn(c, 0, c.height - 4, w, 4) === 0],
      ['last row drawn', darkIn(c, 0, c.height - 28 - 18, w, 18) > 0],
      ['text export lists three frames', (PS.Export.summaryText().match(/^Frame \d /gm) || []).length === 3]
    ]);
  }));

  probe('p12fast.export-png-legacy-footer-unchanged', guarded(function (A) {
    A.replaceState(PS.Model.defaultState(), 'selftest');
    var c = PS.Export.annotatedCanvas('wall'), base = A.renderToCanvas('wall', 2400);
    return check([
      ['legacy room has no frame rows', PS.Export.summaryText().indexOf('Frames (') < 0],
      ['legacy footer is the fixed 264 px', c.height - base.height === 264],
      ['legacy honesty line kept', PS.Export.honestyLine().indexOf('Room: photographic estimates unless marked measured') === 0]
    ]);
  }));
})(window);
