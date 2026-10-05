/* PS.TestCard: canvas content for the projector (PLAN.md section 6.3). No image files, so WebGL never
 * treats a texture as cross-origin under file://. */
(function (root) {
  'use strict';
  var PS = root.PS = root.PS || {};

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // The test card at the native resolution of the profile.
  function draw(profile) {
    var W = profile.nativeW, H = profile.nativeH;
    var c = makeCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, W, H);

    g.fillStyle = '#000000';
    var i, x, y;
    for (i = 1; i < 16; i++) { x = Math.round(i * W / 16); g.fillRect(x - 1, 0, 2, H); }
    for (i = 1; i < 10; i++) { y = Math.round(i * H / 10); g.fillRect(0, y - 1, W, 2); }

    // centre cross and circle
    g.fillRect(W / 2 - 40, H / 2 - 2, 80, 4);
    g.fillRect(W / 2 - 2, H / 2 - 40, 4, 80);
    g.strokeStyle = '#000000';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(W / 2, H / 2, 0.45 * H, 0, Math.PI * 2);
    g.stroke();

    // 12 px borders: top red, bottom blue, left green, right yellow
    var B = 12;
    g.fillStyle = '#e53935'; g.fillRect(0, 0, W, B);
    g.fillStyle = '#1e88e5'; g.fillRect(0, H - B, W, B);
    g.fillStyle = '#43a047'; g.fillRect(0, B, B, H - 2 * B);
    g.fillStyle = '#fdd835'; g.fillRect(W - B, B, B, H - 2 * B);

    // labels
    g.fillStyle = '#101010';
    g.font = 'bold 40px "Segoe UI", Arial, sans-serif';
    g.textBaseline = 'top';
    var m = B + 8;
    g.textAlign = 'center'; g.fillText('TOP', W / 2, m);
    g.textAlign = 'left'; g.fillText('TL', m, m + 44);
    g.textAlign = 'right'; g.fillText('TR', W - m, m + 44);
    g.textBaseline = 'bottom';
    g.textAlign = 'left'; g.fillText('BL', m, H - m);
    g.textAlign = 'right'; g.fillText('BR', W - m, H - m);

    // centre text on a light plate so the grid does not cut through it
    var label = profile.name + ' · ' + W + '×' + H;
    g.font = 'bold 34px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var tw = g.measureText(label).width;
    g.fillStyle = '#c8c8c8';
    g.fillRect(W / 2 - tw / 2 - 12, H / 2 + 60, tw + 24, 48);
    g.fillStyle = '#101010';
    g.fillText(label, W / 2, H / 2 + 84);
    return c;
  }

  // A user image letterboxed into a W x H panel, with black bars.
  function letterbox(img, W, H) {
    var c = makeCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    var iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
    if (iw > 0 && ih > 0) {
      var k = Math.min(W / iw, H / ih), w = iw * k, h = ih * k;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    }
    return c;
  }

  PS.TestCard = { draw: draw, letterbox: letterbox };
})(window);
