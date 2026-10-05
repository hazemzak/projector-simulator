/* State -> readouts + warnings + provenance (PLAN.md §5). Pure: no THREE, no DOM. Uses Optics, Room, Model. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./optics.js'), require('./room.js'), require('./model.js'));
  else { root.PS = root.PS || {}; root.PS.Analysis = factory(root.PS.Optics, root.PS.Room, root.PS.Model); }
})(typeof self !== 'undefined' ? self : this, function (Optics, Room, Model) {
  'use strict';


  function r1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function pct(f) { return r1(f * 100); }

  // ---- helpers -------------------------------------------------------------------------------

  function containingSolid(scene, p) {
    for (let i = 0; i < scene.solids.length; i++) {
      const s = scene.solids[i];
      if (Optics.pointInBox(p, s.min, s.max)) return s;
    }
    return null;
  }

  function insideShell(scene, p) {
    return Optics.pointInBox(p, scene.shell.min, scene.shell.max);
  }


  const CODE_ORDER = ['W_OUTSIDE_ROOM', 'W_BODY', 'W_NOT_FACING', 'W_DISTANCE', 'W_CLIPPED', 'W_OFF_WALL', 'W_KEYSTONE', 'W_ROLL',
    'I_TARGET', 'I_OFFSET', 'I_ROOM'];
  const SPILL_KEYS = ['leftWall', 'rightWall', 'frontWall', 'floor', 'ceiling', 'opening'];
  const SURFACE_NAMES = {
    leftWall: 'left wall', rightWall: 'right wall', frontWall: 'front wall', floor: 'floor',
    ceiling: 'ceiling', opening: 'opening'
  };

  // ---- analyze -------------------------------------------------------------------------------

  function analyze(state, builtins) {
    const profile = Model.effectiveProfile(state, builtins);
    if (!profile) throw new Error('Unknown projector profile "' + state.projector.profileId + '".');
    const proj = state.projector;
    const room = state.room;
    const scene = Room.buildScene(room, state.obstacles);
    const L = [proj.lens.x, proj.lens.y, proj.lens.z];
    const B = Optics.basis(proj.yawDeg, proj.pitchDeg, proj.rollDeg);
    const f = B.f;
    const win = Optics.window(profile, proj);

    const warnings = [];
    const warn = function (code, level, text) { warnings.push({ code: code, level: level, text: text }); };

    // ---- placement of lens and body
    const lensSolid = containingSolid(scene, L);
    const lensOutside = !insideShell(scene, L) || !!lensSolid;
    if (lensOutside) {
      warn('W_OUTSIDE_ROOM', 'error', lensSolid ? 'Lens is inside ' + lensSolid.label + '.' : 'Lens is outside the room.');
    }

    const bodyCorners = Optics.bodyCorners(profile, proj);
    let bodyHit = null;
    bodyCorners.forEach(function (c) {
      if (bodyHit) return;
      if (!insideShell(scene, c)) bodyHit = 'room boundary';
      else { const s = containingSolid(scene, c); if (s) bodyHit = s.label; }
    });
    if (bodyHit) warn('W_BODY', 'warn', 'Projector body intersects ' + bodyHit + '.');
    const bodyZ = bodyCorners.map(function (c) { return c[2]; });

    // ---- image on the back-wall plane (Optics.imageOnWall already carries the readouts)
    const img = Optics.imageOnWall(profile, proj);
    let image = null;
    let imageOnWallFrac = null;
    let greyGap = null;
    let luxInfo = null;
    let luminanceInfo = null;
    let pxInfo = null;
    if (img) {
      const area = img.area;
      image = {
        corners: img.corners,
        widthTop: img.widthTop, widthBottom: img.widthBottom,
        heightLeft: img.heightLeft, heightRight: img.heightRight,
        area: area, bbox: img.bbox
      };
      const clipped = Optics.clipPolygonToRect(img.quad, 0, room.width, 0, room.ceiling);
      imageOnWallFrac = area > 0 && clipped.length >= 3 ? Optics.polygonArea(clipped) / area : 0;
      greyGap = room.greyTop - Math.max(img.corners.TL[2], img.corners.TR[2]);
      luxInfo = { nominal: img.luxNominal, min: img.luxMin, max: img.luxMax, corners: img.cornerLux };
      const luminanceFactor = room.wallReflectance / Math.PI;
      const luminanceCorners = {};
      Object.keys(img.cornerLux).forEach(function (key) { luminanceCorners[key] = img.cornerLux[key] * luminanceFactor; });
      luminanceInfo = { average: img.luxNominal * luminanceFactor, min: img.luxMin * luminanceFactor,
        max: img.luxMax * luminanceFactor, corners: luminanceCorners };
      pxInfo = { avg: img.pxPerCmAvg, min: img.pxPerCmMin, max: img.pxPerCmMax, corners: img.cornerPxPerCm };
    } else {
      warn('W_NOT_FACING', 'error', 'Image does not fully reach the back wall plane.');
    }

    // ---- throw distance
    const axial = img ? img.axial : Optics.throwDistance(L, f);
    if (isFinite(axial) && (axial < profile.distMin || axial > profile.distMax)) {
      warn('W_DISTANCE', 'warn', 'Throw distance ' + r1(axial) + ' m is outside the projector\'s ' +
        profile.distMin.toFixed(2) + '–' + profile.distMax.toFixed(2) + ' m range.');
    }

    // ---- keystone
    const ks = Optics.keystone(f, profile);
    const kv = ks.vDeg;
    const kh = ks.hDeg;
    const roll = img ? Optics.wallRollDeg(profile, proj) : null;
    const keystone = { v: kv, h: kh, limitV: ks.limitV, limitH: ks.limitH, inRange: ks.inRange, rollDeg: roll };
    if (!ks.inRange) {
      const lim = ks.limitV === ks.limitH ? '±' + ks.limitV + '°' : 'V ±' + ks.limitV + '° / H ±' + ks.limitH + '°';
      warn('W_KEYSTONE', 'warn', 'Needed keystone V ' + r1(kv) + '° / H ' + r1(kh) + '° exceeds ' + lim + '.');
    }
    if (roll !== null && Math.abs(roll) > 0.5) {
      warn('W_ROLL', 'warn', 'Image is rotated ' + r1(roll) + '°; keystone cannot correct rotation — level the projector.');
    }
    // ---- beam breakdown (needs the lens inside the room)
    let beam = null;
    let frustumHits = null;
    const d4 = [[win.sL, win.qT], [win.sR, win.qT], [win.sR, win.qB], [win.sL, win.qB]].map(function (sq) {
      return Optics.rayDir(B, sq[0], sq[1]);
    });
    frustumHits = d4.map(function (d) { return Optics.castRay(scene, L, d); });

    if (!lensOutside) {
      const fr = Optics.sampleBeam(scene, profile, proj).fractions;
      const labelOf = {};
      scene.solids.forEach(function (s) { labelOf[s.id] = s; });
      const items = [];
      let spill = 0;
      const spillParts = [];
      Object.keys(fr).forEach(function (k) {
        if (!(fr[k] > 0)) return;
        if (k === 'backWall') items.push({ key: k, label: 'back wall', kind: 'wall', fraction: fr[k] });
        else if (SPILL_KEYS.indexOf(k) >= 0) {
          spill += fr[k];
          spillParts.push({ key: k, fraction: fr[k] });
          items.push({ key: k, label: SURFACE_NAMES[k], kind: 'spill', fraction: fr[k] });
        } else if (labelOf[k]) {
          items.push({ key: k, label: labelOf[k].label, kind: labelOf[k].group, fraction: fr[k] });
        } else items.push({ key: k, label: k, kind: 'other', fraction: fr[k] });
      });
      beam = { fractions: fr, onBackWall: fr.backWall || 0, spill: spill, items: items };

      // W_CLIPPED: one per obstacle key, in scene order
      scene.solids.forEach(function (s) {
        if (s.group === 'obstacle' && fr[s.id] > 0) {
          warn('W_CLIPPED', 'warn', 'Beam clipped by ' + s.label + ': ' + pct(fr[s.id]) + '% of the image.');
        }
      });
      if (spill > 0) {
        spillParts.sort(function (a, b) { return b.fraction - a.fraction; });
        warn('W_OFF_WALL', 'warn', pct(spill) + '% of the image falls off the back wall (' +
          spillParts.map(function (p) { return SURFACE_NAMES[p.key] + ' ' + pct(p.fraction) + '%'; }).join(', ') + ').');
      }
    }

    // ---- target
    let target = null;
    const t = state.target;
    if (t && t.enabled) {
      if (img) {
        const cov = Optics.coverage(img.quad, { x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1 });
        target = { covered: cov.targetCoveredFrac, imageInTarget: cov.imageInTargetFrac, overshoot: cov.overshoot };
      } else target = { covered: 0, imageInTarget: 0, overshoot: null };
    }

    // ---- keystone preview (Optics decides availability and the reason)
    const preview = Optics.keystonePreview(profile, proj);
    // ---- info warnings
    if (t && t.enabled && (target ? target.covered : 0) < 0.995) {
      warn('I_TARGET', 'info', 'Target ' + pct(target ? target.covered : 0) + '% covered.');
    }
    const offsetProvisional = profile.vOffsetStatus !== 'measured';
    if (offsetProvisional) {
      warn('I_OFFSET', 'info', 'Vertical offset is a provisional default (' + profile.vOffset.toFixed(2) + '). Measure it (Help).');
    }
    let nEst = 0, nProv = 0, nUser = 0;
    Room.PARAMS.forEach(function (p) {
      const st = (state.roomStatus || {})[p.key] || p.status;
      if (st === 'user') nUser++; else if (st === 'estimate') nEst++; else nProv++;
    });
    if (nEst + nProv > 0) {
      warn('I_ROOM', 'info', nEst + ' room values are photographic estimates, ' + nProv +
        ' provisional/assumed — verify on site.');
    }

    // error > warn > info; inside a level, PLAN §5 table order (W_CLIPPED entries keep scene order)
    const LEVEL = { error: 0, warn: 1, info: 2 };
    warnings.forEach(function (w, i) { w._i = i; });
    warnings.sort(function (a, b) {
      return LEVEL[a.level] - LEVEL[b.level] || CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code) || a._i - b._i;
    });
    warnings.forEach(function (w) { delete w._i; });

    return {
      profile: profile,
      basis: B,
      window: win,
      image: image,
      imageOnWallFrac: imageOnWallFrac,
      greyGap: greyGap,
      throw: { axial: axial, perpendicular: L[1] },
      lux: luxInfo,
      luminance: luminanceInfo,
      pxPerCm: pxInfo,
      keystone: keystone,
      lens: { z: L[2], dropBelowCeiling: room.ceiling - L[2] },
      body: { lowest: Math.min.apply(null, bodyZ), highest: Math.max.apply(null, bodyZ), corners: bodyCorners },
      beam: beam,
      target: target,
      preview: preview,
      frustumHits: frustumHits,
      warnings: warnings,
      provenance: {
        roomEstimated: nEst, roomProvisional: nProv, roomUser: nUser,
        offsetStatus: profile.vOffsetStatus, offsetProvisional: offsetProvisional,
        // † depends on a provisional offset, ‡ on non-user room values (PLAN.md §5)
        marks: {
          image: '†', corners: '†', imageOnWall: '‡', greyGap: '†‡', target: '†', preview: '†', lens: '‡', body: '‡', beam: '‡'
        }
      }
    };
  }

  return { analyze: analyze };
});
