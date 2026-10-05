/* Built-in projector profiles (PLAN.md §4.1). Exposes PS.Profiles and module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PS = root.PS || {}; root.PS.Profiles = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return [
    {
      id: 'epson-pl955wh', name: 'Epson PowerLite 955WH', nativeW: 1280, nativeH: 800, lumens: 3200,
      throwMin: 1.38, throwMax: 2.24, distMin: 0.97, distMax: 13.71, focalMm: [18.2, 29.2], fNumber: [1.51, 1.99],
      vOffset: 0.00, vOffsetStatus: 'provisional', hOffset: 0.00, hOffsetStatus: 'assumed',
      shiftV: [0, 0], shiftH: [0, 0], keystoneV: 30, keystoneH: 30,
      body: { w: 0.29, d: 0.27, h: 0.09, lensRight: 0.0, lensUp: 0.045 }, bodyStatus: 'assumed',
      source: 'Epson spec sheet (throw 1.38–2.24, 3200 lm, 1280×800, keystone ±30° V/H, 0.97–13.71 m). Offset not published.'
    }
  ];
});
