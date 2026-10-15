'use strict';
/* The browser tests of the Zoomy cards: headless Chrome against a fake Home Assistant (www/fake-hass.js), served by
   serve.js on 127.0.0.1. Nothing talks to a real Home Assistant.

   Usage: node tests/frontend/run.js [cases] [layout] [compare] [shots]     (no argument: cases and layout)
     cases    every case of www/cases.js (functional: data, taps, live changes, several cars, privacy)
     layout   every card at seven widths: nothing sticks out sideways, no sideways page scroll
     compare  the new cards against the original HOME-styled pages, same made-up data, same steps: the same words,
              numbers and chart scales (needs ZOOMY_ORIGINALS = the folder that holds www-zoomy-charts.html,
              www-zoomy-dyno.html and www-zoomy-charge.html; skipped when it is not set)
     shots    screenshots of every card, desktop and phone, into tests/frontend/shots/ (not checked, for looking at)
   Chrome: CHROME=path, else the usual Windows / macOS / Linux place. Always headless, with a fresh profile in the
   system temp folder (never the user's own browser). Exit code: the number of failed checks. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const serve = require('./serve');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(serve.ROOT, 'custom_components', 'zoomy', 'manifest.json'), 'utf8'));
const V = MANIFEST.version;
const CANDIDATES = [process.env.CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const CHROME = CANDIDATES.filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];

let fails = 0, passes = 0;
function ok(c, msg) { if (c) passes++; else fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); }

/* One headless Chrome run. Waits for Chrome's own process to exit, not for its pipes to close: helper processes
   Chrome starts (crash reporter, updater) can keep them open for minutes. */
function chrome(args, ms) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'zoomy-test-chrome-'));
  return new Promise(function (resolve) {
    const child = cp.spawn(CHROME, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--mute-audio', '--user-data-dir=' + prof].concat(args), { windowsHide: true });
    let stdout = '', stderr = '', over = false;
    child.stdout.on('data', function (d) { stdout += d; });
    child.stderr.on('data', function (d) { stderr += d; });
    const end = function (code) {
      if (over) return;
      over = true; clearTimeout(timer);
      setTimeout(function () {
        try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold a file for a moment */ }
        resolve({ stdout: stdout, stderr: stderr, status: code });
      }, 300);
    };
    const timer = setTimeout(function () { stderr += '\n(killed after ' + (ms || 900000) + ' ms)'; try { child.kill(); } catch (e) { /* gone */ } end(null); }, ms || 900000);
    child.on('exit', end);
    child.on('error', function (e) { stderr += String(e); end(null); });
  });
}
async function dump(url, budget, size) {
  const r = await chrome(['--window-size=' + (size || '1400,1000'), '--virtual-time-budget=' + budget, '--dump-dom', url]);
  const m = /<pre id="out">([^<]*)<\/pre>/.exec(r.stdout || '');
  if (!m || m[1] === 'running') { console.log('Chrome gave no result for ' + url + ': ' + String(r.stderr || r.error || '').slice(0, 600)); return null; }
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}

function caseNames() {
  const src = fs.readFileSync(path.join(__dirname, 'www', 'cases.js'), 'utf8');
  const out = [], re = /^CASES\.([a-z0-9_]+) = /gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  // ZOOMY_CASES=a,b runs only those cases
  const only = (process.env.ZOOMY_CASES || '').split(',').filter(Boolean);
  return only.length ? out.filter(function (n) { return only.indexOf(n) >= 0; }) : out;
}

async function groupCases(base) {
  const names = caseNames();
  const t0 = Date.now();
  const res = await dump(base + '/t/runner.html?v=' + V + '&cases=' + names.join(','), 3000000);
  console.log('(' + names.length + ' cases, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s in Chrome)');
  if (!res) { fails++; return; }
  res.jobs.forEach(function (j) {
    console.log('\n== case ' + j.name);
    if (!j.done || !j.result) { ok(false, j.name + ': did not finish'); return; }
    j.result.results.forEach(function (r) { ok(r[0], r[1]); });
    ok(!j.result.errors.length, 'no error in the page' + (j.result.errors.length ? ': ' + j.result.errors.join(' / ') : ''));
    ok(!j.result.logs.length, 'nothing logged' + (j.result.logs.length ? ': ' + j.result.logs.slice(0, 3).join(' / ') : ''));
  });
}

