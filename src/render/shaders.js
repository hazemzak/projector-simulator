/* PS.Shaders: the receiver material (PLAN.md section 2.5). Every optical surface uses this one
 * ShaderMaterial; the projector uniforms are shared objects, the albedo and hatch flags are per material.
 * All positions in the shader are in the three.js frame T (see PS.Scene r2t). */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};
  var THREE = root.THREE;

  var NEAR = 0.02, FAR = 30, DEPTH_W = 2048;

  var vertex = [
    'varying vec3 vPos;',
    'varying vec3 vNrm;',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vPos = wp.xyz;',
    '  vNrm = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var fragment = [
    'uniform mat4 uProjViewProj;',
    'uniform vec3 uLens;',
    'uniform vec3 uAxis;',
    'uniform sampler2D uDepth;',
    'uniform vec2 uDepthTexel;',
    'uniform sampler2D uContent;',
    'uniform mat3 uHomography;',
    'uniform float uUseHomography;',
    'uniform float uLumens;',
    'uniform float uA1;',
    'uniform float uW1;',
    'uniform float uNear;',
    'uniform float uFar;',
    'uniform float uAmbient;',
    'uniform float uExposure;',
    'uniform float uFalseColour;',
    'uniform float uHatchOn;',
    'uniform float uGreyTop;',
    'uniform float uPhotoDepth;',
    'uniform vec3 uAlbedo;',
    'uniform vec3 uAlbedoUpper;',
    'uniform vec3 uHatchColour;',
    'uniform float uSplit;',
    'uniform float uHatchMode;',
    'varying vec3 vPos;',
    'varying vec3 vNrm;',
    '',
    'float linearDepth(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }',
    '',
    'vec3 srgb2lin(vec3 c) {',
    '  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));',
    '}',
    '',
    '// log ramp 50 -> 2000 lux over five stops: #2c1e8f #1f78b4 #33a02c #ffd92f #e31a1c',
    'vec3 rampColour(float lux) {',
    '  float t = clamp(log(lux / 50.0) / log(2000.0 / 50.0), 0.0, 1.0) * 4.0;',
    '  vec3 c0 = srgb2lin(vec3(0.1725, 0.1176, 0.5608));',
    '  vec3 c1 = srgb2lin(vec3(0.1216, 0.4706, 0.7059));',
    '  vec3 c2 = srgb2lin(vec3(0.2000, 0.6275, 0.1725));',
    '  vec3 c3 = srgb2lin(vec3(1.0000, 0.8510, 0.1843));',
    '  vec3 c4 = srgb2lin(vec3(0.8902, 0.1020, 0.1098));',
    '  if (t < 1.0) return mix(c0, c1, t);',
    '  if (t < 2.0) return mix(c1, c2, t - 1.0);',
    '  if (t < 3.0) return mix(c2, c3, t - 2.0);',
    '  return mix(c3, c4, t - 3.0);',
    '}',
    '',
    'void main() {',
    '  vec3 N = normalize(vNrm);',
    '  vec3 albedo = uAlbedo;',
    '  if (uSplit > 0.5 && vPos.y > uGreyTop) albedo = uAlbedoUpper;',
    '  if (uHatchOn > 0.5 && (uHatchMode > 1.5 || (uHatchMode > 0.5 && vPos.z > uPhotoDepth))) {',
    '    vec3 an = abs(N);',
    '    float a = vPos.x; float b = vPos.y;',
    '    if (an.y > 0.5) { a = vPos.x; b = vPos.z; }',
    '    else if (an.x > 0.5) { a = vPos.z; b = vPos.y; }',
    '    float stripe = step(0.5, fract((a + b) / (0.15 * 1.41421356)));',
    '    albedo = mix(albedo, mix(albedo * 0.7, uHatchColour, 0.25), stripe);',
    '  }',
    '  float hemi = 0.75 + 0.25 * N.y;',
    '  vec3 col = albedo * uAmbient * hemi;',
    '',
    '  vec4 pc = uProjViewProj * vec4(vPos, 1.0);',
    '  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;',
    '  vec2 cuv = puv;',
    '  if (uUseHomography > 0.5) { vec3 h = uHomography * vec3(puv, 1.0); cuv = h.xy / h.z; }',
    '  vec3 tex = texture2D(uContent, cuv).rgb;',
    '  float inC = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);',
    '',
    '  float E = 0.0;',
    '  if (pc.w > 0.0 && abs(pc.x) <= pc.w && abs(pc.y) <= pc.w) {',
    '    vec3 D = vPos - uLens;',
    '    float r = length(D);',
    '    vec3 dh = D / r;',
    '    float cosI = -dot(dh, N);',
    '    if (cosI > 0.0) {',
    '      float zf = dot(D, uAxis);',
    '      float tanI = sqrt(max(1.0 - cosI * cosI, 0.0)) / max(cosI, 0.05);',
    '      float bias = 0.004 + zf * (0.002 + 2.0 * (uW1 / 2048.0) * tanI);',
    '      float vis = 0.0;',
    '      for (int i = -1; i <= 1; i++) {',
    '        for (int j = -1; j <= 1; j++) {',
    '          float d = texture2D(uDepth, puv + vec2(float(i), float(j)) * uDepthTexel).r;',
    '          vis += (zf - bias <= linearDepth(d)) ? 1.0 : 0.0;',
    '        }',
    '      }',
    '      vis /= 9.0;',
    '      float cosA = dot(dh, uAxis);',
    '      E = (uLumens / uA1) * cosI / (r * r * cosA * cosA * cosA) * vis;',
    '    }',
    '  }',
    '',
    '  if (uFalseColour > 0.5 && E > 0.0) col = rampColour(E);',
    '  else col += albedo * tex * inC * E / uExposure;',
    '',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  // Uniform holders shared by every receiver material. The scene fills them in sync().
  function createUniforms() {
    return {
      uProjViewProj: { value: new THREE.Matrix4() },
      uLens: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, 0, 1) },
      uDepth: { value: null },
      uDepthTexel: { value: new THREE.Vector2(1 / DEPTH_W, 1 / DEPTH_W) },
      uContent: { value: null },
      uHomography: { value: new THREE.Matrix3() },
      uUseHomography: { value: 0 },
      uLumens: { value: 3200 },
      uA1: { value: 1 },
      uW1: { value: 1 },
      uNear: { value: NEAR },
      uFar: { value: FAR },
      uAmbient: { value: 0.35 },
      uExposure: { value: 800 },
      uFalseColour: { value: 0 },
      uHatchOn: { value: 1 },
      uGreyTop: { value: 2.55 },
      uPhotoDepth: { value: 3.9 }
    };
  }

  // opts: {albedo:'#rrggbb', albedoUpper:'#rrggbb', split:bool, hatchMode:0|1|2}
  // hatchMode 0 none, 1 hatch where room y > photoDepth, 2 hatch everywhere (provisional items).
  function createMaterial(shared, opts) {
    var own = {
      uAlbedo: { value: new THREE.Color(opts.albedo) },
      uAlbedoUpper: { value: new THREE.Color(opts.albedoUpper || opts.albedo) },
      uHatchColour: { value: new THREE.Color('#e0a050') },
      uSplit: { value: opts.split ? 1 : 0 },
      uHatchMode: { value: opts.hatchMode || 0 }
    };
    return new THREE.ShaderMaterial({
      uniforms: Object.assign({}, shared, own),
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.FrontSide
    });
  }

  PS.Shaders = {
    NEAR: NEAR, FAR: FAR, DEPTH_W: DEPTH_W,
    vertex: vertex, fragment: fragment,
    createUniforms: createUniforms, createMaterial: createMaterial
  };
})(window);
