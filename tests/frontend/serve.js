'use strict';
/* A tiny static server for the browser tests (127.0.0.1 only, test use only):
     /zoomy_static/<any version>/<file>   custom_components/zoomy/frontend/<file>   (as Home Assistant serves it)
     /t/<file>                             tests/frontend/www/<file>
     /old/<page>                           the original HOME-styled pages, for the compare group only, from the folder
                                           named by the ZOOMY_ORIGINALS environment variable (nothing when it is unset)
   start(port) -> Promise<{port, close}> */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.join(ROOT, 'custom_components', 'zoomy', 'frontend');
const WWW = path.join(__dirname, 'www');
const OLD = {
  'charts.html': 'www-zoomy-charts.html',
  'dyno.html': 'www-zoomy-dyno.html',
  'charge.html': 'www-zoomy-charge.html'
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function inside(file, folder) {
  const rel = path.relative(folder, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function start(port) {
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = null;
    let m = /^\/zoomy_static\/[^/]+\/(.+)$/.exec(url.pathname);
    if (m) file = path.join(FRONTEND, decodeURIComponent(m[1]));
    else if ((m = /^\/t\/(.+)$/.exec(url.pathname))) file = path.join(WWW, decodeURIComponent(m[1]));
    else if ((m = /^\/old\/(.+)$/.exec(url.pathname)) && process.env.ZOOMY_ORIGINALS && OLD[m[1]]) file = path.join(process.env.ZOOMY_ORIGINALS, OLD[m[1]]);
    const ok = file && (inside(file, FRONTEND) || inside(file, WWW) || (process.env.ZOOMY_ORIGINALS && inside(file, process.env.ZOOMY_ORIGINALS)));
    if (!ok || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(port || 0, '127.0.0.1', function () {
      resolve({ port: server.address().port, close: function () { return new Promise(function (r) { server.close(r); }); } });
    });
  });
}

module.exports = { start: start, ROOT: ROOT, FRONTEND: FRONTEND };

if (require.main === module) {
  start(Number(process.argv[2]) || 8765).then(function (s) { console.log('serving on http://127.0.0.1:' + s.port + '/t/'); });
}