async function groupLayout(base) {
  const res = await dump(base + '/t/layout.html?v=' + V, 600000);
  if (!res) { fails++; return; }
  console.log('\n== layout');
  res.rows.forEach(function (r) {
    ok(!r.sideways && !r.outside.length, r.card + ' at ' + r.w + ' px: no sideways scroll, nothing sticking out' +
       (r.sideways || r.outside.length ? ' (page ' + r.scrollWidth + ' wide; ' + r.outside.join(', ') + ')' : ''));
  });
  res.notes.forEach(function (n) { ok(false, n); });
}

async function groupCompare(base) {
  if (!process.env.ZOOMY_ORIGINALS) { console.log('\n== compare: skipped (ZOOMY_ORIGINALS is not set)'); return; }
  const t0 = Date.now();
  const res = await dump(base + '/t/compare.html?v=' + V, 1500000, '1400,1000');
  console.log('(compare: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s in Chrome)');
  if (!res) { fails++; return; }
  res.jobs.forEach(function (j) {
    console.log('\n== compare ' + j.id);
    if (!j.old || !j.neu) { ok(false, j.id + ': did not finish (' + (j.why || '') + ')'); return; }
    ok(j.old.snaps.length === j.neu.snaps.length && j.old.snaps.length > 0, 'same steps run on both (' + j.neu.snaps.length + ' snapshots)');
    j.old.snaps.forEach(function (so, i) {
      const sn = j.neu.snaps[i];
      if (!sn) return;
      ['shown', 'titles', 'pressed'].forEach(function (k) {
        ok(so[k] === sn[k], so.label + ': same ' + k + (so[k] === sn[k] ? ' (' + so[k].length + ' chars)' : ' ' + firstDiff(so[k], sn[k])));
      });
      if (so.sizes === sn.sizes) ok(so.svg === sn.svg, so.label + ': charts the same size (' + (sn.sizes || 'none') + ') and the same words in them' + (so.svg === sn.svg ? '' : ' ' + firstDiff(so.svg, sn.svg)));
      else ok(false, so.label + ': chart sizes differ: old ' + so.sizes + ' / new ' + sn.sizes);
    });
    ok(!j.old.errors.length && !j.neu.errors.length, 'no step failed' + (j.old.errors.concat(j.neu.errors).length ? ': ' + j.old.errors.concat(j.neu.errors).join(' / ') : ''));
  });
}
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return 'at ' + i + ': old ' + JSON.stringify(a.slice(Math.max(0, i - 50), i + 70)) + ' / new ' + JSON.stringify(b.slice(Math.max(0, i - 50), i + 70));
}

async function groupShots(base) {
  const dir = path.join(__dirname, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const cards = ['summary', 'trips', 'charges', 'map', 'performance', 'charge-sheet'];
  const sizes = [['desktop', 1400, 900], ['phone', 390, 844]];
  for (const c of cards) {
    for (const s of sizes) {
      const file = path.join(dir, c + '-' + s[0] + '.png');
      try { fs.unlinkSync(file); } catch (e) { /* not there yet */ }
      const cars = c === 'trips' && s[0] === 'desktop' ? 2 : 1;
      const r = await chrome(['--window-size=' + s[1] + ',' + s[2], '--virtual-time-budget=20000', '--screenshot=' + file,
                              base + '/t/shot.html?v=' + V + '&card=' + c + '&cars=' + cars + '&w=' + s[1] + '&h=' + s[2]], 120000);
      ok(fs.existsSync(file), 'screenshot ' + path.relative(serve.ROOT, file) + (fs.existsSync(file) ? '' : ': ' + String(r.stderr).slice(0, 200)));
    }
  }
}

(async function main() {
  if (!CHROME) { console.log('No Chrome found: set CHROME to its path.'); process.exit(1); }
  const want = process.argv.slice(2);
  const groups = want.length ? want : ['cases', 'layout'];
  const s = await serve.start(0);
  const base = 'http://127.0.0.1:' + s.port;
  console.log('Zoomy frontend ' + V + ', Chrome ' + CHROME + ', test server ' + base);
  try {
    for (const g of groups) {
      if (g === 'cases') await groupCases(base);
      else if (g === 'layout') await groupLayout(base);
      else if (g === 'compare') await groupCompare(base);
      else if (g === 'shots') await groupShots(base);
      else { console.log('unknown group ' + g); fails++; }
    }
  } finally {
    await s.close();
  }
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
