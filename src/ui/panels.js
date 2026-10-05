/* PS.Panels: left and right panels, banner, help and profile-editor modals (PLAN.md sections 5, 6.1, 6.2, 9.1). Owned by P4.
 * Built from JS into the containers of index.html. Reads PS.App, never touches the scene directly.
 * Exposes PS.Panels.openModal / closeModal for other UI packages. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};
  var Room = PS.Room, Model = PS.Model, Optics = PS.Optics;

  var App = null;
  var refreshers = [];          // fn(state, result), called on every 'change'

  // ------------------------------------------------------------------ small helpers
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function $(id) { return document.getElementById(id); }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) {
      (list || []).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) add(c);
        else e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
      });
    })(Array.isArray(kids) ? kids : [kids]);
    return e;
  }

  function fmt(v, d) {
    if (typeof v !== 'number' || !isFinite(v)) return 'n/a';
    var s = v.toFixed(d);
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
  }
  function signed(v, d) { var s = fmt(v, d); return (v > 0 && s.charAt(0) !== '-' ? '+' : '') + s; }
  function pct(f, d) { return fmt(f * 100, d == null ? 1 : d) + ' %'; }

  function getPath(o, path) { for (var i = 0; i < path.length; i++) o = o[path[i]]; return o; }
  function setPath(o, path, v) {
    for (var i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = v;
  }

  function profileById(state, id) {
    var all = (state.customProfiles || []).concat(PS.Profiles || []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function isCustom(state, id) {
    return (state.customProfiles || []).some(function (p) { return p.id === id; });
  }

  // Keep zoom and lens shift inside the ranges of profile p (used when the profile or its ranges change).
  function clampToProfile(d, p) {
    var pr = d.projector;
    function cl(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
    pr.throwRatio = cl(pr.throwRatio, p.throwMin, p.throwMax);
    pr.shiftV = cl(pr.shiftV, p.shiftV[0], p.shiftV[1]);
    pr.shiftH = cl(pr.shiftH, p.shiftH[0], p.shiftH[1]);
  }

  // ------------------------------------------------------------------ numeric field (PLAN 6.2)
  // o: {label, get(state, result), set(draft, v), step, dec, unit, title, validate(v, state)->message|null,
  //     extra (element after the input), onRefresh(state, result), msgEl, disabled, reg}
  function numField(o) {
    var touchField = root.getComputedStyle(document.documentElement).getPropertyValue('--mobile-layout').trim() === '1';
    var input = h('input', { type: touchField ? 'text' : 'number', inputmode: 'decimal', step: o.step, class: 'num', 'aria-label': o.aria || o.label || '' });
    input.addEventListener('pointerdown', function (event) { if (event.pointerType === 'touch') input.type = 'text'; });
    if (o.disabled) input.disabled = true;
    if (o.title) input.title = o.title;
    var msg = o.msgEl || h('div', { class: 'fmsg' });
    var timer = null;

    function setInvalid(text) {
      input.classList.toggle('invalid', !!text);
      msg.textContent = text || '';
    }
    function apply() {
      var raw = input.value.trim().replace(',', '.'), v = Number(raw);
      if (raw === '' || !isFinite(v)) { setInvalid('Enter a number.'); return false; }
      if (o.validate) { var m = o.validate(v, App.state); if (m) { setInvalid(m); return false; } }
      var cur = o.get(App.state, App.result);
      if (typeof cur === 'number' && Math.abs(cur - v) < 1e-12) { setInvalid(''); return true; }
      var r = App.update(function (d) { o.set(d, v); }, 'panel');
      if (!r.ok) { setInvalid(r.errors[0]); return false; }
      setInvalid('');
      return true;
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(apply, 150);
    });
    input.addEventListener('change', function () {
      clearTimeout(timer);
      if (apply()) input.value = fmt(o.get(App.state, App.result), o.dec);
    });

    function refresh(state, result) {
      if (document.activeElement !== input) {
        input.value = fmt(o.get(state, result), o.dec);
        setInvalid('');
      }
      if (o.onRefresh) o.onRefresh(state, result);
    }
    var row = null;
    if (!o.msgEl || o.label) {
      var field = input;
      if (o.pose) {
        function stepBy(direction) {
          var current = o.get(App.state, App.result);
          input.value = fmt(Math.round((current + direction * o.pose) * 1000) / 1000, o.dec);
          input.dispatchEvent(new root.Event('change', { bubbles: true }));
        }
        field = h('span', { class: 'pose-stepper' }, [
          h('button', { type: 'button', class: 'pose-step', text: '−', 'aria-label': 'Decrease ' + (o.aria || o.label), onclick: function () { stepBy(-1); } }),
          input,
          h('button', { type: 'button', class: 'pose-step', text: '+', 'aria-label': 'Increase ' + (o.aria || o.label), onclick: function () { stepBy(1); } })
        ]);
      }
      row = h('div', { class: 'frow' + (o.mid ? ' srow' : '') + (o.pose ? ' pose-row' : '') }, [
        h('label', { class: 'flabel', text: o.label || '', title: o.title }),
        o.mid,
        field,
        o.extra || h('span', { class: 'unit', text: o.unit || '' }),
        o.msgEl ? null : msg
      ]);
    }
    var f = { row: row, input: input, refresh: refresh };
    (o.reg || refreshers).push(refresh);
    return f;
  }

  function checkbox(label, get, set, extraCls) {
    var cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', function () { App.update(function (d) { set(d, cb.checked); }, 'panel'); });
    var row = h('label', { class: 'check' + (extraCls ? ' ' + extraCls : '') }, [cb, ' ', label]);
    refreshers.push(function (state) { cb.checked = !!get(state); });
    return row;
  }

  function slider(o) {
    var rng = h('input', { type: 'range', class: 'rng', min: o.min, max: o.max, step: o.step, 'aria-label': o.label });
    rng.addEventListener('input', function () {
      var v = parseFloat(rng.value);
      if (isFinite(v)) App.update(function (d) { o.set(d, v); }, 'panel');
    });
    var f = numField({
      label: o.label, get: o.get, set: o.set, step: o.step, dec: o.dec, unit: o.unit, title: o.title, mid: rng,
      validate: function (v, state) {
        var r = o.range ? o.range(state, App.result) : [o.min, o.max];
        return v < r[0] - 1e-12 || v > r[1] + 1e-12 ? 'Must be between ' + fmt(r[0], o.dec) + ' and ' + fmt(r[1], o.dec) + '.' : null;
      },
      onRefresh: function (state, result) {
        var r = o.range ? o.range(state, result) : [o.min, o.max];
        rng.min = r[0]; rng.max = r[1];
        if (document.activeElement !== rng) rng.value = o.get(state, result);
        if (o.onRefresh) o.onRefresh(state, result, f);
      }
    });
    f.range = rng;
    return f;
  }

  function button(text, onclick, cls, title) {
    return h('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: text, onclick: onclick, title: title });
  }

  function section(host, title, open, bodyKids, id) {
    var d = h('details', { class: 'sec', open: open ? true : false }, [h('summary', { text: title }), h('div', { class: 'secbody' }, bodyKids)]);
    host.textContent = '';
    host.appendChild(d);
    return d;
  }

  // ------------------------------------------------------------------ modal
  var modalClose = null, modalOpener = null;
  function closeModal() {
    var host = $('modal-host');
    if (host) host.textContent = '';
    var fn = modalClose, op = modalOpener; modalClose = null; modalOpener = null;
    if (fn) fn();
    if (op && op !== document.body && op.isConnected) op.focus();
  }
  // o: {title, body (element), buttons: [{label, primary, onClick}], wide, onClose}
  function openModal(o) {
    var host = $('modal-host');
    if (!host) return null;
    closeModal();
    modalOpener = document.activeElement;
    modalClose = o.onClose || function () {};
    var foot = h('div', { class: 'modal-foot' }, (o.buttons || []).map(function (b) {
      return button(b.label, function () { if (b.onClick) b.onClick(); else closeModal(); }, b.primary ? 'primary' : '');
    }).concat([button('Close', closeModal)]));
    var box = h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-label': o.title }, [
      h('div', { class: 'modal-head' }, [h('h2', { text: o.title }), h('button', { type: 'button', class: 'xbtn', text: '×', 'aria-label': 'Close', onclick: closeModal })]),
      h('div', { class: 'modal-body' }, [o.body]),
      foot
    ]);
    host.appendChild(box);
    return box;
  }

  // ------------------------------------------------------------------ help (PLAN 9.1, verbatim)
  function rich(text) {
    var parts = text.split('**'), out = [];
    parts.forEach(function (p, i) { if (p) out.push(i % 2 ? h('strong', { text: p }) : p); });
    return out;
  }

  function helpBody() {
    var li = function (t, sub) { return h('li', null, [rich(t), sub ? h('ul', null, sub.map(function (s) { return h('li', null, [rich(s)]); })) : null]); };
    return h('div', { class: 'help' }, [
      h('h3', { text: 'Measuring the vertical offset (5 minutes)' }),
      h('ol', null, [
        li('Put the projector on a flat table with its feet fully retracted. Level it front-to-back: a phone level app on the top cover should read 0.0°.'),
        li('Square it to a flat wall: measure from each front corner of the body to the wall; the two readings must be equal.'),
        li('In the menu, set V-Keystone 0, H-Keystone 0, Auto V-Keystone **Off**, Projection **Front**. Project a white image and focus it.'),
        li('Measure from the floor with a tape:', [
          'h_L = height of the **centre of the lens glass**',
          'h_B = height of the **bottom edge** of the lit image',
          'h_T = height of the **top edge**'
        ]),
        li('**vOffset = (h_B − h_L) / (h_T − h_B).** Example: 0.80, 0.86 and 1.86 give 0.06. Enter it under Projector → Calibration; it turns MEASURED.'),
        li('Optional, for horizontal offset: drop a plumb line from the lens centre and measure the horizontal distances to the left and right image edges. Then hOffset = ((x_L + x_R)/2 − x_lens)/W, with x positive toward the projector\'s right as seen from behind.'),
        li('Optional, to check the throw ratio: at the full Wide zoom, (lens-to-wall distance) ÷ (image width) should be about 1.38.')
      ]),
      h('p', { text: 'If the Epson user\'s guide\'s "Screen size and projection distance" table lists a "distance from lens centre to the bottom of the image", that gives the same number without measuring.' })
    ]);
  }
  function openHelp() { openModal({ title: 'Help — measuring the vertical offset', body: helpBody(), wide: true }); }

  // ------------------------------------------------------------------ chips
  var CHIP = {
    estimate: ['EST', 'chip-est', 'Photographic estimate'],
    provisional: ['PROV', 'chip-prov', 'Provisional (not photographed)'],
    assumed: ['ASSUMED', 'chip-assumed', 'Assumed (typical value, not seen)'],
    user: ['USER', 'chip-user', 'Edited by you'],
    measured: ['MEASURED', 'chip-user', 'Measured by you']
  };
  function setChip(el, status) {
    var c = CHIP[status] || CHIP.assumed;
    el.className = 'chip ' + c[1];
    el.firstChild.textContent = c[0];
    el.title = c[2];
  }
  function chipEl(onReset) {
    var x = h('button', { type: 'button', class: 'chip-x', text: '×', title: 'Reset to default and original status', 'aria-label': 'Reset', onclick: onReset });
    var el = h('span', { class: 'chip' }, [h('span', { class: 'chip-t' }), x]);
    el.firstChild.textContent = '';
    el.x = x;
    return el;
  }

  // ------------------------------------------------------------------ banner
  function buildBanner() {
    var banner = $('banner'), prov = $('provenance');
    if (banner && !$('help-btn')) banner.appendChild(h('button', { type: 'button', id: 'help-btn', class: 'btn', text: 'Help', onclick: openHelp, title: 'How to measure the vertical offset' }));
    refreshers.push(function (state, result) {
      if (!prov) return;
      var p = result.provenance, notUser = p.roomEstimated + p.roomProvisional > 0;
      var offsetTxt = p.offsetProvisional ? 'PROVISIONAL' : 'measured';
      prov.className = (notUser || p.offsetProvisional) ? 'provisional' : '';
      prov.textContent = '';
      prov.appendChild(h('span', { class: notUser ? 'amber' : '' }, 'Room: ' + p.roomEstimated + ' estimated, ' + p.roomProvisional +
        ' provisional/assumed, ' + p.roomUser + ' measured by you'));
      prov.appendChild(document.createTextNode(' · '));
      prov.appendChild(h('span', { class: p.offsetProvisional ? 'amber' : '' }, 'Offset: ' + offsetTxt));
      prov.appendChild(document.createTextNode(' · All lux values nominal'));
    });
  }

  // ------------------------------------------------------------------ projector panel
  function profileSelect() {
    var sel = h('select', { class: 'sel', 'aria-label': 'Projector profile' });
    var sig = '';
    sel.addEventListener('change', function () {
      var id = sel.value;
      App.update(function (d) {
        var p = profileById(d, id);
        d.projector.profileId = id;
        if (p) clampToProfile(d, p);
      }, 'panel');
    });
    refreshers.push(function (state) {
      var list = App.profiles, s = list.map(function (p) { return p.id + '|' + p.name; }).join('\n');
      if (s !== sig) {
        sig = s;
        sel.textContent = '';
        list.forEach(function (p) {
          sel.appendChild(h('option', { value: p.id, text: p.name + (isCustom(state, p.id) ? ' (custom)' : '') }));
        });
      }
      sel.value = state.projector.profileId;
    });
    return sel;
  }

  function calibField(key, label, title) {
    var statusKey = key + 'Status';
    var chip = chipEl(function () {
      App.update(function (d) {
        var cal = d.calibration[d.projector.profileId];
        if (!cal) return;
        delete cal[key]; delete cal[statusKey];
        if (!Object.keys(cal).length) delete d.calibration[d.projector.profileId];
      }, 'panel');
    });
    var f = numField({
      label: label, title: title, step: 0.01, dec: 3, extra: chip,
      get: function (state, result) { return (result || App.result).profile[key]; },
      set: function (d, v) {
        var id = d.projector.profileId;
        d.calibration[id] = d.calibration[id] || {};
        d.calibration[id][key] = v;
        d.calibration[id][statusKey] = 'measured';
      },
      validate: function (v) { return Math.abs(v) > 2 ? 'Offset must be between −2 and 2.' : null; },
      onRefresh: function (state, result) {
        setChip(chip, result.profile[statusKey]);
        var cal = state.calibration[state.projector.profileId];
        chip.x.style.display = cal && cal[key] !== undefined ? '' : 'none';
      }
    });
    return f.row;
  }

  function buildProjector() {
    var host = $('panel-projector');
    if (!host) return;
    var mount = h('select', { class: 'sel', 'aria-label': 'Mount' }, [
      h('option', { value: 'upright', text: 'Upright (table or stand)' }),
      h('option', { value: 'ceiling', text: 'Ceiling-inverted' })
    ]);
    mount.addEventListener('change', function () { App.update(function (d) { d.projector.mount = mount.value; }, 'panel'); });
    refreshers.push(function (state) { mount.value = state.projector.mount; });

    function pos(label, axis) {
      return numField({
        label: label, step: 0.01, pose: 0.01, dec: 3, unit: 'm', aria: 'Lens ' + axis,
        get: function (s) { return s.projector.lens[axis]; },
        set: function (d, v) { d.projector.lens[axis] = v; }
      }).row;
    }
    function ang(label, key, range) {
      return numField({
        label: label, step: 0.5, pose: 1, dec: 1, unit: '°',
        get: function (s) { return s.projector[key]; },
        set: function (d, v) { d.projector[key] = v; },
        validate: range ? function (v) { return Math.abs(v) > range ? 'Must be between −' + range + '° and ' + range + '°.' : null; } : null
      }).row;
    }

    var zoom = slider({
      label: 'Zoom', step: 0.001, dec: 3, unit: ':1', title: 'Throw ratio = distance ÷ image width. Wide is the short throw.',
      get: function (s) { return s.projector.throwRatio; },
      set: function (d, v) { d.projector.throwRatio = v; },
      range: function (s, r) { var p = (r || App.result).profile; return [p.throwMin, p.throwMax]; }
    });
    var zoomBtns = h('div', { class: 'btnrow' }, [
      button('Wide', function () { var p = App.result.profile; App.update(function (d) { d.projector.throwRatio = p.throwMin; }, 'panel'); }, '', 'Shortest throw ratio'),
      button('Tele', function () { var p = App.result.profile; App.update(function (d) { d.projector.throwRatio = p.throwMax; }, 'panel'); }, '', 'Longest throw ratio')
    ]);

    function shiftSlider(label, key, rangeKey) {
      var f = slider({
        label: label, step: 0.001, dec: 3,
        get: function (s) { return s.projector[key]; },
        set: function (d, v) { d.projector[key] = v; },
        range: function (s, r) { return (r || App.result).profile[rangeKey]; },
        onRefresh: function (s, r, ff) {
          var rg = r.profile[rangeKey], show = rg[0] !== 0 || rg[1] !== 0;
          ff.row.style.display = show ? '' : 'none';
        }
      });
      return f.row;
    }

    var fitMsg = h('div', { class: 'fmsg' });
    var fit = button('Fit to target (square-on)', function () {
      var r = App.update(function (d) {
        var p = Model.effectiveProfile(d, App.profiles);
        d.projector = Optics.fitSquareOn(p, d.projector, d.target);
      }, 'panel');
      fitMsg.textContent = r.ok ? '' : r.errors[0];
    }, 'primary', 'Yaw, pitch and roll to 0; keeps the zoom; moves the lens so the image fills the target');

    section(host, 'Projector', true, [
      h('div', { class: 'frow' }, [h('label', { class: 'flabel', text: 'Profile' }), profileSelect(), button('Edit profiles…', openProfileEditor, 'small')]),
      h('div', { class: 'frow' }, [h('label', { class: 'flabel', text: 'Mount' }), mount]),
      pos('x (from left wall)', 'x'), pos('y (from back wall)', 'y'), pos('z (above floor)', 'z'),
      ang('Yaw', 'yawDeg', 0), ang('Pitch', 'pitchDeg', 90), ang('Roll', 'rollDeg', 0),
      zoom.row, zoomBtns,
      shiftSlider('Lens shift V', 'shiftV', 'shiftV'), shiftSlider('Lens shift H', 'shiftH', 'shiftH'),
      h('div', { class: 'subhead' }, [h('span', { text: 'Calibration' }), button('How to measure', openHelp, 'small')]),
      calibField('vOffset', 'vOffset', 'Vertical offset: (image bottom edge − lens axis) ÷ image height'),
      calibField('hOffset', 'hOffset', 'Horizontal offset: (image centre − lens axis) ÷ image width'),
      h('div', { class: 'btnrow' }, [fit]), fitMsg
    ]);
  }

  // ------------------------------------------------------------------ display panel
  var RAMP = ['#2c1e8f', '#1f78b4', '#33a02c', '#ffd92f', '#e31a1c'];
  var LEGEND_LUX = [50, 100, 200, 500, 1000, 2000];

  function legend() {
    var ticks = LEGEND_LUX.map(function (l) {
      var t = Math.log(l / 50) / Math.log(2000 / 50);
      return h('span', { class: 'tick', style: 'left:' + (t * 100).toFixed(2) + '%', text: String(l) });
    });
    var stops = RAMP.map(function (c, i) { return c + ' ' + (i * 25) + '%'; }).join(', ');
    var box = h('div', { class: 'legend' }, [
      h('div', { class: 'ramp', style: 'background:linear-gradient(to right, ' + stops + ')' }),
      h('div', { class: 'ticks' }, ticks),
      h('div', { class: 'legend-unit', text: 'lux, log scale (nominal)' })
    ]);
    refreshers.push(function (state) { box.style.display = state.display.falseColour ? '' : 'none'; });
    return box;
  }

  function buildDisplay() {
    var host = $('panel-display');
    if (!host) return;
    var fileIn = h('input', { type: 'file', accept: 'image/*', style: 'display:none', 'aria-label': 'Load image' });
    var contentName = h('div', { class: 'contentname' });
    fileIn.addEventListener('change', function () {
      var file = fileIn.files && fileIn.files[0];
      if (!file) return;
      var rd = new root.FileReader();
      rd.onload = function () {
        var img = new root.Image();
        img.onload = function () { App.setContentImage(img, file.name); };
        img.onerror = function () { contentName.textContent = 'Could not read "' + file.name + '" as an image.'; };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
      fileIn.value = '';
    });
    function showContent() {
      var c = App.content;
      contentName.textContent = c.kind === 'image' ? c.name + ' — image not saved — reload it after restart' : 'Test card';
    }
    App.on('content', showContent);
    refreshers.push(showContent);

    var amb = slider({
      label: 'Room lights', step: 0.01, dec: 2, min: 0, max: 1,
      get: function (s) { return s.display.ambient; }, set: function (d, v) { d.display.ambient = v; }
    });
    var exp = slider({
      label: 'Exposure', step: 10, dec: 0, unit: 'lux', min: 100, max: 3000, title: 'Illuminance that maps to full brightness in the 3D view',
      get: function (s) { return s.display.exposureLux; }, set: function (d, v) { d.display.exposureLux = v; }
    });

    var ksReason = h('div', { class: 'note warnnote' });
    var ksLabel = h('div', { class: 'note', text: 'Upper bound — Epson\'s actual correction may be smaller and keeps a different anchor' });
    refreshers.push(function (state, result) {
      var pv = result.preview;
      ksReason.style.display = pv && !pv.available ? '' : 'none';
      ksReason.textContent = pv && !pv.available ? 'Preview unavailable: ' + pv.reason : '';
      ksLabel.style.display = state.display.keystoneSim ? '' : 'none';
    });

    section(host, 'Display', true, [
      h('div', { class: 'frow' }, [h('label', { class: 'flabel', text: 'Content' }),
        h('div', { class: 'btnrow tight' }, [button('Test card', function () { App.setContentTestCard(); }), button('Load image…', function () { fileIn.click(); }), fileIn])]),
      contentName,
      amb.row, exp.row,
      checkbox('False-colour lux', function (s) { return s.display.falseColour; }, function (d, v) { d.display.falseColour = v; }),
      legend(),
      checkbox('Show beam edges', function (s) { return s.display.showFrustum; }, function (d, v) { d.display.showFrustum = v; }),
      checkbox('Keystone preview', function (s) { return s.display.keystoneSim; }, function (d, v) { d.display.keystoneSim = v; }),
      ksLabel, ksReason
    ]);
  }

  // ------------------------------------------------------------------ target panel
  function buildTarget() {
    var host = $('panel-target');
    if (!host) return;
    function tf(label, key) {
      return numField({
        label: label, step: 0.01, dec: 3, unit: 'm',
        get: function (s) { return s.target[key]; }, set: function (d, v) { d.target[key] = v; }
      }).row;
    }
    var msg = h('div', { class: 'fmsg' });
    section(host, 'Target on the back wall', false, [
      checkbox('Target enabled', function (s) { return s.target.enabled; }, function (d, v) { d.target.enabled = v; }),
      tf('x0 (left edge)', 'x0'), tf('x1 (right edge)', 'x1'), tf('z0 (bottom edge)', 'z0'), tf('z1 (top edge)', 'z1'),
      h('div', { class: 'btnrow' }, [
        button('Working image (dimensions.md)', function () {
          var t = Model.defaultState().target;
          App.update(function (d) { d.target.x0 = t.x0; d.target.x1 = t.x1; d.target.z0 = t.z0; d.target.z1 = t.z1; }, 'panel');
        }),
        button('From current image', function () {
          var img = App.result.image;
          if (!img) { msg.textContent = 'There is no image on the back wall to copy.'; return; }
          var b = img.bbox, r = App.update(function (d) { d.target.x0 = b.x0; d.target.x1 = b.x1; d.target.z0 = b.z0; d.target.z1 = b.z1; }, 'panel');
          msg.textContent = r.ok ? '' : r.errors[0];
        }, '', 'Bounding box of the image on the wall')
      ]),
      msg
    ]);
  }

  // ------------------------------------------------------------------ obstacles panel
  function buildObstacles() {
    var host = $('panel-obstacles');
    if (!host) return;
    var list = h('div', { class: 'obslist' });
    var msg = h('div', { class: 'fmsg' });
    var sig = null, reg = [];

    function find(state, id) {
      for (var i = 0; i < state.obstacles.length; i++) if (state.obstacles[i].id === id) return state.obstacles[i];
      return null;
    }

    function row(o) {
      var id = o.id, rmsg = h('div', { class: 'fmsg' });
      var en = h('input', { type: 'checkbox', title: 'Enabled', 'aria-label': 'Enabled' });
      en.addEventListener('change', function () { App.update(function (d) { find(d, id).enabled = en.checked; }, 'panel'); });
      var name = h('input', { type: 'text', class: 'txt', 'aria-label': 'Name' });
      name.addEventListener('change', function () {
        var v = name.value.trim();
        if (!v) { name.value = find(App.state, id).name; return; }
        App.update(function (d) { find(d, id).name = v; }, 'panel');
      });
      var del = h('button', { type: 'button', class: 'xbtn', text: '×', title: 'Delete', 'aria-label': 'Delete', onclick: function () {
        App.update(function (d) { d.obstacles = d.obstacles.filter(function (q) { return q.id !== id; }); }, 'panel');
      } });
      function triple(which) {
        return ['x', 'y', 'z'].map(function (ax, i) {
          return numField({
            msgEl: rmsg, step: 0.01, dec: 3, reg: reg, title: which + ' ' + ax, aria: o.name + ' ' + which + ' ' + ax,
            get: function (s) { var q = find(s, id); return q ? q[which][i] : 0; },
            set: function (d, v) { find(d, id)[which][i] = v; }
          }).input;
        });
      }
      reg.push(function (state) {
        var q = find(state, id);
        if (!q) return;
        en.checked = !!q.enabled;
        if (document.activeElement !== name) name.value = q.name;
        r.classList.toggle('off', !q.enabled);
      });
      var r = h('div', { class: 'obs' }, [
        h('div', { class: 'obshead' }, [en, name, del]),
        h('div', { class: 'xyz' }, [h('span', { class: 'xyzl', text: 'min x y z' }), triple('min')]),
        h('div', { class: 'xyz' }, [h('span', { class: 'xyzl', text: 'max x y z' }), triple('max')]),
        rmsg
      ]);
      return r;
    }

    function rebuild(state) {
      reg = [];
      list.textContent = '';
      state.obstacles.forEach(function (o) { list.appendChild(row(o)); });
      if (!state.obstacles.length) list.appendChild(h('div', { class: 'note', text: 'No obstacles.' }));
    }

    function nextId(state, base) {
      var n = 1;
      while (find(state, base + n)) n++;
      return base + n;
    }
    function add(make) {
      var r = App.update(function (d) { d.obstacles.push(make(d)); }, 'panel');
      msg.textContent = r.ok ? '' : r.errors[0];
    }

    refreshers.push(function (state) {
      var s = state.obstacles.map(function (o) { return o.id; }).join('|');
      if (s !== sig) { sig = s; rebuild(state); }
      reg.forEach(function (fn) { fn(state); });
    });
    var secEl = section(host, 'Obstacles', false, [
      list,
      h('div', { class: 'btnrow' }, [
        button('Add box', function () {
          add(function (d) {
            var id = nextId(d, 'box');
            return { id: id, name: 'Box ' + id.slice(3), min: [1.0, 1.0, 0], max: [1.5, 1.5, 0.5], enabled: true };
          });
        }),
        button('Add person', function () {
          add(function (d) {
            var cx = (d.target.x0 + d.target.x1) / 2, id = nextId(d, 'person');
            return { id: id, name: 'Person ' + id.slice(6), min: [cx - 0.25, 1.35, 0], max: [cx + 0.25, 1.65, 1.75], enabled: true };
          });
        }, '', '0.50 × 0.30 × 1.75 m, centred on the target at y = 1.50')
      ]),
      msg
    ]);
    var obsSum = secEl.querySelector('summary');
    refreshers.push(function (state) { obsSum.textContent = 'Obstacles (' + state.obstacles.length + ')'; });
  }

  // ------------------------------------------------------------------ room panel
  function buildRoom() {
    var host = $('panel-room');
    if (!host) return;
    var msg = h('div', { class: 'fmsg' });
    var groups = [], byGroup = {};
    Room.PARAMS.forEach(function (p) {
      if (!byGroup[p.group]) { byGroup[p.group] = []; groups.push(p.group); }
      byGroup[p.group].push(p);
    });

    function field(p) {
      var chip = chipEl(function () {
        var r = App.update(function (d) { d.room[p.key] = p.def; d.roomStatus[p.key] = p.status; }, 'panel');
        msg.textContent = r.ok ? '' : r.errors[0];
      });
      var range = p.low === null ? 'photo range: n/a' : 'photo range ' + fmt(p.low, 3) + '–' + fmt(p.high, 3) + ' m';
      var f = numField({
        label: p.label, title: p.definition + ' — ' + range + ' (default ' + fmt(p.def, 3) + ' m)', step: 0.01, dec: 3, extra: chip,
        get: function (s) { return s.room[p.key]; },
        set: function (d, v) { d.room[p.key] = v; d.roomStatus[p.key] = 'user'; },
        onRefresh: function (s) {
          var st = (s.roomStatus || {})[p.key] || p.status;
          setChip(chip, st);
          chip.x.style.display = st === 'user' ? '' : 'none';
          chip.title = (CHIP[st] || CHIP.assumed)[2] + ' — ' + range;
        }
      });
      f.row.classList.add('roomrow');
      return f.row;
    }

    var kids = groups.map(function (g, i) {
      return h('details', { class: 'grp', open: i === 0 ? true : false }, [
        h('summary', { text: g }), h('div', { class: 'grpbody' }, byGroup[g].map(field))
      ]);
    });
    kids.push(h('div', { class: 'btnrow' }, [
      button('Reset room to photo estimates', function () {
        var r = App.update(function (d) { d.room = Room.defaults(); d.roomStatus = Room.defaultStatus(); }, 'panel');
        msg.textContent = r.ok ? '' : r.errors[0];
      })
    ]), msg);
    section(host, 'Room', true, kids);
  }

  // ------------------------------------------------------------------ readouts (PLAN 5)
  function buildReadouts() {
    var host = $('panel-readouts');
    if (!host) return;
    var body = h('div');
    section(host, 'Readouts', true, [body]);
    refreshers.push(function (state, result) { renderReadouts(body, state, result); });
  }

  function renderReadouts(body, state, result) {
    var P = result.provenance, img = result.image, roomNotUser = P.roomEstimated + P.roomProvisional > 0;
    function mark(key) {
      var m = P.marks[key] || '', out = '';
      if (m.indexOf('†') >= 0 && P.offsetProvisional) out += '†';
      if (m.indexOf('‡') >= 0 && roomNotUser) out += '‡';
      return out;
    }
    var t = h('table', { class: 'rd' });
    function sec(title) { t.appendChild(h('tr', { class: 'rsec' }, [h('th', { colspan: 3, text: title })])); }
    function rr(label, vals, markKey, cls) {
      var cell = h('td', { class: 'rv' }, (Array.isArray(vals) ? vals : [vals]).map(function (v) {
        return typeof v === 'string' ? h('div', { text: v }) : v;
      }));
      t.appendChild(h('tr', { class: cls || '' }, [h('td', { class: 'rl', text: label }), cell, h('td', { class: 'rm', text: markKey ? mark(markKey) : '' })]));
    }
    var NA = 'n/a';

    sec('Image on the back-wall plane');
    if (img) {
      rr('Width (top / bottom)', fmt(img.widthTop, 3) + ' / ' + fmt(img.widthBottom, 3) + ' m', 'image');
      rr('Height (left / right)', fmt(img.heightLeft, 3) + ' / ' + fmt(img.heightRight, 3) + ' m', 'image');
      rr('Area', fmt(img.area, 3) + ' m²', 'image');
      ['TL', 'TR', 'BR', 'BL'].forEach(function (k) {
        var c = img.corners[k];
        rr('Corner ' + k, '(' + fmt(c[0], 3) + ', 0, ' + fmt(c[2], 3) + ') m', 'corners');
      });
      rr('Image on the wall', pct(result.imageOnWallFrac), 'imageOnWall');
      var g = result.greyGap;
      rr('Top vs grey line', Math.abs(g) < 5e-4 ? 'on the line' : fmt(Math.abs(g), 3) + ' m ' + (g > 0 ? 'below' : 'above') + ' the line', 'greyGap');
    } else {
      rr('Image', 'n/a — it does not fully reach the back wall plane');
    }

    sec('Throw and light');
    rr('Throw distance', [fmt(result.throw.axial, 3) + ' m axial', fmt(result.throw.perpendicular, 3) + ' m perpendicular']);
    if (result.lux) {
      rr('Lux (nominal: lumens ÷ area)', [fmt(result.lux.nominal, 0) + ' lx average', 'corners ' + fmt(result.lux.min, 0) + ' – ' + fmt(result.lux.max, 0) + ' lx']);
      rr('px/cm', [fmt(result.pxPerCm.avg, 2) + ' average', 'corners ' + fmt(result.pxPerCm.min, 2) + ' – ' + fmt(result.pxPerCm.max, 2)]);
    } else {
      rr('Lux (nominal: lumens ÷ area)', NA); rr('px/cm', NA);
    }

    sec('Keystone');
    var ks = result.keystone;
    rr('Needed correction', 'V ' + fmt(ks.v, 1) + '° / H ' + fmt(ks.h, 1) + '°');
    rr('Inside ±' + ks.limitV + '° (V) / ±' + ks.limitH + '° (H)', ks.inRange ? 'yes' : 'no', null, ks.inRange ? '' : 'bad');
    rr('Wall roll', ks.rollDeg === null ? NA : fmt(ks.rollDeg, 1) + '°');

    sec('Placement');
    rr('Lens height z', fmt(result.lens.z, 3) + ' m', 'lens');
    rr('Lens below ceiling', fmt(result.lens.dropBelowCeiling, 3) + ' m', 'lens');
    rr('Body lowest / highest z', fmt(result.body.lowest, 3) + ' / ' + fmt(result.body.highest, 3) + ' m', 'body');

    sec('Beam breakdown');
    if (result.beam) {
      var items = result.beam.items.slice().sort(function (a, b) { return b.fraction - a.fraction; });
      items.forEach(function (it, i) {
        rr(it.label, pct(it.fraction), i === 0 ? 'beam' : null, it.kind === 'wall' ? 'good' : it.kind === 'wallItem' ? '' : 'bad');
      });
      if (!items.length) rr('Beam', NA);
    } else {
      rr('Beam', 'n/a (lens outside the room)', 'beam');
    }

    sec('Target');
    var tg = result.target;
    if (tg) {
      rr('Target covered', pct(tg.covered), 'target');
      rr('Image inside target', pct(tg.imageInTarget), 'target');
      if (tg.overshoot) {
        var o = tg.overshoot;
        rr('Overshoot L / R / T / B', [signed(o.left, 3) + ' / ' + signed(o.right, 3) + ' / ' + signed(o.top, 3) + ' / ' + signed(o.bottom, 3) + ' m',
          h('span', { class: 'sub', text: '+ = beyond the target edge, − = short of it' })], 'target');
      }
    } else {
      rr('Target', 'off');
    }

    sec('Keystone preview');
    var pv = result.preview;
    if (pv && pv.available) {
      rr('Corrected size', fmt(pv.width, 3) + ' × ' + fmt(pv.height, 3) + ' m', 'preview');
      rr('Panel used', pct(pv.panelFraction), 'preview');
      rr('px/cm', fmt(pv.pxPerCm, 2), 'preview');
      rr('Lux (nominal)', fmt(pv.lux, 0) + ' lx', 'preview');
    } else {
      rr('Unavailable', pv ? pv.reason : NA);
    }
    rr('', h('span', { class: 'sub', text: 'Upper bound — Epson\'s actual correction may be smaller and keeps a different anchor' }));

    body.textContent = '';
    body.appendChild(t);
    body.appendChild(h('div', { class: 'foot' }, [
      h('div', {}, [h('b', { text: '† ' }), 'depends on the vertical offset, which is ' + (P.offsetProvisional ? 'still provisional' : 'measured') + '.']),
      h('div', {}, [h('b', { text: '‡ ' }), 'depends on room values that you have not measured (estimates, provisional or assumed).']),
      h('div', { text: 'Every lux number is nominal: lumens ÷ area. Real output is lower — ECO mode, lamp age and colour modes cut it by roughly 30–50 %.' })
    ]));
  }

  // ------------------------------------------------------------------ warnings
  var ICON = { error: '✖', warn: '▲', info: 'ℹ' };
  function buildWarnings() {
    var host = $('panel-warnings');
    if (!host) return;
    var list = h('div', { class: 'wlist' });
    var d = section(host, 'Warnings', true, [list]);
    var sum = d.querySelector('summary');
    refreshers.push(function (state, result) {
      var ws = result.warnings;
      sum.textContent = 'Warnings (' + ws.length + ')';
      list.textContent = '';
      if (!ws.length) list.appendChild(h('div', { class: 'note', text: 'No warnings.' }));
      ws.forEach(function (w) {
        list.appendChild(h('div', { class: 'w w-' + w.level, 'data-code': w.code }, [
          h('span', { class: 'wicon', text: ICON[w.level] || '' }),
          h('span', { class: 'wtext', text: w.text }),
          h('span', { class: 'wcode', text: w.code })
        ]));
      });
    });
  }

  // ------------------------------------------------------------------ profile editor (PLAN 6.2)
  function profileErrors(p) {
    var m = [];
    function pos(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
    if (!(pos(p.nativeW) && pos(p.nativeH) && p.nativeW % 1 === 0 && p.nativeH % 1 === 0)) m.push('Pixels must be whole numbers above 0.');
    if (!pos(p.lumens)) m.push('Lumens must be above 0.');
    if (!pos(p.throwMin) || !(p.throwMin <= p.throwMax)) m.push('Throw ratio: min must be above 0 and not above max.');
    if (!pos(p.distMin) || !(p.distMin <= p.distMax)) m.push('Distance: min must be above 0 and not above max.');
    if (!(pos(p.focalMm[0]) && p.focalMm[0] <= p.focalMm[1])) m.push('Focal length: min must be above 0 and not above max.');
    if (!(pos(p.fNumber[0]) && p.fNumber[0] <= p.fNumber[1])) m.push('F-number: min must be above 0 and not above max.');
    if (!(p.shiftV[0] <= p.shiftV[1]) || !(p.shiftH[0] <= p.shiftH[1])) m.push('Lens shift: min must not be above max.');
    if (!(p.keystoneV >= 0 && p.keystoneV < 90 && p.keystoneH >= 0 && p.keystoneH < 90)) m.push('Keystone limits must be between 0° and 90°.');
    if (!(pos(p.body.w) && pos(p.body.d) && pos(p.body.h))) m.push('Body width, depth and height must be above 0.');
    return m.length ? m[0] : null;
  }

  function openProfileEditor() {
    var sel = App.state.projector.profileId;
    var reg = [], unsub = null, sig = '';
    var body = h('div', { class: 'pedit' });

    function listSig(state) { return state.customProfiles.map(function (p) { return p.id; }).join('|') + '#' + sel; }

    function pfield(label, path, o) {
      o = o || {};
      var custom = isCustom(App.state, sel);
      return numField({
        label: label, step: o.step || 0.01, dec: o.dec == null ? 3 : o.dec, unit: o.unit, reg: reg, disabled: !custom, aria: label,
        get: function (s) { var p = profileById(s, sel); return p ? getPath(p, path) : 0; },
        set: function (d, v) {
          var p = profileById(d, sel);
          setPath(p, path, v);
          if (d.projector.profileId === sel) clampToProfile(d, p);
        },
        validate: function (v, s) {
          var p = clone(profileById(s, sel));
          setPath(p, path, v);
          return profileErrors(p);
        }
      }).row;
    }
    function statusSelect(label, key) {
      var custom = isCustom(App.state, sel);
      var s = h('select', { class: 'sel', disabled: !custom, 'aria-label': label }, ['provisional', 'assumed', 'measured', 'estimate'].map(function (v) { return h('option', { value: v, text: v }); }));
      s.addEventListener('change', function () {
        App.update(function (d) { profileById(d, sel)[key] = s.value; }, 'panel');
      });
      reg.push(function (state) { var p = profileById(state, sel); if (p) s.value = p[key]; });
      return h('div', { class: 'frow' }, [h('label', { class: 'flabel', text: label }), s]);
    }
    function textField(label, key) {
      var custom = isCustom(App.state, sel);
      var i = h('input', { type: 'text', class: 'txt', disabled: !custom, 'aria-label': label });
      i.addEventListener('change', function () {
        var v = i.value.trim();
        if (key === 'name' && !v) { i.value = profileById(App.state, sel).name; return; }
        App.update(function (d) { profileById(d, sel)[key] = v; }, 'panel');
      });
      reg.push(function (state) { var p = profileById(state, sel); if (p && document.activeElement !== i) i.value = p[key] || ''; });
      return h('div', { class: 'frow' }, [h('label', { class: 'flabel', text: label }), i]);
    }

    function render() {
      reg = [];
      body.textContent = '';
      sig = listSig(App.state);
      var custom = isCustom(App.state, sel);
      var select = h('select', { class: 'sel', 'aria-label': 'Profile to edit' }, App.profiles.map(function (p) {
        return h('option', { value: p.id, text: p.name + (isCustom(App.state, p.id) ? ' (custom)' : ' (built-in)'), selected: p.id === sel ? true : false });
      }));
      select.addEventListener('change', function () { sel = select.value; render(); });
      var dup = button('Duplicate', function () {
        var src = clone(profileById(App.state, sel)), id = 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        src.id = id; src.name = src.name + ' (copy)';
        var r = App.update(function (d) { d.customProfiles.push(src); }, 'panel');
        if (r.ok) { sel = id; render(); }
      });
      var del = button('Delete', function () {
        if (!custom || !root.confirm('Delete this custom profile?')) return;
        var gone = sel;
        sel = Model.DEFAULT_PROFILE_ID;
        App.update(function (d) {
          d.customProfiles = d.customProfiles.filter(function (p) { return p.id !== gone; });
          delete d.calibration[gone];
          if (d.projector.profileId === gone) { d.projector.profileId = Model.DEFAULT_PROFILE_ID; clampToProfile(d, profileById(d, Model.DEFAULT_PROFILE_ID)); }
        }, 'panel');
        render();
      });
      del.disabled = !custom;

      body.appendChild(h('div', { class: 'btnrow' }, [select, dup, del]));
      body.appendChild(h('div', { class: 'note', text: custom ? 'Calibration entered in the Projector panel overrides the offsets below.' : 'Built-in profiles are read-only. Duplicate one to edit it.' }));
      body.appendChild(h('div', { class: 'pcols' }, [
        h('div', {}, [
          h('div', { class: 'subhead', text: 'Identity' }),
          textField('Name', 'name'),
          pfield('Pixels wide', ['nativeW'], { step: 1, dec: 0 }), pfield('Pixels high', ['nativeH'], { step: 1, dec: 0 }),
          pfield('Lumens', ['lumens'], { step: 10, dec: 0, unit: 'lm' }),
          h('div', { class: 'subhead', text: 'Throw and distance' }),
          pfield('Throw ratio min (wide)', ['throwMin']), pfield('Throw ratio max (tele)', ['throwMax']),
          pfield('Distance min', ['distMin'], { unit: 'm' }), pfield('Distance max', ['distMax'], { unit: 'm' }),
          h('div', { class: 'subhead', text: 'Lens' }),
          pfield('Focal length min', ['focalMm', 0], { step: 0.1, dec: 1, unit: 'mm' }), pfield('Focal length max', ['focalMm', 1], { step: 0.1, dec: 1, unit: 'mm' }),
          pfield('F-number min', ['fNumber', 0]), pfield('F-number max', ['fNumber', 1])
        ]),
        h('div', {}, [
          h('div', { class: 'subhead', text: 'Offsets and shift' }),
          pfield('vOffset', ['vOffset']), statusSelect('vOffset status', 'vOffsetStatus'),
          pfield('hOffset', ['hOffset']), statusSelect('hOffset status', 'hOffsetStatus'),
          pfield('Shift V min', ['shiftV', 0]), pfield('Shift V max', ['shiftV', 1]),
          pfield('Shift H min', ['shiftH', 0]), pfield('Shift H max', ['shiftH', 1]),
          pfield('Keystone V limit', ['keystoneV'], { step: 0.5, dec: 1, unit: '°' }), pfield('Keystone H limit', ['keystoneH'], { step: 0.5, dec: 1, unit: '°' }),
          h('div', { class: 'subhead', text: 'Body (drawing and checks)' }),
          pfield('Width', ['body', 'w'], { unit: 'm' }), pfield('Depth', ['body', 'd'], { unit: 'm' }), pfield('Height', ['body', 'h'], { unit: 'm' }),
          pfield('Lens right of centre', ['body', 'lensRight'], { unit: 'm' }), pfield('Lens above bottom', ['body', 'lensUp'], { unit: 'm' }),
          statusSelect('Body status', 'bodyStatus'), textField('Source', 'source')
        ])
      ]));
      reg.forEach(function (fn) { fn(App.state, App.result); });
    }

    render();
    unsub = App.on('change', function (e) {
      if (!profileById(e.state, sel)) sel = Model.DEFAULT_PROFILE_ID;
      if (listSig(e.state) !== sig) { render(); return; }
      reg.forEach(function (fn) { fn(e.state, e.result); });
    });
    openModal({ title: 'Projector profiles', body: body, wide: true, onClose: function () { if (unsub) unsub(); } });
  }

  // ------------------------------------------------------------------ init
  function buildMobileTabs() {
    var nav = $('mobile-tabs');
    if (!nav) return;
    [['setup', 'Setup'], ['results', 'Results'], ['save', 'Save']].forEach(function (item) {
      var tab = h('button', { type: 'button', class: 'mobile-tab', text: item[1], 'aria-selected': item[0] === 'setup' ? 'true' : 'false' });
      tab.dataset.tab = item[0];
      tab.addEventListener('click', function () { selectMobileTab(item[0]); });
      nav.appendChild(tab);
    });
    document.body.dataset.mobileTab = 'setup';
    refreshers.push(function (state, result) {
      nav.querySelector('[data-tab="results"]').textContent = 'Results (' + result.warnings.length + ')';
    });
  }

  function selectMobileTab(name) {
    document.body.dataset.mobileTab = name;
    var nav = $('mobile-tabs');
    if (!nav) return;
    Array.prototype.forEach.call(nav.children, function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    });
  }

  function touchHints() {
    var timer;
    document.addEventListener('click', function (event) {
      if (!root.matchMedia('(hover: none)').matches || event.target.closest('button')) return;
      var target = event.target.closest('.chip[title], .flabel[title], .rm');
      if (!target) return;
      var message = target.title;
      if (!message && target.classList.contains('rm')) {
        message = '† depends on the vertical offset; ‡ depends on unmeasured room values. See the notes below the readouts.';
      }
      if (!message) return;
      var hint = $('touch-hint');
      if (!hint) { hint = h('div', { id: 'touch-hint', role: 'status' }); document.body.appendChild(hint); }
      hint.textContent = message;
      clearTimeout(timer);
      timer = setTimeout(function () { hint.remove(); }, 4500);
    });
  }

  function mobileLayoutCheck() {
    if (root.innerWidth > 820) return { ok: true, detail: 'skipped: wide viewport' };
    var host = $('canvas-host'), bad = [];
    var rect = host.getBoundingClientRect();
    var edge = Math.min(root.innerWidth, root.visualViewport ? root.visualViewport.width : root.innerWidth);
    function clipped(el, name) {
      var r = el.getBoundingClientRect();
      if (r.width && (r.left < -1 || r.right > edge + 1)) bad.push(name + ' clipped');
    }
    if (rect.width < 300 || rect.height < 300) bad.push('canvas host under 300px');
    if (document.documentElement.scrollWidth > root.innerWidth) bad.push('horizontal scroll');
    clipped($('banner'), 'banner');
    clipped($('provenance'), 'provisional notice');
    clipped($('help-btn'), 'Help');
    Array.prototype.forEach.call($('viewbar').querySelectorAll('button'), function (button) { clipped(button, 'view button'); });
    var tabs = Array.prototype.slice.call($('mobile-tabs').querySelectorAll('button'));
    if (tabs.length !== 3 || tabs.map(function (tab) { return tab.textContent.split(' ')[0]; }).join(',') !== 'Setup,Results,Save') bad.push('tabs missing');
    tabs.forEach(function (tab) { clipped(tab, 'tab ' + tab.textContent); });
    var initial = document.body.dataset.mobileTab;
    [['setup', ['projector', 'display', 'target', 'obstacles', 'room']],
      ['results', ['warnings', 'readouts']], ['save', ['placements']]].forEach(function (group) {
      selectMobileTab(group[0]);
      group[1].forEach(function (name) {
        var panel = $('panel-' + name);
        if (!panel || !panel.getBoundingClientRect().width || root.getComputedStyle(panel).display === 'none') bad.push(name + ' hidden');
        if (rect.top >= panel.getBoundingClientRect().top) bad.push(name + ' above canvas');
        var details = Array.prototype.slice.call(panel.querySelectorAll('details'));
        var opened = details.map(function (d) { return d.open; });
        details.forEach(function (d) { d.open = true; });
        Array.prototype.forEach.call(panel.querySelectorAll('input'), function (input) { clipped(input, name + ' input'); });
        Array.prototype.forEach.call(panel.querySelectorAll('button, select'), function (control) { clipped(control, name + ' control'); });
        if (document.documentElement.scrollWidth > root.innerWidth) bad.push(name + ' horizontal scroll');
        details.forEach(function (d, i) { d.open = opened[i]; });
      });
    });
    selectMobileTab(initial);
    return { ok: !bad.length, detail: bad.length ? bad.join('; ') : 'view first; panels and fields fit' };
  }

  function init(app) {
    App = app;
    refreshers = [];
    buildBanner();
    buildProjector();
    buildDisplay();
    buildTarget();
    buildObstacles();
    buildRoom();
    buildReadouts();
    buildWarnings();
    buildMobileTabs();
    touchHints();
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('modal-host') && $('modal-host').firstChild) closeModal();
    });
    var host = $('modal-host');
    if (host) host.addEventListener('mousedown', function (e) { if (e.target === host) closeModal(); });
    App.on('change', function (e) { refreshAll(e.state, e.result); });
    refreshAll(App.state, App.result);
    if (PS.SelfTest && PS.SelfTest.register) PS.SelfTest.register('panels.mobile-layout', mobileLayoutCheck);
  }

  function refreshAll(state, result) {
    refreshers.forEach(function (fn) {
      try { fn(state, result); } catch (e) { if (root.console) root.console.error(e); }
    });
  }

  PS.Panels = { init: init, openModal: openModal, closeModal: closeModal, openHelp: openHelp };

  // ------------------------------------------------------------------ self-test checks (run by PS.SelfTest)
  (function () {
    function input(label) { return document.querySelector('[aria-label="' + label + '"]'); }
    function typeInto(label, text) {
      var i = input(label);
      i.value = text;
      i.dispatchEvent(new root.Event('change', { bubbles: true }));
      return i;
    }
    function click(text, scope) {
      var b = Array.prototype.filter.call((scope || document).querySelectorAll('button'), function (x) { return x.textContent === text; })[0];
      if (!b) throw new Error('no button "' + text + '"');
      b.click();
    }
    function chipOf(label) { return input(label).parentNode.querySelector('.chip'); }
    function check(rows) {
      var bad = rows.filter(function (r) { return !r[1]; }).map(function (r) { return r[0]; });
      return { ok: !bad.length, detail: bad.length ? 'failed: ' + bad.join('; ') : rows.length + ' assertions' };
    }
    function fresh(A) { A.replaceState(Model.defaultState(), 'selftest'); }
    var pending = (PS.pendingSelfTests = PS.pendingSelfTests || []);

    pending.push(['panels.room-field-chip', function (A) {
      fresh(A);
      var rows = [], i;
      rows.push(['starts EST', chipOf('Back wall width').textContent.indexOf('EST') === 0]);
      i = typeInto('Back wall width', '3.1');
      rows.push(['value applied', Math.abs(A.state.room.width - 3.1) < 1e-9]);
      rows.push(['status user', A.state.roomStatus.width === 'user' && chipOf('Back wall width').textContent.indexOf('USER') === 0]);
      chipOf('Back wall width').querySelector('.chip-x').click();
      rows.push(['reset to default', A.state.room.width === 2.9 && A.state.roomStatus.width === 'estimate']);
      i = typeInto('Back wall width', 'abc');
      rows.push(['non-number rejected', A.state.room.width === 2.9 && i.classList.contains('invalid')]);
      i = typeInto('Pier width', '2');
      rows.push(['invalid room rejected', A.state.room.pierW === 0.17 && i.classList.contains('invalid') && !!i.parentNode.querySelector('.fmsg').textContent]);
      return check(rows);
    }]);

    pending.push(['panels.projector-fit-and-calibration', function (A) {
      fresh(A);
      var rows = [];
      typeInto('Lens y', '3');
      typeInto('Yaw', '12');
      rows.push(['lens y and yaw applied', A.state.projector.lens.y === 3 && A.state.projector.yawDeg === 12]);
      click('Fit to target (square-on)', document.getElementById('panel-projector'));
      var L = A.state.projector.lens;
      rows.push(['fit restores default placement', Math.abs(L.x - 1.45) < 1e-3 && Math.abs(L.y - 3.519) < 2e-3 && Math.abs(L.z - 0.70) < 1e-3 && A.state.projector.yawDeg === 0]);
      rows.push(['I_OFFSET shown', A.result.warnings.some(function (w) { return w.code === 'I_OFFSET'; }) && document.querySelector('[data-code="I_OFFSET"]') !== null]);
      typeInto('vOffset', '0.06');
      rows.push(['calibration stored as measured', A.state.calibration['epson-pl955wh'].vOffsetStatus === 'measured']);
      rows.push(['I_OFFSET gone', document.querySelector('[data-code="I_OFFSET"]') === null]);
      rows.push(['banner says measured', document.getElementById('provenance').textContent.indexOf('Offset: measured') >= 0]);
      typeInto('Zoom', '9');
      rows.push(['zoom out of range rejected', A.state.projector.throwRatio === 1.38]);
      click('Tele', document.getElementById('panel-projector'));
      rows.push(['tele sets max throw', A.state.projector.throwRatio === 2.24]);
      return check(rows);
    }]);

    pending.push(['panels.obstacles-and-target', function (A) {
      fresh(A);
      var rows = [], host = document.getElementById('panel-obstacles');
      click('Add person', host);
      var p = A.state.obstacles[A.state.obstacles.length - 1];
      rows.push(['person added', A.state.obstacles.length === 2 && Math.abs(p.max[2] - 1.75) < 1e-9 && Math.abs((p.min[0] + p.max[0]) / 2 - 1.45) < 1e-9]);
      click('Add box', host);
      rows.push(['box added with unique id', A.state.obstacles.length === 3 && A.state.obstacles[2].id !== p.id]);
      var rowsEl = host.querySelectorAll('.obs');
      rows.push(['one row per obstacle', rowsEl.length === 3]);
      host.querySelectorAll('.obs')[2].querySelector('[aria-label="Delete"]').click();
      rows.push(['box deleted', A.state.obstacles.length === 2 && host.querySelectorAll('.obs').length === 2]);
      A.update(function (d) { d.target.x0 = 0.5; }, 'selftest');
      click('Working image (dimensions.md)', document.getElementById('panel-target'));
      rows.push(['working image restores target', A.state.target.x0 === 0.175 && A.state.target.z1 === 2.29375]);
      click('From current image', document.getElementById('panel-target'));
      rows.push(['target from image', Math.abs(A.state.target.x1 - 2.725) < 1e-3]);
      return check(rows);
    }]);

    pending.push(['panels.modals', function (A) {
      fresh(A);
      var rows = [], host = document.getElementById('modal-host');
      PS.Panels.openHelp();
      rows.push(['help text verbatim', host.textContent.indexOf('vOffset = (h_B − h_L) / (h_T − h_B).') >= 0 && host.textContent.indexOf('Example: 0.80, 0.86 and 1.86 give 0.06.') >= 0]);
      PS.Panels.closeModal();
      rows.push(['help closes', !host.firstChild]);
      click('Edit profiles…', document.getElementById('panel-projector'));
      rows.push(['built-in is read-only', host.querySelector('input.num').disabled === true]);
      click('Duplicate', host);
      rows.push(['duplicate created', A.state.customProfiles.length === 1 && A.state.customProfiles[0].name === 'Epson PowerLite 955WH (copy)']);
      var lum = host.querySelector('[aria-label="Lumens"]');
      rows.push(['custom is editable', lum && !lum.disabled]);
      lum.value = '4000'; lum.dispatchEvent(new root.Event('change', { bubbles: true }));
      rows.push(['edit stored', A.state.customProfiles[0].lumens === 4000]);
      var tmax = host.querySelector('[aria-label="Throw ratio max (tele)"]');
      tmax.value = '1'; tmax.dispatchEvent(new root.Event('change', { bubbles: true }));
      rows.push(['throw max below min rejected', A.state.customProfiles[0].throwMax === 2.24 && tmax.classList.contains('invalid')]);
      PS.Panels.closeModal();
      return check(rows);
    }]);
  })();
})(window);
