// tests/browser.mjs
// Copyright (C) 2026 Stefano Natangelo
// SPDX-License-Identifier: AGPL-3.0-only
//
// Mobile Dashboard browser tests. Drives headless Chrome (or Edge) through
// the DevTools Protocol, with no libraries.
//
//   node browser.mjs <group> <results folder>
//   groups: phone | desktop
//
// Variables: MD_BASE (http://localhost:8080), MD_SID (the administrator's
// OJSESSION cookie, set by run.sh), MD_JOURNAL (jse),
// MD_WORKFLOW (69/3: a submission in review), MD_WORKFLOW2 (12/4: a
// submission in production), MD_CHROME (path to the browser).
// Prints "  ok    ..." or "  FAILED ..." for each check; exits with 1 if
// anything fails.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [mode, out] = process.argv.slice(2);
const B = process.env.MD_BASE || 'http://localhost:8080';
const J = process.env.MD_JOURNAL || 'jse';
const WF = process.env.MD_WORKFLOW || '69/3';
const WF2 = process.env.MD_WORKFLOW2 || '12/4';
const SID = process.env.MD_SID;
const BLOCK = ['*mobileDashboard*'];
const chrome = process.env.MD_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => existsSync(p));
if (!SID || !chrome || !mode || !out) { console.log('  FAILED browser start — missing SID, Chrome or an argument'); process.exit(1); }
mkdirSync(out, { recursive: true });

