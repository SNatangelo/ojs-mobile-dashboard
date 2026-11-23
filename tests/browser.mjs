// tests/browser.mjs
// Copyright (C) 2026 Stefano Natangelo
// SPDX-License-Identifier: AGPL-3.0-only
//
// Test nel browser di Mobile Dashboard. Guida Chrome (o Edge) headless via
// DevTools Protocol, senza librerie.
//
//   node browser.mjs <prova> <cartella risultati>
//   prove: telefono | computer
//
// Variabili: MD_BASE (http://localhost:8080), MD_SID (cookie OJSESSION
// dell'amministratore, lo imposta run.sh), MD_JOURNAL (jse),
// MD_WORKFLOW (69/3: un articolo in revisione), MD_WORKFLOW2 (12/4: un
// articolo in produzione), MD_CHROME (percorso del browser).
// Scrive "  ok    ..." o "  FALLITO ..." per ogni controllo; esce con 1 se
// qualcosa fallisce.
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
if (!SID || !chrome || !mode || !out) { console.log('  FALLITO avvio del browser — manca SID, Chrome o un argomento'); process.exit(1); }
mkdirSync(out, { recursive: true });

let pass = 0, fail = 0;
const ok = n => { pass++; console.log('  ok    ' + n); };
const ko = (n, d) => { fail++; console.log('  FALLITO ' + n + (d ? ' — ' + d : '')); };
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
// Richieste di rete in corso: alcune pagine caricano gli elenchi dopo, via
// API, e i controlli vanno fatti solo quando hanno finito
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
// Aspetta che la rete sia ferma da almeno `quiet` ms (al massimo `max` ms)
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
  const b = els[els.length - 1]; if (!b) return 'non trovato'; b.click(); return 'ok';
}, text);
const loggedIn = () => ev(() => !!document.querySelector('.app__main, .pkp_structure_main') && !document.querySelector('form#login, .page_login'));

