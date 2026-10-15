/* Stand-ins for the parts of Home Assistant's own frontend the Zoomy cards use, for the browser tests:
     window.loadCardHelpers()   createCardElement({type: 'map', ...}) "loads" the map: ha-map is defined a moment later
     ha-map                     Home Assistant 2026.10's map element: paths, fitBounds, updateComplete (no layers);
                                with ?oldmap=1 an older (Leaflet) one: layers, Leaflet, leafletMap
   The stand-in map draws its paths as a plain SVG (no tiles, nothing loaded), so screenshots show the route. */
(function () {
  'use strict';
  var oldMap = /oldmap/.test(location.search);
  window.__mapCards = [];
  window.__maps = [];

  function drawInto(el, lines, dots, box) {
    var w = el.clientWidth || 600, h = el.clientHeight || 400;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" style="position:absolute;inset:0;background:' +
            'repeating-linear-gradient(0deg,#1a2a33 0 1px,transparent 1px 48px),repeating-linear-gradient(90deg,#1a2a33 0 1px,transparent 1px 48px),#0f1a20">';
    if (box) {
      var a = box[0][0], b = box[0][1], c = box[1][0], d = box[1][1], pad = 30;
      var sx = (w - 2 * pad) / Math.max(1e-9, d - b), sy = (h - 2 * pad) / Math.max(1e-9, c - a), k = Math.min(sx, sy);
      var X = function (lon) { return pad + (lon - b) * k + ((w - 2 * pad) - (d - b) * k) / 2; };
      var Y = function (lat) { return h - pad - (lat - a) * k - ((h - 2 * pad) - (c - a) * k) / 2; };
      lines.forEach(function (ln) {
        s += '<polyline fill="none" stroke="' + ln.color + '" stroke-width="4" stroke-linejoin="round" points="' +
             ln.pts.map(function (p) { return X(p[1]).toFixed(1) + ',' + Y(p[0]).toFixed(1); }).join(' ') + '"/>';
      });
      dots.forEach(function (dt) { s += '<circle r="8" stroke="#0b1220" stroke-width="2" fill="' + dt.color + '" cx="' + X(dt.p[1]).toFixed(1) + '" cy="' + Y(dt.p[0]).toFixed(1) + '"/>'; });
    }
    el.innerHTML = s + '</svg>';
  }

  class FakeHaMap extends HTMLElement {
    static get elementProperties() {
      var m = new Map([['entities', {}], ['paths', {}], ['autoFit', {}], ['zoom', {}], ['themeMode', {}], ['fitZones', {}]]);
      if (oldMap) m.set('layers', {});
      return m;
    }
    constructor() {
      super();
      this._paths = []; this._layers = []; this.fits = []; this.pathSets = 0; this.updateComplete = Promise.resolve(true);
      window.__maps.push(this);
      if (oldMap) {
        var self = this;
        this.Leaflet = {
          polyline: function (pts, o) { return { kind: 'polyline', pts: pts, o: o }; },
          circleMarker: function (p, o) { var m = { kind: 'marker', p: p, o: o }; m.bindTooltip = function (label) { m.label = label; return m; }; return m; }
        };
        setTimeout(function () { self.leafletMap = { id: Math.random() }; }, 50);
      }
    }
    connectedCallback() { this.style.position = this.style.position || 'absolute'; this._draw(); }
    set paths(p) { this._paths = p || []; this.pathSets++; this._draw(); }
    get paths() { return this._paths; }
    set layers(l) { this._layers = l || []; this._draw(); }
    get layers() { return this._layers; }
    fitBounds(box, opts) { this.fits.push({ box: box, opts: opts }); this._box = box; this._draw(); }
    _draw() {
      var lines = [], dots = [];
      (this._paths || []).forEach(function (p) {
        var pts = (p.points || []).map(function (q) { return q.point; });
        if (pts.length > 1) lines.push({ color: p.color, pts: pts }); else if (pts.length) dots.push({ color: p.color, p: pts[0] });
      });
      (this._layers || []).forEach(function (l) {
        if (l.kind === 'polyline') lines.push({ color: l.o.color, pts: l.pts }); else if (l.kind === 'marker') dots.push({ color: l.o.fillColor, p: l.p });
      });
      drawInto(this, lines, dots, this._box || null);
    }
  }

  window.loadCardHelpers = function () {
    return Promise.resolve({
      createCardElement: function (cfg) {
        window.__mapCards.push(cfg);
        if (cfg && cfg.type === 'map') setTimeout(function () { if (!customElements.get('ha-map')) customElements.define('ha-map', FakeHaMap); }, 150);
        return document.createElement('div');
      }
    });
  };
})();
