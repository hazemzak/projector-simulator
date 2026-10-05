/* PS.SelfTest: in-browser self test (?selftest=1), PLAN.md section 8 P3.
 * Extension point for P5 and P6: PS.SelfTest.register(name, fn), fn(App) -> {ok, detail} or a promise of it.
 * Registered checks run after the built-in ones, in registration order. Output: <pre id="selftest">, one
 * line per check ("PASS|FAIL name detail"), and document.body.dataset.selftest = 'PASS' | 'FAIL'. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};

  var registered = [];

  function register(name, fn) { registered.push({ name: name, fn: fn }); }

  // Files that load before this one cannot call register() yet; they may queue instead:
  //   (PS.pendingSelfTests = PS.pendingSelfTests || []).push([name, fn])
  function drainPending() {
    (PS.pendingSelfTests || []).forEach(function (p) { register(p[0], p[1]); });
    PS.pendingSelfTests = [];
  }

  function fmt(v, d) { return (typeof v === 'number') ? v.toFixed(d == null ? 4 : d) : String(v); }

  // Compare actual values with expected ones; rows are [label, actual, expected, tolerance].
  function compare(rows) {
    var bad = [], parts = [];
    rows.forEach(function (r) {
      var ok = Math.abs(r[1] - r[2]) <= r[3];
      parts.push(r[0] + '=' + fmt(r[1]));
      if (!ok) bad.push(r[0] + ' got ' + fmt(r[1]) + ' expected ' + fmt(r[2]) + ' +-' + r[3]);
    });
    return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: parts.join(' ') };
  }

  function presetState(id) { return PS.Model.PRESETS[id].patch(PS.Model.defaultState()); }

  // ---------------------------------------------------------------- core: TV1 and TV5 through PS.Optics
  function opticsCheck(App, yaw) {
    var s = presetState('default');
    s.projector.yawDeg = yaw;
    var prof = PS.Model.effectiveProfile(s, PS.Profiles);
    var O = PS.Optics, img = O.imageOnWall(prof, s.projector), B = O.basis(s.projector.yawDeg, 0, 0);
    if (!img) return { ok: false, detail: 'imageOnWall returned null' };
    var ks = O.keystone(B.f, prof), c = img.corners, rows;
    if (yaw === 0) {
      rows = [
        ['TL.x', c.TL[0], 0.1750, 2e-4], ['TL.z', c.TL[2], 2.2938, 2e-4], ['TR.x', c.TR[0], 2.7250, 2e-4],
        ['BR.z', c.BR[2], 0.7000, 2e-4], ['widthTop', img.widthTop, 2.5500, 2e-4], ['heightLeft', img.heightLeft, 1.5938, 2e-4],
        ['area', img.area, 4.0641, 2e-4], ['lux', img.luxNominal, 787.4, 0.2], ['cornerLuxTL', img.cornerLux.TL, 787.4, 0.2],
        ['cornerLuxBR', img.cornerLux.BR, 787.4, 0.2], ['px/cm', img.pxPerCmAvg, 5.0196, 0.002],
        ['pxMin', img.pxPerCmMin, 5.020, 0.002], ['pxMax', img.pxPerCmMax, 5.020, 0.002],
        ['kappaV', ks.vDeg, 0, 0.01], ['kappaH', ks.hDeg, 0, 0.01], ['axial', img.axial, 3.519, 2e-4],
        ['roll', O.wallRollDeg(prof, s.projector), 0, 0.01]
      ];
    } else {
      rows = [
        ['TL.x', c.TL[0], 0.8348, 2e-4], ['TL.z', c.TL[2], 2.2212, 2e-4], ['TR.x', c.TR[0], 3.4749, 2e-4],
        ['TR.z', c.TR[2], 2.4288, 2e-4], ['BR.x', c.BR[0], 3.4749, 2e-4], ['BL.x', c.BL[0], 0.8348, 2e-4],
        ['widthTop', img.widthTop, 2.6482, 2e-4], ['widthBottom', img.widthBottom, 2.6401, 2e-4],
        ['heightLeft', img.heightLeft, 1.5212, 2e-4], ['heightRight', img.heightRight, 1.7288, 2e-4],
        ['area', img.area, 4.2900, 2e-4], ['lux', img.luxNominal, 745.9, 0.2],
        ['cornerLuxTL', img.cornerLux.TL, 905.6, 0.2], ['cornerLuxBL', img.cornerLux.BL, 905.6, 0.2],
        ['cornerLuxTR', img.cornerLux.TR, 616.9, 0.2], ['cornerLuxBR', img.cornerLux.BR, 616.9, 0.2],
        ['px/cm', img.pxPerCmAvg, 4.8856, 0.002], ['pxMin', img.pxPerCmMin, 4.443, 0.002],
        ['pxMax', img.pxPerCmMax, 5.383, 0.002], ['kappaH', ks.hDeg, 10.000, 0.01], ['axial', img.axial, 3.5733, 2e-4]
      ];
    }
    return compare(rows);
  }

  // ---------------------------------------------------------------- GPU pixel checks on the wall view
  var WALL_W = 580;

  function whiteCanvas(prof) {
    var c = document.createElement('canvas');
    c.width = prof.nativeW; c.height = prof.nativeH;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // Render the exact wall view of the current state and return a luminance sampler at room (x, z).
  function wallSampler(App) {
    var cv = App.renderToCanvas('wall', WALL_W, { opticalOnly: true, exact: true });
    var g = cv.getContext('2d'), room = App.state.room, w = cv.width, h = cv.height;
    var sampler = function (x, z) {
      var px = Math.min(w - 1, Math.max(0, Math.floor(x / room.width * w)));
      var py = Math.min(h - 1, Math.max(0, Math.floor((1 - z / room.ceiling) * h)));
      var d = g.getImageData(px, py, 1, 1).data;
      return (d[0] + d[1] + d[2]) / 3;
    };
    sampler.canvas = cv;
    sampler.room = room;
    return sampler;
  }

  function line(label, v) { return label + '=' + v.toFixed(1); }

  function litCheck(name, lit, litLabel, unlit, unlitLabel) {
    return { name: name, ok: lit > 1.5 * unlit, detail: line(litLabel, lit) + ' > 1.5*' + line(unlitLabel, unlit) + ' (' + fmt(lit / unlit, 2) + 'x)' };
  }

  function unlitCheck(name, v, vLabel, ref, refLabel, frac) {
    var rel = Math.abs(v - ref) / ref;
    return { name: name, ok: rel <= frac, detail: line(vLabel, v) + ' vs ' + line(refLabel, ref) + ' (' + fmt(rel * 100, 1) + '% <= ' + frac * 100 + '%)' };
  }

  function gpuChecks(App) {
    var out = [], O = PS.Optics, prof, s, sm;
    function load(id) {
      var r = App.replaceState(presetState(id), 'selftest');
      if (!r.ok) throw new Error('preset ' + id + ' rejected: ' + r.errors.join('; '));
      prof = App.result.profile;
      App.setContentImage(whiteCanvas(prof), 'white');
      return wallSampler(App);
    }

    // preset default
    sm = load('default');
    out.push(litCheck('gpu.default.lit-centre', sm(1.45, 1.50), 'lit(1.45,1.50)', sm(1.45, 2.45), 'unlit(1.45,2.45)'));
    out.push(litCheck('gpu.default.image-left-edge', sm(0.185, 1.50), 'lit(0.185,1.50)', sm(0.165, 1.50), 'unlit(0.165,1.50)'));
    out.push(unlitCheck('gpu.default.pier-face-unlit', sm(0.08, 1.50), 'pier(0.08,1.50)', sm(0.08, 2.45), 'unlit(0.08,2.45)', 0.10));

    // extra: scan the image edges along z = 1.5 and compare with the CPU quad (+-1 cm)
    (function () {
      var cv = sm.canvas, g = cv.getContext('2d'), w = cv.width, h = cv.height, room = sm.room;
      var py = Math.min(h - 1, Math.floor((1 - 1.5 / room.ceiling) * h));
      var row = g.getImageData(0, py, w, 1).data, lum = [], lo = 1e9, hi = -1e9, i;
      for (i = 0; i < w; i++) { var l = (row[4 * i] + row[4 * i + 1] + row[4 * i + 2]) / 3; lum.push(l); lo = Math.min(lo, l); hi = Math.max(hi, l); }
      var thr = (lo + hi) / 2, first = -1, last = -1;
      for (i = 0; i < w; i++) if (lum[i] > thr) { if (first < 0) first = i; last = i; }
      var xl = first / w * room.width, xr = (last + 1) / w * room.width;
      var img = O.imageOnWall(App.result.profile, App.state.projector);
      var ok = Math.abs(xl - img.corners.TL[0]) <= 0.01 && Math.abs(xr - img.corners.TR[0]) <= 0.01;
      out.push({ name: 'gpu.default.edge-scan', ok: ok,
        detail: 'left ' + fmt(xl, 3) + ' vs ' + fmt(img.corners.TL[0], 3) + ', right ' + fmt(xr, 3) + ' vs ' + fmt(img.corners.TR[0], 3) + ' (+-0.010)' });
    })();

    // preset occluder
    sm = load('occluder');
    (function () {
      var st = App.state, L = O.lensOf(st.projector), box = st.obstacles.filter(function (o) { return o.id === 'testbox'; })[0];
      var xs = [], zs = [];
      for (var i = 0; i < 8; i++) {
        var c = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
        var hit = O.hitPlaneY0(L, [c[0] - L[0], c[1] - L[1], c[2] - L[2]]);
        xs.push(hit.point[0]); zs.push(hit.point[2]);
      }
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), z0 = Math.min.apply(null, zs), z1 = Math.max.apply(null, zs);
      var inside = 1.45 > x0 && 1.45 < x1 && 1.80 > z0 && 1.80 < z1 && !(1.45 > x0 && 1.45 < x1 && 1.55 > z0 && 1.55 < z1) &&
                   !(1.25 > x0 && 1.25 < x1);
      out.push({ name: 'gpu.occluder.shadow-region', ok: inside && Math.abs(x0 - 1.348) < 2e-3 && Math.abs(x1 - 1.552) < 2e-3 &&
                 Math.abs(z0 - 1.667) < 2e-3 && Math.abs(z1 - 1.928) < 2e-3,
        detail: 'x ' + fmt(x0, 3) + '-' + fmt(x1, 3) + ' z ' + fmt(z0, 3) + '-' + fmt(z1, 3) });
    })();
    var ref = sm(2.85, 1.80);
    out.push(unlitCheck('gpu.occluder.shadow-dark', sm(1.45, 1.80), 'shadow(1.45,1.80)', ref, 'unlit(2.85,1.80)', 0.15));
    out.push(litCheck('gpu.occluder.below-shadow-lit', sm(1.45, 1.55), 'lit(1.45,1.55)', ref, 'unlit(2.85,1.80)'));
    out.push(litCheck('gpu.occluder.beside-shadow-lit', sm(1.25, 1.80), 'lit(1.25,1.80)', ref, 'unlit(2.85,1.80)'));

    // preset spill
    sm = load('spill');
    out.push(litCheck('gpu.spill.pier-face-lit', sm(0.08, 1.50), 'lit(0.08,1.50)', sm(0.08, 2.45), 'unlit(0.08,2.45)'));

    // extra: yaw10 has a lit centre and an unlit strip left of the image
    sm = load('yaw10');
    out.push(litCheck('gpu.yaw10.lit-centre', sm(2.0, 1.00), 'lit(2.0,1.00)', sm(0.5, 1.00), 'unlit(0.5,1.00)'));
    return out;
  }

  // ---------------------------------------------------------------- run
  function run(App) {
    drainPending();
    var lines = [], allOk = true;
    var saved = { state: JSON.parse(JSON.stringify(App.state)), content: App.content, view: App.getView() };

    function record(name, r) {
      if (!r.ok) allOk = false;
      lines.push((r.ok ? 'PASS ' : 'FAIL ') + name + ' ' + r.detail);
    }
    function guard(name, fn) {
      try { var r = fn(); if (r && typeof r.then === 'function') return r.then(function (x) { record(name, x); }, function (e) { record(name, { ok: false, detail: 'threw ' + (e && e.message || e) }); }); record(name, r); }
      catch (e) { record(name, { ok: false, detail: 'threw ' + (e && e.message || e) }); }
      return null;
    }

    // environment
    guard('env.webgl2', function () {
      var gl = App.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      var name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return { ok: typeof root.WebGL2RenderingContext !== 'undefined' && gl instanceof root.WebGL2RenderingContext, detail: String(name) };
    });
    guard('env.float-depth-texture', function () {
      App.renderNow();
      var rt = App.depthTarget, dt = rt && rt.depthTexture;
      return { ok: !!dt && dt.type === root.THREE.FloatType, detail: rt ? rt.width + 'x' + rt.height + ' float depth' : 'no depth target' };
    });
    guard('optics.TV1', function () { return opticsCheck(App, 0); });
    guard('optics.TV5', function () { return opticsCheck(App, 10); });

    try {
      gpuChecks(App).forEach(function (c) { record(c.name, c); });
    } catch (e) { record('gpu.pixel-checks', { ok: false, detail: 'threw ' + e.message }); }

    // put the page back as it was before the registered checks run (they may change it themselves)
    function restore() {
      App.replaceState(saved.state, 'selftest');
      if (saved.content.kind === 'testcard') App.setContentTestCard();
      App.setView(saved.view);
    }
    restore();

    var chain = Promise.resolve();
    registered.forEach(function (c) {
      chain = chain.then(function () {
        var p = guard(c.name, function () { return c.fn(App); });
        return p;
      });
    });
    return chain.then(function () {
      try { restore(); } catch (e) { /* keep the report */ }
      var pre = document.getElementById('selftest');
      if (!pre) {
        pre = document.createElement('pre');
        pre.id = 'selftest';
        pre.style.cssText = 'position:fixed;right:8px;bottom:8px;max-width:60vw;max-height:45vh;overflow:auto;margin:0;' +
          'padding:6px 8px;background:#fff;color:#111;border:1px solid #888;font:11px/1.35 Consolas,monospace;white-space:pre;z-index:200';
        document.body.appendChild(pre);
      }
      pre.textContent = lines.join('\n');
      document.body.dataset.selftest = allOk ? 'PASS' : 'FAIL';
      if (root.parent !== root) root.parent.postMessage({ selftest: allOk ? 'PASS' : 'FAIL', lines: lines }, '*');
      return allOk;
    });
  }

  PS.SelfTest = { register: register, run: run };
})(window);
