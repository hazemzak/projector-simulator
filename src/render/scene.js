/* PS.Scene: the three.js scene (PLAN.md sections 2.1, 2.5, 6.3). Room meshes, projector camera and depth
 * pass, helpers, projector body, the four views and renderToCanvas.
 *
 * Frames: room frame R (x right, y from the back wall, z up) is left-handed; three.js frame T is
 * (x, z, y). r2t / t2r are the ONLY conversion between them. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};
  var THREE = root.THREE;
  var Room = PS.Room, Optics = PS.Optics, Shaders = PS.Shaders;

  function r2t(p) { return new THREE.Vector3(p[0], p[2], p[1]); }
  function t2r(v) { return [v.x, v.z, v.y]; }

  var VIEWS = ['persp', 'top', 'wall', 'projector'];
  var MARGIN = 0.08;
  var BG = '#2b2f36';

  function create(host) {
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    var dom = renderer.domElement;
    dom.style.position = 'absolute';
    dom.style.left = '0';
    dom.style.top = '0';
    host.appendChild(dom);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    var sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 3, 2);
    scene.add(sun);

    var shared = Shaders.createUniforms();
    var materialCache = {};
    var roomGroup = new THREE.Group();   // optical meshes (layers 0 and 1)
    var decorGroup = new THREE.Group();  // wires and the floor label (layer 0)
    var helperGroup = new THREE.Group(); // beam edges, target outline, keystone rectangle (layer 0)
    var pivot = new THREE.Group();       // at the lens, content basis; P5 attaches the gizmo to it
    var bodyGroup = new THREE.Group();
    [roomGroup, decorGroup, helperGroup, pivot].forEach(function (g) { g.userData.psOwned = true; scene.add(g); });
    pivot.add(bodyGroup);

    var cur = { state: null, result: null, profile: null };
    var view = 'persp';
    var dirty = false, rafId = 0;
    var roomKey = '', roomDimsKey = '', bodyKey = '';
    var width = 0, height = 0;
    var depthRT = null, depthDirty = true;
    var opticalOnly = false;

    // ---------------------------------------------------------------- cameras
    var cameras = {
      persp: new THREE.PerspectiveCamera(50, 1.6, 0.05, 80),
      top: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40),
      wall: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40),
      projector: new THREE.Camera()
    };
    var depthCam = new THREE.Camera();
    depthCam.layers.set(1);

    function dims() {
      var p = cur.state ? cur.state.room : Room.defaults();
      return { W: p.width, D: p.depth, H: p.ceiling };
    }

    // Place and orient a camera at the lens with an off-axis window [sL,sR] x [qB,qT] on the unit plane.
    function aimProjectorCamera(cam, L, B, sL, sR, qB, qT, near, far) {
      cam.position.copy(r2t(L));
      var m = new THREE.Matrix4().makeBasis(r2t(B.r), r2t(B.u), r2t(B.f.map(function (v) { return -v; })));
      if (m.determinant() <= 0) throw new Error('Projector basis is not right-handed in frame T.');
      cam.quaternion.setFromRotationMatrix(m);
      cam.updateMatrixWorld(true);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      cam.projectionMatrix.makePerspective(near * sL, near * sR, near * qT, near * qB, near, far);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }

    // The projector view: the window enlarged 15% on each side, widened to the viewport aspect.
    function aimViewCamera(cam, aspect) {
      var st = cur.state, w = cur.result.window, B = cur.result.basis;
      var ws = (w.sR - w.sL) * 1.3, hs = (w.qT - w.qB) * 1.3;
      var sc = (w.sL + w.sR) / 2, qc = (w.qB + w.qT) / 2;
      if (ws / hs < aspect) ws = hs * aspect; else hs = ws / aspect;
      aimProjectorCamera(cam, Optics.lensOf(st.projector), B, sc - ws / 2, sc + ws / 2, qc - hs / 2, qc + hs / 2, 0.02, 60);
    }

    function orthoExtents(v, aspect, margin, exact) {
      var d = dims();
      var cw = d.W, ch = v === 'wall' ? d.H : d.D;
      if (exact) return { hx: cw / 2, hy: ch / 2 };
      var hy = Math.max(ch / 2 * (1 + margin), cw / 2 * (1 + margin) / aspect);
      return { hx: hy * aspect, hy: hy };
    }

    function fitOrtho(cam, v, aspect) {
      var e = orthoExtents(v, aspect, MARGIN, false);
      cam.left = -e.hx; cam.right = e.hx; cam.top = e.hy; cam.bottom = -e.hy;
      cam.updateProjectionMatrix();
    }

    // Default framing of each view. up is set once before the controls are built.
    function placeCamera(v) {
      var d = dims(), cam = cameras[v], tgt;
      if (v === 'persp') {
        // Narrow hosts (portrait) get a longer pull-back so the whole room, including the hatched front, stays in frame.
        var k = (width && height) ? Math.max(1, 1.5 / (width / height)) : 1;
        cam.position.copy(r2t([d.W / 2, d.D + 1.5 * k, 2.2 + 0.5 * (k - 1)]));
        tgt = r2t([d.W / 2, 0, 1.3]);
      } else if (v === 'top') {
        cam.up.copy(r2t([0, -1, 0]));
        cam.position.copy(r2t([d.W / 2, d.D / 2, d.H + 5]));
        tgt = r2t([d.W / 2, d.D / 2, 0]);
      } else {
        cam.up.copy(r2t([0, 0, 1]));
        cam.position.copy(r2t([d.W / 2, d.D + 5, d.H / 2]));
        tgt = r2t([d.W / 2, 0, d.H / 2]);
      }
      cam.zoom = 1;
      cam.lookAt(tgt);
      if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
      return tgt;
    }

    // One OrbitControls per camera: it caches the camera's up vector, and the ortho views differ.
    var orbits = {};
    ['persp', 'top', 'wall'].forEach(function (v) {
      var tgt = placeCamera(v);
      var oc = new THREE.OrbitControls(cameras[v], dom);
      oc.target.copy(tgt);
      oc.enableDamping = false;
      if (v === 'persp') { oc.minDistance = 0.5; oc.maxDistance = 30; }
      else { oc.enableRotate = false; oc.minZoom = 0.3; oc.maxZoom = 30; }
      oc.update();
      oc.addEventListener('change', requestRender);
      orbits[v] = oc;
    });

    var orbitEnabled = true;
    function applyOrbitEnabled() {
      VIEWS.forEach(function (v) { if (orbits[v]) orbits[v].enabled = orbitEnabled && v === view; });
    }
    // Facade so P5 can hold one reference and still disable whichever control is active.
    var orbit = {
      get enabled() { return orbitEnabled; },
      set enabled(v) { orbitEnabled = !!v; applyOrbitEnabled(); },
      get active() { return orbits[view] || null; },
      get target() { return (orbits[view] || orbits.persp).target; },
      get object() { return cameras[view]; },
      controls: orbits,
      update: function () { if (orbits[view]) orbits[view].update(); }
    };

    // ---------------------------------------------------------------- materials and room meshes
    function material(opts) {
      var key = [opts.albedo, opts.albedoUpper || '', opts.split ? 1 : 0, opts.hatchMode || 0].join('|');
      if (!materialCache[key]) materialCache[key] = Shaders.createMaterial(shared, opts);
      return materialCache[key];
    }

    function disposeGroup(g) {
      for (var i = g.children.length - 1; i >= 0; i--) {
        var o = g.children[i];
        g.remove(o);
        if (o.geometry) o.geometry.dispose();
        if (o.userData.ownMaterial && o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      }
    }

    function solidColour(s) {
      var C = Room.COLORS;
      if (s.user) return C.obstacle;
      if (s.id === 'ac') return C.ac;
      if (s.id.indexOf('rail') === 0 || s.id.indexOf('spot') === 0) return C.rail;
      if (s.id.indexOf('skirt') === 0) return C.skirting;
      if (s.id.indexOf('sock') === 0) return C.sockets;
      if (s.id === 'pier') return C.wallGrey;
      return C.obstacle;
    }

    function shellMaterial(q, p) {
      var C = Room.COLORS;
      var hatch = q.alwaysProvisional ? 2 : 1;
      if (q.cls === 'floor') return material({ albedo: C.floor, hatchMode: hatch });
      if (q.cls === 'ceiling') return material({ albedo: C.ceiling, hatchMode: hatch });
      return material({ albedo: C.wallGrey, albedoUpper: C.wallWhite, split: true, hatchMode: hatch });
    }

    function makeLabelTexture(text) {
      var c = document.createElement('canvas');
      c.width = 1024; c.height = 128;
      var g = c.getContext('2d');
      g.font = 'bold 64px "Segoe UI", Arial, sans-serif';
      var tw = g.measureText(text).width;
      if (tw > 960) g.font = 'bold ' + Math.floor(64 * 960 / tw) + 'px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = 'rgba(40,20,0,0.85)';
      g.strokeText(text, 512, 66);
      g.fillStyle = '#ffd9a0';
      g.fillText(text, 512, 66);
      var t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function buildRoom(state) {
      disposeGroup(roomGroup);
      disposeGroup(decorGroup);
      var p = state.room;
      var sc = Room.buildScene(p, state.obstacles);

      sc.quads.forEach(function (q) {
        var pts = q.corners.map(r2t);
        var n = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
        var inward = r2t(q.inwardNormal);
        if (n.dot(inward) < 0) pts.reverse();
        var pos = [], nrm = [];
        pts.forEach(function (v) { pos.push(v.x, v.y, v.z); nrm.push(inward.x, inward.y, inward.z); });
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        var mesh = new THREE.Mesh(geo, shellMaterial(q, p));
        mesh.name = 'shell-' + q.id;
        mesh.layers.enable(1);
        roomGroup.add(mesh);
      });

      sc.solids.forEach(function (s) {
        var size = r2t([s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]]);
        var centre = r2t([(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2]);
        var geo = new THREE.BoxGeometry(size.x, size.y, size.z);
        geo.translate(centre.x, centre.y, centre.z);
        var opts = { albedo: solidColour(s), hatchMode: s.provisional ? 2 : 1 };
        if (s.id === 'pier') { opts.split = true; opts.albedoUpper = Room.COLORS.wallWhite; }
        var mesh = new THREE.Mesh(geo, material(opts));
        mesh.name = 'solid-' + s.id;
        mesh.layers.enable(1);
        roomGroup.add(mesh);
      });

      // decor: suspension wires (drawn, not optical)
      var wirePts = [];
      sc.wires.forEach(function (w) {
        var a = r2t(w.a), b = r2t(w.b);
        wirePts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      });
      var wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
      var wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x8a8f96 }));
      wires.userData.ownMaterial = true;
      decorGroup.add(wires);

      // "NOT PHOTOGRAPHED" label flat on the floor
      if (p.photoDepth < p.depth) {
        var lw = Math.min(2.4, p.width * 0.9);
        var lg = new THREE.PlaneGeometry(lw, lw / 8);
        var lm = new THREE.MeshBasicMaterial({
          map: makeLabelTexture('NOT PHOTOGRAPHED — PROVISIONAL'), transparent: true, depthWrite: false
        });
        var label = new THREE.Mesh(lg, lm);
        label.userData.ownMaterial = true;
        label.rotation.x = -Math.PI / 2;
        label.position.copy(r2t([p.width / 2, (p.photoDepth + p.depth) / 2, 0.004]));
        decorGroup.add(label);
      }
    }

    // ---------------------------------------------------------------- projector body (pivot children)
    function buildBody(profile, mount) {
      disposeGroup(bodyGroup);
      var b = profile.body;
      var geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a4f57 }));
      mesh.userData.ownMaterial = true;
      mesh.position.set(-(b.lensRight || 0), b.h / 2 - (b.lensUp || 0), b.d / 2);
      bodyGroup.add(mesh);
      var edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x9aa0a8 }));
      edges.userData.ownMaterial = true;
      edges.position.copy(mesh.position);
      bodyGroup.add(edges);
      var lens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 24), new THREE.MeshLambertMaterial({ color: 0x15171a }));
      lens.userData.ownMaterial = true;
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 0, -0.015);
      bodyGroup.add(lens);
      var dot = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide }));
      dot.userData.ownMaterial = true;
      dot.rotation.y = Math.PI;
      dot.position.set(0, 0, -0.031);
      bodyGroup.add(dot);
    }

    // ---------------------------------------------------------------- helpers
    function lineMaterial(color) { return new THREE.LineBasicMaterial({ color: color }); }

    var beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
    var beamLines = new THREE.LineSegments(beamGeo, lineMaterial(0xff8a00));
    beamLines.frustumCulled = false;
    helperGroup.add(beamLines);

    var targetOutline = null, previewOutline = null;

    // Dashed rectangle on the back wall plane as thin ribbons (GL lines are 1 px wide).
    function dashedRect(r, color) {
      var y = 0.004, hw = 0.003, dash = 0.06, gap = 0.04;
      var pos = [], idx = [];
      function edge(ax, az, bx, bz) {
        var len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
        var dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx;
        for (var t = 0; t < len; t += dash + gap) {
          var t1 = Math.min(t + dash, len);
          var ends = [t, t1];
          for (var e = 0; e < 2; e++) {
            var cx = ax + dx * ends[e], cz = az + dz * ends[e];
            [[cx - nx * hw, cz - nz * hw], [cx + nx * hw, cz + nz * hw]].forEach(function (c) {
              var v = r2t([c[0], y, c[1]]);
              pos.push(v.x, v.y, v.z);
            });
          }
          var i0 = pos.length / 3 - 4;
          idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
        }
      }
      edge(r.x0, r.z0, r.x1, r.z0); edge(r.x1, r.z0, r.x1, r.z1);
      edge(r.x1, r.z1, r.x0, r.z1); edge(r.x0, r.z1, r.x0, r.z0);
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
      m.userData.ownMaterial = true;
      return m;
    }

    function replaceHelper(old, mesh) {
      if (old) { helperGroup.remove(old); old.geometry.dispose(); old.material.dispose(); }
      if (mesh) helperGroup.add(mesh);
      return mesh;
    }

    function syncHelpers(state, result) {
      var L = r2t(Optics.lensOf(state.projector));
      var arr = beamGeo.attributes.position.array, n = 0;
      result.frustumHits.forEach(function (h) {
        if (!h.point) return;
        var p = r2t(h.point);
        arr[n++] = L.x; arr[n++] = L.y; arr[n++] = L.z;
        arr[n++] = p.x; arr[n++] = p.y; arr[n++] = p.z;
      });
      beamGeo.setDrawRange(0, n / 3);
      beamGeo.attributes.position.needsUpdate = true;
      beamLines.visible = !!state.display.showFrustum;

      var t = state.target;
      targetOutline = replaceHelper(targetOutline, t && t.enabled ? dashedRect(t, 0x00bcd4) : null);
      var pv = result.preview;
      previewOutline = replaceHelper(previewOutline,
        state.display.keystoneSim && pv && pv.available ? dashedRect(pv.rect, 0xe91e8c) : null);
    }

    // ---------------------------------------------------------------- depth pass
    var depthMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });

    function ensureDepthTarget(w, h) {
      if (depthRT && depthRT.width === w && depthRT.height === h) return;
      if (depthRT) { depthRT.depthTexture.dispose(); depthRT.dispose(); }
      var dt = new THREE.DepthTexture(w, h, THREE.FloatType);
      depthRT = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: dt, depthBuffer: true
      });
      shared.uDepth.value = dt;
      shared.uDepthTexel.value.set(1 / w, 1 / h);
      depthDirty = true;
    }

    function renderDepth() {
      var prevOverride = scene.overrideMaterial, prevTarget = renderer.getRenderTarget(), prevBg = scene.background;
      scene.overrideMaterial = depthMat;
      scene.background = null;
      renderer.setRenderTarget(depthRT);
      renderer.render(scene, depthCam);
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
      renderer.setRenderTarget(prevTarget);
      depthDirty = false;
    }

    // ---------------------------------------------------------------- sync from state
    function sync(state, result, source) {
      var profile = result.profile, disp = state.display;
      var prev = cur;
      cur = { state: state, result: result, profile: profile };

      var rk = JSON.stringify([state.room, state.obstacles.filter(function (o) { return o.enabled; })]);
      var roomChanged = rk !== roomKey;
      if (roomChanged) {
        roomKey = rk;
        buildRoom(state);
        var dk = [state.room.width, state.room.depth, state.room.ceiling].join(',');
        if (dk !== roomDimsKey) {
          roomDimsKey = dk;
          ['top', 'wall'].forEach(function (v) {
            var tgt = placeCamera(v);
            orbits[v].target.copy(tgt);
            orbits[v].update();
          });
        }
      }

      var bk = JSON.stringify([profile.body, state.projector.mount]);
      if (bk !== bodyKey) { bodyKey = bk; buildBody(profile, state.projector.mount); bodyGroup.rotation.z = state.projector.mount === 'ceiling' ? Math.PI : 0; }

      // pivot: skip while the gizmo is driving it
      var B = result.basis, w = result.window, L = Optics.lensOf(state.projector);
      if (source !== 'gizmo') {
        pivot.position.copy(r2t(L));
        var pm = new THREE.Matrix4().makeBasis(r2t(B.r), r2t(B.u), r2t(B.f.map(function (v) { return -v; })));
        pivot.quaternion.setFromRotationMatrix(pm);
        pivot.updateMatrixWorld(true);
      }

      // projector camera and shared uniforms
      aimProjectorCamera(depthCam, L, B, w.sL, w.sR, w.qB, w.qT, Shaders.NEAR, Shaders.FAR);
      shared.uProjViewProj.value.multiplyMatrices(depthCam.projectionMatrix, depthCam.matrixWorldInverse);
      shared.uLens.value.copy(r2t(L));
      shared.uAxis.value.copy(r2t(B.f));
      shared.uLumens.value = profile.lumens;
      shared.uA1.value = w.A1;
      shared.uW1.value = w.W1;
      shared.uAmbient.value = disp.ambient;
      shared.uExposure.value = disp.exposureLux;
      shared.uFalseColour.value = disp.falseColour ? 1 : 0;
      shared.uGreyTop.value = state.room.greyTop;
      shared.uPhotoDepth.value = state.room.photoDepth;
      var pv = result.preview;
      if (disp.keystoneSim && pv && pv.available && pv.homography) {
        var h = pv.homography;
        shared.uHomography.value.set(h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]);
        shared.uUseHomography.value = 1;
      } else shared.uUseHomography.value = 0;

      ensureDepthTarget(Shaders.DEPTH_W, Math.round(Shaders.DEPTH_W * w.aspect));
      depthDirty = true;
      syncHelpers(state, result);
      refit();
      requestRender();
    }

    // ---------------------------------------------------------------- content texture
    function setContentCanvas(canvas) {
      var t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.needsUpdate = true;
      var old = shared.uContent.value;
      shared.uContent.value = t;
      if (old) old.dispose();
      requestRender();
    }

    // ---------------------------------------------------------------- sizing, views, rendering
    function resize() {
      var w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      var pr = Math.min(root.devicePixelRatio || 1, 2);
      if (w === width && h === height && renderer.getPixelRatio() === pr) return;
      width = w; height = h;
      applySize();
    }

    // Aspect-dependent camera parameters (also after a room-size change).
    function refit() {
      var aspect = width / height;
      cameras.persp.aspect = aspect;
      cameras.persp.updateProjectionMatrix();
      fitOrtho(cameras.top, 'top', aspect);
      fitOrtho(cameras.wall, 'wall', aspect);
    }

    function applySize() {
      renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      refit();
      requestRender();
    }

    if (root.ResizeObserver) new root.ResizeObserver(function () { resize(); }).observe(host);
    root.addEventListener('resize', resize);

    function setView(name) {
      if (VIEWS.indexOf(name) < 0) return false;
      view = name;
      applyOrbitEnabled();
      if (name !== 'projector') {
        var tgt = placeCamera(name);
        orbits[name].target.copy(tgt);
        orbits[name].update();
      }
      requestRender();
      return true;
    }

    function resetCamera() { setView(view); }

    function activeCamera(v, aspect) {
      if (v === 'projector') { if (cur.result) aimViewCamera(cameras.projector, aspect || width / height); return cameras.projector; }
      return cameras[v];
    }

    function requestRender() {
      dirty = true;
      if (rafId) return;
      rafId = root.requestAnimationFrame(function () {
        rafId = 0;
        if (dirty) renderNow();
      });
    }

    function setVisibility(forOptical, v) {
      var saved = [];
      function hide(o) { saved.push([o, o.visible]); o.visible = false; }
      if (forOptical) { hide(helperGroup); hide(decorGroup); hide(pivot); }
      else if (v === 'projector') { hide(bodyGroup); hide(beamLines); }
      return saved;
    }

    function restoreVisibility(saved) { saved.forEach(function (s) { s[0].visible = s[1]; }); }

    function renderNow() {
      dirty = false;
      if (!cur.result) return;
      if (depthDirty) renderDepth();
      var saved = setVisibility(false, view);
      renderer.setRenderTarget(null);
      renderer.render(scene, activeCamera(view));
      restoreVisibility(saved);
    }

    // Render a view at widthPx and return an sRGB 2D canvas (no gizmo).
    // opticalOnly: no helpers, body, decor or hatch. exact: ortho views frame the surface with no margin.
    function renderToCanvas(v, widthPx, opts) {
      opts = opts || {};
      var w = Math.max(1, Math.round(widthPx));
      var d = dims(), h, cam;
      if (v === 'wall' || v === 'top') {
        var e = orthoExtents(v, 1, MARGIN, !!opts.exact);
        h = Math.max(1, Math.round(w * e.hy / e.hx));
        cam = new THREE.OrthographicCamera(-e.hx, e.hx, e.hy, -e.hy, 0.1, 40);
        var src = cameras[v];
        var cc = v === 'wall' ? r2t([d.W / 2, d.D + 5, d.H / 2]) : r2t([d.W / 2, d.D / 2, d.H + 5]);
        cam.up.copy(src.up);
        cam.position.copy(cc);
        cam.lookAt(v === 'wall' ? r2t([d.W / 2, 0, d.H / 2]) : r2t([d.W / 2, d.D / 2, 0]));
        cam.updateMatrixWorld(true);
      } else if (v === 'projector') {
        h = Math.max(1, Math.round(w * cur.profile.nativeH / cur.profile.nativeW));
        cam = cameras.projector;
        aimViewCamera(cam, w / h);
      } else {
        var aspect = width / height;
        h = Math.max(1, Math.round(w / aspect));
        cam = cameras.persp.clone();
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
      }

      var hidden = [];
      scene.children.forEach(function (o) { if (!o.userData.psOwned && o.visible && !o.isLight) { hidden.push(o); o.visible = false; } });
      var saved = setVisibility(!!opts.opticalOnly, v);
      shared.uHatchOn.value = opts.opticalOnly ? 0 : 1;
      if (depthDirty) renderDepth();

      renderer.setRenderTarget(null);
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      renderer.render(scene, cam);
      var out = document.createElement('canvas');
      out.width = w; out.height = h;
      out.getContext('2d').drawImage(dom, 0, 0);

      shared.uHatchOn.value = 1;
      restoreVisibility(saved);
      hidden.forEach(function (o) { o.visible = true; });
      applySize();
      return out;
    }

    resize();

    return {
      renderer: renderer, scene: scene, cameras: cameras, orbit: orbit, projectorPivot: pivot, domElement: dom,
      views: VIEWS, shared: shared,
      sync: sync, setContentCanvas: setContentCanvas,
      setView: setView, getView: function () { return view; }, resetCamera: resetCamera,
      requestRender: requestRender, renderNow: renderNow, renderToCanvas: renderToCanvas,
      activeCamera: function () { return activeCamera(view); },
      depthTarget: function () { return depthRT; },
      resize: resize
    };
  }

  PS.Scene = { create: create, r2t: r2t, t2r: t2r, VIEWS: VIEWS };
})(window);
