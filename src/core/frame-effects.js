/* PS.FrameEffects: frame shadows, fixed-grid front illumination and oriented-body-box collision
 * (PLAN_P12_FAST.md sections 3.2, 3.6, 3.7). Pure: no THREE, no DOM. Depends on Frames and Optics.
 *
 *   FrameEffects.analyze(room, frames, mappingResults, profile, projector, scene, preview, previewEnabled)
 *       -> completed frame results (litSampleFraction, shadow, extra issues)
 *   FrameEffects.bodyIntersectsBox(bodyCorners, min, max) -> boolean
 *
 * Room frame as in Optics (x right, y from the back wall y = 0 into the room, z up).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./frames.js'), require('./optics.js'));
  else { root.PS = root.PS || {}; root.PS.FrameEffects = factory(root.PS.Frames, root.PS.Optics); }
})(typeof self !== 'undefined' ? self : this, function (Frames, Optics) {
  'use strict';

  const GRID_U = 32, GRID_Z = 20;
  const EPS = 1e-9;
  const T_TOL = 1e-7;
  const LABEL = 'Potential geometric shadow; other obstructions can overlap it.';

  // ---------------------------------------------------------------- planar helpers, p = [u, z]
  function signedArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return s / 2;
  }
  function area(poly) { return poly.length < 3 ? 0 : Math.abs(signedArea(poly)); }

  function ccw(poly) { return signedArea(poly) < 0 ? poly.slice().reverse() : poly; }

  // Sutherland-Hodgman against the half-plane fn(p) >= 0.
  function clipHalf(poly, fn) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
      const fc = fn(cur), fp = fn(prev);
      if (fc >= 0) {
        if (fp < 0) out.push(cut(prev, cur, fp, fc));
        out.push(cur);
      } else if (fp >= 0) out.push(cut(prev, cur, fp, fc));
    }
    return out;
  }
  function cut(a, b, fa, fb) {
    const t = fa / (fa - fb);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }

  // Convex subject clipped by a convex clipper.
  function clipConvex(subject, clipper) {
    const c = ccw(clipper);
    let poly = subject;
    for (let i = 0; i < c.length && poly.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      poly = clipHalf(poly, function (p) { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); });
    }
    return poly;
  }

  function rectPoly(u0, u1, z0, z1) { return [[u0, z0], [u1, z0], [u1, z1], [u0, z1]]; }

  // Convex polygon minus an axis-aligned rectangle, as non-overlapping convex pieces.
  function subtractRect(poly, r) {
    const out = [];
    let rest = poly;
    function take(fnKeep, fnRest) {
      const piece = clipHalf(rest, fnKeep);
      if (area(piece) > 1e-14) out.push(piece);
      rest = clipHalf(rest, fnRest);
    }
    take(function (p) { return r.u0 - p[0]; }, function (p) { return p[0] - r.u0; });
    if (!rest.length) return out;
    take(function (p) { return p[0] - r.u1; }, function (p) { return r.u1 - p[0]; });
    if (!rest.length) return out;
    take(function (p) { return r.z0 - p[1]; }, function (p) { return p[1] - r.z0; });
    if (!rest.length) return out;
    const top = clipHalf(rest, function (p) { return p[1] - r.z1; });
    if (area(top) > 1e-14) out.push(top);
    return out;
  }

  // Andrew monotone chain, counter-clockwise from the lowest-left point, collinear points dropped.
  function convexHull(points) {
    const pts = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function crossAt(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    const lower = [], upper = [];
    pts.forEach(function (p) {
      while (lower.length >= 2 && crossAt(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-15) lower.pop();
      lower.push(p);
    });
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && crossAt(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-15) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // ---------------------------------------------------------------- oriented box versus AABB
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function crs(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  // Separating-axis test: 3 body axes, 3 world axes, 9 edge cross products. Touching counts as
  // intersecting (as the legacy corner test does). bodyCorners is Optics.bodyCorners order
  // (index = 4 i + 2 j + k over the body's right, up and back axes).
  function bodyIntersectsBox(bodyCorners, min, max) {
    const c = bodyCorners;
    const edges = [sub(c[4], c[0]), sub(c[2], c[0]), sub(c[1], c[0])];
    const world = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const axes = [];
    function push(a) {
      const n = Math.sqrt(dot(a, a));
      if (n > 1e-9) axes.push([a[0] / n, a[1] / n, a[2] / n]);
    }
    edges.forEach(push);
    world.forEach(push);
    edges.forEach(function (e) { world.forEach(function (w) { push(crs(e, w)); }); });

    const box = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      box.push([i ? max[0] : min[0], j ? max[1] : min[1], k ? max[2] : min[2]]);
    }
    for (let a = 0; a < axes.length; a++) {
      let b0 = Infinity, b1 = -Infinity, o0 = Infinity, o1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const pb = dot(c[i], axes[a]), po = dot(box[i], axes[a]);
        if (pb < b0) b0 = pb; if (pb > b1) b1 = pb;
        if (po < o0) o0 = po; if (po > o1) o1 = po;
      }
      if (b1 < o0 - EPS || o1 < b0 - EPS) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- shadow (section 3.7)
  function footprint(profile, proj, preview, previewEnabled) {
    if (previewEnabled && preview && preview.available) {
      if (preview.wallQuad) return preview.wallQuad;
      if (preview.rect) return rectPoly(preview.rect.x0, preview.rect.x1, preview.rect.z0, preview.rect.z1);
    }
    const img = Optics.imageOnWall(profile, proj);
    return img ? img.quad : null;
  }

  function mountRect(f) { return { u0: f.u, u1: f.u + f.width, z0: f.bottom, z1: f.bottom + f.height }; }

  function computeShadow(room, f, frames, lens, fp) {
    const D = lens[1];
    if (!(D > f.depth)) {
      return { shadow: null, reason: 'Shadow unavailable: the lens is not in front of the frame front (lens distance ' +
        D.toFixed(3) + ' m must exceed the frame depth ' + f.depth.toFixed(3) + ' m).' };
    }
    const pts = [];
    [0, f.depth].forEach(function (n) {
      const k = D / (D - n);
      [f.u, f.u + f.width].forEach(function (u) {
        [f.bottom, f.bottom + f.height].forEach(function (z) {
          pts.push([lens[0] + k * (u - lens[0]), lens[2] + k * (z - lens[2])]);
        });
      });
    });
    const hull = convexHull(pts);
    const us = hull.map(function (p) { return p[0]; }), zs = hull.map(function (p) { return p[1]; });
    const b = { u0: Math.min.apply(null, us), u1: Math.max.apply(null, us), z0: Math.min.apply(null, zs), z1: Math.max.apply(null, zs) };
    const m = mountRect(f);

    let pieces = [];
    if (f.depth > 0 && fp) {
      let poly = clipConvex(ccw(hull), rectPoly(0, room.width, 0, room.ceiling));
      if (poly.length >= 3) poly = clipConvex(poly, fp);
      if (poly.length >= 3) {
        pieces = [poly];
        frames.forEach(function (g) {
          if (!Frames.validFrame(g)) return;
          const r = mountRect(g);
          let next = [];
          pieces.forEach(function (p) { next = next.concat(subtractRect(p, r)); });
          pieces = next;
        });
      }
    }
    let exposedArea = 0;
    pieces.forEach(function (p) { exposedArea += area(p); });
    return {
      shadow: {
        silhouette: hull, silhouetteArea: area(hull),
        exposedPolygons: pieces, exposedArea: exposedArea,
        bounds: b,
        extensions: { left: m.u0 - b.u0, right: b.u1 - m.u1, bottom: m.z0 - b.z0, top: b.z1 - m.z1 },
        label: LABEL
      },
      reason: null
    };
  }

  // ---------------------------------------------------------------- front illumination
  function lensProblem(scene, L) {
    if (!Optics.pointInBox(L, scene.shell.min, scene.shell.max)) return 'the lens is outside the room';
    const solids = scene.solids || [];
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (L[0] > s.min[0] + EPS && L[0] < s.max[0] - EPS && L[1] > s.min[1] + EPS && L[1] < s.max[1] - EPS &&
          L[2] > s.min[2] + EPS && L[2] < s.max[2] - EPS) return 'the lens is inside ' + s.label;
    }
    return null;
  }

  function insideUnit(uv) {
    return uv[0] >= -EPS && uv[0] <= 1 + EPS && uv[1] >= -EPS && uv[1] <= 1 + EPS;
  }

  // Active content test for a front point: native panel UV, or the corrected-content UV.
  function contentUV(profile, proj, p, preview, active) {
    const uv = Optics.panelUV(profile, proj, p);
    if (!uv || !isFinite(uv[0]) || !isFinite(uv[1])) return null;
    if (!active) return uv;
    const H = preview.homography;
    const d = H[6] * uv[0] + H[7] * uv[1] + H[8];
    if (!(d > 1e-12) || !isFinite(d)) return null;
    return [(H[0] * uv[0] + H[1] * uv[1] + H[2]) / d, (H[3] * uv[0] + H[4] * uv[1] + H[5]) / d];
  }

  // Fraction of the 32 x 20 front-centre grid inside the active content AND unobstructed: the ray
  // from the lens reaches the sample point on the frame's own front before anything else.
  function litFraction(f, profile, proj, scene, L, preview, active) {
    const own = 'frame:' + f.id;
    let lit = 0, obstructed = 0;
    for (let j = 0; j < GRID_Z; j++) {
      const z = f.bottom + (j + 0.5) / GRID_Z * f.height;
      for (let i = 0; i < GRID_U; i++) {
        const u = f.u + (i + 0.5) / GRID_U * f.width;
        const P = [u, f.depth, z];
        const uv = contentUV(profile, proj, P, preview, active);
        if (!uv || !insideUnit(uv)) continue;
        const hit = Optics.castRay(scene, L, [P[0] - L[0], P[1] - L[1], P[2] - L[2]]);
        let free;
        if (f.depth > 0) free = hit.solidId === own && Math.abs(hit.t - 1) <= T_TOL;
        else free = hit.t !== undefined && hit.t >= 1 - T_TOL;
        if (free) lit++; else obstructed++;
      }
    }
    return { fraction: lit / (GRID_U * GRID_Z), obstructed: obstructed };
  }

  // ---------------------------------------------------------------- analyze
  function analyze(room, frames, mappingResults, profile, projector, scene, preview, previewEnabled) {
    frames = frames || [];
    const L = Optics.lensOf(projector);
    const active = !!(previewEnabled && preview && preview.available && preview.homography);
    const fp = footprint(profile, projector, preview, previewEnabled);
    const lensBad = lensProblem(scene, L);

    return (mappingResults || []).map(function (res, i) {
      const f = frames[i];
      const out = Object.assign({}, res, { issues: (res.issues || []).slice() });
      if (!Frames.validFrame(f)) return out;

      if (lensBad) {
        out.litSampleFraction = null;
        out.issues.push({ code: 'ILLUMINATION_UNAVAILABLE', message: 'Illumination unavailable: ' + lensBad + '.' });
      } else {
        const lit = litFraction(f, profile, projector, scene, L, preview, active);
        out.litSampleFraction = lit.fraction;
        if (lit.obstructed > 0) {
          out.issues.push({ code: 'FRONT_SHADED', message: 'Part of the frame front is in the shadow of the column, another frame or an obstacle.' });
        }
      }

      const sh = computeShadow(room, f, frames, L, fp);
      out.shadow = sh.shadow;
      if (!sh.shadow) out.issues.push({ code: 'SHADOW_UNAVAILABLE', message: sh.reason });
      return out;
    });
  }

  return { analyze: analyze, bodyIntersectsBox: bodyIntersectsBox, LABEL: LABEL, GRID: [GRID_U, GRID_Z] };
});
