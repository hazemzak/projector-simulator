/* URL-fragment state transport. CompressionStream is optional so file:// works without it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), globalThis);
  else { root.PS = root.PS || {}; root.PS.Share = factory(root.PS.Model, root); }
})(typeof self !== 'undefined' ? self : this, function (Model, root) {
  'use strict';
  function base64url(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return root.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unbase64(s) {
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid share link encoding.');
    var binary = root.atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });
  }
  function stream(bytes, ctor, format) {
    var input = new ctor(format), writer = input.writable.getWriter();
    var done = writer.write(bytes).then(function () { return writer.close(); });
    return Promise.all([done, new Response(input.readable).arrayBuffer()]).then(function (a) { return new Uint8Array(a[1]); });
  }
  function encode(state) {
    var errors = Model.validateState(state);
    if (errors.length) return Promise.reject(new Error(errors.join(' ')));
    var bytes = new TextEncoder().encode(Model.serializeProject(state, []));
    if (root.CompressionStream && root.DecompressionStream) return stream(bytes, root.CompressionStream, 'gzip').then(function (packed) { return 'g' + base64url(packed); });
    return Promise.resolve('u' + base64url(bytes));
  }
  function decode(value) {
    return Promise.resolve().then(function () {
      if (typeof value !== 'string' || !/^[gu][A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid share link.');
      var bytes = unbase64(value.slice(1));
      if (value[0] === 'g') {
        if (!root.DecompressionStream) throw new Error('This browser cannot open a compressed share link.');
        return stream(bytes, root.DecompressionStream, 'gzip');
      }
      return bytes;
    }).then(function (bytes) {
      return { ok: true, state: Model.parseProject(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).state };
    }).catch(function (e) { return { ok: false, error: e.message }; });
  }
  return { encode: encode, decode: decode };
});
