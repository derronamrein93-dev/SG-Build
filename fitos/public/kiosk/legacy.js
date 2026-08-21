/* =============================================================================
 * Stride Guide kiosk — legacy shims.
 *
 * Deliberately almost empty, and that is the finding rather than an oversight.
 *
 * The pilot device tops out at WebKit 12.1, which already has everything this
 * kiosk actually uses: fetch, Promise, JSON, classList, addEventListener,
 * dataset, textContent, Element.closest, and the whole ES5 library. kiosk.js is
 * written in ES5 syntax, so there is nothing to transpile either. Pulling in
 * core-js to cover a gap that does not exist would cost ~30 KB of parse time on
 * an A7 to solve nothing.
 *
 * What IS here is the short list of things a future edit is most likely to
 * reach for that WebKit 12.1 does not have. Each is guarded, so on any modern
 * browser this file defines nothing and costs one parse of ~700 bytes.
 *
 *   Object.hasOwn                Safari 15.4
 *   Array.prototype.at           Safari 15.4
 *   String.prototype.replaceAll  Safari 13.1
 *   Promise.allSettled           Safari 13
 *
 * If something is added to kiosk.js that needs more than this, the compat test
 * in src/lib/kiosk/compat.ts will say so before it reaches a device.
 * ========================================================================== */
(function () {
  'use strict';

  if (!Object.hasOwn) {
    Object.hasOwn = function (obj, key) {
      return obj !== null && obj !== undefined &&
             Object.prototype.hasOwnProperty.call(Object(obj), key);
    };
  }

  if (!Array.prototype.at) {
    Array.prototype.at = function (index) {
      var i = Math.trunc(index) || 0;
      if (i < 0) i += this.length;
      return (i < 0 || i >= this.length) ? undefined : this[i];
    };
  }

  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (search, replacement) {
      return this.split(search).join(replacement);
    };
  }

  if (!Promise.allSettled) {
    Promise.allSettled = function (promises) {
      return Promise.all(Array.prototype.map.call(promises, function (p) {
        return Promise.resolve(p).then(
          function (value) { return { status: 'fulfilled', value: value }; },
          function (reason) { return { status: 'rejected', reason: reason }; });
      }));
    };
  }
})();
