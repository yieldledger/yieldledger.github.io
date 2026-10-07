// Loads the market data written by the daily job (site/data).
const quotes = new Map();
let indexP = null, fxP = null, metaP = null;

const safe = s => s.replace(/[^A-Za-z0-9.\-]/g, '_');
const getJSON = async url => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

export function loadIndex() {
  return (indexP ??= getJSON('data/index.json').catch(() => ({ asof: null, rows: [] })));
}
export function loadMeta() {
  return (metaP ??= getJSON('data/meta.json').catch(() => null));
}
export function loadFx() {
  return (fxP ??= getJSON('data/fx/USDCAD.json').catch(() => null));
}
export function loadQuote(sym) {
  if (!quotes.has(sym)) quotes.set(sym, getJSON(`data/q/${safe(sym)}.json`).catch(() => null));
  return quotes.get(sym);
}
export async function loadQuotes(syms) {
  const out = {};
  await Promise.all([...new Set(syms)].map(async s => { out[s] = await loadQuote(s); }));
  return out;
}

/**
 * Turn what a person types ("VDY", "vdy.to", "T") into a tracked Yahoo symbol.
 * Canadian listing wins when both exist, unless the hint says USD/US.
 */
export function resolveSymbol(input, rows, hint = '') {
  const raw = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return null;
  const bySym = new Map(rows.map(r => [r.s.toUpperCase(), r]));
  if (raw.includes('.') && bySym.has(raw)) return bySym.get(raw);
  const base = raw.replace(/\.(TO|TSX|NE|CN|V|US)$/, '').replace(/\./g, '-');
  const usWanted = /USD|US|NYSE|NASDAQ|ARCA|BATS/i.test(hint) || /\.US$/.test(raw);
  const ca = bySym.get(base + '.TO') || bySym.get(base + '.NE') || bySym.get(raw.replace(/\.UN$/, '-UN') + '.TO');
  const us = bySym.get(base) || bySym.get(raw);
  if (usWanted) return us || ca || null;
  return ca || us || null;
}

export function search(rows, q, limit = 8) {
  const s = q.trim().toUpperCase();
  if (!s) return [];
  const scored = [];
  for (const r of rows) {
    const d = r.d.toUpperCase(), n = (r.n || '').toUpperCase();
    let score = -1;
    if (d === s) score = 100; else if (d.startsWith(s)) score = 80 - d.length;
    else if (n.includes(s)) score = 40; else if (r.s.toUpperCase().includes(s)) score = 30;
    if (score >= 0) scored.push([score + (r.ex === 'CA' ? 1 : 0), r]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]);
}
