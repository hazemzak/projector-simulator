/* State schema, defaults, presets, profile merge, (de)serialisation (PLAN.md §4). Pure: no THREE, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./room.js'));
  else { root.PS = root.PS || {}; root.PS.Model = factory(root.PS.Room); }
})(typeof self !== 'undefined' ? self : this, function (Room) {
  'use strict';

  const SCHEMA = 'projsim/1';
  const DEFAULT_PROFILE_ID = 'epson-pl955wh';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultObstacles() {
    return [{
      id: 'bench', name: 'Bench (existing furniture, may be removed)',
      min: [0.95, 0.30, 0], max: [2.05, 0.75, 0.42], enabled: true
    }];
  }

  function defaultState() {
    return {
      schema: SCHEMA,
      room: Room.defaults(),
      roomStatus: Room.defaultStatus(),
      obstacles: defaultObstacles(),
      customProfiles: [],
      calibration: {},
      projector: {
        profileId: DEFAULT_PROFILE_ID,
        lens: { x: 1.45, y: 3.519, z: 0.70 },
        yawDeg: 0, pitchDeg: 0, rollDeg: 0,
        throwRatio: 1.38,
        mount: 'upright',
        shiftV: 0, shiftH: 0
      },
      target: { enabled: true, x0: 0.175, x1: 2.725, z0: 0.700, z1: 2.29375 },
      display: { ambient: 0.35, exposureLux: 800, falseColour: false, showFrustum: true, keystoneSim: false }
    };
  }

  // Fill missing sections/fields from the defaults so older or hand-written files still load.
  function normalizeState(s) {
    const d = defaultState();
    const out = Object.assign({}, d, s);
    out.room = Object.assign({}, d.room, s.room);
    out.roomStatus = Object.assign({}, d.roomStatus, s.roomStatus);
    out.projector = Object.assign({}, d.projector, s.projector);
    out.projector.lens = Object.assign({}, d.projector.lens, (s.projector || {}).lens);
    out.target = Object.assign({}, d.target, s.target);
    out.display = Object.assign({}, d.display, s.display);
    if (!Array.isArray(out.obstacles)) out.obstacles = d.obstacles;
    if (!Array.isArray(out.customProfiles)) out.customProfiles = [];
    if (!out.calibration || typeof out.calibration !== 'object') out.calibration = {};
    return out;
  }

  function findProfile(state, builtins) {
    const id = state.projector.profileId;
    const all = (state.customProfiles || []).concat(builtins || []);
    for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  // The profile with its calibration (measured offsets) merged in. Never mutates its inputs.
  function effectiveProfile(state, builtins) {
    const base = findProfile(state, builtins);
    if (!base) return null;
    const p = clone(base);
    const cal = (state.calibration || {})[base.id];
    if (cal) {
      ['vOffset', 'vOffsetStatus', 'hOffset', 'hOffsetStatus'].forEach(function (k) {
        if (cal[k] !== undefined && cal[k] !== null) p[k] = cal[k];
      });
    }
    return p;
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function validateState(s) {
    const errors = [];
    if (!s || typeof s !== 'object') return ['State is missing.'];
    if (s.schema !== SCHEMA) errors.push('Unknown schema "' + s.schema + '".');
    Room.validate(s.room).forEach(function (m) { errors.push('Room: ' + m); });

    const p = s.projector;
    if (!p || typeof p !== 'object') errors.push('Projector is missing.');
    else {
      if (typeof p.profileId !== 'string' || !p.profileId) errors.push('Projector: profileId is missing.');
      const lens = p.lens || {};
      ['x', 'y', 'z'].forEach(function (k) { if (!isNum(lens[k])) errors.push('Projector: lens.' + k + ' must be a number.'); });
      ['yawDeg', 'pitchDeg', 'rollDeg', 'shiftV', 'shiftH'].forEach(function (k) {
        if (!isNum(p[k])) errors.push('Projector: ' + k + ' must be a number.');
      });
      if (!isNum(p.throwRatio) || p.throwRatio <= 0) errors.push('Projector: throwRatio must be greater than 0.');
      if (p.mount !== 'upright' && p.mount !== 'ceiling') errors.push('Projector: mount must be "upright" or "ceiling".');
    }

    const t = s.target;
    if (!t || typeof t !== 'object') errors.push('Target is missing.');
    else {
      ['x0', 'x1', 'z0', 'z1'].forEach(function (k) { if (!isNum(t[k])) errors.push('Target: ' + k + ' must be a number.'); });
      if (isNum(t.x0) && isNum(t.x1) && !(t.x0 < t.x1)) errors.push('Target: x0 must be less than x1.');
      if (isNum(t.z0) && isNum(t.z1) && !(t.z0 < t.z1)) errors.push('Target: z0 must be less than z1.');
    }

    if (!Array.isArray(s.obstacles)) errors.push('Obstacles must be a list.');
    else s.obstacles.forEach(function (o, i) {
      const name = 'Obstacle ' + (o && o.name || i + 1);
      if (!o || !Array.isArray(o.min) || !Array.isArray(o.max) || o.min.length !== 3 || o.max.length !== 3 ||
          !o.min.every(isNum) || !o.max.every(isNum)) { errors.push(name + ': min/max must be [x, y, z] numbers.'); return; }
      for (let k = 0; k < 3; k++) if (!(o.min[k] < o.max[k])) { errors.push(name + ': min must be below max on every axis.'); break; }
    });

    const d = s.display;
    if (!d || typeof d !== 'object') errors.push('Display is missing.');
    else {
      if (!isNum(d.ambient) || d.ambient < 0 || d.ambient > 1) errors.push('Display: ambient must be between 0 and 1.');
      if (!isNum(d.exposureLux) || d.exposureLux <= 0) errors.push('Display: exposureLux must be greater than 0.');
    }
    return errors;
  }

  // ---- presets -------------------------------------------------------------------------------
  // patch(state) returns a NEW state; the argument is not modified.

  function preset(label, fn) {
    return {
      label: label,
      patch: function (state) { const s = clone(state); fn(s); return s; }
    };
  }

  function setLens(s, x, y, z) { s.projector.lens = { x: x, y: y, z: z }; }

  function resetPose(s) {
    const d = defaultState();
    s.projector = d.projector;
    s.obstacles = d.obstacles;
    s.target = d.target;
  }

  const PRESETS = {
    default: { label: 'Default (working placement)', patch: function () { return defaultState(); } },
    yaw10: preset('Yaw +10°', function (s) { resetPose(s); s.projector.yawDeg = 10; }),
    pitch8: preset('Pitch +8°', function (s) { resetPose(s); setLens(s, 1.45, 4.00, 1.20); s.projector.pitchDeg = 8; }),
    ceiling: preset('Ceiling mount', function (s) {
      resetPose(s); setLens(s, 1.45, 4.40, 2.45); s.projector.mount = 'ceiling'; s.projector.throwRatio = 1.38;
    }),
    occluder: preset('Occluder (test box)', function (s) {
      resetPose(s);
      s.obstacles[0].enabled = false;
      s.obstacles.push({ id: 'testbox', name: 'test box', min: [1.40, 1.70, 1.20], max: [1.50, 1.80, 1.30], enabled: true });
    }),
    spill: preset('Spill (lens near left wall)', function (s) { resetPose(s); setLens(s, 0.60, 3.519, 0.70); }),
    railclip: preset('Rail clip', function (s) { resetPose(s); setLens(s, 1.20, 4.00, 2.77); })
  };
  PRESETS.default.label = 'Default (working placement)';

  // ---- placements ----------------------------------------------------------------------------

  function makeId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function makePlacement(state, name, note) {
    return {
      id: makeId(),
      name: name,
      note: note || '',
      savedAt: new Date().toISOString(),
      projector: clone(state.projector),
      target: clone(state.target),
      calibration: clone(state.calibration || {}),
      room: clone(state.room),
      roomStatus: clone(state.roomStatus),
      obstacles: clone(state.obstacles),
      customProfiles: clone(state.customProfiles || [])
    };
  }

  function mergeById(current, incoming) {
    const out = clone(current);
    clone(incoming).forEach(function (p) {
      const i = out.findIndex(function (q) { return q.id === p.id; });
      if (i >= 0) out[i] = p; else out.push(p);
    });
    return out;
  }

  // Returns a new state. Pose, target, calibration and custom profiles always come from the placement
  // (calibration and custom profiles are merged by profile id, so profiles not in the placement survive).
  // Room, room status and obstacles come from the placement only when restoreRoom is true.
  function applyPlacement(state, pl, opts) {
    const restoreRoom = !!(opts && opts.restoreRoom);
    const s = clone(state);
    s.projector = clone(pl.projector);
    s.target = clone(pl.target);
    s.customProfiles = mergeById(s.customProfiles || [], pl.customProfiles || []);
    s.calibration = Object.assign({}, s.calibration, clone(pl.calibration || {}));
    if (restoreRoom) {
      s.room = clone(pl.room);
      s.roomStatus = clone(pl.roomStatus);
      s.obstacles = clone(pl.obstacles);
    }
    return s;
  }

  // Differences between two room parameter sets (state.room objects), in PARAMS order.
  function diffRoom(a, b) {
    const out = [];
    Room.PARAMS.forEach(function (p) {
      if (a[p.key] !== b[p.key]) out.push({ key: p.key, a: a[p.key], b: b[p.key] });
    });
    return out;
  }

  // ---- files ---------------------------------------------------------------------------------

  function serializeProject(state, placements) {
    return JSON.stringify({ schema: SCHEMA, state: state, placements: placements || [] }, null, 2);
  }

  function parseProject(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('Not a valid JSON file: ' + e.message); }
    if (!o || typeof o !== 'object' || o.schema !== SCHEMA) {
      throw new Error('Unsupported file: expected schema "' + SCHEMA + '", found "' + (o && o.schema) + '".');
    }
    if (!o.state || typeof o.state !== 'object') throw new Error('The file has no state.');
    const state = normalizeState(o.state);
    const errors = validateState(state);
    if (errors.length) throw new Error('Invalid state: ' + errors.join(' '));
    const placements = o.placements === undefined ? [] : o.placements;
    if (!Array.isArray(placements)) throw new Error('Placements must be a list.');
    return { state: state, placements: placements };
  }

  return {
    SCHEMA: SCHEMA,
    DEFAULT_PROFILE_ID: DEFAULT_PROFILE_ID,
    defaultState: defaultState,
    effectiveProfile: effectiveProfile,
    findProfile: findProfile,
    validateState: validateState,
    PRESETS: PRESETS,
    serializeProject: serializeProject,
    parseProject: parseProject,
    makePlacement: makePlacement,
    applyPlacement: applyPlacement,
    diffRoom: diffRoom
  };
});