let pass = 0, fail = 0;
const ok = n => { pass++; console.log('  ok    ' + n); };
const ko = (n, d) => { fail++; console.log('  FAILED ' + n + (d ? ' — ' + d : '')); };
const check = (n, cond, d) => (cond ? ok(n) : ko(n, typeof d === 'string' ? d : JSON.stringify(d)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- Chrome
const profile = mkdtempSync(join(tmpdir(), 'mdtests-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--hide-scrollbars',
  '--no-first-run', `--user-data-dir=${profile}`, '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 75 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++seq; pending.set(i, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr, arg) => {
  const src = typeof expr === 'function' ? `(${expr})(${JSON.stringify(arg ?? null)})` : expr;
  const r = await send('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result?.value;
};
const errors = [];
// Network requests in flight: some pages load their lists later, through
// the API, and the checks must wait until they have finished
const inflight = new Set(); let netLast = Date.now();
await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails; const url = d.url || d.stackTrace?.callFrames?.[0]?.url || '';
    if (/mobileDashboard/.test(url)) errors.push((d.exception?.description || d.text).split('\n')[0]);
  } else if (m.method === 'Network.requestWillBeSent' && !/^(data|blob):/.test(m.params.request.url)) {
    inflight.add(m.params.requestId); netLast = Date.now();
  } else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
    if (inflight.delete(m.params.requestId)) netLast = Date.now();
  }
});
// Waits until the network has been idle for at least `quiet` ms (at most `max` ms)
async function netIdle(quiet = 1000, max = 10000) {
  const end = Date.now() + max;
  while (Date.now() < end && (inflight.size || Date.now() - netLast < quiet)) await sleep(100);
}
await send('Network.setCookie', { name: 'OJSESSION', value: SID, domain: new URL(B).hostname, path: '/', httpOnly: true });
await send('Network.setCookie', { name: 'currentLocale', value: 'en', domain: new URL(B).hostname, path: '/' });
async function size(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await send('Emulation.setUserAgentOverride', { userAgent: mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
}
async function go(url, settle = 7000) {
  inflight.clear();
  await send('Page.navigate', { url: url.startsWith('http') ? url : B + url });
  for (let i = 0; i < 120; i++) { await sleep(150); if (await ev('document.readyState') === 'complete') break; }
  await sleep(settle);
  await netIdle();
  await ev(() => { document.querySelectorAll('.app__notifications, .tox-statusbar__text-container').forEach(e => e.remove()); return 1; });
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(out, name + '.png'); writeFileSync(f, Buffer.from(r.data, 'base64')); return f;
}
const clickText = text => ev(t => {
  const els = [...document.querySelectorAll('button,a,[role=button],[role=tab]')]
    .filter(b => b.offsetParent !== null && b.textContent.trim().replace(/\s+/g, ' ') === t);
  const b = els[els.length - 1]; if (!b) return 'not found'; b.click(); return 'ok';
}, text);
const loggedIn = () => ev(() => !!document.querySelector('.app__main, .pkp_structure_main') && !document.querySelector('form#login, .page_login'));

// Common phone checks
// doc: page width; box: furthest right edge of the main boxes
// (.app clips what overflows, so doc alone is not enough)
const overflow = () => ev(() => {
  const els = [...document.querySelectorAll('.app, .app > *, .app__body, .app__body > *, .app__body > * > *')]
    .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  let box = 0, which = '';
  for (const e of els) { const r = e.getBoundingClientRect(); if (r.right > box) { box = Math.round(r.right); which = e.className || e.tagName; } }
  return { doc: document.documentElement.scrollWidth, box, which: String(which).slice(0, 60), vw: innerWidth };
});
async function phoneBasics(name) {
  const o = await overflow();
  check(`${name}: no sideways scrolling (${o.doc}/${o.vw} px)`, o.doc <= o.vw + 1, o);
  check(`${name}: content inside the screen (${o.box}/${o.vw} px)`, o.box <= o.vw + 1, o);
  check(`${name}: plugin files loaded`, await ev(() => [...document.querySelectorAll('link[href*="mobileDashboard/styles/mobile.css"]')].length > 0
    && [...document.scripts].some(s => s.src.includes('mobileDashboard/styles/mobile.js'))));
}
async function pluginRows(name) {
  const r = await ev(async () => {
    for (let i = 0; i < 30 && !document.querySelector('.pkp_controllers_grid tr.gridRow input[type="checkbox"]'); i++) await new Promise(r => setTimeout(r, 500));
    const rows = [...document.querySelectorAll('.pkp_controllers_grid tr.gridRow')]
      .filter(r => r.offsetParent !== null && r.querySelector('td input[type="checkbox"]')).slice(0, 6);
    return rows.map(r => {
      const cells = [...r.cells].filter(c => c.offsetParent !== null);
      const cb = r.querySelector('td input[type="checkbox"]').closest('td').getBoundingClientRect();
      const nameCell = cells.find(c => !c.querySelector('input[type="checkbox"]') && c.textContent.trim());
      const n = nameCell.getBoundingClientRect();
      const desc = cells.filter(c => c !== nameCell && c.textContent.trim().length > 25).map(c => c.getBoundingClientRect().width)[0] || 0;
      return { name: nameCell.textContent.trim().slice(0, 30), nameW: Math.round(n.width), sameLine: Math.abs(n.top - cb.top) < 24,
        desc: Math.round(desc), row: Math.round(r.getBoundingClientRect().width) };
    });
  });
  check(`${name}: there are plugin rows`, Array.isArray(r) && r.length >= 3, r);
  if (!Array.isArray(r)) return;
  const bad = r.filter(x => x.nameW < 150 || !x.sameLine || (x.desc && x.desc < x.row * 0.8));
  check(`${name}: wide name, checkbox on the same row, full-width description`, bad.length === 0, bad);
}

try {
  if (mode === 'phone') {
    await size(390, 844, true);

    // Dashboard and menu
    await go(`/${J}/submissions`, 8000);
    check('signed in as administrator', await loggedIn());
    await phoneBasics('dashboard'); await shot('01-dashboard');
    const nav = await ev(async () => {
      const t = document.getElementById('mdNavToggle'); if (!t || t.offsetParent === null) return '☰ button missing';
      t.click(); await new Promise(r => setTimeout(r, 900));
      const open = document.documentElement.classList.contains('md-nav-open') || document.body.classList.contains('md-nav-open');
      const panel = document.getElementById(t.getAttribute('aria-controls')) || document.querySelector('.app__nav');
      const p = panel.getBoundingClientRect();
      const sc = [panel, ...panel.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) || panel;
      sc.scrollTop = sc.scrollHeight; await new Promise(r => setTimeout(r, 400));
      const links = [...panel.querySelectorAll('a,button')].filter(a => a.offsetParent !== null);
      const last = links[links.length - 1].getBoundingClientRect();
      return { open, expanded: t.getAttribute('aria-expanded'), inside: p.left >= -1 && p.right <= innerWidth + 1,
        lastVisible: last.bottom <= innerHeight + 1 && last.top >= 0, lastText: links[links.length - 1].textContent.trim().slice(0, 30) };
    });
    check('☰ menu: opens inside the screen', nav && nav.open && nav.expanded === 'true' && nav.inside, nav);
    check(`☰ menu: the last item can be reached ("${nav?.lastText}")`, nav && nav.lastVisible, nav);
    await shot('02-menu');
    const closed = await ev(async () => {
      document.getElementById('mdNavBackdrop')?.click(); await new Promise(r => setTimeout(r, 700));
      return !document.documentElement.classList.contains('md-nav-open') && !document.body.classList.contains('md-nav-open');
    });
    check('☰ menu: closes when tapping outside', closed);
    // With the ☰ menu open, a tap on the journal switcher (the first header
    // control after ☰) opens its menu and closes ☰
    const sw = await ev(async () => {
      document.getElementById('mdNavToggle').click(); await new Promise(r => setTimeout(r, 700));
      const t = document.getElementById('mdNavToggle').getBoundingClientRect();
      const c = [...document.querySelectorAll('.app__header a, .app__header button')]
        .filter(e => e.id !== 'mdNavToggle' && e.getClientRects().length && e.getBoundingClientRect().left > t.right - 1)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
      if (!c) return 'journal switcher missing';
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), open: document.body.classList.contains('md-nav-open') };
    });
    if (sw?.x) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sw.x, y: sw.y, id: 1 }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(900);
    }
    const sw2 = await ev(() => ({ navOpen: document.body.classList.contains('md-nav-open'),
      expanded: [...document.querySelectorAll('.app__header [aria-expanded="true"]')].filter(e => e.id !== 'mdNavToggle').length }));
    check(`☰ menu: tapping the journal switcher closes ☰ and opens the journal menu`, sw?.open && !sw2.navOpen && sw2.expanded > 0, { sw, sw2 });
    await shot('02b-journal-switcher');
    await ev(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.click(); return 1; });
    await go(`/${J}/submissions`, 8000);

    // Workflow and stage menu
    await go(`/${J}/workflow/index/${WF}`, 8000);
    await phoneBasics('workflow'); await shot('03-workflow');
    const st = await ev(async () => {
      const t = document.querySelector('.mdStagesToggle'); if (!t) return 'stage bar missing';
      const before = t.getAttribute('aria-expanded'); t.click(); await new Promise(r => setTimeout(r, 700));
      const after = t.getAttribute('aria-expanded');
      const box = document.getElementById(t.getAttribute('aria-controls'));
      const items = box ? [...box.querySelectorAll('a,button')].filter(a => a.offsetParent !== null && a !== t).length : 0;
      return { before, after, items };
    });
    check('stages: closed bar that opens with a tap', st && st.before === 'false' && st.after === 'true' && st.items >= 3, st);
    await shot('04-stages');
    const pick = await ev(async () => {
      const t = document.querySelector('.mdStagesToggle'); const box = document.getElementById(t.getAttribute('aria-controls'));
      const item = [...box.querySelectorAll('a,button')].find(a => a.offsetParent !== null && a !== t && /Submission/.test(a.textContent));
      if (!item) return 'Submission item missing'; item.click(); await new Promise(r => setTimeout(r, 3500));
      return t.getAttribute('aria-expanded');
    });
    check('stages: choosing an item closes the bar again', pick === 'false', pick);
    const labels = await ev(() => ({ cells: document.querySelectorAll('td[data-md-label]').length,
      tables: document.querySelectorAll('.DialogContent table').length }));
    check('workflow tables: cells with labels', labels.tables > 0 && labels.cells > 0, labels);
    await phoneBasics('workflow, Submission stage');

    await go(`/${J}/workflow/index/${WF2}`, 8000);
    await phoneBasics('workflow of a submission in production');

    // Journal plugins and Plugin Gallery
    await go(`/${J}/management/settings/website#plugins`, 9000);
    await phoneBasics('journal plugins');
    await pluginRows('journal plugins');
    await ev(() => { document.querySelector('.pkp_controllers_grid tr.gridRow')?.scrollIntoView(); scrollBy(0, -80); return 1; });
    await shot('05-plugins');
    check('Plugin Gallery: tab found', (await clickText('Plugin Gallery')) === 'ok');
    // The list comes from the PKP site through the server, sometimes a few
    // seconds late: wait for the network and then for the rows
    await sleep(6000); await netIdle(1000, 20000);
    await ev(async () => {
      const shown = () => [...document.querySelectorAll('.pkp_controllers_grid tr.gridRow')].filter(r => r.offsetParent !== null).length;
      for (let i = 0; i < 20 && shown() < 3; i++) await new Promise(r => setTimeout(r, 500));
      return 1;
    });
    await phoneBasics('Plugin Gallery');
    const gal = await ev(() => {
      const rows = [...document.querySelectorAll('.pkp_controllers_grid tr.gridRow')].filter(r => r.offsetParent !== null).slice(0, 5);
      return rows.map(r => Math.round([...r.cells].filter(c => c.offsetParent !== null)[0].getBoundingClientRect().width));
    });
    check('Plugin Gallery: wide plugin names (not one letter per line)', gal.length >= 3 && gal.every(w => w >= 150), gal);
    await shot('06-gallery');

    // Users & Roles
    await go(`/${J}/management/settings/access`, 9000);
    await phoneBasics('Users & Roles');
    const u = await ev(async () => {
      let t; // the user table arrives after the page
      for (let i = 0; i < 30 && !(t = document.querySelector('.app__main table.md-named')); i++) await new Promise(r => setTimeout(r, 500));
      if (!t) return 'table without the md-named class';
      const first = t.tBodies[0].rows[0].cells[0];
      return { bold: +getComputedStyle(first.querySelector('span') || first).fontWeight, w: Math.round(first.getBoundingClientRect().width) };
    });
    check('Users & Roles: name in bold across the whole row', u && u.bold >= 600 && u.w >= 200, u);
    await ev(() => { document.querySelector('.app__main table.border-separate')?.scrollIntoView(); scrollBy(0, -70); return 1; });
    await shot('07-users');

    // Settings: nested margins
    for (const [p, n] of [['distribution', 'Distribution'], ['workflow', 'Workflow Settings'], ['context', 'Journal Settings']]) {
      await go(`/${J}/management/settings/${p}`, 8000);
      await phoneBasics(n);
      const g = await ev(() => {
        const f = [...document.querySelectorAll('.pkpFormGroup')].find(e => e.offsetParent !== null);
        return f ? Math.round(f.getBoundingClientRect().width) : 0;
      });
      check(`${n}: fields use almost the full width (${g}/390 px)`, g >= 330, g);
      if (p === 'distribution') await shot('08-settings');
    }

    // Tabs: one row that scrolls sideways, pinned below the header, with the
    // active tab joined to the panel; a swipe on the panel (real touches,
    // not clicks) opens the next tab, inner ones first
    const tabBars = () => ev(() => [...document.querySelectorAll('.app__main .pkpTabs__buttons, .app__main .ui-tabs-nav')].filter(b => b.getClientRects().length).map(b => {
      const tabs = [...b.children].filter(c => c.getAttribute('role') === 'tab' && c.getClientRects().length);
      const act = tabs.find(c => c.getAttribute('aria-selected') === 'true');
      const panel = act && document.getElementById(act.getAttribute('aria-controls'));
      const cs = getComputedStyle(b);
      return {
        active: act ? act.textContent.replace(/\s+/g, ' ').trim() : null,
        rows: new Set(tabs.map(c => Math.round(c.getBoundingClientRect().top))).size,
        scrolls: b.scrollWidth > b.clientWidth,
        sticky: cs.position === 'sticky' ? cs.top : 'no',
        top: Math.round(b.getBoundingClientRect().top),
        box: Math.round(b.parentElement.getBoundingClientRect().top),
        joined: !!panel && Math.round(act.getBoundingClientRect().bottom) === Math.round(panel.getBoundingClientRect().top),
        white: !!act && getComputedStyle(act).backgroundColor === 'rgb(255, 255, 255)',
      };
    }));
    const tabNames = b => (Array.isArray(b) ? b.map(x => x.active).join(' > ') : String(b));
    // a point in the innermost panel away from fields and links (inside: within
    // that box, for example a grid)
    const freeSpot = (x, minY = 0, inside = null) => ev(([x, minY, inside]) => {
      const bars = [...document.querySelectorAll('.app__main .pkpTabs__buttons, .app__main .ui-tabs-nav')].filter(b => b.getClientRects().length);
      const act = bars.length && [...bars[bars.length - 1].children].find(c => c.getAttribute('aria-selected') === 'true');
      const panel = act && document.getElementById(act.getAttribute('aria-controls'));
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      for (const xx of [x, x + 30, x - 30]) for (let y = Math.max(r.top + 30, 160, minY); y < Math.min(r.bottom - 10, innerHeight - 20); y += 12) {
        const el = document.elementFromPoint(xx, y);
        if (el && el.closest('[role=tabpanel]') === panel && !el.closest('input, textarea, select, a, button, .tox, iframe' + (inside ? '' : ', table'))
          && (!inside || el.closest(inside))) return { x: xx, y: Math.round(y) };
      }
      return null;
    }, [x, minY, inside]);
    const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    async function drag(x0, y0, x1, y1, steps = 10) {
      await touch('touchStart', x0, y0);
      for (let i = 1; i <= steps; i++) { await sleep(16); await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); }
      await touch('touchEnd');
      await sleep(900);
      return tabBars();
    }
    async function swipe(dir, inside) {
      const p = await freeSpot(dir < 0 ? 320 : 70, 0, inside);
      return p ? drag(p.x, p.y, dir < 0 ? 70 : 330, p.y + 6) : 'no free point in the panel';
    }
    await go(`/${J}/management/settings/distribution`, 8000);
    let tb = await tabBars();
    check('tabs: a single row that scrolls sideways', Array.isArray(tb) && tb.length === 1 && tb[0].rows === 1 && tb[0].scrolls, tb);
    check('tabs: row pinned below the header', tb[0]?.sticky === '48px', tb);
    check('tabs: the active tab is white and joined to the panel', tb[0]?.joined && tb[0]?.white, tb);
    await shot('11-tabs');
    tb = await swipe(-1);
    check(`tabs: swipe left, next tab (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Setup', tb);
    tb = await swipe(-1);
    check(`nested tabs: the swipe changes the inner one first (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Registration', tb);
    tb = await swipe(-1);
    check(`nested tabs: after the last inner one it changes the outer one (${tabNames(tb)})`, tabNames(tb) === 'Search Indexing', tb);
    for (let i = 0; i < 3; i++) tb = await swipe(1);
    check(`tabs: swipe right back to the first (${tabNames(tb)})`, tabNames(tb) === 'License', tb);
    tb = await swipe(1);
    check('tabs: on the first, a swipe right does not change tab', tabNames(tb) === 'License', tb);
    // a slightly diagonal swipe (40° from horizontal), which the browser leaves
    // to the page because it is more sideways than vertical, also changes tab
    const slant = await freeSpot(300, 330);
    tb = slant ? await drag(slant.x, slant.y, slant.x - 100, slant.y - 85, 12) : 'no free point in the panel';
    check(`tabs: slightly diagonal swipe, next tab (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Setup', tb);
    tb = await swipe(1);
    // Tab indicators: on the phone the last tapped tab stays in :hover and OJS
    // focuses the open tab even after a tap or a swipe; the coloured line
    // belongs only on the open tab and the focus ring only with the keyboard
    const marks = () => ev(() => Object.fromEntries([...document.querySelectorAll('.app__main .pkpTabs__button, .app__main .ui-tabs-nav > li')]
      .filter(t => t.getClientRects().length).map(t => {
        const a = t.matches('li') ? t.querySelector('a') : t;
        const after = getComputedStyle(a, '::after').content;
        return [t.textContent.replace(/\s+/g, ' ').trim(), {
          open: t.getAttribute('aria-selected') === 'true', hover: t.matches(':hover'), focus: t.matches(':focus') || a.matches(':focus'),
          line: getComputedStyle(a, '::before').backgroundColor !== 'rgba(0, 0, 0, 0)', dot: after !== 'none' && after !== 'normal',
        }];
      })));
    async function tap(name) {
      const p = await ev(n => {
        const t = [...document.querySelectorAll('.app__main [role=tab]')].find(e => e.getClientRects().length && e.textContent.replace(/\s+/g, ' ').trim() === n);
        const r = t && t.getBoundingClientRect();
        return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
      }, name);
      if (p) { await touch('touchStart', p.x, p.y); await sleep(60); await touch('touchEnd'); await sleep(1500); }
    }
    async function key(k, code) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
      await sleep(1500);
    }
    await tap('DOIs');
    let mk = await marks();
    check('tabs: tapping a tab opens it, with no focus ring under the name', mk.DOIs?.open && mk.DOIs.focus && !mk.DOIs.dot, mk.DOIs);
    tb = await swipe(1);
    mk = await marks();
    check(`tabs: after a tap and a swipe the coloured line is only on the open tab (${tabNames(tb)})`,
      tabNames(tb) === 'License' && mk.DOIs?.hover && Object.values(mk).every(m => m.line === m.open), mk);
    check('tabs: no focus ring on the tab opened with a swipe', mk.License?.focus && !mk.License.dot, mk.License);
    await key('ArrowRight', 39);
    mk = await marks();
    check(`tabs: with the keyboard (right arrow) the focus ring is shown (${tabNames(await tabBars())})`, mk.DOIs?.open && mk.DOIs.focus && mk.DOIs.dot && mk.DOIs.line, mk.DOIs);
    tb = await swipe(1);
    mk = await marks();
    check(`tabs: after the keyboard, a swipe removes the focus ring again (${tabNames(tb)})`, tabNames(tb) === 'License' && mk.License?.focus && !mk.License.dot, mk.License);
    const low = await freeSpot(200, 600);
    const y0 = await ev('scrollY');
    tb = low ? await drag(low.x, low.y, low.x + 12, low.y - 400, 12) : 'no free point lower down';
    const y1 = await ev('scrollY');
    check(`tabs: dragging vertically scrolls the page (${Math.round(y1 - y0)} px) and the tab stays`, y1 - y0 > 100 && tabNames(tb) === 'License', { y0, y1, tb });
    await ev(() => { scrollTo(0, 1400); return 1; });
    await sleep(500);
    tb = await tabBars();
    check('tabs: when the page scrolls the row stays below the header', tb[0]?.top === 48 && tb[0]?.box < 48, tb);
    tb = await swipe(-1);
    check(`tabs: swipe with the row pinned, the new panel is shown from its start (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Setup' && tb[0]?.box === 48, tb);
    await shot('12-pinned-tabs');
    // Profile (old forms): half- or three-quarter-width fields become as wide
    // as the form, one per row
    const formFields = () => ev(async () => {
      let form;
      for (let i = 0; i < 20; i++) {
        const panel = [...document.querySelectorAll('.ui-tabs-panel')].find(p => p.getClientRects().length && p.getAttribute('aria-hidden') !== 'true');
        form = panel && panel.querySelector('form.pkp_form');
        if (form && (!form.querySelector('textarea') || form.querySelectorAll('.tox-tinymce').length >= 2)) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (!form) return 'form missing';
      const fw = form.getBoundingClientRect().width;
      return { form: Math.round(fw), fields: [...form.querySelectorAll('input[type=text], input[type=email], input[type=tel], select, .tox-tinymce')]
        .filter(e => e.getClientRects().length && !e.closest('.localization_popover'))
        .map(e => { const r = e.getBoundingClientRect(); return { id: (e.id || e.className).split(/[- ]/)[0], pct: Math.round(r.width / fw * 100), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }) };
    });
    await go(`/${J}/user/profile`, 9000);
    tb = await tabBars();
    check('Profile: tabs on one pinned row, the active one joined to the panel', Array.isArray(tb) && tb.length === 1 && tb[0].rows === 1 && tb[0].sticky === '48px' && tb[0].joined, tb);
    let ff = await formFields();
    const given = ff.fields?.find(f => f.id === 'givenName'), family = ff.fields?.find(f => f.id === 'familyName');
    check(`Profile, Identity: fields as wide as the form (${ff.form}/390 px), given and family name stacked`,
      ff.form >= 340 && ff.fields.length >= 3 && ff.fields.every(f => f.pct >= 95) && given && family && family.top >= given.bottom, ff);
    await swipe(-1);
    await sleep(2000);
    tb = await tabBars();
    check(`Profile: swipe left, next tab (${tabNames(tb)})`, tabNames(tb) === 'Contact', tb);
    ff = await formFields();
    check('Profile, Contact: email, signature, phone, affiliation, address and country as wide as the form',
      ff.form >= 340 && ff.fields.length >= 6 && ff.fields.every(f => f.pct >= 95), ff);
    await shot('13-profile-contact');
    // in old tabs too, the last tapped tab loses the coloured line when a
    // swipe opens another one
    await tap('Roles');
    await sleep(1500);
    tb = await swipe(1);
    mk = await marks();
    check(`Profile: after a tap and a swipe the coloured line is only on the open tab (${tabNames(tb)})`,
      tabNames(tb) === 'Contact' && mk.Roles?.hover && Object.values(mk).every(m => m.line === m.open), mk);
    // On a text field: if it is the one being typed in, the swipe does not
    // change tab; if it is not focused, it does
    const fieldSpot = (focus) => ev(f => {
      const i = [...document.querySelectorAll('.app__main .ui-tabs-panel input[type=text], .app__main .ui-tabs-panel input[type=email]')].find(e => e.getClientRects().length);
      if (!i) return null;
      if (f) i.focus({ preventScroll: true }); else document.activeElement?.blur();
      const r = i.getBoundingClientRect();
      return r.top > 120 && r.bottom < innerHeight - 20 ? { y: Math.round(r.top + r.height / 2) } : null;
    }, focus);
    let fs = await fieldSpot(true);
    tb = fs ? await drag(70, fs.y, 330, fs.y + 4) : 'field not visible';
    check(`Profile: on the field being typed in, the swipe does not change tab (${tabNames(tb)})`, tabNames(tb) === 'Contact', tb);
    fs = await fieldSpot(false);
    tb = fs ? await drag(70, fs.y, 330, fs.y + 4) : 'field not visible';
    check(`Profile: on an unfocused field the swipe changes tab (${tabNames(tb)})`, tabNames(tb) === 'Identity', tb);
    await go('/index/admin/settings', 9000);
    await clickText('Languages');
    await sleep(3000);
    tb = await swipe(-1, '.pkp_controllers_grid');
    check(`Administration: swipe also over a grid (${tabNames(tb)})`, tabNames(tb) === 'Site Setup > Navigation', tb);
    // Below a short panel (Highlights) the grey page also changes tab
    await clickText('Highlights');
    await sleep(3000);
    const grey = await ev(() => {
      const p = [...document.querySelectorAll('.app__main .pkpTab[role=tabpanel]')].filter(e => e.getClientRects().length).pop();
      const y = p && Math.round(p.getBoundingClientRect().bottom + 100);
      return y && y < innerHeight - 40 ? y : null;
    });
    tb = grey ? await drag(320, grey, 70, grey + 5, 12) : 'no space below the panel';
    check(`Administration: swipe also on the grey page below the panel (${tabNames(tb)})`, tabNames(tb) === 'Site Setup > Bulk Emails', tb);
    // Appearance > Setup has the same id ("setup") as the outer Site Setup
    // panel: a swipe right goes back to Theme, not to Site Setup
    await clickText('Appearance');
    await sleep(2500);
    await clickText('Setup');
    await sleep(2500);
    tb = await drag(100, 600, 330, 604, 12);
    check(`Administration: from Appearance > Setup a swipe right goes to Theme (${tabNames(tb)})`, tabNames(tb) === 'Appearance > Theme', tb);
    // Side panels with a form (journal Edit): labels and fields away from the
    // screen edge
    await go('/index/admin/contexts', 8000);
    await ev(() => { const a = document.querySelector('.app__main a.show_extras'); if (a) a.click(); return 1; });
    await sleep(800);
    await ev(() => { const a = [...document.querySelectorAll('.app__main a')].find(e => e.offsetParent && e.textContent.trim() === 'Edit'); if (a) a.click(); return 1; });
    await sleep(5000);
    const edge = await ev(() => {
      const f = document.querySelector('.DialogContent .pkpForm');
      const l = f && f.querySelector('.pkpFormFieldLabel'), i = f && f.querySelector('input[type=text]');
      return l && i ? { label: Math.round(l.getBoundingClientRect().left), field: Math.round(i.getBoundingClientRect().left) } : 'form not found';
    });
    check(`Hosted Journals, Edit: labels and fields away from the edge (${edge?.label}/${edge?.field} px)`, edge?.label >= 12 && edge?.field >= 12, edge);
    await shot('15-edit-journal');
    // Side panels with an "old" OJS form (Create Section)
    await go(`/${J}/management/settings/context`, 8000);
    await clickText('Sections');
    await sleep(3000);
    await clickText('Create Section');
    await sleep(6000);
    const oldForm = await ev(() => {
      const f = document.querySelector('.DialogContent form.pkp_form');
      const i = f && [...f.querySelectorAll('input[type=text]')].find(e => e.getClientRects().length);
      const l = f && [...f.querySelectorAll('label')].find(e => e.getClientRects().length && e.textContent.trim());
      return i && l ? { label: Math.round(l.getBoundingClientRect().left), field: Math.round(i.getBoundingClientRect().left), right: Math.round(innerWidth - i.getBoundingClientRect().right) } : 'form not found';
    });
    check(`Create Section: labels and fields away from the edges (${oldForm?.label}/${oldForm?.field}/${oldForm?.right} px)`, oldForm?.label >= 12 && oldForm?.field >= 12 && oldForm?.right >= 12, oldForm);
    // Two languages together (Appearance > Setup, second language on): OJS
    // puts them in two half-width columns; on the phone they are stacked
    await go(`/${J}/management/settings/website`, 8000);
    await clickText('Setup');
    await sleep(2500); await netIdle(1000, 20000);
    const langOn = await ev(() => {
      const b = [...document.querySelectorAll('.app__main .pkpFormLocales__locale')].find(e => e.tagName === 'BUTTON' && e.offsetParent && !e.classList.contains('pkpFormLocales__locale--isActive'));
      if (!b) return 'no second language';
      b.click(); return 'ok';
    });
    await sleep(1500);
    const twoLang = await ev(() => {
      const g = [...document.querySelectorAll('.pkpForm--hasManyVisibleLocales .pkpFormGroup__localeGroup')].find(e => e.offsetParent && e.querySelectorAll('.pkpFormGroup__locale--isVisible').length >= 2);
      if (!g) return 'multilingual fields not found';
      const r = [...g.querySelectorAll('.pkpFormGroup__locale--isVisible')].map(e => e.getBoundingClientRect());
      return { widths: r.map(x => Math.round(x.width)), stacked: r[1].top >= r[0].bottom - 1 };
    });
    check(`Two languages together: fields stacked at full width (${langOn}, ${twoLang?.widths})`, twoLang?.stacked && twoLang.widths?.every(w => w >= 300), twoLang);
    await shot('16a-two-languages');
    // Navigation menu (Edit): Assigned and Unassigned stacked at full width,
    // each opening and closing when its heading is tapped
    await go(`/${J}/management/settings/website`, 8000);
    await ev(() => { const t = [...document.querySelectorAll('.app__main [role=tab]')].find(e => e.offsetParent && e.textContent.trim() === 'Setup'); (t.querySelector('a') || t).click(); return 1; });
    await sleep(2500);
    await clickText('Navigation');
    await sleep(4000); await netIdle(1000, 20000);
    // the Edit of the first row of the menu grid (not another "Edit" on the page)
    await ev(() => { const a = [...document.querySelectorAll('.app__main a.show_extras')].find(e => e.offsetParent && e.closest('[id*="navigationmenusgrid"]')); if (a) a.click(); return 1; });
    await sleep(800);
    await ev(() => { const a = [...document.querySelectorAll('a[id*="navigationmenusgrid-row"][id*="-edit-"]')].find(e => e.offsetParent); if (a) a.click(); return 1; });
    await sleep(2000); await netIdle(1000, 20000);
    // the form arrives from the server after the panel opens: wait for it
    for (let i = 0; i < 40 && !(await ev(() => !!document.querySelector('.pkp_nav_management .md-nav-toggle'))); i++) await sleep(500);
    await sleep(1000);
    const navState = () => ev(() => {
      const cols = [...document.querySelectorAll('.pkp_nav_management > .pkp_nav_assigned, .pkp_nav_management > .pkp_nav_unassigned')];
      if (cols.length !== 2) return 'columns not found';
      const r = cols.map(c => c.getBoundingClientRect());
      return { widths: r.map(x => Math.round(x.width)), stacked: r[1].top >= r[0].bottom - 1, open: cols.map(c => !!c.querySelector(':scope > ul').getClientRects().length) };
    });
    const nav1 = await navState();
    check(`Navigation menu: lists stacked at full width (${nav1?.widths})`, nav1?.stacked && nav1.widths?.every(w => w >= 300), nav1);
    check('Navigation menu: Assigned open, Unassigned closed', nav1?.open?.[0] === true && nav1.open[1] === false, nav1);
    await ev(() => { document.querySelectorAll('.pkp_nav_management .md-nav-toggle')[1]?.click(); return 1; });
    await sleep(500);
    const nav2 = await navState();
    check('Navigation menu: a tap on the heading opens Unassigned', nav2?.open?.[1] === true, nav2);
    await shot('16-navigation-menu');
    // Widening the window above 900 px without reloading, the headings go back
    // to how OJS makes them (no chevrons, buttons or closed lists); back on
    // the phone the controls return
    await send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    const navWide = await ev(() => {
      const heads = [...document.querySelectorAll('.pkp_nav_management > * > .pkp_nav_management_header')];
      return { heads: heads.length, extras: heads.filter(h => h.classList.contains('md-nav-toggle') || h.querySelector('svg') || ['role', 'tabindex', 'aria-controls', 'aria-expanded'].some(a => h.hasAttribute(a))).length,
        closed: document.querySelectorAll('.pkp_nav_management .md-nav-closed').length,
        lists: [...document.querySelectorAll('.pkp_nav_management > * > ul')].filter(u => u.getClientRects().length).length };
    });
    check(`Navigation menu: above 900 px without reloading, no added controls (${navWide?.heads} headings, ${navWide?.lists} visible lists)`,
      navWide?.heads === 2 && navWide.extras === 0 && navWide.closed === 0 && navWide.lists === 2, navWide);
    await size(390, 844, true);
    await sleep(800);
    const nav3 = await navState();
    check('Navigation menu: back on the phone, Assigned open and Unassigned closed', nav3?.open?.[0] === true && nav3.open[1] === false, nav3);
    // Users & Roles: each start date next to its role, even when a role has
    // no date
    await go(`/${J}/management/settings/access`, 8000);
    const roles = await ev(() => {
      let rows = 0, off = 0;
      for (const tr of document.querySelectorAll('.app__main tbody tr')) {
        const cols = [...tr.children].map(td => [...td.querySelectorAll(':scope > div.flex.flex-col')]).filter(d => d.length > 1);
        if (cols.length !== 2 || cols[0].length !== cols[1].length) continue;
        rows++;
        cols[0].forEach((d, i) => { if (Math.abs(d.getBoundingClientRect().top - cols[1][i].getBoundingClientRect().top) > 2) off++; });
      }
      return { rows, off };
    });
    check(`Users & Roles: each date next to its role (${roles.rows} users with several roles)`, roles.rows > 0 && roles.off === 0, roles);
    // Invite to a role: the step bar fits inside the screen
    await go(`/${J}/invitation/create/userRoleAssignment`, 8000);
    const steps = await ev(() => { const w = document.querySelector('.pkpSteps__buttonWrapper'); return w ? { scroll: w.scrollWidth, width: w.clientWidth } : 'bar not found'; });
    check(`Invite to a role: step bar inside the screen (${steps?.scroll}/${steps?.width} px)`, steps?.scroll <= steps?.width + 1, steps);
    // DOIs: the "Articles" heading is not repeated below the tab of the same name
    await go(`/${J}/dois`, 8000);
    const doiTitle = await ev(() => { const h = document.querySelector('.app__main [role=tabpanel] > h1:first-child'); return h ? !!h.getClientRects().length : 'no heading'; });
    check('DOIs: the tab name is not repeated as a heading', doiTitle === false, doiTitle);
    // Statistics: the dates below the chart do not overlap
    await go(`/${J}/stats/publications/publications`, 9000);
    // the chart is drawn after the data arrives: wait until it has several dates
    const readTicks = () => ev(() => {
      const find = (vn, d) => { if (!vn || d > 400) return null; const c = vn.component; if (c) { const r = c.exposed && c.exposed.chart; const ch = r && (r.value !== undefined ? r.value : r); if (ch && ch.scales) return ch; return find(c.subTree, d + 1); } let f = null; if (Array.isArray(vn.children)) vn.children.some(x => (f = find(x, d + 1))); return f; };
      const ch = find(document.getElementById('app')._vnode, 0);
      const sc = ch && ch.scales.x;
      if (!sc || !sc._labelSizes) return 'chart not found';
      const w = sc._labelSizes.widths, gaps = [];
      for (let i = 1; i < sc.ticks.length; i++) gaps.push(Math.round(sc.getPixelForTick(i) - sc.getPixelForTick(i - 1) - (w[i] + w[i - 1]) / 2));
      return { labels: sc.ticks.map(t => t.label), gaps };
    });
    let ticks = await readTicks();
    for (let i = 0; i < 40 && !(ticks?.labels?.length >= 2); i++) { await sleep(500); ticks = await readTicks(); }
    // sometimes the data does not arrive (empty chart, a single date): reload once
    if (!(ticks?.labels?.length >= 2)) {
      await go(`/${J}/stats/publications/publications`, 9000); await netIdle(1000, 20000);
      for (let i = 0; i < 40 && !(ticks?.labels?.length >= 2); i++) { await sleep(500); ticks = await readTicks(); }
    }
    await sleep(1500); ticks = await readTicks();
    check(`Statistics: dates below the chart do not overlap (${ticks?.labels?.join(' / ')})`, ticks?.labels?.length >= 2 && ticks.gaps.every(g => g > 4), ticks);
    await shot('17-statistics');
    // Grids in side tabs (Workflow > Submission > Components): buttons that
    // wrap to a second row stay in the header and rows are as wide as the
    // grid, not one letter per line
    await go(`/${J}/management/settings/workflow`, 8000);
    await clickText('Components');
    await sleep(4000);
    const cg = await ev(() => {
      const g = [...document.querySelectorAll('.app__main .pkp_controllers_grid')].find(e => e.offsetParent !== null);
      const h = g && g.querySelector(':scope > .header'), a = h && h.querySelector('.actions'), row = g && g.querySelector('tr.gridRow');
      if (!h || !a || !row) return 'grid, buttons or rows missing';
      const R = e => e.getBoundingClientRect();
      return { header: Math.round(R(h).bottom), buttons: Math.round(R(a).bottom), rowTop: Math.round(R(row).top), row: Math.round(R(row).width), grid: Math.round(R(g).width) };
    });
    check(`Workflow, Components: buttons inside the header, rows as wide as the grid (${cg?.row}/${cg?.grid} px)`,
      cg && cg.buttons <= cg.header + 1 && cg.rowTop >= cg.header - 1 && cg.row >= cg.grid - 4, cg);
    await shot('14-components');

    // Repeated headings: no visible heading equal to the page (or panel)
    // title other than the title itself
    const dupTitles = scope => ev(s => {
      const root = document.querySelector(s) || document;
      const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const h1 = [...root.querySelectorAll('h1')].find(h => h.getClientRects().length);
      if (!h1) return 'no title';
      return [...root.querySelectorAll('h2, h3, h4')].filter(h => h.getClientRects().length && norm(h.textContent) === norm(h1.textContent)).length;
    }, scope);

    // Tasks (bell panel)
    await go(`/${J}/submissions`, 7000);
    await ev(() => { [...document.querySelectorAll('.app__header button')].find(b => /^Tasks/.test(b.textContent.trim()))?.click(); return 1; });
    await sleep(5000);
    await phoneBasics('Tasks');
    check('Tasks: the "Tasks" heading is not repeated', (await dupTitles('.DialogContent')) === 0, await dupTitles('.DialogContent'));
    const tk = await ev(() => {
      const rows = [...document.querySelectorAll('.DialogContent .pkp_controllers_grid tr.gridRow')].filter(r => r.offsetParent !== null).slice(0, 5);
      if (!rows.length) return 'no tasks';
      const panel = document.querySelector('.DialogContent .shadow-xl').getBoundingClientRect();
      return {
        rows: rows.length,
        labels: document.querySelectorAll('.DialogContent [data-md-label]').length,
        // checkbox left of the text, at the same height
        inline: rows.every(r => { const c = r.querySelector('input[type=checkbox]').getBoundingClientRect(), t = r.cells[1].getBoundingClientRect();
          return c.right <= t.left && Math.abs(c.top - t.top) < 12; }),
        // text inside the panel
        inside: rows.every(r => r.cells[1].getBoundingClientRect().right <= panel.right + 1),
        edge: Math.round(rows[0].getBoundingClientRect().left - panel.left),
      };
    });
    check('Tasks: no "TASKS:" label on the rows', tk && tk.labels === 0, tk);
    check('Tasks: checkbox left of the text, on the same row', tk && tk.inline, tk);
    check('Tasks: list almost edge to edge, text inside the screen', tk && tk.inside && tk.edge <= 8, tk);
    await shot('09-tasks');

    // Lists inside boxes: repeated heading and nested margins
    for (const [p, n] of [['stats/counterR5/counterR5', 'Counter R5'], ['management/settings/announcements', 'Announcements'], ['management/settings/institutions', 'Institutions']]) {
      await go(`/${J}/${p}`, 8000);
      await phoneBasics(n);
      check(`${n}: the page title is not repeated in the box`, (await dupTitles('.app__main')) === 0, await dupTitles('.app__main'));
      const x = await ev(() => {
        const i = [...document.querySelectorAll('.app__main .listPanel')].find(e => e.offsetParent !== null);
        return i ? Math.round(i.getBoundingClientRect().left) : 'no list';
      });
      check(`${n}: list without a box inside a box (edge at ${x} px)`, typeof x === 'number' && x <= 12, x);
      const ind = await ev(() => {
        const l = [...document.querySelectorAll('.app__main .listPanel')].find(e => e.offsetParent !== null);
        if (!l) return 'no list';
        const left = l.getBoundingClientRect().left;
        const els = [...l.querySelectorAll('.pkpHeader__actions > *, .listPanel__itemIdentity, .listPanel__itemActions:not(:has(> :only-child)) > :first-child')].filter(e => e.offsetParent !== null);
        return Math.round(Math.max(...els.map(e => e.getBoundingClientRect().left - left)));
      });
      check(`${n}: search, buttons and rows aligned with the list edge (indent ${ind} px)`, typeof ind === 'number' && ind <= 12, ind);
    }

    // Statistics
    await go(`/${J}/stats/editorial/editorial`, 9000);
    await phoneBasics('Editorial Activity');
    const ed = await ev(() => {
      const ring = document.querySelector('.pkpStats--editorial__stageChartWrapper')?.getBoundingClientRect();
      const box = document.querySelector('.pkpStats--editorial__stageWrapper')?.getBoundingClientRect();
      const tot = document.querySelector('.pkpStats--editorial__stage--total')?.getBoundingClientRect();
      const st = [...document.querySelectorAll('.pkpStats--editorial__stage:not(.pkpStats--editorial__stage--total)')].map(e => e.getBoundingClientRect());
      if (!ring || !tot || !st.length) return 'chart not found';
      const mid = r => [r.left + r.width / 2, r.top + r.height / 2];
      const [rx] = mid(ring), [tx] = mid(tot);
      return {
        below: tot.top >= ring.bottom - 2 && Math.abs(rx - tx) <= 4,
        beside: st.every(r => r.left >= ring.right),
        right: Math.round(Math.max(...st.map(r => r.right))),
        height: Math.round(box.height), n: st.length,
      };
    });
    check('Editorial Activity: total below the ring, stages beside it, all inside the screen', ed && ed.below && ed.beside && ed.right <= 390 - 8 && ed.height <= 260, ed);
    const tr = await ev(() => {
      const row = [...document.querySelectorAll('.pkpStats__panel table tbody tr')].find(e => e.offsetParent !== null);
      if (!row) return 'Trends table not found';
      const [name, ...vals] = [...row.cells].map(c => c.getBoundingClientRect());
      return { nameAlone: vals.every(v => v.top >= name.bottom - 1), sameLine: vals.every(v => Math.abs(v.top - vals[0].top) <= 1), n: vals.length };
    });
    check('Editorial Activity, Trends: name above, values side by side', tr && tr.nameAlone && tr.sameLine && tr.n >= 2, tr);
    await shot('10-editorial');
    await go(`/${J}/stats/users/users`, 8000);
    await phoneBasics('Registered users');
    const su = await ev(() => {
      const t = [...document.querySelectorAll('.app__main table')].find(e => e.offsetParent !== null);
      if (!t) return 'table not found';
      const oneLine = [...t.tBodies[0].rows].every(r => r.cells.length !== 2 || Math.abs(r.cells[0].getBoundingClientRect().top - r.cells[1].getBoundingClientRect().top) <= 4);
      return { oneLine, head: Math.round(t.tHead.getBoundingClientRect().height), left: Math.round(t.getBoundingClientRect().left) };
    });
    check('Registered users: name and number on the same row, no empty grey bar, smaller margins', su && su.oneLine && su.head <= 1 && su.left <= 20, su);
    const ex = await ev(() => {
      const h = document.querySelector('.pkpStats__panel > .pkpHeader');
      const t = h && h.querySelector('.pkpHeader__title'), a = h && h.querySelector('.pkpHeader__actions');
      if (!t || !a) return 'header not found';
      const rt = t.getBoundingClientRect(), ra = a.getBoundingClientRect();
      return { sameLine: ra.top < rt.bottom && ra.bottom > rt.top, right: Math.round(innerWidth - ra.right), afterTitle: ra.left >= rt.right - 1 };
    });
    check('Registered users: Export on the heading row, on the right', ex && ex.sameLine && ex.afterTitle && ex.right <= 24, ex);

    // Site administration
    await go('/index/admin/settings#plugins', 9000);
    await phoneBasics('Administration, plugins');
    await pluginRows('Administration, plugins');
    await go('/index/admin', 6000);
    await phoneBasics('Administration');
    check('no JavaScript errors from the plugin files', errors.length === 0, errors);
  }

  if (mode === 'desktop') {
    // Above 900 px the plugin must change nothing: each page is captured with
    // the plugin and with its files blocked, and the two are compared.
    await size(1300, 900, false);
    const pages = [
      ['01-dashboard', `/${J}/submissions`],
      ['02-review', `/${J}/workflow/index/${WF}`],
      ['03-submission', `/${J}/workflow/index/${WF}`, async () => { await clickText('Submission'); await sleep(4000); }],
      ['04-file', `/${J}/workflow/index/${WF}`, async () => { await clickText('Submission'); await sleep(4000);
        await ev(() => { document.querySelector('.pkp_controllers_grid td.first_column a')?.click(); return 1; }); await sleep(1000); }],
      ['05-copyediting', `/${J}/workflow/index/${WF2}`, async () => { await clickText('Copyediting'); await sleep(4000); }],
      ['06-galleys', `/${J}/workflow/index/${WF2}`, async () => { await clickText('Galleys'); await sleep(4000); }],
      ['07-add-reviewer', `/${J}/workflow/index/${WF}`, async () => { await clickText('Add Reviewer'); await sleep(6000); }],
      ['08-settings', `/${J}/management/settings/context`],
      ['09-users', `/${J}/management/settings/access`],
      ['10-website', `/${J}/management/settings/website`],
      ['11-reviewer', `/${J}/dashboard/reviewAssignments`],
      ['12-admin', '/index/admin/settings#plugins'],
      ['13-tasks', `/${J}/submissions`, async () => { await ev(() => { [...document.querySelectorAll('.app__header button')].find(b => /^Tasks/.test(b.textContent.trim()))?.click(); return 1; }); await sleep(5000); }],
      ['14-counter', `/${J}/stats/counterR5/counterR5`],
      ['15-editorial', `/${J}/stats/editorial/editorial`],
      ['16-stats-users', `/${J}/stats/users/users`],
      ['17-announcements', `/${J}/management/settings/announcements`],
    ];
    const capture = async (name, url, act) => {
      const pair = [];
      for (const blocked of [false, true]) {
        await send('Network.setBlockedURLs', { urls: blocked ? BLOCK : [] });
        await go(url, 7000); if (act) { await act(); await netIdle(); }
        await ev(() => { scrollTo(0, 0); document.querySelectorAll('*').forEach(e => { if (e.scrollTop) e.scrollTop = 0; }); return 1; }); await sleep(400);
        pair.push(await shot(`desktop-${name}-${blocked ? 'without' : 'with'}`));
      }
      await send('Network.setBlockedURLs', { urls: [] });
      return pair;
    };
    const blank = async () => { await send('Page.navigate', { url: 'about:blank' }); await sleep(500); };
    const same = d => d && !d.size && d.n <= 20;
    // Pixel-by-pixel comparison, in a blank page (see blank)
    const diff = (a, b) => ev(async ([x, y]) => {
      const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
      const [i1, i2] = await Promise.all([load(x), load(y)]);
      if (i1.width !== i2.width || i1.height !== i2.height) return { size: [i1.width, i1.height, i2.width, i2.height] };
      const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
      const p = px(i1), q = px(i2); let n = 0, max = 0;
      for (let k = 0; k < p.length; k += 4) {
        const m = Math.max(Math.abs(p[k] - q[k]), Math.abs(p[k + 1] - q[k + 1]), Math.abs(p[k + 2] - q[k + 2]));
        if (m > 3) n++; if (m > max) max = m;
      }
      return { n, max };
    }, [readFileSync(a).toString('base64'), readFileSync(b).toString('base64')]);
    const res = [];
    for (const p of pages) res.push({ p, files: await capture(...p) });
    await blank();
    for (const r of res) r.d = await diff(...r.files);
    // A pair that differs is captured once more: sometimes a list arrives from
    // the API after the capture (for example the files in Review), which has
    // nothing to do with the plugin. A real difference remains on the second try.
    const again = res.filter(r => !same(r.d));
    for (const r of again) { r.files = await capture(...r.p); r.twice = true; }
    if (again.length) { await blank(); for (const r of again) r.d = await diff(...r.files); }
    for (const { p: [name], files: [a, b], d, twice } of res) {
      check(`desktop, ${name}: identical with and without the plugin${twice && same(d) ? ' (on the second try)' : ''}`, same(d), d);
      if (same(d)) { rmSync(a); rmSync(b); }
    }
  }
} catch (e) {
  ko(`group "${mode}" interrupted`, e.message);
} finally {
  ws.close(); proc.kill();
  await sleep(500); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`  (${mode}: ${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
