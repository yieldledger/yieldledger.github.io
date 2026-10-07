// Turns pasted text or a brokerage CSV export into buy/sell rows.
import { resolveSymbol } from './data.js';
import { ACCOUNTS } from './engine.js';

const ACCT_ALIASES = [
  [/^tfsa$/i, 'TFSA'], [/^(rrsp|rsp|spousal rrsp)$/i, 'RRSP'], [/^fhsa$/i, 'FHSA'], [/^resp$/i, 'RESP'], [/^lira$/i, 'LIRA'],
  [/^(non[- ]?reg(istered)?|personal|cash|taxable|individual)$/i, 'Non-registered'], [/^margin$/i, 'Margin'],
];
export function normAccount(s, fallback) {
  const t = String(s || '').trim();
  for (const [re, v] of ACCT_ALIASES) if (re.test(t)) return v;
  for (const a of ACCOUNTS) if (t.toLowerCase().includes(a.toLowerCase())) return a;
  if (/tfsa/i.test(t)) return 'TFSA';
  if (/rrsp|rsp/i.test(t)) return 'RRSP';
  if (/fhsa/i.test(t)) return 'FHSA';
  return fallback;
}

export function normDate(s) {
  const t = String(s || '').trim();
  let m;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) {
    // Ambiguous day/month: treat as month/day unless the first part is over 12.
    const a = +m[1], b = +m[2];
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const p = Date.parse(t);
  return Number.isFinite(p) ? new Date(p).toISOString().slice(0, 10) : null;
}
const toNum = s => {
  const t = String(s ?? '').replace(/[$,\s]|CAD|USD/gi, '').replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
};

/** "VDY 150 2025-01-15 6750 TFSA" — one holding per line, any order after the ticker. */
export function parseQuick(text, rows, defaults) {
  const out = [];
  for (const raw of String(text).split(/\n+/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const toks = line.split(/[\s,;\t]+/).filter(Boolean);
    let sym = null, shares = null, cost = null, date = null, account = null, symText = '';
    for (const t of toks) {
      const d = /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t) ? normDate(t) : null;
      if (d) { date = d; continue; }
      const a = normAccount(t, null);
      if (a && /^[a-z-]+$/i.test(t) && t.length > 2 && !resolveSymbol(t, rows)) { account = a; continue; }
      const n = /^[$]?-?[\d,]*\.?\d+$/.test(t) ? toNum(t) : null;
      if (n != null) { if (shares == null) shares = n; else if (cost == null) cost = n; continue; }
      if (!sym) { symText = t; sym = resolveSymbol(t, rows); }
    }
    out.push({ line, symText, sym, shares, cost, date: date || defaults.date, account: account || defaults.account, side: (shares ?? 0) < 0 ? 'sell' : 'buy' });
  }
  return out;
}

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

const COLS = {
  sym: /^(symbol|ticker|security symbol|stock|instrument|security)$/i,
  name: /(description|security name|name)/i,
  qty: /(quantity|shares|qty|units|no\. of shares)/i,
  date: /(trade date|transaction date|settlement date|date)/i,
  amount: /(net amount|amount|book value|book cost|total cost|cost|total)/i,
  price: /^(price|unit price|avg price|average price)/i,
  type: /(transaction type|activity type|type|action|activity|transaction)/i,
  cur: /currency/i,
  acct: /account/i,
};

/** CSV export (activity or holdings) → rows. Activity files keep buys and sells; DRIP rows are skipped because the app replays them. */
export function parseExport(text, rows, defaults) {
  const grid = parseCSV(text);
  const hi = grid.findIndex(r => r.some(c => COLS.sym.test(c.trim())) && r.some(c => COLS.qty.test(c.trim())));
  if (hi < 0) throw new Error('Could not find a header row with a symbol and a quantity column.');
  const head = grid[hi].map(c => c.trim());
  const col = {};
  for (const [k, re] of Object.entries(COLS)) {
    const i = head.findIndex((h, j) => re.test(h) && !Object.values(col).includes(j));
    if (i >= 0) col[k] = i;
  }
  const out = []; let skipped = 0;
  for (const r of grid.slice(hi + 1)) {
    const g = k => (col[k] != null ? (r[col[k]] ?? '').trim() : '');
    const symText = g('sym'); if (!symText) continue;
    const type = g('type');
    if (type && /reinvest|drip|dividend|distribution|interest|fee|deposit|withdraw|transfer|contribution/i.test(type)) { skipped++; continue; }
    const isSell = type ? /sell|sold|disposition/i.test(type) : false;
    if (type && !isSell && !/buy|bought|purchase/i.test(type)) { skipped++; continue; }
    let shares = toNum(g('qty')); if (shares == null || shares === 0) { skipped++; continue; }
    shares = Math.abs(shares) * (isSell ? -1 : 1);
    let cost = toNum(g('amount'));
    if (cost != null) cost = Math.abs(cost);
    if ((cost == null || cost === 0) && toNum(g('price'))) cost = Math.abs(toNum(g('price')) * shares);
    out.push({
      line: r.join(', '), symText, sym: resolveSymbol(symText, rows, g('cur')),
      shares, cost: cost || null, date: normDate(g('date')) || defaults.date,
      account: normAccount(g('acct'), defaults.account), side: isSell ? 'sell' : 'buy',
    });
  }
  return { rows: out, skipped, columns: Object.fromEntries(Object.entries(col).map(([k, i]) => [k, head[i]])) };
}
