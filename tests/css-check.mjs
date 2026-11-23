// tests/css-check.mjs
// Copyright (C) 2026 Stefano Natangelo
// SPDX-License-Identifier: AGPL-3.0-only
//
// Controlla che mobile.css cambi qualcosa solo sotto i 900 px: ogni regola
// deve stare dentro @media (max-width: 900px), tranne quelle che toccano solo
// gli elementi creati dal plugin (#md..., .md...), che sul computer
// restano nascosti.
//   node css-check.mjs <mobile.css>
import { readFileSync } from 'node:fs';

const css = readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const own = sel => sel.split(',').every(s => /^\s*[#.]md[\w-]*(\s|$|:|\[|>|\.)/.test(s.trim() + ' '));
let depth = 0, media = 0, start = 0; const bad = [];
for (let i = 0; i < css.length; i++) {
  const ch = css[i];
  if (ch === '{') {
    const head = css.slice(start, i).trim();
    if (depth === 0) {
      if (head.startsWith('@media')) media = /max-width:\s*900px/.test(head) ? 1 : 2;
      else if (!own(head)) bad.push(head.replace(/\s+/g, ' '));
    } else if (depth === 1 && media === 2) bad.push(head.replace(/\s+/g, ' '));
    depth++; start = i + 1;
  } else if (ch === '}') {
    depth--; start = i + 1; if (depth === 0) media = 0;
  } else if (ch === ';' && depth === 0) start = i + 1;
}
if (bad.length) { console.log(bad.slice(0, 5).join(' | ')); process.exit(1); }
