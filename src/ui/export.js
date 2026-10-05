/* PS.Export: annotated PNG export of the wall and top views, and the plain-text summary (PLAN.md 6.4).
 * Owned by P6. Called as PS.Export.init(PS.App) by app.js. Every image and summary carries the honesty
 * line about estimates and the vertical offset. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};

  var WIDTH = 2400;          // exported image width, px
  var FOOTER_H = 264;        // white footer under the view, px
  var FONT_PX = 22;
  var MIN_FONT_PX = 16;
  var LINE_H = 24;
  var MAX_WARNINGS = 4;
  var TOP_MARGIN = 0.08;     // framing margin of the ortho views; must match MARGIN in src/render/scene.js

  var App = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function f(v, d) { return v.toFixed(d); }

  function dateText(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function placementName() {
    return (PS.Storage && PS.Storage.currentName && PS.Storage.currentName()) || '';
  }

  // ------------------------------------------------------------------ text
  // Returns [{text, kind}] where kind is 'title' | 'text' | 'error' | 'warn' | 'info' | 'honesty'.
  function summaryEntries() {
    var s = App.state, r = App.result, p = s.projector, prof = r.profile, out = [];
    function add(text, kind) { out.push({ text: text, kind: kind || 'text' }); }

    add('Projector placement simulator — ' + (placementName() || 'current placement') + ' — ' + dateText(), 'title');
    add('Projector: ' + prof.name + ' · mount: ' + (p.mount === 'ceiling' ? 'ceiling (inverted)' : 'upright'));
    add('Lens x ' + f(p.lens.x, 3) + '  y ' + f(p.lens.y, 3) + '  z ' + f(p.lens.z, 3) + ' m · yaw ' + f(p.yawDeg, 1) + '°  pitch ' +
      f(p.pitchDeg, 1) + '°  roll ' + f(p.rollDeg, 1) + '° · throw ratio ' + f(p.throwRatio, 3) +
      ' · throw ' + f(r.throw.axial, 3) + ' m axial (' + f(r.throw.perpendicular, 3) + ' m to wall)');

    if (r.image) {
      var im = r.image, c = im.corners;
      var same = Math.abs(im.widthTop - im.widthBottom) < 5e-4 && Math.abs(im.heightLeft - im.heightRight) < 5e-4;
      add('Image ' + (same ? f(im.widthTop, 3) + ' × ' + f(im.heightLeft, 3) + ' m (W × H)' :
        'W ' + f(im.widthTop, 3) + ' top / ' + f(im.widthBottom, 3) + ' bottom × H ' + f(im.heightLeft, 3) + ' left / ' +
        f(im.heightRight, 3) + ' right m') + ' · corners (x, z m): TL ' + f(c.TL[0], 3) + ', ' + f(c.TL[2], 3) +
        ' · TR ' + f(c.TR[0], 3) + ', ' + f(c.TR[2], 3) + ' · BR ' + f(c.BR[0], 3) + ', ' + f(c.BR[2], 3) +
        ' · BL ' + f(c.BL[0], 3) + ', ' + f(c.BL[2], 3));
    } else {
      add('Image: does not reach the back wall plane.');
    }

    var parts = [];
    if (r.lux) parts.push('Nominal lux ' + f(r.lux.nominal, 0) + ' (corners ' + f(r.lux.min, 0) + '–' + f(r.lux.max, 0) + ')');
    if (r.pxPerCm) parts.push(f(r.pxPerCm.avg, 2) + ' px/cm (' + f(r.pxPerCm.min, 2) + '–' + f(r.pxPerCm.max, 2) + ')');
    var k = r.keystone;
    parts.push('Keystone V ' + f(k.v, 1) + '° / H ' + f(k.h, 1) + '° (inside ±' + k.limitV + '°: ' + (k.inRange ? 'yes' : 'no') + ')');
    add(parts.join(' · '));

    var ws = r.warnings, shown = ws.length > MAX_WARNINGS ? ws.slice(0, MAX_WARNINGS - 1) : ws;
    shown.forEach(function (w) { add({ error: 'ERROR ', warn: 'WARN ', info: 'NOTE ' }[w.level] + w.text, w.level); });
    if (ws.length > shown.length) {
      var more = ws.length - shown.length;
      add('+ ' + more + ' more warning' + (more === 1 ? '' : 's') + ' (see the Warnings panel)', 'info');
    }

    add(honestyLine(), 'honesty');
    return out;
  }

  function honestyLine() {
    var prof = App.result.profile;
    var off = prof.vOffsetStatus === 'measured' ? 'measured ' + f(prof.vOffset, 2) : 'provisional ' + f(prof.vOffset, 2);
    return 'Room: photographic estimates unless marked measured — verify on site. Vertical offset: ' + off + '.';
  }

  function summaryLines() { return summaryEntries().map(function (e) { return e.text; }); }
  function summaryText() { return summaryLines().join('\n') + '\n'; }

  // ------------------------------------------------------------------ images
  var KIND_COLOUR = { title: '#252027', text: '#252027', error: '#504653', warn: '#504653', info: '#504653', honesty: '#504653' };

  function drawFitted(g, text, x, y, maxW, bold) {
    var size = FONT_PX;
    g.font = (bold ? 'bold ' : '') + size + 'px "Segoe UI", Arial, sans-serif';
    while (g.measureText(text).width > maxW && size > MIN_FONT_PX) {
      size--;
      g.font = (bold ? 'bold ' : '') + size + 'px "Segoe UI", Arial, sans-serif';
    }
    var t = text;
    while (g.measureText(t).width > maxW && t.length > 4) t = t.slice(0, -2);
    g.fillText(t === text ? t : t + '…', x, y);
  }

  function drawScaleBar(g, w, h) {
    var d = App.state.room;
    var pxPerM = w / (Math.max(d.width, d.depth) * (1 + TOP_MARGIN));
    var x0 = 60, y0 = h - 70, len = pxPerM;
    g.save();
    g.fillStyle = '#0D0C0E99';
    g.fillRect(x0 - 20, y0 - 44, len + 40 + 56, 74);
    g.strokeStyle = '#FFFFFF';
    g.fillStyle = '#FFFFFF';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x0, y0); g.lineTo(x0 + len, y0);
    g.moveTo(x0, y0 - 12); g.lineTo(x0, y0 + 12);
    g.moveTo(x0 + len, y0 - 12); g.lineTo(x0 + len, y0 + 12);
    g.stroke();
    g.font = 'bold 26px "Segoe UI", Arial, sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillText('1 m', x0 + len + 12, y0 + 9);
    g.restore();
  }

  // The view rendered at 2400 px plus the footer. Returns a canvas of width 2400.
  function annotatedCanvas(view) {
    var base = App.renderToCanvas(view, WIDTH);
    var out = document.createElement('canvas');
    out.width = base.width;
    out.height = base.height + FOOTER_H;
    var g = out.getContext('2d');
    g.drawImage(base, 0, 0);
    if (view === 'top') drawScaleBar(g, base.width, base.height);

    g.fillStyle = '#FFFFFF';
    g.fillRect(0, base.height, out.width, FOOTER_H);
    g.fillStyle = '#252027';
    g.fillRect(0, base.height, out.width, 4);
    g.textBaseline = 'alphabetic';
    var y = base.height + 36;
    summaryEntries().forEach(function (e) {
      g.fillStyle = KIND_COLOUR[e.kind] || '#252027';
      drawFitted(g, e.text, 24, y, out.width - 48, e.kind === 'title' || e.kind === 'honesty');
      y += LINE_H;
    });
    return out;
  }

  function dataUrl(view) { return annotatedCanvas(view).toDataURL('image/png'); }

  function baseName() { return 'projsim_' + PS.Storage.slug(placementName() || 'current'); }

  function downloadCanvas(canvas, fname) {
    canvas.toBlob(function (blob) { if (blob) PS.Storage.download(fname, blob, 'image/png'); }, 'image/png');
  }

  // view is 'wall' or 'top'. Returns the file name; the download starts once the PNG is encoded.
  function downloadPng(view) {
    if (view !== 'wall' && view !== 'top') throw new Error('Only the wall and top views can be exported.');
    var fname = baseName() + '_' + view + '.png';
    downloadCanvas(annotatedCanvas(view), fname);
    return fname;
  }

  function downloadSummary() {
    var fname = baseName() + '_summary.txt';
    PS.Storage.download(fname, summaryText(), 'text/plain');
    return fname;
  }

  // ------------------------------------------------------------------ clipboard
  // Fallback when navigator.clipboard is unavailable: a modal with the text selected; tries execCommand.
  function copyFallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) return Promise.resolve('execCommand');

    PS.Storage.injectStyle();
    return PS.Storage.modal(function (box, close) {
      box.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Copy the summary' }));
      var note = document.createElement('div');
      note.textContent = 'Automatic copy is not available here. The text is selected: press Ctrl+C.';
      box.appendChild(note);
      var area = document.createElement('textarea');
      area.value = text;
      area.readOnly = true;
      box.appendChild(area);
      var bar = document.createElement('div');
      bar.className = 'ps6-buttons';
      bar.appendChild(PS.Storage.button('Download .txt', '', function () { downloadSummary(); }));
      bar.appendChild(PS.Storage.button('Close', 'ps6-primary', function () { close('closed'); }));
      box.appendChild(bar);
      root.setTimeout(function () { area.focus(); area.select(); }, 0);
    }).then(function () { return 'manual'; });
  }

  // Resolves with 'clipboard' | 'execCommand' | 'manual'.
  function copySummary() {
    var text = summaryText();
    var nav = root.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      return nav.clipboard.writeText(text).then(function () { return 'clipboard'; }, function () { return copyFallback(text); });
    }
    return copyFallback(text);
  }

  // ------------------------------------------------------------------ self test
  function register(name, fn) {
    if (PS.SelfTest && PS.SelfTest.register) PS.SelfTest.register(name, fn);
    else (PS.pendingSelfTests = PS.pendingSelfTests || []).push([name, fn]);
  }

  function registerChecks() {
    register('export.top-canvas-2400', function (A) {
      var c = A.renderToCanvas('top', 2400);
      return { ok: c.width === 2400 && c.height > 0, detail: 'renderToCanvas(top, 2400) -> ' + c.width + 'x' + c.height };
    });

    register('export.wall-png-dataurl', function () {
      var url = dataUrl('wall'), c = annotatedCanvas('wall');
      var g = c.getContext('2d'), fy = c.height - FOOTER_H;
      var foot = g.getImageData(0, fy + 4, c.width, FOOTER_H - 4).data, dark = 0;
      for (var i = 0; i < foot.length; i += 4) if (foot[i] < 100 && foot[i + 1] < 100 && foot[i + 2] < 100) dark++;
      var corner = g.getImageData(c.width - 3, c.height - 3, 1, 1).data;
      var white = corner[0] === 255 && corner[1] === 255 && corner[2] === 255;
      var ok = url.indexOf('data:image/png') === 0 && url.length > 5000 && c.width === 2400 && dark > 800 && white;
      return { ok: ok, detail: url.slice(0, 22) + '… (' + url.length + ' chars), canvas ' + c.width + 'x' + c.height + ', footer text pixels ' + dark + ', footer white ' + white };
    });

    register('export.summary-text', function (A) {
      var before = JSON.parse(JSON.stringify(A.state)), why = [];
      var t = summaryText();
      var honest = 'Room: photographic estimates unless marked measured — verify on site. Vertical offset: provisional 0.00.';
      if (t.indexOf(honest) < 0) why.push('provisional honesty line missing');
      ['2.550', '1.594', '787', '5.02', 'Epson PowerLite 955WH', 'nominal'].forEach(function (s) {
        if (t.toLowerCase().indexOf(s.toLowerCase()) < 0) why.push('"' + s + '" missing');
      });
      var r = A.update(function (d) { d.calibration['epson-pl955wh'] = { vOffset: 0.12, vOffsetStatus: 'measured', hOffset: 0, hOffsetStatus: 'assumed' }; }, 'selftest');
      var t2 = summaryText();
      if (!r.ok || t2.indexOf('Vertical offset: measured 0.12.') < 0) why.push('measured honesty line missing');
      A.replaceState(before, 'selftest');
      return { ok: why.length === 0, detail: why.length ? why.join('; ') : summaryLines().length + ' lines; provisional and measured offset lines present' };
    });
  }

  function init(app) {
    App = app;
    registerChecks();
  }

  PS.Export = {
    init: init,
    summaryEntries: summaryEntries, summaryLines: summaryLines, summaryText: summaryText, honestyLine: honestyLine,
    annotatedCanvas: annotatedCanvas, dataUrl: dataUrl,
    downloadPng: downloadPng, downloadSummary: downloadSummary, copySummary: copySummary
  };
})(window);
