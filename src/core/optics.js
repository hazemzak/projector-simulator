/* PS.Optics: pure projector optics (PLAN.md section 2). No renderer or browser dependencies.
 *
 * Conventions used by every function here:
 *   - Room frame R (x right, y from back wall into the room, z up). It is left-handed, so no cross
 *     products are used on room triples; every basis is written out explicitly.
 *   - Vectors and points are plain arrays [x, y, z]; wall-plane points in 2D are [x, z].
 *   - Angles are in DEGREES at the API (yawDeg, pitchDeg, rollDeg) and radians inside.
 *   - `profile` is an effective profile (calibration already merged): nativeW, nativeH, lumens,
 *     throwMin/throwMax, vOffset, hOffset, shiftV/shiftH (optional), keystoneV/keystoneH, body.
 *   - `proj` is state.projector: { lens:{x,y,z}, yawDeg, pitchDeg, rollDeg, throwRatio, mount,
 *     shiftV, shiftH }.
 *   - Quads are arrays of four [x, z] points ordered TL, TR, BR, BL; rects are {x0, x1, z0, z1}.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PS = root.PS || {}; root.PS.Optics = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  // ---------------------------------------------------------------- small vector helpers
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function lensOf(proj) {
    var l = proj.lens;
    return Array.isArray(l) ? [l[0], l[1], l[2]] : [l.x, l.y, l.z];
  }
  function normDeg(x) { return x - 360 * Math.ceil((x - 180) / 360); } // -> (-180, 180]

  // ---------------------------------------------------------------- 2.2 pose <-> basis
  // Intrinsic yaw -> pitch -> roll. Returns the CONTENT basis {f, r, u} (both mounts).
  function basis(yawDeg, pitchDeg, rollDeg) {
    var psi = (yawDeg || 0) * DEG, th = (pitchDeg || 0) * DEG, rho = (rollDeg || 0) * DEG;
    var sp = Math.sin(psi), cp = Math.cos(psi), st = Math.sin(th), ct = Math.cos(th);
    var sr = Math.sin(rho), cr = Math.cos(rho);
    var f = [sp * ct, -cp * ct, st];
    var r2 = [cp, sp, 0];
    var u2 = [-sp * st, cp * st, ct];
    var u = [cr * u2[0] + sr * r2[0], cr * u2[1] + sr * r2[1], cr * u2[2] + sr * r2[2]];
    var r = [cr * r2[0] - sr * u2[0], cr * r2[1] - sr * u2[1], cr * r2[2] - sr * u2[2]];
    return { f: f, r: r, u: u };
  }

  // poseFromBasis(f, u, prevYaw) or poseFromBasis(B, prevYaw) with B = {f, u, ...}.
  // Returns {yawDeg, pitchDeg, rollDeg}, yaw and roll normalised to (-180, 180].
  function poseFromBasis(f, u, prevYaw) {
    if (f && !Array.isArray(f) && f.f) { prevYaw = u; u = f.u; f = f.f; }
    prevYaw = prevYaw || 0;
    var yaw;
    if (Math.sqrt(f[0] * f[0] + f[1] * f[1]) < 1e-6) yaw = prevYaw * DEG;
    else yaw = Math.atan2(f[0], -f[1]);
    var th = Math.asin(clamp(f[2], -1, 1));
    var sp = Math.sin(yaw), cp = Math.cos(yaw), st = Math.sin(th), ct = Math.cos(th);
    var r2 = [cp, sp, 0];
    var u2 = [-sp * st, cp * st, ct];
    var rho = Math.atan2(dot(u, r2), dot(u, u2));
    return { yawDeg: normDeg(yaw * RAD), pitchDeg: th * RAD, rollDeg: normDeg(rho * RAD) };
  }

  function basisOf(proj) { return basis(proj.yawDeg, proj.pitchDeg, proj.rollDeg); }

  // ---------------------------------------------------------------- 2.3 frustum window
  // Window on the unit plane (one metre along f). Panel UV: p_u=(s-sL)/(sR-sL), p_v=(q-qB)/(qT-qB).
  function window(profile, proj) {
    var T = proj.throwRatio;
    var a = profile.nativeH / profile.nativeW;
    var v = (profile.vOffset || 0) + (proj.shiftV || 0);
    var h = (profile.hOffset || 0) + (proj.shiftH || 0);
    var W1 = 1 / T, H1 = a * W1;
    var sL, sR, qB, qT;
    if (proj.mount === 'ceiling') {
      sL = (-0.5 - h) * W1; sR = (0.5 - h) * W1;
      qB = -(v + 1) * H1; qT = -v * H1;
    } else {
      sL = (-0.5 + h) * W1; sR = (0.5 + h) * W1;
      qB = v * H1; qT = (v + 1) * H1;
    }
    return { sL: sL, sR: sR, qB: qB, qT: qT, W1: W1, H1: H1, A1: W1 * H1, aspect: a, T: T, v: v, h: h };
  }

  function rayDir(B, s, q) {
    return [B.f[0] + s * B.r[0] + q * B.u[0],
            B.f[1] + s * B.r[1] + q * B.u[1],
            B.f[2] + s * B.r[2] + q * B.u[2]];
  }

  // ---------------------------------------------------------------- 2.4 back-wall plane
  // Returns {t, point:[x,0,z]} or null when the ray does not reach y = 0 ahead of L.
  function hitPlaneY0(L, d) {
    if (!(d[1] < -1e-9)) return null;
    var t = L[1] / -d[1];
    if (t < 0) return null;
    return { t: t, point: [L[0] + t * d[0], 0, L[2] + t * d[2]] };
  }

  function distance2(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }

  // Shoelace area of [[x, z], ...], absolute value.
  function polygonArea(pts) {
    var s = 0, n = pts.length;
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(s) / 2;
  }
  function signedArea(pts) {
    var s = 0, n = pts.length;
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return s / 2;
  }

  // Axial throw distance L_y / (-f_y); Infinity if the axis does not point at the wall.
  function throwDistance(L, f) {
    return f[1] < -1e-9 ? L[1] / -f[1] : Infinity;
  }

  // E = (Phi/A1) cos(theta_i) / (r^2 cos^3(alpha)). P is the surface point, n its unit normal,
  // f the unit axis. Returns 0 when the beam meets the back of the surface.
  function illuminance(lumens, A1, L, f, P, n) {
    var D = [P[0] - L[0], P[1] - L[1], P[2] - L[2]];
    var r2 = dot(D, D), r = Math.sqrt(r2);
    var dh = [D[0] / r, D[1] / r, D[2] / r];
    var cosI = -dot(dh, n);
    if (cosI <= 0) return 0;
    var cosA = dot(dh, f);
    if (cosA <= 0) return 0;
    return (lumens / A1) * cosI / (r2 * cosA * cosA * cosA);
  }

  // Pixel density in px/cm for an element with illuminance `lux`: sqrt(N_px * E / Phi) / 100.
  function pxPerCm(nPx, lumens, lux) {
    return Math.sqrt(nPx * lux / lumens) / 100;
  }

  // The image on the back-wall plane. Returns null if any corner ray misses the plane.
  function imageOnWall(profile, proj) {
    var B = basisOf(proj), L = lensOf(proj), w = window(profile, proj);
    var names = ['TL', 'TR', 'BR', 'BL'];
    var sq = [[w.sL, w.qT], [w.sR, w.qT], [w.sR, w.qB], [w.sL, w.qB]];
    var corners = {}, quad = [];
    for (var i = 0; i < 4; i++) {
      var hit = hitPlaneY0(L, rayDir(B, sq[i][0], sq[i][1]));
      if (!hit) return null;
      corners[names[i]] = hit.point;
      quad.push([hit.point[0], hit.point[2]]);
    }
    var TL = quad[0], TR = quad[1], BR = quad[2], BL = quad[3];
    var xs = quad.map(function (p) { return p[0]; }), zs = quad.map(function (p) { return p[1]; });
    var area = polygonArea(quad);
    var nPx = profile.nativeW * profile.nativeH;
    var lumens = profile.lumens;
    var cornerLux = {}, cornerPx = {};
    var luxMin = Infinity, luxMax = -Infinity, pxMin = Infinity, pxMax = -Infinity;
    for (var k = 0; k < 4; k++) {
      var E = illuminance(lumens, w.A1, L, B.f, corners[names[k]], [0, 1, 0]);
      var px = pxPerCm(nPx, lumens, E);
      cornerLux[names[k]] = E; cornerPx[names[k]] = px;
      luxMin = Math.min(luxMin, E); luxMax = Math.max(luxMax, E);
      pxMin = Math.min(pxMin, px); pxMax = Math.max(pxMax, px);
    }
    return {
      corners: corners,   // {TL, TR, BR, BL}, each [x, 0, z]
      quad: quad,         // [[x, z] x4] ordered TL, TR, BR, BL
      widthTop: distance2(TL, TR), widthBottom: distance2(BL, BR),
      heightLeft: distance2(TL, BL), heightRight: distance2(TR, BR),
      bbox: { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
              z0: Math.min.apply(null, zs), z1: Math.max.apply(null, zs) },
      area: area,
      axial: throwDistance(L, B.f),
      perpendicular: L[1],
      luxNominal: lumens / area,
      cornerLux: cornerLux, luxMin: luxMin, luxMax: luxMax,
      pxPerCmAvg: Math.sqrt(nPx / (area * 1e4)),
      cornerPxPerCm: cornerPx, pxPerCmMin: pxMin, pxPerCmMax: pxMax
    };
  }

  // ---------------------------------------------------------------- 2.8 keystone
  // Needed correction angles. Limits come from `lim` (a profile: keystoneV/keystoneH), default 30.
  function keystone(f, lim) {
    var limV = lim && lim.keystoneV != null ? lim.keystoneV : 30;
    var limH = lim && lim.keystoneH != null ? lim.keystoneH : 30;
    var kv = Math.asin(clamp(f[2], -1, 1)) * RAD;
    var kh = Math.atan2(f[0], -f[1]) * RAD;
    var eps = 1e-9;
    return { vDeg: kv, hDeg: kh, limitV: limV, limitH: limH,
             inRange: Math.abs(kv) <= limV + eps && Math.abs(kh) <= limH + eps };
  }

  // Angle of the image's vertical centre line from vertical, positive when the top leans to +x.
  // null if either end of the line misses the wall plane.
  function wallRollDeg(profile, proj) {
    var B = basisOf(proj), L = lensOf(proj), w = window(profile, proj);
    var sc = (w.sL + w.sR) / 2;
    var b = hitPlaneY0(L, rayDir(B, sc, w.qB)), t = hitPlaneY0(L, rayDir(B, sc, w.qT));
    if (!b || !t) return null;
    var roll = Math.atan2(t.point[0] - b.point[0], t.point[2] - b.point[2]) * RAD;
    return Math.abs(roll) < 1e-12 ? 0 : roll;
  }

  // ---------------------------------------------------------------- 2.9 target coverage and fit
  // Sutherland-Hodgman against the axis-aligned rect. pts: [[x, z], ...].
  function clipPolygonToRect(pts, x0, x1, z0, z1) {
    var edges = [
      { inside: function (p) { return p[0] >= x0; }, cut: function (a, b) { return interp(a, b, 0, x0); } },
      { inside: function (p) { return p[0] <= x1; }, cut: function (a, b) { return interp(a, b, 0, x1); } },
      { inside: function (p) { return p[1] >= z0; }, cut: function (a, b) { return interp(a, b, 1, z0); } },
      { inside: function (p) { return p[1] <= z1; }, cut: function (a, b) { return interp(a, b, 1, z1); } }
    ];
    function interp(a, b, axis, val) {
      var t = (val - a[axis]) / (b[axis] - a[axis]);
      var p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      p[axis] = val;
      return p;
    }
    var out = pts.map(function (p) { return [p[0], p[1]]; });
    for (var e = 0; e < edges.length && out.length; e++) {
      var inp = out; out = [];
      for (var i = 0; i < inp.length; i++) {
        var cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
        var ci = edges[e].inside(cur), pi = edges[e].inside(prev);
        if (ci) { if (!pi) out.push(edges[e].cut(prev, cur)); out.push(cur); }
        else if (pi) out.push(edges[e].cut(prev, cur));
      }
    }
    return out;
  }

  // quad: [[x, z] x4] ordered TL, TR, BR, BL.  rect: {x0, x1, z0, z1}.
  function coverage(quad, rect) {
    var clip = clipPolygonToRect(quad, rect.x0, rect.x1, rect.z0, rect.z1);
    var clipArea = clip.length >= 3 ? polygonArea(clip) : 0;
    var targetArea = (rect.x1 - rect.x0) * (rect.z1 - rect.z0);
    var quadArea = polygonArea(quad);
    var TL = quad[0], TR = quad[1], BR = quad[2], BL = quad[3];
    return {
      clipArea: clipArea, targetArea: targetArea, quadArea: quadArea,
      targetCoveredFrac: targetArea > 0 ? clipArea / targetArea : 0,
      imageInTargetFrac: quadArea > 0 ? clipArea / quadArea : 0,
      overshoot: {   // positive = image extends beyond that target edge
        left: rect.x0 - Math.max(TL[0], BL[0]),
        right: Math.min(TR[0], BR[0]) - rect.x1,
        top: Math.min(TL[1], TR[1]) - rect.z1,
        bottom: rect.z0 - Math.max(BL[1], BR[1])
      }
    };
  }

  // Square-on placement that fills the target: yaw = pitch = roll = 0, zoom kept.
  // Returns a copy of proj with the new lens position.
  function fitSquareOn(profile, proj, rect) {
    var w = window(profile, proj), a = w.aspect;
    var tw = rect.x1 - rect.x0, th = rect.z1 - rect.z0;
    var cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
    var W = Math.min(tw, th / a), H = a * W;
    var lx, lz;
    if (proj.mount === 'ceiling') { lx = cx + w.h * W; lz = (cz + H / 2) + w.v * H; }
    else { lx = cx - w.h * W; lz = (cz - H / 2) - w.v * H; }
    var out = {};
    for (var k in proj) if (Object.prototype.hasOwnProperty.call(proj, k)) out[k] = proj[k];
    out.lens = { x: lx, y: w.T * W, z: lz };
    out.yawDeg = 0; out.pitchDeg = 0; out.rollDeg = 0;
    return out;
  }

  // ---------------------------------------------------------------- 2.8 inscribed rect, homography
  function solve3(A, b) {
    var d = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
          - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
          + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    if (Math.abs(d) < 1e-12) return null;
    function det(c) {   // replace column c by b
      var M = [A[0].slice(), A[1].slice(), A[2].slice()];
      for (var i = 0; i < 3; i++) M[i][c] = b[i];
      return M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
           - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
           + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    }
    return [det(0) / d, det(1) / d, det(2) / d];
  }

  // Largest wall-aligned rectangle of aspect width/height inscribed in a convex quad.
  // LP in (cx, cz, b): half-height b, half-width b*aspect. Returns null if there is no solution.
  function largestInscribedRect(quad, aspectWoverH) {
    var n = quad.length, orient = signedArea(quad) > 0 ? 1 : -1;
    var cons = [];
    for (var i = 0; i < n; i++) {
      var p = quad[i], q = quad[(i + 1) % n];
      var ex = q[0] - p[0], ez = q[1] - p[1], len = Math.sqrt(ex * ex + ez * ez);
      if (len < 1e-12) continue;
      // CCW polygon: outward normal is the edge rotated clockwise.
      var nx = orient * ez / len, nz = -orient * ex / len;
      cons.push({ nx: nx, nz: nz, k: nx * p[0] + nz * p[1],
                  g: Math.abs(nx) * aspectWoverH + Math.abs(nz) });
    }
    var m = cons.length, best = -Infinity, sols = [];
    for (var a = 0; a < m; a++) for (var b = a + 1; b < m; b++) for (var c = b + 1; c < m; c++) {
      var T = [a, b, c].map(function (j) { return [cons[j].nx, cons[j].nz, cons[j].g]; });
      var x = solve3(T, [cons[a].k, cons[b].k, cons[c].k]);
      if (!x || !(x[2] > 0)) continue;
      var ok = true;
      for (var j = 0; j < m; j++) {
        if (cons[j].nx * x[0] + cons[j].nz * x[1] + x[2] * cons[j].g > cons[j].k + 1e-9) { ok = false; break; }
      }
      if (!ok) continue;
      if (x[2] > best + 1e-9) { best = x[2]; sols = [x]; }
      else if (Math.abs(x[2] - best) <= 1e-9) sols.push(x);
    }
    if (!sols.length) return null;
    var cx = 0, cz = 0, bb = 0;
    sols.forEach(function (s) { cx += s[0]; cz += s[1]; bb += s[2]; });
    cx /= sols.length; cz /= sols.length; bb /= sols.length;
    var hw = bb * aspectWoverH;
    return { cx: cx, cz: cz, halfH: bb, halfW: hw, width: 2 * hw, height: 2 * bb,
             rect: { x0: cx - hw, x1: cx + hw, z0: cz - bb, z1: cz + bb } };
  }

  // 3x3 homography (row-major array of 9, H[8] = 1) mapping src[i] -> dst[i], four [x, y] pairs.
  function homography4(src, dst) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (i = 0; i < 8; i++) {   // Gauss-Jordan with partial pivoting
      var piv = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      if (Math.abs(A[piv][i]) < 1e-14) return null;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
      for (j = 0; j < 8; j++) {
        if (j === i) continue;
        var fct = A[j][i] / A[i][i];
        for (k = i; k < 9; k++) A[j][k] -= fct * A[i][k];
      }
    }
    var h = [];
    for (i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]);
    h.push(1);
    return h;
  }

  function applyHomography(H, p) {
    var w = H[6] * p[0] + H[7] * p[1] + H[8];
    return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
  }

  // Panel UV (p_u, p_v) of point P in room coordinates, or null if it is behind the projector.
  function panelUV(profile, proj, P) {
    var B = basisOf(proj), L = lensOf(proj), w = window(profile, proj);
    var D = [P[0] - L[0], P[1] - L[1], P[2] - L[2]];
    var k = dot(D, B.f);
    if (!(k > 1e-9)) return null;
    var s = dot(D, B.r) / k, q = dot(D, B.u) / k;
    return [(s - w.sL) / (w.sR - w.sL), (q - w.qB) / (w.qT - w.qB)];
  }

  // Keystone correction preview (upper bound). Always returns {available, reason?, ...}.
  // homography maps panel UV -> content UV (content v = 1 is the top).
  function keystonePreview(profile, proj) {
    var img = imageOnWall(profile, proj);
    if (!img) return { available: false, reason: 'Image does not fully reach the back wall plane.' };
    var B = basisOf(proj);
    var ks = keystone(B.f, profile);
    if (!ks.inRange) {
      return { available: false, reason: 'Needed keystone V ' + ks.vDeg.toFixed(1) + '° / H ' +
               ks.hDeg.toFixed(1) + '° exceeds ±' + ks.limitV + '°.' };
    }
    var roll = wallRollDeg(profile, proj);
    if (roll == null || Math.abs(roll) > 0.5) {
      return { available: false, reason: 'Image is rotated ' + (roll == null ? 'n/a' : roll.toFixed(1)) +
               '°; keystone cannot correct rotation.' };
    }
    var aspect = profile.nativeW / profile.nativeH;
    var lp = largestInscribedRect(img.quad, aspect);
    if (!lp) return { available: false, reason: 'No inscribed rectangle found.' };
    var r = lp.rect;
    var wall = [[r.x0, r.z1], [r.x1, r.z1], [r.x1, r.z0], [r.x0, r.z0]];   // TL, TR, BR, BL
    var uv = [];
    for (var i = 0; i < 4; i++) {
      var p = panelUV(profile, proj, [wall[i][0], 0, wall[i][1]]);
      if (!p) return { available: false, reason: 'Corrected rectangle is behind the projector.' };
      uv.push(p);
    }
    var H = homography4(uv, [[0, 1], [1, 1], [1, 0], [0, 0]]);
    var panelFraction = polygonArea(uv);
    var area = lp.width * lp.height, nPx = profile.nativeW * profile.nativeH;
    return {
      available: true, reason: null,
      centre: [lp.cx, lp.cz], width: lp.width, height: lp.height, rect: r, area: area,
      wallQuad: wall, panelQuad: uv, homography: H, panelFraction: panelFraction,
      pxPerCm: Math.sqrt(panelFraction * nPx / (area * 1e4)),
      lux: profile.lumens * panelFraction / area
    };
  }

  // ---------------------------------------------------------------- projector body
  // The 8 corners of the body box in room coordinates. The front face is in the lens plane and the
  // body extends body.d behind it. Physical right = m*r, physical up = m*u (m = -1 for ceiling).
  function bodyCorners(profile, proj) {
    var B = basisOf(proj), L = lensOf(proj), body = profile.body;
    var m = proj.mount === 'ceiling' ? -1 : 1;
    var lr = body.lensRight || 0, lu = body.lensUp || 0;
    var xs = [-body.w / 2 - lr, body.w / 2 - lr];
    var ys = [-lu, body.h - lu];
    var zs = [0, -body.d];
    var out = [];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) for (var k = 0; k < 2; k++) {
      var a = xs[i], b = ys[j], c = zs[k];
      out.push([L[0] + a * m * B.r[0] + b * m * B.u[0] + c * B.f[0],
                L[1] + a * m * B.r[1] + b * m * B.u[1] + c * B.f[1],
                L[2] + a * m * B.r[2] + b * m * B.u[2] + c * B.f[2]]);
    }
    return out;
  }

  // ---------------------------------------------------------------- 2.6 ray casting
  function pointInBox(p, min, max) {
    return p[0] >= min[0] && p[0] <= max[0] &&
           p[1] >= min[1] && p[1] <= max[1] &&
           p[2] >= min[2] && p[2] <= max[2];
  }

  // scene = {shell:{min:[0,0,0], max:[W,Dp,Hc]}, holes:[{face,u0,u1,v0,v1,cls}], solids:[...]}.
  // The shell also accepts {width, depth, ceiling|height} or {W, Dp, Hc}.
  function shellBounds(shell) {
    if (shell.min && shell.max) return { min: shell.min, max: shell.max };
    var W = shell.width != null ? shell.width : shell.W;
    var D = shell.depth != null ? shell.depth : (shell.Dp != null ? shell.Dp : shell.D);
    var H = shell.ceiling != null ? shell.ceiling : (shell.height != null ? shell.height : shell.Hc);
    return { min: [0, 0, 0], max: [W, D, H] };
  }

  var FACE_CLASS = ['leftWall', 'rightWall', 'backWall', 'frontWall', 'floor', 'ceiling'];
  // face index: 0 x0, 1 x1, 2 y0, 3 y1, 4 z0, 5 z1  (axis = index >> 1, max side = index & 1)
  var FACE_NAME = ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'];

  // Nearest hit of the ray L + t d (t > 0; d need not be unit). Returns
  // {key, solidId, t, point, normal, label, group} or {key:'insideSolid'|'outside'}.
  function castRay(scene, L, d) {
    var solids = scene.solids || [], holes = scene.holes || [];
    var sb = shellBounds(scene.shell), i, ax;
    var eps = 1e-9;
    var bestT = Infinity, bestSolid = null, bestAxis = 0;

    for (i = 0; i < solids.length; i++) {
      var s = solids[i];
      if (L[0] > s.min[0] + eps && L[0] < s.max[0] - eps &&
          L[1] > s.min[1] + eps && L[1] < s.max[1] - eps &&
          L[2] > s.min[2] + eps && L[2] < s.max[2] - eps) {
        return { key: 'insideSolid', solidId: s.id, label: s.label, group: s.group };
      }
    }
    for (ax = 0; ax < 3; ax++) {
      if (L[ax] < sb.min[ax] - eps || L[ax] > sb.max[ax] + eps) return { key: 'outside' };
    }

    for (i = 0; i < solids.length; i++) {
      var so = solids[i], tmin = -Infinity, tmax = Infinity, entry = 0, miss = false;
      for (ax = 0; ax < 3; ax++) {
        if (Math.abs(d[ax]) < 1e-12) {
          if (L[ax] < so.min[ax] || L[ax] > so.max[ax]) { miss = true; break; }
        } else {
          var t1 = (so.min[ax] - L[ax]) / d[ax], t2 = (so.max[ax] - L[ax]) / d[ax];
          if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
          if (t1 > tmin) { tmin = t1; entry = ax; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { miss = true; break; }
        }
      }
      if (miss || !(tmin > 1e-6)) continue;
      if (tmin < bestT) { bestT = tmin; bestSolid = so; bestAxis = entry; }
    }

    // exit through the shell
    var shellT = Infinity, face = -1;
    for (ax = 0; ax < 3; ax++) {
      if (d[ax] > 1e-12) {
        var tp = (sb.max[ax] - L[ax]) / d[ax];
        if (tp > 1e-6 && tp < shellT) { shellT = tp; face = ax * 2 + 1; }
      } else if (d[ax] < -1e-12) {
        var tn = (sb.min[ax] - L[ax]) / d[ax];
        if (tn > 1e-6 && tn < shellT) { shellT = tn; face = ax * 2; }
      }
    }

    if (bestSolid && bestT < shellT) {
      var pt = [L[0] + bestT * d[0], L[1] + bestT * d[1], L[2] + bestT * d[2]];
      var nrm = [0, 0, 0];
      nrm[bestAxis] = d[bestAxis] > 0 ? -1 : 1;
      return { key: bestSolid.countsAs || bestSolid.id, solidId: bestSolid.id, t: bestT,
               point: pt, normal: nrm, label: bestSolid.label, group: bestSolid.group };
    }
    if (face < 0) return { key: 'outside' };

    var P = [L[0] + shellT * d[0], L[1] + shellT * d[1], L[2] + shellT * d[2]];
    var fax = face >> 1, inward = [0, 0, 0];
    inward[fax] = (face & 1) ? -1 : 1;
    var cls = FACE_CLASS[face], fname = FACE_NAME[face];
    var cu = fax === 0 ? P[1] : P[0];
    var cv = fax === 2 ? P[1] : P[2];
    for (i = 0; i < holes.length; i++) {
      var hl = holes[i];
      if (hl.face === fname && cu >= hl.u0 && cu <= hl.u1 && cv >= hl.v0 && cv <= hl.v1) { cls = hl.cls; break; }
    }
    return { key: cls, solidId: null, t: shellT, point: P, normal: inward };
  }

  // Cast rays through the cell centres of an nx x ny grid over the window (equal-area on the
  // panel). Returns {nx, ny, total, counts:{key:n}, fractions:{key:f}}.
  function sampleBeam(scene, profile, proj, nx, ny) {
    nx = nx || 128; ny = ny || 80;
    var B = basisOf(proj), L = lensOf(proj), w = window(profile, proj);
    var counts = {}, total = nx * ny;
    for (var j = 0; j < ny; j++) {
      var q = w.qB + (j + 0.5) / ny * (w.qT - w.qB);
      for (var i = 0; i < nx; i++) {
        var s = w.sL + (i + 0.5) / nx * (w.sR - w.sL);
        var hit = castRay(scene, L, rayDir(B, s, q));
        counts[hit.key] = (counts[hit.key] || 0) + 1;
      }
    }
    var fractions = {};
    for (var key in counts) fractions[key] = counts[key] / total;
    return { nx: nx, ny: ny, total: total, counts: counts, fractions: fractions };
  }

  return {
    basis: basis, poseFromBasis: poseFromBasis, window: window, rayDir: rayDir,
    hitPlaneY0: hitPlaneY0, imageOnWall: imageOnWall, illuminance: illuminance, pxPerCm: pxPerCm,
    keystone: keystone, wallRollDeg: wallRollDeg, polygonArea: polygonArea,
    clipPolygonToRect: clipPolygonToRect, coverage: coverage,
    largestInscribedRect: largestInscribedRect, homography4: homography4,
    keystonePreview: keystonePreview, fitSquareOn: fitSquareOn, bodyCorners: bodyCorners,
    castRay: castRay, sampleBeam: sampleBeam, pointInBox: pointInBox,
    // helpers beyond the P1 list
    applyHomography: applyHomography, panelUV: panelUV, throwDistance: throwDistance,
    basisOf: basisOf, lensOf: lensOf
  };
});