// Controlli comuni del telefono
// doc: larghezza della pagina; box: bordo destro più lontano dei riquadri
// principali (.app taglia ciò che esce, quindi doc da solo non basta)
const overflow = () => ev(() => {
  const els = [...document.querySelectorAll('.app, .app > *, .app__body, .app__body > *, .app__body > * > *')]
    .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  let box = 0, which = '';
  for (const e of els) { const r = e.getBoundingClientRect(); if (r.right > box) { box = Math.round(r.right); which = e.className || e.tagName; } }
  return { doc: document.documentElement.scrollWidth, box, which: String(which).slice(0, 60), vw: innerWidth };
});
async function phoneBasics(name) {
  const o = await overflow();
  check(`${name}: niente scorrimento di lato (${o.doc}/${o.vw} px)`, o.doc <= o.vw + 1, o);
  check(`${name}: contenuto dentro lo schermo (${o.box}/${o.vw} px)`, o.box <= o.vw + 1, o);
  check(`${name}: file del plugin caricati`, await ev(() => [...document.querySelectorAll('link[href*="mobileDashboard/styles/mobile.css"]')].length > 0
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
  check(`${name}: ci sono righe di plugin`, Array.isArray(r) && r.length >= 3, r);
  if (!Array.isArray(r)) return;
  const bad = r.filter(x => x.nameW < 150 || !x.sameLine || (x.desc && x.desc < x.row * 0.8));
  check(`${name}: nome largo, spunta sulla stessa riga, descrizione a tutta larghezza`, bad.length === 0, bad);
}

try {
  if (mode === 'telefono') {
    await size(390, 844, true);

    // Dashboard e menu
    await go(`/${J}/submissions`, 8000);
    check('accesso come amministratore', await loggedIn());
    await phoneBasics('dashboard'); await shot('01-dashboard');
    const nav = await ev(async () => {
      const t = document.getElementById('mdNavToggle'); if (!t || t.offsetParent === null) return 'pulsante ☰ assente';
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
    check('menu ☰: si apre dentro lo schermo', nav && nav.open && nav.expanded === 'true' && nav.inside, nav);
    check(`menu ☰: si arriva all'ultima voce ("${nav?.lastText}")`, nav && nav.lastVisible, nav);
    await shot('02-menu');
    const closed = await ev(async () => {
      document.getElementById('mdNavBackdrop')?.click(); await new Promise(r => setTimeout(r, 700));
      return !document.documentElement.classList.contains('md-nav-open') && !document.body.classList.contains('md-nav-open');
    });
    check('menu ☰: si chiude toccando fuori', closed);
    // Col menu ☰ aperto, un tocco sul pulsante per cambiare rivista (il primo
    // controllo dell'intestazione dopo ☰) apre il suo menu e chiude il ☰
    const sw = await ev(async () => {
      document.getElementById('mdNavToggle').click(); await new Promise(r => setTimeout(r, 700));
      const t = document.getElementById('mdNavToggle').getBoundingClientRect();
      const c = [...document.querySelectorAll('.app__header a, .app__header button')]
        .filter(e => e.id !== 'mdNavToggle' && e.getClientRects().length && e.getBoundingClientRect().left > t.right - 1)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
      if (!c) return 'pulsante delle riviste assente';
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
    check(`menu ☰: toccando il cambio rivista il ☰ si chiude e si apre il menu delle riviste`, sw?.open && !sw2.navOpen && sw2.expanded > 0, { sw, sw2 });
    await shot('02b-cambio-rivista');
    await ev(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.click(); return 1; });
    await go(`/${J}/submissions`, 8000);

    // Workflow e menu delle fasi
    await go(`/${J}/workflow/index/${WF}`, 8000);
    await phoneBasics('workflow'); await shot('03-workflow');
    const st = await ev(async () => {
      const t = document.querySelector('.mdStagesToggle'); if (!t) return 'barra delle fasi assente';
      const before = t.getAttribute('aria-expanded'); t.click(); await new Promise(r => setTimeout(r, 700));
      const after = t.getAttribute('aria-expanded');
      const box = document.getElementById(t.getAttribute('aria-controls'));
      const items = box ? [...box.querySelectorAll('a,button')].filter(a => a.offsetParent !== null && a !== t).length : 0;
      return { before, after, items };
    });
    check('fasi: barra chiusa che si apre con un tocco', st && st.before === 'false' && st.after === 'true' && st.items >= 3, st);
    await shot('04-fasi');
    const pick = await ev(async () => {
      const t = document.querySelector('.mdStagesToggle'); const box = document.getElementById(t.getAttribute('aria-controls'));
      const item = [...box.querySelectorAll('a,button')].find(a => a.offsetParent !== null && a !== t && /Submission/.test(a.textContent));
      if (!item) return 'voce Submission assente'; item.click(); await new Promise(r => setTimeout(r, 3500));
      return t.getAttribute('aria-expanded');
    });
    check('fasi: scegliendo una voce la barra si richiude', pick === 'false', pick);
    const labels = await ev(() => ({ cells: document.querySelectorAll('td[data-md-label]').length,
      tables: document.querySelectorAll('.DialogContent table').length }));
    check('tabelle del workflow: celle con etichetta', labels.tables > 0 && labels.cells > 0, labels);
    await phoneBasics('workflow, fase Submission');

    await go(`/${J}/workflow/index/${WF2}`, 8000);
    await phoneBasics('workflow di un articolo in produzione');

    // Plugin della rivista e Plugin Gallery
    await go(`/${J}/management/settings/website#plugins`, 9000);
    await phoneBasics('plugin della rivista');
    await pluginRows('plugin della rivista');
    await ev(() => { document.querySelector('.pkp_controllers_grid tr.gridRow')?.scrollIntoView(); scrollBy(0, -80); return 1; });
    await shot('05-plugin');
    check('Plugin Gallery: scheda trovata', (await clickText('Plugin Gallery')) === 'ok');
    // L'elenco arriva dal sito di PKP attraverso il server, a volte con
    // qualche secondo di ritardo: si aspetta la rete e poi le righe
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
    check('Plugin Gallery: nomi dei plugin larghi (non una lettera per riga)', gal.length >= 3 && gal.every(w => w >= 150), gal);
    await shot('06-gallery');

    // Users & Roles
    await go(`/${J}/management/settings/access`, 9000);
    await phoneBasics('Users & Roles');
    const u = await ev(async () => {
      let t; // la tabella degli utenti arriva dopo la pagina
      for (let i = 0; i < 30 && !(t = document.querySelector('.app__main table.md-named')); i++) await new Promise(r => setTimeout(r, 500));
      if (!t) return 'tabella senza classe md-named';
      const first = t.tBodies[0].rows[0].cells[0];
      return { bold: +getComputedStyle(first.querySelector('span') || first).fontWeight, w: Math.round(first.getBoundingClientRect().width) };
    });
    check('Users & Roles: nome in grassetto e a tutta riga', u && u.bold >= 600 && u.w >= 200, u);
    await ev(() => { document.querySelector('.app__main table.border-separate')?.scrollIntoView(); scrollBy(0, -70); return 1; });
    await shot('07-utenti');

    // Impostazioni: margini annidati
    for (const [p, n] of [['distribution', 'Distribution'], ['workflow', 'Workflow Settings'], ['context', 'Journal Settings']]) {
      await go(`/${J}/management/settings/${p}`, 8000);
      await phoneBasics(n);
      const g = await ev(() => {
        const f = [...document.querySelectorAll('.pkpFormGroup')].find(e => e.offsetParent !== null);
        return f ? Math.round(f.getBoundingClientRect().width) : 0;
      });
      check(`${n}: i campi usano quasi tutta la larghezza (${g}/390 px)`, g >= 330, g);
      if (p === 'distribution') await shot('08-impostazioni');
    }

    // Schede: una riga che scorre di lato, ferma sotto l'intestazione, con
    // la scheda attiva unita al pannello; uno swipe sul pannello (tocchi
    // veri, non clic) apre la scheda accanto, prima quelle interne
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
    // un punto del pannello più interno lontano da campi e link (in: dentro
    // quel riquadro, per esempio una griglia)
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
      return p ? drag(p.x, p.y, dir < 0 ? 70 : 330, p.y + 6) : 'nessun punto libero nel pannello';
    }
    await go(`/${J}/management/settings/distribution`, 8000);
    let tb = await tabBars();
    check('schede: una sola riga che scorre di lato', Array.isArray(tb) && tb.length === 1 && tb[0].rows === 1 && tb[0].scrolls, tb);
    check('schede: riga ferma sotto l\'intestazione', tb[0]?.sticky === '48px', tb);
    check('schede: la scheda attiva è bianca e unita al pannello', tb[0]?.joined && tb[0]?.white, tb);
    await shot('11-schede');
    tb = await swipe(-1);
    check(`schede: swipe a sinistra, scheda seguente (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Setup', tb);
    tb = await swipe(-1);
    check(`schede annidate: lo swipe cambia prima quella interna (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Registration', tb);
    tb = await swipe(-1);
    check(`schede annidate: dopo l'ultima interna cambia quella esterna (${tabNames(tb)})`, tabNames(tb) === 'Search Indexing', tb);
    for (let i = 0; i < 3; i++) tb = await swipe(1);
    check(`schede: swipe a destra fino alla prima (${tabNames(tb)})`, tabNames(tb) === 'License', tb);
    tb = await swipe(1);
    check('schede: sulla prima, uno swipe a destra non cambia scheda', tabNames(tb) === 'License', tb);
    // uno swipe un po' obliquo (40° dall'orizzontale), che il browser lascia
    // alla pagina perché più di lato che in verticale, cambia scheda anche lui
    const slant = await freeSpot(300, 330);
    tb = slant ? await drag(slant.x, slant.y, slant.x - 100, slant.y - 85, 12) : 'nessun punto libero nel pannello';
    check(`schede: swipe un po' obliquo, scheda seguente (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Setup', tb);
    tb = await swipe(1);
    // Segni delle schede: sul telefono la scheda toccata per ultima resta in
    // :hover e OJS dà il focus alla scheda aperta anche dopo un tocco o uno
    // swipe; la linea colorata va solo sulla scheda aperta e il pallino del
    // focus solo con la tastiera
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
    check('schede: toccando una scheda si apre, senza pallino sotto il nome', mk.DOIs?.open && mk.DOIs.focus && !mk.DOIs.dot, mk.DOIs);
    tb = await swipe(1);
    mk = await marks();
    check(`schede: dopo un tocco e uno swipe la linea colorata resta solo sulla scheda aperta (${tabNames(tb)})`,
      tabNames(tb) === 'License' && mk.DOIs?.hover && Object.values(mk).every(m => m.line === m.open), mk);
    check('schede: niente pallino sulla scheda aperta con uno swipe', mk.License?.focus && !mk.License.dot, mk.License);
    await key('ArrowRight', 39);
    mk = await marks();
    check(`schede: con la tastiera (freccia a destra) il pallino c'è (${tabNames(await tabBars())})`, mk.DOIs?.open && mk.DOIs.focus && mk.DOIs.dot && mk.DOIs.line, mk.DOIs);
    tb = await swipe(1);
    mk = await marks();
    check(`schede: dopo la tastiera, uno swipe toglie di nuovo il pallino (${tabNames(tb)})`, tabNames(tb) === 'License' && mk.License?.focus && !mk.License.dot, mk.License);
    const low = await freeSpot(200, 600);
    const y0 = await ev('scrollY');
    tb = low ? await drag(low.x, low.y, low.x + 12, low.y - 400, 12) : 'nessun punto libero in basso';
    const y1 = await ev('scrollY');
    check(`schede: trascinando in verticale la pagina scorre (${Math.round(y1 - y0)} px) e la scheda resta`, y1 - y0 > 100 && tabNames(tb) === 'License', { y0, y1, tb });
    await ev(() => { scrollTo(0, 1400); return 1; });
    await sleep(500);
    tb = await tabBars();
    check('schede: scorrendo la pagina la riga resta sotto l\'intestazione', tb[0]?.top === 48 && tb[0]?.box < 48, tb);
    tb = await swipe(-1);
    check(`schede: swipe con la riga ferma, il nuovo pannello si vede dall'inizio (${tabNames(tb)})`, tabNames(tb) === 'DOIs > Setup' && tb[0]?.box === 48, tb);
    await shot('12-schede-ferme');
    // Profilo (moduli vecchi): i campi a metà o a tre quarti di larghezza
    // diventano larghi quanto il modulo, uno per riga
    const formFields = () => ev(async () => {
      let form;
      for (let i = 0; i < 20; i++) {
        const panel = [...document.querySelectorAll('.ui-tabs-panel')].find(p => p.getClientRects().length && p.getAttribute('aria-hidden') !== 'true');
        form = panel && panel.querySelector('form.pkp_form');
        if (form && (!form.querySelector('textarea') || form.querySelectorAll('.tox-tinymce').length >= 2)) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (!form) return 'modulo assente';
      const fw = form.getBoundingClientRect().width;
      return { form: Math.round(fw), fields: [...form.querySelectorAll('input[type=text], input[type=email], input[type=tel], select, .tox-tinymce')]
        .filter(e => e.getClientRects().length && !e.closest('.localization_popover'))
        .map(e => { const r = e.getBoundingClientRect(); return { id: (e.id || e.className).split(/[- ]/)[0], pct: Math.round(r.width / fw * 100), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }) };
    });
    await go(`/${J}/user/profile`, 9000);
    tb = await tabBars();
    check('Profilo: schede su una riga ferma, la attiva unita al pannello', Array.isArray(tb) && tb.length === 1 && tb[0].rows === 1 && tb[0].sticky === '48px' && tb[0].joined, tb);
    let ff = await formFields();
    const given = ff.fields?.find(f => f.id === 'givenName'), family = ff.fields?.find(f => f.id === 'familyName');
    check(`Profilo, Identity: campi larghi quanto il modulo (${ff.form}/390 px), nome e cognome uno sotto l'altro`,
      ff.form >= 340 && ff.fields.length >= 3 && ff.fields.every(f => f.pct >= 95) && given && family && family.top >= given.bottom, ff);
    await swipe(-1);
    await sleep(2000);
    tb = await tabBars();
    check(`Profilo: swipe a sinistra, scheda seguente (${tabNames(tb)})`, tabNames(tb) === 'Contact', tb);
    ff = await formFields();
    check('Profilo, Contact: email, firma, telefono, affiliazione, indirizzo e paese larghi quanto il modulo',
      ff.form >= 340 && ff.fields.length >= 6 && ff.fields.every(f => f.pct >= 95), ff);
    await shot('13-profilo-contatti');
    // anche nelle schede vecchie la scheda toccata per ultima perde la linea
    // colorata quando uno swipe ne apre un'altra
    await tap('Roles');
    await sleep(1500);
    tb = await swipe(1);
    mk = await marks();
    check(`Profilo: dopo un tocco e uno swipe la linea colorata resta solo sulla scheda aperta (${tabNames(tb)})`,
      tabNames(tb) === 'Contact' && mk.Roles?.hover && Object.values(mk).every(m => m.line === m.open), mk);
    // Su un campo di testo: se è quello in cui si scrive lo swipe non cambia
    // scheda, se non è selezionato sì
    const fieldSpot = (focus) => ev(f => {
      const i = [...document.querySelectorAll('.app__main .ui-tabs-panel input[type=text], .app__main .ui-tabs-panel input[type=email]')].find(e => e.getClientRects().length);
      if (!i) return null;
      if (f) i.focus({ preventScroll: true }); else document.activeElement?.blur();
      const r = i.getBoundingClientRect();
      return r.top > 120 && r.bottom < innerHeight - 20 ? { y: Math.round(r.top + r.height / 2) } : null;
    }, focus);
    let fs = await fieldSpot(true);
    tb = fs ? await drag(70, fs.y, 330, fs.y + 4) : 'campo non visibile';
    check(`Profilo: sul campo in cui si scrive lo swipe non cambia scheda (${tabNames(tb)})`, tabNames(tb) === 'Contact', tb);
    fs = await fieldSpot(false);
    tb = fs ? await drag(70, fs.y, 330, fs.y + 4) : 'campo non visibile';
    check(`Profilo: su un campo non selezionato lo swipe cambia scheda (${tabNames(tb)})`, tabNames(tb) === 'Identity', tb);
    await go('/index/admin/settings', 9000);
    await clickText('Languages');
    await sleep(3000);
    tb = await swipe(-1, '.pkp_controllers_grid');
    check(`Administration: swipe anche sopra una griglia (${tabNames(tb)})`, tabNames(tb) === 'Site Setup > Navigation', tb);
    // Sotto un pannello corto (Highlights) anche la pagina grigia cambia scheda
    await clickText('Highlights');
    await sleep(3000);
    const grey = await ev(() => {
      const p = [...document.querySelectorAll('.app__main .pkpTab[role=tabpanel]')].filter(e => e.getClientRects().length).pop();
      const y = p && Math.round(p.getBoundingClientRect().bottom + 100);
      return y && y < innerHeight - 40 ? y : null;
    });
    tb = grey ? await drag(320, grey, 70, grey + 5, 12) : 'nessuno spazio sotto il pannello';
    check(`Administration: swipe anche sulla pagina grigia sotto il pannello (${tabNames(tb)})`, tabNames(tb) === 'Site Setup > Bulk Emails', tb);
    // Appearance > Setup ha lo stesso id («setup») del pannello esterno Site
    // Setup: uno swipe a destra torna a Theme, non a Site Setup
    await clickText('Appearance');
    await sleep(2500);
    await clickText('Setup');
    await sleep(2500);
    tb = await drag(100, 600, 330, 604, 12);
    check(`Administration: da Appearance > Setup uno swipe a destra va a Theme (${tabNames(tb)})`, tabNames(tb) === 'Appearance > Theme', tb);
    // Finestre laterali con un modulo (Edit della rivista): etichette e campi
    // staccati dal bordo dello schermo
    await go('/index/admin/contexts', 8000);
    await ev(() => { const a = document.querySelector('.app__main a.show_extras'); if (a) a.click(); return 1; });
    await sleep(800);
    await ev(() => { const a = [...document.querySelectorAll('.app__main a')].find(e => e.offsetParent && e.textContent.trim() === 'Edit'); if (a) a.click(); return 1; });
    await sleep(5000);
    const edge = await ev(() => {
      const f = document.querySelector('.DialogContent .pkpForm');
      const l = f && f.querySelector('.pkpFormFieldLabel'), i = f && f.querySelector('input[type=text]');
      return l && i ? { label: Math.round(l.getBoundingClientRect().left), field: Math.round(i.getBoundingClientRect().left) } : 'modulo non trovato';
    });
    check(`Hosted Journals, Edit: etichette e campi staccati dal bordo (${edge?.label}/${edge?.field} px)`, edge?.label >= 12 && edge?.field >= 12, edge);
    await shot('15-modifica-rivista');
    // Finestre laterali con un modulo «vecchio» di OJS (Create Section)
    await go(`/${J}/management/settings/context`, 8000);
    await clickText('Sections');
    await sleep(3000);
    await clickText('Create Section');
    await sleep(6000);
    const oldForm = await ev(() => {
      const f = document.querySelector('.DialogContent form.pkp_form');
      const i = f && [...f.querySelectorAll('input[type=text]')].find(e => e.getClientRects().length);
      const l = f && [...f.querySelectorAll('label')].find(e => e.getClientRects().length && e.textContent.trim());
      return i && l ? { label: Math.round(l.getBoundingClientRect().left), field: Math.round(i.getBoundingClientRect().left), right: Math.round(innerWidth - i.getBoundingClientRect().right) } : 'modulo non trovato';
    });
    check(`Create Section: etichette e campi staccati dai bordi (${oldForm?.label}/${oldForm?.field}/${oldForm?.right} px)`, oldForm?.label >= 12 && oldForm?.field >= 12 && oldForm?.right >= 12, oldForm);
    // Due lingue insieme (Appearance > Setup, seconda lingua accesa): OJS le
    // mette in due colonne a metà; sul telefono una sotto l'altra
    await go(`/${J}/management/settings/website`, 8000);
    await clickText('Setup');
    await sleep(2500); await netIdle(1000, 20000);
    const langOn = await ev(() => {
      const b = [...document.querySelectorAll('.app__main .pkpFormLocales__locale')].find(e => e.tagName === 'BUTTON' && e.offsetParent && !e.classList.contains('pkpFormLocales__locale--isActive'));
      if (!b) return 'nessuna seconda lingua';
      b.click(); return 'ok';
    });
    await sleep(1500);
    const twoLang = await ev(() => {
      const g = [...document.querySelectorAll('.pkpForm--hasManyVisibleLocales .pkpFormGroup__localeGroup')].find(e => e.offsetParent && e.querySelectorAll('.pkpFormGroup__locale--isVisible').length >= 2);
      if (!g) return 'campi multilingue non trovati';
      const r = [...g.querySelectorAll('.pkpFormGroup__locale--isVisible')].map(e => e.getBoundingClientRect());
      return { widths: r.map(x => Math.round(x.width)), stacked: r[1].top >= r[0].bottom - 1 };
    });
    check(`Due lingue insieme: campi uno sotto l'altro a tutta larghezza (${langOn}, ${twoLang?.widths})`, twoLang?.stacked && twoLang.widths?.every(w => w >= 300), twoLang);
    await shot('16a-due-lingue');
    // Menu di navigazione (Edit): Assigned e Unassigned uno sotto l'altro, a
    // tutta larghezza, e ciascuno si apre e si chiude toccando il titolo
    await go(`/${J}/management/settings/website`, 8000);
    await ev(() => { const t = [...document.querySelectorAll('.app__main [role=tab]')].find(e => e.offsetParent && e.textContent.trim() === 'Setup'); (t.querySelector('a') || t).click(); return 1; });
    await sleep(2500);
    await clickText('Navigation');
    await sleep(4000); await netIdle(1000, 20000);
    // l'Edit della prima riga della griglia dei menu (non un altro «Edit» della pagina)
    await ev(() => { const a = [...document.querySelectorAll('.app__main a.show_extras')].find(e => e.offsetParent && e.closest('[id*="navigationmenusgrid"]')); if (a) a.click(); return 1; });
    await sleep(800);
    await ev(() => { const a = [...document.querySelectorAll('a[id*="navigationmenusgrid-row"][id*="-edit-"]')].find(e => e.offsetParent); if (a) a.click(); return 1; });
    await sleep(2000); await netIdle(1000, 20000);
    // il modulo arriva dal server dopo l'apertura del pannello: aspettarlo
    for (let i = 0; i < 40 && !(await ev(() => !!document.querySelector('.pkp_nav_management .md-nav-toggle'))); i++) await sleep(500);
    await sleep(1000);
    const navState = () => ev(() => {
      const cols = [...document.querySelectorAll('.pkp_nav_management > .pkp_nav_assigned, .pkp_nav_management > .pkp_nav_unassigned')];
      if (cols.length !== 2) return 'colonne non trovate';
      const r = cols.map(c => c.getBoundingClientRect());
      return { widths: r.map(x => Math.round(x.width)), stacked: r[1].top >= r[0].bottom - 1, open: cols.map(c => !!c.querySelector(':scope > ul').getClientRects().length) };
    });
    const nav1 = await navState();
    check(`Menu di navigazione: elenchi uno sotto l'altro a tutta larghezza (${nav1?.widths})`, nav1?.stacked && nav1.widths?.every(w => w >= 300), nav1);
    check('Menu di navigazione: Assigned aperto, Unassigned chiuso', nav1?.open?.[0] === true && nav1.open[1] === false, nav1);
    await ev(() => { document.querySelectorAll('.pkp_nav_management .md-nav-toggle')[1]?.click(); return 1; });
    await sleep(500);
    const nav2 = await navState();
    check('Menu di navigazione: un tocco sul titolo apre Unassigned', nav2?.open?.[1] === true, nav2);
    await shot('16-menu-navigazione');
    // Users & Roles: ogni data di inizio accanto al suo ruolo, anche quando un
    // ruolo non ha data
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
    check(`Users & Roles: ogni data accanto al suo ruolo (${roles.rows} utenti con più ruoli)`, roles.rows > 0 && roles.off === 0, roles);
    // Invite to a role: la barra dei passi entra nello schermo
    await go(`/${J}/invitation/create/userRoleAssignment`, 8000);
    const steps = await ev(() => { const w = document.querySelector('.pkpSteps__buttonWrapper'); return w ? { scroll: w.scrollWidth, width: w.clientWidth } : 'barra non trovata'; });
    check(`Invite to a role: barra dei passi dentro lo schermo (${steps?.scroll}/${steps?.width} px)`, steps?.scroll <= steps?.width + 1, steps);
    // DOIs: il titolo «Articles» non si ripete sotto la scheda omonima
    await go(`/${J}/dois`, 8000);
    const doiTitle = await ev(() => { const h = document.querySelector('.app__main [role=tabpanel] > h1:first-child'); return h ? !!h.getClientRects().length : 'nessun titolo'; });
    check('DOIs: il nome della scheda non si ripete come titolo', doiTitle === false, doiTitle);
    // Statistiche: le date sotto il grafico non si sovrappongono
    await go(`/${J}/stats/publications/publications`, 9000);
    // il grafico si disegna dopo l'arrivo dei dati: aspettare che abbia più date
    const readTicks = () => ev(() => {
      const find = (vn, d) => { if (!vn || d > 400) return null; const c = vn.component; if (c) { const r = c.exposed && c.exposed.chart; const ch = r && (r.value !== undefined ? r.value : r); if (ch && ch.scales) return ch; return find(c.subTree, d + 1); } let f = null; if (Array.isArray(vn.children)) vn.children.some(x => (f = find(x, d + 1))); return f; };
      const ch = find(document.getElementById('app')._vnode, 0);
      const sc = ch && ch.scales.x;
      if (!sc || !sc._labelSizes) return 'grafico non trovato';
      const w = sc._labelSizes.widths, gaps = [];
      for (let i = 1; i < sc.ticks.length; i++) gaps.push(Math.round(sc.getPixelForTick(i) - sc.getPixelForTick(i - 1) - (w[i] + w[i - 1]) / 2));
      return { labels: sc.ticks.map(t => t.label), gaps };
    });
    let ticks = await readTicks();
    for (let i = 0; i < 40 && !(ticks?.labels?.length >= 2); i++) { await sleep(500); ticks = await readTicks(); }
    // a volte i dati non arrivano (grafico vuoto, una data sola): si ricarica una volta
    if (!(ticks?.labels?.length >= 2)) {
      await go(`/${J}/stats/publications/publications`, 9000); await netIdle(1000, 20000);
      for (let i = 0; i < 40 && !(ticks?.labels?.length >= 2); i++) { await sleep(500); ticks = await readTicks(); }
    }
    await sleep(1500); ticks = await readTicks();
    check(`Statistiche: date sotto il grafico senza sovrapposizioni (${ticks?.labels?.join(' / ')})`, ticks?.labels?.length >= 2 && ticks.gaps.every(g => g > 4), ticks);
    await shot('17-statistiche');
    // Griglie nelle schede laterali (Workflow > Submission > Components): i
    // pulsanti che vanno su una seconda riga restano nell'intestazione e le
    // righe sono larghe quanto la griglia, non una lettera per riga
    await go(`/${J}/management/settings/workflow`, 8000);
    await clickText('Components');
    await sleep(4000);
    const cg = await ev(() => {
      const g = [...document.querySelectorAll('.app__main .pkp_controllers_grid')].find(e => e.offsetParent !== null);
      const h = g && g.querySelector(':scope > .header'), a = h && h.querySelector('.actions'), row = g && g.querySelector('tr.gridRow');
      if (!h || !a || !row) return 'griglia, pulsanti o righe assenti';
      const R = e => e.getBoundingClientRect();
      return { header: Math.round(R(h).bottom), buttons: Math.round(R(a).bottom), rowTop: Math.round(R(row).top), row: Math.round(R(row).width), grid: Math.round(R(g).width) };
    });
    check(`Workflow, Components: pulsanti dentro l'intestazione, righe larghe quanto la griglia (${cg?.row}/${cg?.grid} px)`,
      cg && cg.buttons <= cg.header + 1 && cg.rowTop >= cg.header - 1 && cg.row >= cg.grid - 4, cg);
    await shot('14-componenti');

    // Titoli ripetuti: nessuna intestazione visibile uguale al titolo della
    // pagina (o del pannello) oltre al titolo stesso
    const dupTitles = scope => ev(s => {
      const root = document.querySelector(s) || document;
      const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const h1 = [...root.querySelectorAll('h1')].find(h => h.getClientRects().length);
      if (!h1) return 'nessun titolo';
      return [...root.querySelectorAll('h2, h3, h4')].filter(h => h.getClientRects().length && norm(h.textContent) === norm(h1.textContent)).length;
    }, scope);

    // Tasks (pannello della campanella)
    await go(`/${J}/submissions`, 7000);
    await ev(() => { [...document.querySelectorAll('.app__header button')].find(b => /^Tasks/.test(b.textContent.trim()))?.click(); return 1; });
    await sleep(5000);
    await phoneBasics('Tasks');
    check('Tasks: il titolo "Tasks" non si ripete', (await dupTitles('.DialogContent')) === 0, await dupTitles('.DialogContent'));
    const tk = await ev(() => {
      const rows = [...document.querySelectorAll('.DialogContent .pkp_controllers_grid tr.gridRow')].filter(r => r.offsetParent !== null).slice(0, 5);
      if (!rows.length) return 'nessun compito';
      const panel = document.querySelector('.DialogContent .shadow-xl').getBoundingClientRect();
      return {
        rows: rows.length,
        labels: document.querySelectorAll('.DialogContent [data-md-label]').length,
        // spunta a sinistra del testo, alla stessa altezza
        inline: rows.every(r => { const c = r.querySelector('input[type=checkbox]').getBoundingClientRect(), t = r.cells[1].getBoundingClientRect();
          return c.right <= t.left && Math.abs(c.top - t.top) < 12; }),
        // testo dentro il pannello
        inside: rows.every(r => r.cells[1].getBoundingClientRect().right <= panel.right + 1),
        edge: Math.round(rows[0].getBoundingClientRect().left - panel.left),
      };
    });
    check('Tasks: niente etichetta "TASKS:" sulle righe', tk && tk.labels === 0, tk);
    check('Tasks: spunta a sinistra del testo, sulla stessa riga', tk && tk.inline, tk);
    check('Tasks: elenco quasi da bordo a bordo, testo dentro lo schermo', tk && tk.inside && tk.edge <= 8, tk);
    await shot('09-tasks');

    // Elenchi dentro riquadri: titolo ripetuto e margini annidati
    for (const [p, n] of [['stats/counterR5/counterR5', 'Counter R5'], ['management/settings/announcements', 'Announcements'], ['management/settings/institutions', 'Institutions']]) {
      await go(`/${J}/${p}`, 8000);
      await phoneBasics(n);
      check(`${n}: il titolo della pagina non si ripete nel riquadro`, (await dupTitles('.app__main')) === 0, await dupTitles('.app__main'));
      const x = await ev(() => {
        const i = [...document.querySelectorAll('.app__main .listPanel')].find(e => e.offsetParent !== null);
        return i ? Math.round(i.getBoundingClientRect().left) : 'nessun elenco';
      });
      check(`${n}: elenco senza riquadro nel riquadro (bordo a ${x} px)`, typeof x === 'number' && x <= 12, x);
      const ind = await ev(() => {
        const l = [...document.querySelectorAll('.app__main .listPanel')].find(e => e.offsetParent !== null);
        if (!l) return 'nessun elenco';
        const left = l.getBoundingClientRect().left;
        const els = [...l.querySelectorAll('.pkpHeader__actions > *, .listPanel__itemIdentity, .listPanel__itemActions:not(:has(> :only-child)) > :first-child')].filter(e => e.offsetParent !== null);
        return Math.round(Math.max(...els.map(e => e.getBoundingClientRect().left - left)));
      });
      check(`${n}: ricerca, pulsanti e righe allineati al bordo dell'elenco (rientro ${ind} px)`, typeof ind === 'number' && ind <= 12, ind);
    }

    // Statistics
    await go(`/${J}/stats/editorial/editorial`, 9000);
    await phoneBasics('Editorial Activity');
    const ed = await ev(() => {
      const ring = document.querySelector('.pkpStats--editorial__stageChartWrapper')?.getBoundingClientRect();
      const box = document.querySelector('.pkpStats--editorial__stageWrapper')?.getBoundingClientRect();
      const tot = document.querySelector('.pkpStats--editorial__stage--total')?.getBoundingClientRect();
      const st = [...document.querySelectorAll('.pkpStats--editorial__stage:not(.pkpStats--editorial__stage--total)')].map(e => e.getBoundingClientRect());
      if (!ring || !tot || !st.length) return 'grafico non trovato';
      const mid = r => [r.left + r.width / 2, r.top + r.height / 2];
      const [rx] = mid(ring), [tx] = mid(tot);
      return {
        below: tot.top >= ring.bottom - 2 && Math.abs(rx - tx) <= 4,
        beside: st.every(r => r.left >= ring.right),
        right: Math.round(Math.max(...st.map(r => r.right))),
        height: Math.round(box.height), n: st.length,
      };
    });
    check('Editorial Activity: totale sotto l\'anello, fasi a fianco, tutto dentro lo schermo', ed && ed.below && ed.beside && ed.right <= 390 - 8 && ed.height <= 260, ed);
    const tr = await ev(() => {
      const row = [...document.querySelectorAll('.pkpStats__panel table tbody tr')].find(e => e.offsetParent !== null);
      if (!row) return 'tabella Trends non trovata';
      const [name, ...vals] = [...row.cells].map(c => c.getBoundingClientRect());
      return { nameAlone: vals.every(v => v.top >= name.bottom - 1), sameLine: vals.every(v => Math.abs(v.top - vals[0].top) <= 1), n: vals.length };
    });
    check('Editorial Activity, Trends: nome sopra, valori affiancati', tr && tr.nameAlone && tr.sameLine && tr.n >= 2, tr);
    await shot('10-editorial');
    await go(`/${J}/stats/users/users`, 8000);
    await phoneBasics('Registered users');
    const su = await ev(() => {
      const t = [...document.querySelectorAll('.app__main table')].find(e => e.offsetParent !== null);
      if (!t) return 'tabella non trovata';
      const oneLine = [...t.tBodies[0].rows].every(r => r.cells.length !== 2 || Math.abs(r.cells[0].getBoundingClientRect().top - r.cells[1].getBoundingClientRect().top) <= 4);
      return { oneLine, head: Math.round(t.tHead.getBoundingClientRect().height), left: Math.round(t.getBoundingClientRect().left) };
    });
    check('Registered users: nome e numero sulla stessa riga, niente barra grigia vuota, margini ridotti', su && su.oneLine && su.head <= 1 && su.left <= 20, su);
    const ex = await ev(() => {
      const h = document.querySelector('.pkpStats__panel > .pkpHeader');
      const t = h && h.querySelector('.pkpHeader__title'), a = h && h.querySelector('.pkpHeader__actions');
      if (!t || !a) return 'intestazione non trovata';
      const rt = t.getBoundingClientRect(), ra = a.getBoundingClientRect();
      return { sameLine: ra.top < rt.bottom && ra.bottom > rt.top, right: Math.round(innerWidth - ra.right), afterTitle: ra.left >= rt.right - 1 };
    });
    check('Registered users: Export sulla riga del titolo, a destra', ex && ex.sameLine && ex.afterTitle && ex.right <= 24, ex);

    // Amministrazione del sito
    await go('/index/admin/settings#plugins', 9000);
    await phoneBasics('Administration, plugin');
    await pluginRows('Administration, plugin');
    await go('/index/admin', 6000);
    await phoneBasics('Administration');
    check('nessun errore JavaScript dai file del plugin', errors.length === 0, errors);
  }

  if (mode === 'computer') {
    // Sopra i 900 px il plugin non deve cambiare nulla: ogni pagina si
    // fotografa con il plugin e con i suoi file bloccati, e si confronta.
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
        pair.push(await shot(`computer-${name}-${blocked ? 'senza' : 'con'}`));
      }
      await send('Network.setBlockedURLs', { urls: [] });
      return pair;
    };
    const blank = async () => { await send('Page.navigate', { url: 'about:blank' }); await sleep(500); };
    const same = d => d && !d.size && d.n <= 20;
    // Confronto pixel per pixel, in una pagina vuota (vedi blank)
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
    // Una coppia diversa si rifotografa una volta: a volte un elenco arriva
    // dall'API dopo la schermata (per esempio i file in Review) e non dipende
    // dal plugin. Una differenza vera resta anche alla seconda prova.
    const again = res.filter(r => !same(r.d));
    for (const r of again) { r.files = await capture(...r.p); r.twice = true; }
    if (again.length) { await blank(); for (const r of again) r.d = await diff(...r.files); }
    for (const { p: [name], files: [a, b], d, twice } of res) {
      check(`computer, ${name}: identico con e senza plugin${twice && same(d) ? ' (alla seconda prova)' : ''}`, same(d), d);
      if (same(d)) { rmSync(a); rmSync(b); }
    }
  }
} catch (e) {
  ko(`prova "${mode}" interrotta`, e.message);
} finally {
  ws.close(); proc.kill();
  await sleep(500); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`  (${mode}: ${pass} superati, ${fail} falliti)`);
process.exit(fail ? 1 : 0);
