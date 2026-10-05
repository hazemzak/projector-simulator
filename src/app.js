/* PS.App: state store, event bus, URL parameters and wiring (PLAN.md section 1.4). Owned by P3.
 * Other packages add files and never edit this one: it calls PS.<Name>.init(PS.App) for Panels, Manip,
 * Storage and Export when they exist, then runs the self test if ?selftest=1. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};
  var Model = PS.Model, Analysis = PS.Analysis;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var params = {};
  new root.URLSearchParams(root.location.search).forEach(function (v, k) { params[k] = v; });

  var host = document.getElementById('canvas-host');
  var S;
  try {
    S = PS.Scene.create(host);
  } catch (e) {
    host.textContent = 'WebGL2 is not available: ' + e.message;
    document.body.dataset.boot = 'nowebgl';
    if (params.selftest) {
      var pre = document.createElement('pre');
      pre.id = 'selftest';
      pre.textContent = 'FAIL env.webgl2 ' + e.message;
      document.body.appendChild(pre);
      document.body.dataset.selftest = 'FAIL';
    }
    return;
  }

  // ------------------------------------------------------------------ state
  var initial = Model.PRESETS[params.preset] ? Model.PRESETS[params.preset].patch(Model.defaultState()) : Model.defaultState();
  var state = initial;
  var result = Analysis.analyze(state, PS.Profiles);
  var listeners = { change: [], view: [], content: [] };
  var content = { kind: 'testcard', name: 'Test card', source: null };
  var contentKey = '';

  function emit(evt, payload) {
    listeners[evt].slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { if (root.console) root.console.error(e); }
    });
  }

  function profileKey(p) { return [p.id, p.name, p.nativeW, p.nativeH].join('|'); }

  function rebuildContent() {
    var p = result.profile;
    var canvas = content.kind === 'image' ? PS.TestCard.letterbox(content.source, p.nativeW, p.nativeH) : PS.TestCard.draw(p);
    contentKey = profileKey(p) + '|' + content.kind;
    S.setContentCanvas(canvas);
  }

  // Validate, analyse and apply a candidate state. Returns {ok, errors}.
  function apply(candidate, source) {
    var errors = Model.validateState(candidate);
    if (errors.length) return { ok: false, errors: errors };
    var res;
    try { res = Analysis.analyze(candidate, PS.Profiles); }
    catch (e) { return { ok: false, errors: [e.message] }; }
    state = candidate;
    result = res;
    S.sync(state, result, source);
    if (contentKey !== profileKey(result.profile) + '|' + content.kind) rebuildContent();
    emit('change', { state: state, result: result, source: source });
    return { ok: true, errors: [] };
  }

  var App = {
    params: params,
    nostore: !!params.nostore,
    sharedLink: false,
    shareError: '',

    // state
    update: function (fn, source) {
      var draft = clone(state);
      try { fn(draft); } catch (e) { return { ok: false, errors: [e.message] }; }
      return apply(draft, source || 'api');
    },
    replaceState: function (newState, source) { return apply(clone(newState), source || 'api'); },
    on: function (evt, fn) {
      if (!listeners[evt]) throw new Error('Unknown event "' + evt + '"');
      listeners[evt].push(fn);
      return function () { var i = listeners[evt].indexOf(fn); if (i >= 0) listeners[evt].splice(i, 1); };
    },

    // rendering and views
    requestRender: function () { S.requestRender(); },
    renderNow: function () { S.renderNow(); },
    setView: function (name) {
      if (!S.setView(name)) return false;
      emit('view', { view: name });
      return true;
    },
    getView: function () { return S.getView(); },
    resetCamera: function () { S.resetCamera(); },
    renderToCanvas: function (view, widthPx, opts) { return S.renderToCanvas(view, widthPx, opts); },

    // content
    setContentTestCard: function () {
      content = { kind: 'testcard', name: 'Test card', source: null };
      rebuildContent();
      emit('content', { kind: 'testcard', name: content.name });
    },
    setContentImage: function (img, name) {
      content = { kind: 'image', name: name || 'image', source: img };
      rebuildContent();
      emit('content', { kind: 'image', name: content.name });
    }
  };

  Object.defineProperties(App, {
    state: { get: function () { return state; }, enumerable: true },
    result: { get: function () { return result; }, enumerable: true },
    // built-in profiles, then the custom ones of the current state
    profiles: { get: function () { return PS.Profiles.concat(state.customProfiles || []); }, enumerable: true },
    content: { get: function () { return { kind: content.kind, name: content.name }; }, enumerable: true },
    renderer: { get: function () { return S.renderer; }, enumerable: true },
    scene: { get: function () { return S.scene; }, enumerable: true },
    cameras: { get: function () { return S.cameras; }, enumerable: true },
    orbit: { get: function () { return S.orbit; }, enumerable: true },
    projectorPivot: { get: function () { return S.projectorPivot; }, enumerable: true },
    domElement: { get: function () { return S.domElement; }, enumerable: true },
    depthTarget: { get: function () { return S.depthTarget(); }, enumerable: true }
  });

  PS.App = App;

  // ------------------------------------------------------------------ boot
  function openShareFragment(fragment) {
    return PS.Share.decode(fragment).then(function (decoded) {
      if (!decoded.ok) return { ok: false, error: decoded.error };
      var applied = apply(decoded.state, 'share');
      if (!applied.ok) return { ok: false, error: applied.errors.join(' ') };
      App.sharedLink = true;
      return { ok: true };
    });
  }
  App.openShareFragment = openShareFragment;

  function shareFailure(error) {
    state = initial;
    result = Analysis.analyze(state, PS.Profiles);
    App.sharedLink = false;
    App.shareError = 'Invalid shared link: ' + (error && error.message ? error.message : error);
  }

  function boot() {
    S.sync(state, result, 'init');
    rebuildContent();
    App.setView(Model && PS.Scene.VIEWS.indexOf(params.view) >= 0 ? params.view : 'persp');
    ['Panels', 'Manip', 'Storage', 'Export'].forEach(function (name) {
      if (PS[name] && typeof PS[name].init === 'function') PS[name].init(App);
    });
    emit('change', { state: state, result: result, source: 'init' });
    S.renderNow();
    document.body.dataset.boot = 'ok r' + root.THREE.REVISION;
    if (params.selftest && PS.SelfTest && typeof PS.SelfTest.run === 'function') PS.SelfTest.run(App);
  }
  function loadShareAndBoot(encoded, done) {
    return Promise.resolve().then(function () { return openShareFragment(encoded); }).then(function (r) {
      if (!r.ok) shareFailure(r.error);
    }, shareFailure).then(done);
  }
  if (PS.SelfTest && PS.SelfTest.register) PS.SelfTest.register('app.share-throw-boots', function () {
    var savedState = state, savedResult = result, savedError = App.shareError, savedShared = App.sharedLink;
    var oldDecode = PS.Share.decode, oldSync = S.sync, oldBoot = document.body.dataset.boot, calls = 0;
    PS.Share.decode = function () { return Promise.resolve({ ok: true, state: Model.defaultState() }); };
    S.sync = function (s, r, source) { if (source === 'share') throw new Error('simulated apply failure'); return oldSync.apply(S, arguments); };
    return loadShareAndBoot('stub', function () { calls++; document.body.dataset.boot = 'ok simulated'; }).then(function () {
      return { ok: calls === 1 && document.body.dataset.boot.indexOf('ok') === 0 &&
        App.shareError.indexOf('simulated apply failure') >= 0 && state === initial,
        detail: 'boot calls ' + calls + ', error ' + App.shareError };
    }).catch(function (e) { return { ok: false, detail: e.message }; }).then(function (check) {
      PS.Share.decode = oldDecode; S.sync = oldSync;
      state = savedState; result = savedResult; App.shareError = savedError; App.sharedLink = savedShared;
      document.body.dataset.boot = oldBoot;
      return check;
    });
  });
  var fragment = /^#s=(.*)$/.exec(root.location.hash);
  if (fragment) loadShareAndBoot(fragment[1], boot);
  else boot();
})(window);
