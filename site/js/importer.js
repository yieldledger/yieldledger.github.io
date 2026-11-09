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

// Column names used by Wealthsimple, Questrade, Interactive Brokers and most other brokers, best match first.
const COLS = {
  sym: [/^(symbol|ticker|security symbol|stock symbol|instrument|security)$/],
  qty: [/^(quantity|qty|shares|units|no\. of shares|number of shares|position)$/, /quantity|shares|units/],
  date: [/^(trade date|transaction date|date\/time|date)$/, /^(settlement date|process date)$/, /date/],
  price: [/^(average cost|avg cost|average price|avg price|cost price|cost per share|average cost per share|unit cost|avg\. cost)$/, /^(price|unit price|t\. price|trade price|execution price)$/, /average|avg/],
  amount: [/^book value \(market\)$/, /^(book value|book cost|total cost|cost basis|basis|total book cost)$/, /^book value \(cad\)$/, /^(net amount|net cash amount)$/, /^(amount|gross amount|proceeds|total|total amount|value)$/, /book value|book cost|cost basis/],
  type: [/^(action|activity sub type|transaction type|activity type|type|side|buy\/sell|code|description)$/],
  cur: [/^market price currency$/, /^(currency|curr)$/, /^book value currency \(market\)$/],
  acct: [/^(account type|account classification|account)$/, /account type|account/],
};
const normHead = h => String(h ?? '').trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
const NOT = { price: /market|close|current|last|commission|fee/, amount: /market value|market price|commission|fee|unrealized|realized|gain/, qty: /price|value/, date: /expiry|maturity/ };

function mapColumns(head) {
  const col = {}, taken = new Set();
  for (const [k, pats] of Object.entries(COLS)) {
    if (k === 'type') continue;
    for (const re of pats) {
      const i = head.findIndex((h, j) => !taken.has(j) && re.test(h) && !(NOT[k] && NOT[k].test(h)));
      if (i >= 0) { col[k] = i; taken.add(i); break; }
    }
  }
  // Every column that can say buy or sell; the values are read together.
  col.types = head.map((h, j) => (/^(action|activity sub type|transaction type|activity type|type|side|buy\/sell|activity)$/.test(h) && !taken.has(j) ? j : -1)).filter(j => j >= 0);
  return col;
}

/** Rows of cells (from CSV, Excel or PDF) → buy/sell rows. Works with activity exports and holdings snapshots. */
export function parseGrid(grid, rows, defaults) {
  const isHead = r => { const h = r.map(normHead); return h.some(c => COLS.sym[0].test(c)) && h.some(c => COLS.qty.some(re => re.test(c)) && !NOT.qty.test(c)); };
  const hi = grid.findIndex(isHead);
  if (hi < 0) throw new Error('Could not find a header row with a symbol and a quantity column.');
  // Interactive Brokers statements stack sections: "Trades,Header,…" then "Trades,Data,…".
  const section = /^header$/i.test(String(grid[hi][1] || '').trim()) ? String(grid[hi][0]).trim() : null;
  const head = grid[hi].map(normHead);
  const col = mapColumns(head);
  const kind = col.date == null && !col.types.length ? 'holdings' : 'activity';
  const out = []; let skipped = 0;
  for (const r of grid.slice(hi + 1)) {
    if (section) { if (String(r[0]).trim() !== section) continue; if (!/^data$/i.test(String(r[1]).trim())) continue; }
    else if (isHead(r)) continue;
    const g = k => (col[k] != null ? String(r[col[k]] ?? '').trim() : '');
    const symText = g('sym').replace(/\s+/g, '');
    if (!symText || /^(total|cash|subtotal)/i.test(symText)) continue;
    const type = col.types.map(j => String(r[j] ?? '')).join(' ').trim();
    if (type && /reinvest|drip|\brei\b|dividend|distribution|\bdis\b|\bdiv\b|interest|fee|deposit|withdraw|transfer|contribution|journal|split|exchange|\bfx\b|conversion/i.test(type) && !/^(buy|sell)\b/i.test(type)) { skipped++; continue; }
    let shares = toNum(g('qty')); if (shares == null || shares === 0) { skipped++; continue; }
    const isSell = type ? /\bsell\b|\bsold\b|disposition|\bsld\b/i.test(type) : shares < 0;
    if (type && !isSell && !/\bbuy\b|\bbought\b|purchase|\bbot\b|trade/i.test(type) && kind === 'activity') { skipped++; continue; }
    shares = Math.abs(shares) * (isSell ? -1 : 1);
    let cost = toNum(g('amount'));
    if (cost != null) cost = Math.abs(cost);
    const px = toNum(g('price'));
    if ((cost == null || cost === 0) && px) cost = Math.abs(px * shares);
    out.push({
      line: r.join(', '), symText, sym: resolveSymbol(symText, rows, g('cur')),
      shares, cost: cost || null, costMode: cost ? 'total' : undefined, date: normDate(g('date')) || defaults.date,
      account: normAccount(g('acct'), defaults.account), side: isSell ? 'sell' : 'buy',
    });
  }
  return { rows: out, skipped, kind, columns: Object.fromEntries(Object.entries(col).filter(([k]) => k !== 'types').map(([k, i]) => [k, grid[hi][i]]).concat(col.types.length ? [['type', col.types.map(j => grid[hi][j]).join(' + ')]] : [])) };
}
export const parseExport = (text, rows, defaults) => parseGrid(parseCSV(text), rows, defaults);

