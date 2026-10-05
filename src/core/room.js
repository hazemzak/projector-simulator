/* Room parameter schema, validation and geometry generation (PLAN.md §3). Pure: no THREE, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PS = root.PS || {}; root.PS.Room = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [key, label, group, def, low, high, status, definition]
  const ROWS = [
    ['width', 'Back wall width', 'Room', 2.90, 2.55, 3.30, 'estimate', 'back wall, left face to right face, at 1 m height'],
    ['depth', 'Room depth', 'Room', 5.20, 4.10, 6.70, 'provisional', "back wall to the front wall's inside face"],
    ['ceiling', 'Ceiling height', 'Room', 3.25, 2.95, 3.65, 'estimate', 'floor to flat ceiling'],
    ['greyTop', 'Grey paint height', 'Room', 2.55, 2.30, 2.90, 'estimate', 'floor to the grey/white paint line'],
    ['photoDepth', 'Photographed depth', 'Room', 3.90, 3.30, 4.70, 'estimate', 'y beyond which no photo shows the room (visual hatch only)'],
    ['skirtH', 'Skirting height', 'Skirting', 0.09, 0.07, 0.12, 'estimate', 'skirting height'],
    ['skirtT', 'Skirting thickness', 'Skirting', 0.012, 0.008, 0.020, 'assumed', 'skirting thickness'],
    ['pierW', 'Pier width', 'Pier', 0.17, 0.10, 0.25, 'estimate', 'pier width along the back wall'],
    ['pierD', 'Pier projection', 'Pier', 0.16, 0.10, 0.24, 'estimate', 'pier projection along the left wall'],
    ['acW', 'AC width', 'AC', 1.07, 0.90, 1.25, 'estimate', 'AC width'],
    ['acH', 'AC height', 'AC', 0.31, 0.25, 0.38, 'estimate', 'AC height'],
    ['acD', 'AC depth', 'AC', 0.23, 0.17, 0.30, 'estimate', 'AC depth from the wall'],
    ['acGapR', 'AC gap to right wall', 'AC', 0.10, 0.00, 0.40, 'estimate', "right wall to the AC's right end"],
    ['acBottom', 'AC underside height', 'AC', 2.70, 2.55, 2.80, 'estimate', 'floor to the AC underside'],
    ['sockSize', 'Socket plate size', 'Sockets', 0.08, 0.07, 0.10, 'estimate', 'socket plate side'],
    ['sockT', 'Socket plate thickness', 'Sockets', 0.010, null, null, 'assumed', 'plate thickness'],
    ['sockBackX', 'Back socket x', 'Sockets', 0.43, 0.35, 0.60, 'estimate', "left face to the back-wall socket's centre"],
    ['sockBackZ', 'Back socket z', 'Sockets', 0.28, 0.20, 0.35, 'estimate', 'floor to its centre'],
    ['sockL1Y', 'Left socket 1 y', 'Sockets', 0.43, 0.25, 0.70, 'estimate', "back wall to left-wall socket 1's centre"],
    ['sockL2Y', 'Left socket 2 y', 'Sockets', 3.35, 2.70, 4.30, 'estimate', "back wall to left-wall socket 2's centre"],
    ['sockLZ', 'Left sockets z', 'Sockets', 0.28, null, null, 'assumed', "floor to the left sockets' centre"],
    ['openY', 'Opening position', 'Opening', 3.90, 3.20, 4.40, 'provisional', "back wall to the opening's near jamb (left wall)"],
    ['openW', 'Opening width', 'Opening', 1.05, 0.75, 1.45, 'provisional', 'opening clear width'],
    ['openH', 'Opening height', 'Opening', 2.35, 2.00, 2.70, 'provisional', 'opening clear height'],
    ['railY', 'Rail y', 'Track rail', 2.65, 1.80, 4.00, 'estimate', 'back wall to the cross-rail centreline'],
    ['railX0', 'Rail x start', 'Track rail', 0.30, null, null, 'estimate', "left face to the cross rail's left end"],
    ['railLen', 'Rail length', 'Track rail', 2.30, 1.80, 2.80, 'estimate', 'cross-rail length'],
    ['railDrop', 'Rail drop', 'Track rail', 0.50, 0.35, 0.70, 'estimate', 'ceiling to the rail underside'],
    ['railSec', 'Rail section', 'Track rail', 0.04, null, null, 'assumed', 'rail square cross-section'],
    ['stemAt', 'Stem position', 'Track rail', 1.15, null, null, 'assumed', 'stem position along the cross rail, from its left end'],
    ['stemLen', 'Stem length', 'Track rail', 1.50, 0.80, 2.20, 'provisional', 'stem length from the cross-rail centreline toward +y'],
    ['spot1At', 'Spotlight 1 position', 'Spotlights', 0.74, null, null, 'assumed', 'spotlight 1 position along the cross rail from its left end'],
    ['spot2At', 'Spotlight 2 position', 'Spotlights', 0.55, null, null, 'assumed', 'spotlight 2 position along the stem from the cross-rail centreline'],
    ['spot3At', 'Spotlight 3 position', 'Spotlights', 1.15, null, null, 'assumed', 'spotlight 3 position along the stem'],
    ['spotDrop', 'Spotlight drop', 'Spotlights', 0.18, 0.12, 0.25, 'assumed', 'rail underside to the spotlight bottom'],
    ['spotSize', 'Spotlight size', 'Spotlights', 0.08, null, null, 'assumed', 'spotlight box side']
  ];

  const PARAMS = ROWS.map(function (r) {
    return { key: r[0], label: r[1], group: r[2], def: r[3], low: r[4], high: r[5], status: r[6], unit: 'm', definition: r[7] };
  });
  const WALL_REFLECTANCE = { key: 'wallReflectance', label: 'Wall reflectance', group: 'Room',
    def: 0.50, low: 0.05, high: 0.95, status: 'estimate', unit: '',
    definition: 'fraction of light reflected by the matte grey wall' };
  const PARAM_BY_KEY = {};
  PARAMS.forEach(function (p) { PARAM_BY_KEY[p.key] = p; });
  PARAM_BY_KEY.wallReflectance = WALL_REFLECTANCE;

  const COLORS = {
    wallGrey: '#a3a8b2', wallWhite: '#efefea', ceiling: '#f2f2ee', floor: '#7b4f35', skirting: '#f4f4f0',
    ac: '#e8e8e4', rail: '#d8d8d8', sockets: '#f0f0f0', obstacle: '#8c7a6a', hatchMix: '#e0a050'
  };

  const FACE_CLASSES = { x0: 'leftWall', x1: 'rightWall', y0: 'backWall', y1: 'frontWall', z0: 'floor', z1: 'ceiling' };

  function defaults() {
    const o = {};
    PARAMS.forEach(function (p) { o[p.key] = p.def; });
    o.wallReflectance = WALL_REFLECTANCE.def;
    return o;
  }

  function defaultStatus() {
    const o = {};
    PARAMS.forEach(function (p) { o[p.key] = p.status; });
    o.wallReflectance = WALL_REFLECTANCE.status;
    return o;
  }

  // ---- validation ----------------------------------------------------------------------------

  function validate(p) {
    const msgs = [];
    if (!p || typeof p !== 'object') return ['Room is missing.'];
    let numeric = true;
    PARAMS.forEach(function (d) {
      const v = p[d.key];
      if (typeof v !== 'number' || !isFinite(v)) { msgs.push(d.label + ' (' + d.key + ') must be a number.'); numeric = false; }
      else if (d.key === 'acGapR' || d.key === 'railX0') { if (v < 0) msgs.push(d.label + ' must be ≥ 0.'); }
      else if (v <= 0) msgs.push(d.label + ' must be greater than 0.');
    });
    if (typeof p.wallReflectance !== 'number' || !isFinite(p.wallReflectance) ||
        p.wallReflectance < 0 || p.wallReflectance > 1) msgs.push('Wall reflectance (wallReflectance) must be between 0 and 1.');
    if (!numeric) return msgs;

    if (!(p.pierW < p.width / 2)) msgs.push('Pier width must be less than half the room width.');
    if (p.acGapR + p.acW > p.width - p.pierW) msgs.push('AC does not fit between the pier and the right wall.');
    if (p.acBottom + p.acH > p.ceiling) msgs.push('AC top is above the ceiling.');
    if (!(p.greyTop < p.ceiling)) msgs.push('Grey paint height must be below the ceiling.');
    if (p.openY + p.openW > p.depth) msgs.push('Opening extends beyond the front wall.');
    if (!(p.openH < p.ceiling)) msgs.push('Opening height must be below the ceiling.');
    if (p.railX0 + p.railLen > p.width) msgs.push('Cross rail extends beyond the right wall.');
    if (!(p.railDrop > p.railSec + p.spotDrop)) msgs.push('Rail drop must exceed rail section plus spotlight drop.');
    if (!(p.railDrop < p.ceiling)) msgs.push('Rail drop must be less than the ceiling height.');
    if (p.stemAt > p.railLen) msgs.push('Stem position is beyond the end of the cross rail.');
    if (p.railY + p.stemLen > p.depth) msgs.push('Stem extends beyond the front wall.');
    if (p.spot1At > p.railLen) msgs.push('Spotlight 1 is beyond the end of the cross rail.');
    if (p.spot2At > p.stemLen) msgs.push('Spotlight 2 is beyond the end of the stem.');
    if (p.spot3At > p.stemLen) msgs.push('Spotlight 3 is beyond the end of the stem.');
    const h = p.sockSize / 2;
    if (p.sockBackX - h < 0 || p.sockBackX + h > p.width) msgs.push('Back-wall socket is outside the wall (x).');
    if (p.sockBackZ - h < 0 || p.sockBackZ + h > p.ceiling) msgs.push('Back-wall socket is outside the wall (z).');
    if (p.sockL1Y - h < 0 || p.sockL1Y + h > p.depth) msgs.push('Left-wall socket 1 is outside the wall.');
    if (p.sockL2Y - h < 0 || p.sockL2Y + h > p.depth) msgs.push('Left-wall socket 2 is outside the wall.');
    if (p.sockLZ - h < 0 || p.sockLZ + h > p.ceiling) msgs.push('Left-wall sockets are outside the wall (z).');
    return msgs;
  }

  // ---- geometry ------------------------------------------------------------------------------

  function buildScene(p, obstacles) {
    const W = p.width, Dp = p.depth, Hc = p.ceiling;
    const s = p.railSec;
    const Hr = Hc - p.railDrop;
    const solids = [];

    function add(id, label, min, max, group, extra) {
      const o = { id: id, label: label, min: min, max: max, group: group, provisional: false };
      if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      solids.push(o);
    }

    // architecture
    add('pier', 'pier', [0, 0, 0], [p.pierW, p.pierD, Hc], 'obstacle');
    add('ac', 'AC unit', [W - p.acGapR - p.acW, 0, p.acBottom], [W - p.acGapR, p.acD, p.acBottom + p.acH], 'obstacle');

    // track rail and spotlights
    const stemX = p.railX0 + p.stemAt;
    add('railCross', 'track rail (cross bar)', [p.railX0, p.railY - s / 2, Hr], [p.railX0 + p.railLen, p.railY + s / 2, Hr + s], 'obstacle');
    add('railStem', 'track rail (stem)', [stemX - s / 2, p.railY + s / 2, Hr], [stemX + s / 2, p.railY + p.stemLen, Hr + s], 'obstacle', { provisional: true });
    function spot(id, label, cx, cy, provisional) {
      const h = p.spotSize / 2;
      add(id, label, [cx - h, cy - h, Hr - p.spotDrop], [cx + h, cy + h, Hr], 'obstacle', { provisional: provisional });
    }
    spot('spot1', 'spotlight 1', p.railX0 + p.spot1At, p.railY, false);
    spot('spot2', 'spotlight 2', stemX, p.railY + p.spot2At, true);
    spot('spot3', 'spotlight 3', stemX, p.railY + p.spot3At, true);

    // skirting (wallItem; counts as the wall it sits on)
    const t = p.skirtT, sh = p.skirtH;
    add('skirtBack', 'skirting (back wall)', [p.pierW, 0, 0], [W, t, sh], 'wallItem', { countsAs: 'backWall' });
    add('skirtLeft1', 'skirting (left wall)', [0, p.pierD, 0], [t, p.openY, sh], 'wallItem', { countsAs: 'leftWall' });
    add('skirtLeft2', 'skirting (left wall)', [0, p.openY + p.openW, 0], [t, Dp, sh], 'wallItem', { countsAs: 'leftWall' });
    add('skirtRight', 'skirting (right wall)', [W - t, 0, 0], [W, Dp, sh], 'wallItem', { countsAs: 'rightWall' });

    // sockets
    const k = p.sockSize / 2, st = p.sockT;
    add('sockBack', 'socket (back wall)', [p.sockBackX - k, 0, p.sockBackZ - k], [p.sockBackX + k, st, p.sockBackZ + k], 'wallItem', { countsAs: 'backWall' });
    add('sockL1', 'socket (left wall)', [0, p.sockL1Y - k, p.sockLZ - k], [st, p.sockL1Y + k, p.sockLZ + k], 'wallItem', { countsAs: 'leftWall' });
    add('sockL2', 'socket (left wall)', [0, p.sockL2Y - k, p.sockLZ - k], [st, p.sockL2Y + k, p.sockLZ + k], 'wallItem', { countsAs: 'leftWall' });

    // user obstacles
    (obstacles || []).forEach(function (o) {
      if (!o || !o.enabled) return;
      add(o.id, o.name || o.id, o.min.slice(), o.max.slice(), 'obstacle', { user: true });
    });

    // shell, holes
    const shell = {
      min: [0, 0, 0], max: [W, Dp, Hc], size: [W, Dp, Hc], width: W, depth: Dp, height: Hc,
      classes: Object.assign({}, FACE_CLASSES)
    };
    const holes = [{ face: 'x0', u0: p.openY, u1: p.openY + p.openW, v0: 0, v1: p.openH, cls: 'opening' }];

    // render quads: corners in room coordinates; inwardNormal points into the room
    const quads = [
      { id: 'back', cls: 'backWall', corners: [[0, 0, 0], [W, 0, 0], [W, 0, Hc], [0, 0, Hc]], inwardNormal: [0, 1, 0], alwaysProvisional: false },
      { id: 'right', cls: 'rightWall', corners: [[W, 0, 0], [W, Dp, 0], [W, Dp, Hc], [W, 0, Hc]], inwardNormal: [-1, 0, 0], alwaysProvisional: false },
      { id: 'floor', cls: 'floor', corners: [[0, 0, 0], [W, 0, 0], [W, Dp, 0], [0, Dp, 0]], inwardNormal: [0, 0, 1], alwaysProvisional: false },
      { id: 'ceiling', cls: 'ceiling', corners: [[0, 0, Hc], [W, 0, Hc], [W, Dp, Hc], [0, Dp, Hc]], inwardNormal: [0, 0, -1], alwaysProvisional: false },
      { id: 'front', cls: 'frontWall', corners: [[0, Dp, 0], [W, Dp, 0], [W, Dp, Hc], [0, Dp, Hc]], inwardNormal: [0, -1, 0], alwaysProvisional: true },
      { id: 'leftA', cls: 'leftWall', corners: [[0, 0, 0], [0, p.openY, 0], [0, p.openY, Hc], [0, 0, Hc]], inwardNormal: [1, 0, 0], alwaysProvisional: false },
      { id: 'leftB', cls: 'leftWall', corners: [[0, p.openY + p.openW, 0], [0, Dp, 0], [0, Dp, Hc], [0, p.openY + p.openW, Hc]], inwardNormal: [1, 0, 0], alwaysProvisional: false },
      { id: 'leftLintel', cls: 'leftWall', corners: [[0, p.openY, p.openH], [0, p.openY + p.openW, p.openH], [0, p.openY + p.openW, Hc], [0, p.openY, Hc]], inwardNormal: [1, 0, 0], alwaysProvisional: false }
    ];

    // decor: suspension wires (not optical)
    const top = Hr + s;
    const wires = [
      { a: [p.railX0 + 0.15, p.railY, top], b: [p.railX0 + 0.15, p.railY, Hc] },
      { a: [p.railX0 + p.railLen - 0.15, p.railY, top], b: [p.railX0 + p.railLen - 0.15, p.railY, Hc] },
      { a: [stemX, p.railY + p.stemLen - 0.15, top], b: [stemX, p.railY + p.stemLen - 0.15, Hc] }
    ];

    return { shell: shell, holes: holes, solids: solids, quads: quads, wires: wires, railUnderside: Hr };
  }

  return {
    PARAMS: PARAMS,
    WALL_REFLECTANCE: WALL_REFLECTANCE,
    PARAM_BY_KEY: PARAM_BY_KEY,
    COLORS: COLORS,
    FACE_CLASSES: FACE_CLASSES,
    defaults: defaults,
    defaultStatus: defaultStatus,
    validate: validate,
    buildScene: buildScene
  };
});
