/* State schema, defaults, presets, profile merge, (de)serialisation (PLAN.md §4). Pure: no THREE, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./room.js'), require('../../data/projectors.js'));
  else { root.PS = root.PS || {}; root.PS.Model = factory(root.PS.Room, root.PS.Profiles); }
})(typeof self !== 'undefined' ? self : this, function (Room, Builtins) {
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
    for (let i = 0; i < all.length; i++) if (all[i] && all[i].id === id) return all[i];
    return null;
  }

  // The profile with its calibration (measured offsets) merged in. Never mutates its inputs.
  function effectiveProfile(state, builtins) {
    const base = findProfile(state, builtins);
    if (!base) return null;
    const p = clone(base);
    const cal = (state.calibration || {})[base.id];
    if (cal) ['vOffset', 'hOffset'].forEach(function (key) {
      const status = key + 'Status';
      if (isNum(cal[key])) p[key] = cal[key];
      if (cal[status] !== undefined) p[status] = cal[status] === 'measured' && !isNum(cal[key]) ? 'provisional' : cal[status];
    });
    ['vOffset', 'hOffset'].forEach(function (key) {
      if (!isNum(p[key])) { p[key] = 0; p[key + 'Status'] = 'provisional'; }
    });
    return p;
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function validateProfile(cp) {
    const errors = [];
    if (!cp || typeof cp !== 'object') return ['profile is missing.'];
    if (typeof cp.id !== 'string' || !cp.id) errors.push('id is missing.');
    if (typeof cp.name !== 'string' || !cp.name) errors.push('name is missing.');
    ['nativeW', 'nativeH', 'lumens', 'throwMin', 'throwMax', 'distMin', 'distMax'].forEach(function (k) {
      if (!isNum(cp[k]) || cp[k] <= 0) errors.push(k + ' must be finite and greater than 0.');
    });
    ['nativeW', 'nativeH'].forEach(function (k) {
      if (isNum(cp[k]) && cp[k] > 0 && cp[k] % 1 !== 0) errors.push(k + ' must be a whole number.');
    });
    if (isNum(cp.throwMin) && isNum(cp.throwMax) && cp.throwMax < cp.throwMin) errors.push('throwMax must be at least throwMin.');
    if (isNum(cp.distMin) && isNum(cp.distMax) && cp.distMax < cp.distMin) errors.push('distMax must be at least distMin.');
    ['w', 'd', 'h'].forEach(function (k) {
      if (!cp.body || !isNum(cp.body[k]) || cp.body[k] <= 0) errors.push('body.' + k + ' must be finite and greater than 0.');
    });
    ['vOffset', 'hOffset', 'keystoneV', 'keystoneH'].forEach(function (k) {
      if (!isNum(cp[k])) errors.push(k + ' must be finite.');
    });
    ['lensRight', 'lensUp'].forEach(function (k) {
      if (!cp.body || !isNum(cp.body[k])) errors.push('body.' + k + ' must be finite.');
    });
    ['shiftV', 'shiftH', 'focalMm', 'fNumber'].forEach(function (k) {
      if (!Array.isArray(cp[k]) || cp[k].length !== 2 || !cp[k].every(isNum)) errors.push(k + ' must have two finite numbers.');
      else {
        if (cp[k][1] < cp[k][0]) errors.push(k + ' maximum must be at least minimum.');
        if ((k === 'focalMm' || k === 'fNumber') && cp[k][0] <= 0) errors.push(k + ' minimum must be greater than 0.');
      }
    });
    ['keystoneV', 'keystoneH'].forEach(function (k) {
      if (isNum(cp[k]) && (cp[k] < 0 || cp[k] >= 90)) errors.push(k + ' must be between 0 and 90 degrees.');
    });
    return errors;
  }

  function validateState(s) {
    const errors = [];
    if (!s || typeof s !== 'object') return ['State is missing.'];
    if (s.schema !== SCHEMA) errors.push('Unknown schema "' + s.schema + '".');
    Room.validate(s.room).forEach(function (m) { errors.push('Room: ' + m); });
    if (!Array.isArray(s.customProfiles)) errors.push('Custom profiles must be a list.');
    else s.customProfiles.forEach(function (cp, i) {
      validateProfile(cp).forEach(function (m) { errors.push('Custom profile ' + (i + 1) + ': ' + m); });
    });
    Builtins.forEach(function (bp, i) {
      validateProfile(bp).forEach(function (m) { errors.push('Built-in profile ' + (i + 1) + ': ' + m); });
    });

    const p = s.projector;
    if (!p || typeof p !== 'object') errors.push('Projector is missing.');
    else {
      if (typeof p.profileId !== 'string' || !p.profileId) errors.push('Projector: profileId is missing.');
      else if (!findProfile(s, Builtins)) errors.push('Projector: unknown profile "' + p.profileId + '".');
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

  function validatePlacement(pl) {
    if (!pl || typeof pl !== 'object' || Array.isArray(pl) ||
        typeof pl.id !== 'string' || !pl.id || typeof pl.name !== 'string' ||
        typeof pl.note !== 'string' || typeof pl.savedAt !== 'string' || !isFinite(Date.parse(pl.savedAt)))
      return ['Placement metadata is incomplete.'];
    const fields = ['projector', 'target', 'calibration', 'room', 'roomStatus', 'obstacles', 'customProfiles'];
    if (fields.some(function (k) { return !Object.prototype.hasOwnProperty.call(pl, k); }))
      return ['Placement is incomplete.'];
    if (!pl.projector || !pl.target || !pl.room || !pl.roomStatus ||
        !pl.calibration || typeof pl.calibration !== 'object' || Array.isArray(pl.calibration) ||
        !Array.isArray(pl.obstacles) || !Array.isArray(pl.customProfiles) ||
        Room.PARAMS.some(function (p) { return !Object.prototype.hasOwnProperty.call(pl.room, p.key) ||
          !Object.prototype.hasOwnProperty.call(pl.roomStatus, p.key); }) ||
        !['enabled', 'x0', 'x1', 'z0', 'z1'].every(function (k) { return Object.prototype.hasOwnProperty.call(pl.target, k); }) ||
        !['profileId', 'lens', 'yawDeg', 'pitchDeg', 'rollDeg', 'throwRatio', 'mount', 'shiftV', 'shiftH']
          .every(function (k) { return Object.prototype.hasOwnProperty.call(pl.projector, k); }))
      return ['Placement is incomplete.'];
    const state = Object.assign(defaultState(), {
      projector: pl.projector, target: pl.target, calibration: pl.calibration,
      room: Object.assign(Room.defaults(), pl.room), roomStatus: Object.assign(Room.defaultStatus(), pl.roomStatus),
      obstacles: pl.obstacles, customProfiles: pl.customProfiles
    });
    return validateState(state);
  }

  function filterPlacements(list) { return list.filter(function (pl) { return !validatePlacement(pl).length; }); }

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
    const errors = validatePlacement(pl);
    if (errors.length) throw new Error('Invalid placement: ' + errors.join(' '));
    const restoreRoom = !!(opts && opts.restoreRoom);
    const s = clone(state);
    s.projector = clone(pl.projector);
    s.target = clone(pl.target);
    s.customProfiles = mergeById(s.customProfiles || [], pl.customProfiles || []);
    s.calibration = Object.assign({}, s.calibration, clone(pl.calibration || {}));
    if (restoreRoom) {
      s.room = Object.assign(Room.defaults(), clone(pl.room));
      s.roomStatus = Object.assign(Room.defaultStatus(), clone(pl.roomStatus));
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
    const aReflectance = a.wallReflectance === undefined ? Room.WALL_REFLECTANCE.def : a.wallReflectance;
    const bReflectance = b.wallReflectance === undefined ? Room.WALL_REFLECTANCE.def : b.wallReflectance;
    if (aReflectance !== bReflectance) out.push({ key: 'wallReflectance', a: aReflectance, b: bReflectance });
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
    const valid = filterPlacements(placements);
    return { state: state, placements: valid, skipped: placements.length - valid.length };
  }

  return {
    SCHEMA: SCHEMA,
    DEFAULT_PROFILE_ID: DEFAULT_PROFILE_ID,
    defaultState: defaultState,
    effectiveProfile: effectiveProfile,
    findProfile: findProfile,
    validateState: validateState,
    validateProfile: validateProfile,
    PRESETS: PRESETS,
    serializeProject: serializeProject,
    parseProject: parseProject,
    makePlacement: makePlacement,
    validatePlacement: validatePlacement,
    filterPlacements: filterPlacements,
    applyPlacement: applyPlacement,
    diffRoom: diffRoom
  };
});