/* ------------------------------------------------------------ Excel and PDF */
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the file reader. Check your connection and try again.')); document.head.appendChild(s); });
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

export async function parseExcel(buf, rows, defaults) {
  if (!window.XLSX) await loadScript(XLSX_URL);
  const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
  let firstErr;
  for (const name of wb.SheetNames) {
    const grid = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
    try { const r = parseGrid(grid.map(row => row.map(c => String(c ?? ''))), rows, defaults); if (r.rows.length) return r; } catch (e) { firstErr = firstErr || e; }
  }
  throw firstErr || new Error('Could not find a header row with a symbol and a quantity column.');
}

/** Text lines from a PDF, rebuilt from the position of each piece of text on the page. */
async function pdfLines(buf) {
  if (!window.pdfjsLib) await loadScript(PDFJS + 'pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const byY = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push([it.transform[4], it.str.trim()]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) lines.push(byY.get(y).sort((a, b) => a[0] - b[0]).map(x => x[1]));
  }
  return lines;
}
/**
 * Statements are laid out for reading, not importing. If the PDF has a table with Symbol and Quantity
 * headings it is read like a spreadsheet; otherwise each line that starts with a tracked ticker followed by
 * a share count becomes a row, and the amount paid is left for the person to check.
 */
export async function parsePdf(buf, rows, defaults) {
  const lines = await pdfLines(buf);
  try { const r = parseGrid(lines, rows, defaults); if (r.rows.length) return { ...r, pdf: true }; } catch {}
  const out = []; let skipped = 0;
  const acctFromPage = lines.map(l => l.join(' ')).map(l => normAccount((l.match(/\b(TFSA|RRSP|FHSA|RESP|LIRA|Margin|Non[- ]?registered|Cash)\b/i) || [])[1], null)).find(Boolean);
  for (const parts of lines) {
    const toks = parts.join(' ').split(/\s+/);
    let k = toks.findIndex(x => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x) && resolveSymbol(x, rows));
    if (k < 0) continue;
    const nums = toks.slice(k + 1).map(toNum).filter(n => n != null);
    if (!nums.length || !(nums[0] > 0)) { skipped++; continue; }
    out.push({ line: parts.join(' '), symText: toks[k], sym: resolveSymbol(toks[k], rows), shares: nums[0], cost: null, date: defaults.date, account: acctFromPage || defaults.account, side: 'buy' });
  }
  if (!out.length) throw new Error('No holdings found in this PDF. Try the CSV or Excel export from your broker instead.');
  return { rows: out, skipped, kind: 'holdings', pdf: true, columns: {} };
}
