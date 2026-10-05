/* PS.Manip: TransformControls gizmo on the projector pivot, view bar and keyboard (PLAN.md section 6.3). Owned by P5.
 * Drag -> App.update(..., 'gizmo'), angles via PS.Optics.poseFromBasis (section 2.2 inverse).
 * Keys: W move (world), E rotate (local), Q toggle space, S snap, 1-4 views. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};

  var SNAP_M = 0.01, SNAP_DEG = 1;
  var VIEW_BUTTONS = [
    { view: 'persp', label: 'Perspective', key: '1' },
    { view: 'top', label: 'Top', key: '2' },
    { view: 'wall', label: 'Back wall', key: '3' },
    { view: 'projector', label: 'From projector', key: '4' }
  ];

  var App, THREE, controls, pivot, bar, buttons = {}, spaceLabel;
  var snapOn = false, dragging = false;

  function round(v, d) { var k = Math.pow(10, d); return Math.round(v * k) / k; }

  // ---------------------------------------------------------------- pivot -> state
  // Read the pivot transform (frame T) and convert to room-frame lens position and pose.
  function readPivot() {
    var T2R = PS.Scene.t2r;
    var m = new THREE.Matrix4().makeRotationFromQuaternion(pivot.quaternion);
    var yT = new THREE.Vector3().setFromMatrixColumn(m, 1);   // content up
    var zT = new THREE.Vector3().setFromMatrixColumn(m, 2);   // minus the optical axis
    var f = T2R(zT.clone().negate()), u = T2R(yT);
    var pose = PS.Optics.poseFromBasis(f, u, App.state.projector.yawDeg);
    return { lens: T2R(pivot.position), pose: pose };
  }

  // Same handler for real gizmo drags and for the self test (controls 'objectChange').
  function onObjectChange() {
    var p = readPivot();
    return App.update(function (d) {
      d.projector.lens = { x: round(p.lens[0], 4), y: round(p.lens[1], 4), z: round(p.lens[2], 4) };
      d.projector.yawDeg = round(p.pose.yawDeg, 3);
      d.projector.pitchDeg = round(p.pose.pitchDeg, 3);
      d.projector.rollDeg = round(p.pose.rollDeg, 3);
    }, 'gizmo');
  }

  // After a drag, push the (validated) state back onto the pivot: scene.sync skips the pivot for source 'gizmo'.
  function onDraggingChanged(e) {
    dragging = !!e.value;
    App.orbit.enabled = !dragging;
    if (!dragging) App.update(function () {}, 'gizmo-end');
  }

  // ---------------------------------------------------------------- modes, snap, views
  function setMode(mode) {
    controls.setMode(mode);
    controls.setSpace(mode === 'rotate' ? 'local' : 'world');
    refreshBar();
    App.requestRender();
  }

  function toggleSpace() {
    controls.setSpace(controls.space === 'local' ? 'world' : 'local');
    refreshBar();
    App.requestRender();
  }

  function setSnap(on) {
    snapOn = !!on;
    controls.setTranslationSnap(snapOn ? SNAP_M : null);
    controls.setRotationSnap(snapOn ? SNAP_DEG * Math.PI / 180 : null);
    refreshBar();
  }

  function onView() {
    var v = App.getView();
    controls.camera = v === 'projector' ? App.cameras.persp : App.cameras[v];
    if (v === 'projector') controls.detach();           // projector view is read-only
    else if (controls.object !== pivot) controls.attach(pivot);
    refreshBar();
    App.requestRender();
  }

  // ---------------------------------------------------------------- view bar
  function el(tag, cls, text, title) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (title) e.title = title;
    if (tag === 'button') e.type = 'button';
    return e;
  }

  function addStyle() {
    var st = document.createElement('style');
    st.id = 'manip-style';
    st.textContent =
      '#viewbar{align-items:center}' +
      '#viewbar .vb{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid var(--edge);border-radius:2px;background:var(--field);color:var(--text);font-size:12px;cursor:pointer;transition:background-color .12s ease-out,border-color .12s ease-out,color .12s ease-out}' +
      '@media(hover:hover){#viewbar .vb:hover{background:var(--raise)}}' +
      '#viewbar .vb[aria-pressed="true"]{background:var(--field);border-color:var(--accent);color:var(--accent)}' +
      '#viewbar .vb-sep{width:1px;height:16px;align-self:center;margin:0 4px;background:var(--hair)}' +
      '#viewbar .vb-hint{margin-left:auto;font-size:12px;color:var(--text-2)}' +
      '#viewbar kbd{font:inherit;font-family:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;font-size:11px;color:var(--text-2);margin-left:4px}';
    document.head.appendChild(st);
  }

  function button(id, label, key, title, onClick) {
    var b = el('button', 'vb', label, title);
    if (key) { var k = el('kbd', null, key); b.appendChild(k); }
    b.addEventListener('click', onClick);
    buttons[id] = b;
    bar.appendChild(b);
    return b;
  }

  function buildBar() {
    bar = document.getElementById('viewbar');
    if (!bar) return;
    bar.textContent = '';
    addStyle();
    VIEW_BUTTONS.forEach(function (vb) {
      button(vb.view, vb.label, vb.key, vb.label + ' view (key ' + vb.key + ')', function () { App.setView(vb.view); });
    });
    bar.appendChild(el('span', 'vb-sep'));
    button('translate', 'Move', 'W', 'Move the projector (key W, world axes)', function () { setMode('translate'); });
    button('rotate', 'Rotate', 'E', 'Rotate the projector (key E, local axes)', function () { setMode('rotate'); });
    button('space', 'Space', 'Q', 'Toggle world / local axes (key Q)', toggleSpace);
    button('snap', 'Snap', 'S', 'Snap to 0.01 m / 1 degree (key S)', function () { setSnap(!snapOn); });
    bar.appendChild(el('span', 'vb-sep'));
    button('reset', 'Reset camera', null, 'Return the current view to its default framing', function () { App.resetCamera(); });
    spaceLabel = el('span', 'vb-hint');
    bar.appendChild(spaceLabel);
  }

  function refreshBar() {
    if (!bar) return;
    var v = App.getView();
    VIEW_BUTTONS.forEach(function (vb) { buttons[vb.view].setAttribute('aria-pressed', String(vb.view === v)); });
    var readOnly = v === 'projector';
    buttons.translate.setAttribute('aria-pressed', String(controls.mode === 'translate'));
    buttons.rotate.setAttribute('aria-pressed', String(controls.mode === 'rotate'));
    buttons.snap.setAttribute('aria-pressed', String(snapOn));
    buttons.space.setAttribute('aria-pressed', 'false');
    ['translate', 'rotate', 'space', 'snap'].forEach(function (id) { buttons[id].disabled = readOnly; buttons[id].style.opacity = readOnly ? '0.5' : ''; });
    spaceLabel.textContent = readOnly ? 'From projector (read-only)' : controls.mode === 'rotate' ? 'Rotate, ' + controls.space + ' axes' : 'Move, ' + controls.space + ' axes';
  }

  // ---------------------------------------------------------------- keyboard
  function typing(t) {
    if (!t || !t.tagName) return false;
    var n = t.tagName.toLowerCase();
    // a focused checkbox, slider or button takes no typed text, so keys 1-4 and W/E/Q/S still work after clicking one
    if (n === 'input') return !/^(checkbox|radio|range|button|submit|reset|file|color|image)$/.test(t.type);
    return n === 'textarea' || n === 'select' || t.isContentEditable;
  }

  function onKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
    var host = document.getElementById('modal-host');
    if (host && host.childNodes.length) return;
    var k = (e.key || '').toLowerCase(), ro = App.getView() === 'projector', used = true;
    if (k === '1') App.setView('persp');
    else if (k === '2') App.setView('top');
    else if (k === '3') App.setView('wall');
    else if (k === '4') App.setView('projector');
    else if (ro) used = false;
    else if (k === 'w') setMode('translate');
    else if (k === 'e') setMode('rotate');
    else if (k === 'q') toggleSpace();
    else if (k === 's') setSnap(!snapOn);
    else used = false;
    if (used) e.preventDefault();
  }

  // ---------------------------------------------------------------- self test
  // Rotate the pivot about the vertical axis (room z = three.js Y) and run the real objectChange path.
  function selfTestYaw(app) {
    var saved = JSON.parse(JSON.stringify(app.state));
    try {
      var r = app.replaceState(PS.Model.defaultState(), 'selftest');
      if (!r.ok) return { ok: false, detail: 'default state rejected: ' + r.errors.join('; ') };
      if (app.getView() === 'projector') onView();
      var q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -10 * Math.PI / 180);
      app.projectorPivot.quaternion.premultiply(q);
      controls.dispatchEvent({ type: 'objectChange' });
      var p = app.state.projector, bad = [];
      if (Math.abs(p.yawDeg - 10) > 0.01) bad.push('yaw ' + p.yawDeg + ' expected 10 +-0.01');
      if (Math.abs(p.pitchDeg) > 0.01) bad.push('pitch ' + p.pitchDeg + ' expected 0 +-0.01');
      var detail = 'yaw=' + p.yawDeg.toFixed(3) + ' pitch=' + p.pitchDeg.toFixed(3) + ' roll=' + p.rollDeg.toFixed(3);
      return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: detail };
    } finally {
      app.replaceState(saved, 'selftest');   // source other than 'gizmo' puts the pivot back on the state
    }
  }

  // ---------------------------------------------------------------- init
  function init(app) {
    App = app;
    THREE = root.THREE;
    pivot = App.projectorPivot;

    controls = new THREE.TransformControls(App.cameras.persp, App.domElement);
    function sizeForViewport() {
      controls.setSize(parseFloat(root.getComputedStyle(document.documentElement).getPropertyValue('--gizmo-size')) || 0.8);
      App.requestRender();
    }
    sizeForViewport();
    root.addEventListener('resize', sizeForViewport);
    controls.setMode('translate');
    controls.setSpace('world');
    controls.addEventListener('objectChange', onObjectChange);
    controls.addEventListener('dragging-changed', onDraggingChanged);
    controls.addEventListener('change', function () { App.requestRender(); });
    App.scene.add(controls.getHelper());
    controls.attach(pivot);

    buildBar();
    root.document.addEventListener('keydown', onKey);
    App.on('view', onView);

    var want = App.params && App.params.view;
    if (want && PS.Scene.VIEWS.indexOf(want) >= 0 && App.getView() !== want) App.setView(want);
    onView();

    if (PS.SelfTest && PS.SelfTest.register) PS.SelfTest.register('manip.gizmo-yaw10', selfTestYaw);
  }

  PS.Manip = {
    init: init,
    controls: function () { return controls; },
    onObjectChange: onObjectChange,
    setMode: setMode,
    setSnap: setSnap
  };
})(window);
