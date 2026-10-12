/* PS.Frames: pure physical-frame geometry and native-pixel mapping (PLAN_P12_FAST.md sections 3.4-3.6, 3.8).
 *
 * Depends on PS.Optics only. No shadows, visibility sampling, UI or persistence live here.
 *
 *   Frames.attach(baseScene, frames) -> scene
 *   Frames.map(room, frames, profile, projector, preview, previewEnabled)
 *       -> { frames: [result], frameOverlay: { count, edges } }
 *
 * Room frame as in Optics (x right, y from the back wall y = 0 into the room, z up). A frame is
 * { id, name, u, bottom, width, height, depth } in metres: an opaque slab
 * min [u, 0, bottom], max [u + width, depth, bottom + height].
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./optics.js'));
  else { root.PS = root.PS || {}; root.PS.Frames = factory(root.PS.Optics); }
})(typeof self !== 'undefined' ? self : this, function (Optics) {
  'use strict';

  var NAMES = ['TL', 'TR', 'BR', 'BL'];
  var MAX_MASKS = 3;
  var EPS = 1e-9;

  function finite(x) { return typeof x === 'number' && isFinite(x); }

  function validFrame(f) {
    return !!f && finite(f.u) && finite(f.bottom) && finite(f.width) && finite(f.height) &&
           finite(f.depth) && f.width > 0 && f.height > 0 && f.depth >= 0;
  }

  // Physical front corners, TL TR BR BL, xyz metres (the face at distance `depth` from the wall).
  function frontCorners(f) {
    var x0 = f.u, x1 = f.u + f.width, z0 = f.bottom, z1 = f.bottom + f.height, y = f.depth;
    return { TL: [x0, y, z1], TR: [x1, y, z1], BR: [x1, y, z0], BL: [x0, y, z0] };
  }

  // ---------------------------------------------------------------- attach
  // Appends positive-depth slabs to the scene's solids; zero-depth frames become frameFronts.
  // The base scene is never mutated; its solid objects are shared, not copied.
  function attach(baseScene, frames) {
    var scene = {};
    for (var k in baseScene) if (Object.prototype.hasOwnProperty.call(baseScene, k)) scene[k] = baseScene[k];
    var solids = (baseScene.solids || []).slice();
    var fronts = [];
    (frames || []).forEach(function (f) {
      if (!validFrame(f)) return;
      if (f.depth > 0) {
        solids.push({
          id: 'frame:' + f.id, frameId: f.id, label: f.name,
          min: [f.u, 0, f.bottom], max: [f.u + f.width, f.depth, f.bottom + f.height],
          group: 'frame', provisional: false
        });
      } else {
        fronts.push({ frameId: f.id, corners: frontCorners(f), normal: [0, 1, 0] });
      }
    });
    scene.solids = solids;
    scene.frameFronts = fronts;
    return scene;
  }

  // ---------------------------------------------------------------- helpers
  // Sutherland-Hodgman against the half-plane fn(p) >= 0, p = [x, z].
  function clipHalf(poly, fn) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
      var fc = fn(cur), fp = fn(prev);
      if (fc >= 0) {
        if (fp < 0) out.push(cut(prev, cur, fp, fc));
        out.push(cur);
      } else if (fp >= 0) out.push(cut(prev, cur, fp, fc));
    }
    return out;
  }
  function cut(a, b, fa, fb) {
    var t = fa / (fa - fb);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }

  // Fraction of the physical front rectangle (plane y = depth) inside the native frustum and
  // ahead of the lens. The frustum faces are linear in the point, so this is exact in metres.
  function nativeCoverage(profile, proj, f) {
    var B = Optics.basisOf(proj), L = Optics.lensOf(proj), w = Optics.window(profile, proj);
    var n = f.depth;
    function rel(p) { return [p[0] - L[0], n - L[1], p[1] - L[2]]; }
    function dotv(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    var planes = [
      function (p) { var d = rel(p); return dotv(d, B.f) - 1e-9; },
      function (p) { var d = rel(p); return dotv(d, B.r) - w.sL * dotv(d, B.f); },
      function (p) { var d = rel(p); return w.sR * dotv(d, B.f) - dotv(d, B.r); },
      function (p) { var d = rel(p); return dotv(d, B.u) - w.qB * dotv(d, B.f); },
      function (p) { var d = rel(p); return w.qT * dotv(d, B.f) - dotv(d, B.u); }
    ];
    var poly = [[f.u, f.bottom + f.height], [f.u + f.width, f.bottom + f.height],
                [f.u + f.width, f.bottom], [f.u, f.bottom]];
    for (var i = 0; i < planes.length && poly.length; i++) poly = clipHalf(poly, planes[i]);
    if (poly.length < 3) return 0;
    var c = Optics.polygonArea(poly) / (f.width * f.height);
    return c > 1 - 1e-12 ? 1 : (c < 0 ? 0 : c);
  }

  // Snap values within EPS of an integer so exact pixel edges do not fall a ULP the wrong way.
  function snap(x) { var r = Math.round(x); return Math.abs(x - r) < EPS ? r : x; }
  function floorPx(x) { return Math.floor(snap(x)); }
  function ceilPx(x) { return Math.ceil(snap(x)); }

  function bounds(named) {
    var xs = NAMES.map(function (k) { return named[k][0]; });
    var ys = NAMES.map(function (k) { return named[k][1]; });
    return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys),
             x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
  }

  function rectOf(b) { return { x0: floorPx(b.x0), y0: floorPx(b.y0), x1: ceilPx(b.x1), y1: ceilPx(b.y1) }; }

  function clippedRect(r, W, H) {
    var c = { x0: Math.max(r.x0, 0), y0: Math.max(r.y0, 0), x1: Math.min(r.x1, W), y1: Math.min(r.y1, H) };
    return (c.x1 > c.x0 && c.y1 > c.y0) ? c : null;
  }

  // Panel UV -> pixel-edge coordinates, top-left origin, continuous [0,W] x [0,H].
  function uvToPixel(uv, W, H) { return [W * uv[0], H * (1 - uv[1])]; }

  // Homography of panel UV -> content UV with the denominator checked (null when unbounded).
  function applyChecked(H, uv) {
    var d = H[6] * uv[0] + H[7] * uv[1] + H[8];
    if (!(d > 1e-12) || !isFinite(d)) return null;
    return [(H[0] * uv[0] + H[1] * uv[1] + H[2]) / d, (H[3] * uv[0] + H[4] * uv[1] + H[5]) / d];
  }

  function insideUnit(uv) {
    return uv[0] >= -EPS && uv[0] <= 1 + EPS && uv[1] >= -EPS && uv[1] <= 1 + EPS;
  }

  // ---------------------------------------------------------------- mask edges
  // Four inward edge equations a*x + b*y + c >= 0 for a quad of named pixel corners, in normalized
  // top-left coordinates, (a, b) unit length. Returns null for a degenerate quad.
  function maskEdges(panelPixels, W, H) {
    var pts = NAMES.map(function (k) { return [panelPixels[k][0] / W, panelPixels[k][1] / H]; });
    var s = 0, i;
    for (i = 0; i < 4; i++) {
      var p = pts[i], q = pts[(i + 1) % 4];
      s += p[0] * q[1] - q[0] * p[1];
    }
    if (!(Math.abs(s) / 2 > 1e-12)) return null;
    var sign = s > 0 ? 1 : -1, edges = [];
    for (i = 0; i < 4; i++) {
      var a0 = pts[i], a1 = pts[(i + 1) % 4];
      var ex = a1[0] - a0[0], ey = a1[1] - a0[1], len = Math.sqrt(ex * ex + ey * ey);
      if (!(len > 1e-12)) return null;
      var a = -ey * sign / len, b = ex * sign / len;
      edges.push([a, b, -(a * a0[0] + b * a0[1])]);
    }
    return edges;
  }

  // ---------------------------------------------------------------- map
  function overlaps(a, b) {
    return a.u < b.u + b.width - EPS && b.u < a.u + a.width - EPS &&
           a.bottom < b.bottom + b.height - EPS && b.bottom < a.bottom + a.height - EPS;
  }

  function mapOne(room, f, profile, proj, preview, previewEnabled) {
    var W = profile.nativeW, H = profile.nativeH;
    var res = {
      frameId: f ? f.id : null, name: f ? f.name : null,
      frontCornersWorld: null, wallFit: null,
      insideNativeImage: false, nativeCoverage: 0, insidePreviewImage: null,
      panelPixels: null, pixelBounds: null,
      coveringPixelRect: { unclipped: null, clipped: null },
      contentPixels: null,
      litSampleFraction: null, shadow: null,   // completed by FrameEffects
      issues: []
    };
    if (!validFrame(f)) {
      res.issues.push({ code: 'FRAME_INVALID', message: 'Frame values are not finite, positive sizes with a non-negative depth.' });
      return res;
    }
    var fc = frontCorners(f);
    res.frontCornersWorld = fc;

    var wallW = room && finite(room.width) ? room.width : null;
    var wallH = room && finite(room.ceiling) ? room.ceiling : (room && finite(room.height) ? room.height : null);
    if (wallW != null && wallH != null) {
      res.wallFit = f.u >= -EPS && f.bottom >= -EPS && f.u + f.width <= wallW + EPS && f.bottom + f.height <= wallH + EPS;
      if (!res.wallFit) res.issues.push({ code: 'WALL_FIT', message: 'Frame extends beyond the back wall.' });
    }

    res.nativeCoverage = nativeCoverage(profile, proj, f);

    var uvs = {}, bounded = true;
    NAMES.forEach(function (k) {
      var uv = Optics.panelUV(profile, proj, fc[k]);
      if (!uv || !finite(uv[0]) || !finite(uv[1])) bounded = false; else uvs[k] = uv;
    });
    if (!bounded) {
      res.issues.push({ code: 'MAPPING_UNBOUNDED', message: 'Part of the frame front is level with or behind the lens; pixel coordinates are undefined.' });
    } else {
      var px = {};
      NAMES.forEach(function (k) { px[k] = uvToPixel(uvs[k], W, H); });
      res.panelPixels = px;
      res.pixelBounds = bounds(px);
      var un = rectOf(res.pixelBounds);
      res.coveringPixelRect = { unclipped: un, clipped: clippedRect(un, W, H) };
      res.insideNativeImage = NAMES.every(function (k) { return insideUnit(uvs[k]); });

      var active = !!(previewEnabled && preview && preview.available && preview.homography);
      if (active) {
        var cuv = {}, ok = true;
        NAMES.forEach(function (k) {
          var c = applyChecked(preview.homography, uvs[k]);
          if (!c) ok = false; else cuv[k] = c;
        });
        if (ok) {
          var cp = {};
          NAMES.forEach(function (k) { cp[k] = uvToPixel(cuv[k], W, H); });
          res.contentPixels = cp;
          res.insidePreviewImage = NAMES.every(function (k) { return insideUnit(cuv[k]); });
        } else {
          res.issues.push({ code: 'PREVIEW_UNBOUNDED', message: 'Corrected-content coordinates are undefined for this frame.' });
        }
      } else {
        res.contentPixels = px;
      }
    }
    if (res.insideNativeImage === false && res.nativeCoverage <= 0) {
      res.issues.push({ code: 'OUTSIDE_IMAGE', message: 'Frame front is outside the projected image.' });
    } else if (res.nativeCoverage < 1) {
      res.issues.push({ code: 'PARTLY_OUTSIDE_IMAGE', message: 'Only ' + (res.nativeCoverage * 100).toFixed(1) + '% of the frame front is inside the projected image.' });
    }
    return res;
  }

  function map(room, frames, profile, projector, preview, previewEnabled) {
    frames = frames || [];
    var results = frames.map(function (f) { return mapOne(room, f, profile, projector, preview, previewEnabled); });

    // overlap warnings on the mounting rectangles
    for (var i = 0; i < frames.length; i++) for (var j = i + 1; j < frames.length; j++) {
      if (validFrame(frames[i]) && validFrame(frames[j]) && overlaps(frames[i], frames[j])) {
        results[i].issues.push({ code: 'OVERLAP', message: 'Overlaps frame "' + frames[j].name + '".' });
        results[j].issues.push({ code: 'OVERLAP', message: 'Overlaps frame "' + frames[i].name + '".' });
      }
    }

    var edges = [], count = 0, W = profile.nativeW, H = profile.nativeH;
    results.forEach(function (r) {
      if (!r.panelPixels || count >= MAX_MASKS) return;
      var e = maskEdges(r.panelPixels, W, H);
      if (!e) {
        r.issues.push({ code: 'MASK_DEGENERATE', message: 'Frame quad is degenerate in pixel space; no white patch.' });
        return;
      }
      for (var k = 0; k < 4; k++) edges.push(e[k]);
      count++;
    });
    while (edges.length < 12) edges.push([0, 0, 0]);
    return { frames: results, frameOverlay: { count: count, edges: edges } };
  }

  return { attach: attach, map: map, frontCorners: frontCorners, validFrame: validFrame, maskEdges: maskEdges };
});
