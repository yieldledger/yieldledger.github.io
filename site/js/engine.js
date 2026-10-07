// Yield Ledger calculation engine: DRIP replay, returns, income projections.
// Pure functions, no DOM. Dates are ISO strings (YYYY-MM-DD), compared as strings.

export const WHT_ACCOUNTS = new Set(['TFSA', 'FHSA', 'RESP', 'RDSP']);
export const ACCOUNTS = ['TFSA', 'RRSP', 'FHSA', 'RESP', 'LIRA', 'Non-registered', 'Margin'];
export const PAY_LAG_DAYS = 7; // estimated days from ex-dividend date to payment

const DAY = 86400000;
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * DAY);
export const monthKey = iso => iso.slice(0, 7);

/** US withholding rate on this security's dividends inside this account. */
export function withholding(q, account) {
  if (!q) return 0;
  if (q.wh === 'CDR') return 0.15; // the depositary bank is the shareholder, so no RRSP exemption
  if (q.ex !== 'US') return 0; // Canadian-listed funds pay any foreign tax inside the fund; distributions arrive net
  if (account === 'RRSP' || account === 'LIRA') return 0; // treaty exemption for retirement accounts
  return 0.15; // TFSA/FHSA/RESP: lost. Non-registered: withheld, usually recoverable as a foreign tax credit.
}

/* ------------------------------------------------------------ Canadian tax and currency */
export const FX_FEE = 0.015; // Wealthsimple: CAD account buying a US-listed security, each way
export const TAX_ACCOUNTS = ['TFSA', 'RRSP', 'Non-registered'];
/** What a Canadian keeps of a security's yield in each account type. row needs y (yield) and wh (profile). */
export function keep(row, account) {
  const y = row.y ?? row.st?.yld ?? 0, wh = row.wh || (row.ex === 'US' ? 'US' : 'CA');
  const reg = account !== 'Non-registered' && account !== 'Margin';
  const rrsp = account === 'RRSP' || account === 'LIRA';
  if (wh === 'US') return rrsp ? { kept: y, lost: 0, how: 'none' } : reg ? { kept: y * 0.85, lost: y * 0.15, how: 'lost' } : { kept: y * 0.85, lost: y * 0.15, how: 'credit' };
  if (wh === 'CDR') return reg ? { kept: y * 0.85, lost: y * 0.15, how: 'lost' } : { kept: y * 0.85, lost: y * 0.15, how: 'credit' };
  if (wh === 'CA-US') return { kept: y, lost: (y / 0.85) * 0.15, how: reg ? 'inside' : 'inside-credit' };
  if (wh === 'CA-INTL' || wh === 'CA-MIX') return { kept: y, lost: null, how: reg ? 'inside-varies' : 'inside-credit' };
  return { kept: y, lost: 0, how: 'none' };
}
/** US-listed fund that tracks the same index as a Canadian-listed one (for the RRSP swap). */
export const US_EQUIV = { 'VFV.TO': 'VOO', 'ZSP.TO': 'SPY', 'XUS.TO': 'SPY', 'XSP.TO': 'SPY', 'HXS.TO': 'SPY', 'VUN.TO': 'VTI', 'XUU.TO': 'VTI', 'ZQQ.TO': 'QQQ', 'XQQ.TO': 'QQQ', 'QQC.TO': 'QQQ', 'HXQ.TO': 'QQQ', 'VGG.TO': 'VIG' };
export const whtRecoverable = account => !WHT_ACCOUNTS.has(account) && account !== 'RRSP' && account !== 'LIRA';

/** Binary search helpers over a sorted array of ISO date strings. */
function lastIndexOnOrBefore(dates, iso) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function firstIndexOnOrAfter(dates, iso) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] >= iso) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans;
}
export function priceOn(series, iso) {
  if (!series || !series.d.length) return NaN;
  const i = lastIndexOnOrBefore(series.d, iso);
  return i >= 0 ? series.v[i] : series.v[0];
}
export function priceOnOrAfter(series, iso) {
  const i = firstIndexOnOrAfter(series.d, iso);
  return i >= 0 ? series.v[i] : series.v[series.v.length - 1];
}
export const fxOn = (fx, iso, cur) => (cur === 'USD' ? (fx ? priceOn(fx, iso) : 1.37) : 1);

/** Shares bought before a split are scaled to today's split-adjusted share count. */
function splitFactorAfter(q, iso) {
  let f = 1;
  for (const [d, r] of q.spl || []) if (d > iso && r > 0) f *= r;
  return f;
}

/**
 * Replay one position: each buy, each dividend, each DRIP purchase.
 * pos: { sym, account, drip: 'frac'|'whole'|'off', lots: [{ id, date, shares, cost? }] }
 * q: security record from data/q. fx: USDCAD series or null.
 * Amounts in the security's own currency; *Cad fields converted at the rate on each date.
 */
export function simulate(pos, q, fx, asOf = today()) {
  const cur = q.cur || 'CAD';
  const w = withholding(q, pos.account);
  const lots = [...pos.lots].filter(l => l.date && (+l.shares || l.frac)).sort((a, b) => a.date.localeCompare(b.date));
  const events = [];
  for (const l of lots) {
    const f = splitFactorAfter(q, l.date);
    const px = priceOn(q.c, l.date);
    if (l.frac) { events.push({ t: 'sell', date: l.date, frac: +l.frac, lot: l }); continue; }
    const sh = Math.abs(+l.shares) * f;
    const amt = Number.isFinite(+l.cost) && +l.cost > 0 ? +l.cost : sh * px;
    events.push({ t: +l.shares > 0 ? 'buy' : 'sell', date: l.date, shares: sh, cost: amt, lot: l });
  }
  const firstDate = lots.length ? lots[0].date : asOf;
  for (const [ex, dps] of q.div || []) if (ex > firstDate && ex <= asOf) events.push({ t: 'div', date: ex, dps });
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.t === 'div' ? -1 : 1));

  let shares = 0, cash = 0, invested = 0, investedCad = 0, boughtCad = 0;
  let realized = 0, realizedCad = 0, dripShares = 0, divGross = 0, divNet = 0, divNetCad = 0, whtTotal = 0, reinvested = 0, paidOut = 0, paidOutCad = 0;
  const ledger = [], steps = [], flows = [];
  for (const e of events) {
    if (e.t === 'buy') {
      shares += e.shares; invested += e.cost;
      const r = fxOn(fx, e.date, cur); investedCad += e.cost * r; boughtCad += e.cost * r;
      flows.push([e.date, -e.cost * r]);
      steps.push([e.date, shares, invested, divNet, investedCad]);
      ledger.push({ kind: 'buy', date: e.date, shares: e.shares, price: e.cost / e.shares, amount: e.cost, after: shares });
      continue;
    }
    if (e.t === 'sell') {
      if (e.frac) { e.shares = shares * Math.min(1, e.frac); e.cost = e.shares * priceOn(q.c, e.date); }
      const sold = Math.min(e.shares, shares);
      if (sold <= 0) continue;
      const frac = sold / shares, r = fxOn(fx, e.date, cur);
      const proceeds = e.cost * (sold / e.shares);
      invested -= invested * frac; investedCad -= investedCad * frac;
      shares -= sold; realized += proceeds; realizedCad += proceeds * r;
      flows.push([e.date, proceeds * r]);
      steps.push([e.date, shares, invested, divNet, investedCad]);
      ledger.push({ kind: 'sell', date: e.date, shares: sold, price: proceeds / sold, amount: proceeds, after: shares, fracSold: frac });
      continue;
    }
    if (shares <= 0) continue;
    const pay = addDays(e.date, PAY_LAG_DAYS) > asOf ? asOf : addDays(e.date, PAY_LAG_DAYS);
    const gross = shares * e.dps, wht = gross * w, net = gross - wht;
    const r = fxOn(fx, pay, cur);
    divGross += gross; whtTotal += wht; divNet += net; divNetCad += net * r;
    const price = priceOnOrAfter(q.c, pay);
    let bought = 0;
    if (pos.drip === 'frac') { bought = net / price; reinvested += net; }
    else if (pos.drip === 'whole') {
      cash += net; bought = Math.floor(cash / price + 1e-9);
      cash -= bought * price; reinvested += bought * price;
    } else { paidOut += net; paidOutCad += net * r; flows.push([pay, net * r]); }
    shares += bought; dripShares += bought;
    ledger.push({ kind: 'div', date: e.date, pay, held: shares - bought, dps: e.dps, gross, wht, net, netCad: net * r, price, bought, after: shares, cash });
    steps.push([pay, shares, invested, divNet, investedCad, divNetCad + 0]);
  }

  const px = q.px ?? priceOn(q.c, asOf);
  const rNow = fxOn(fx, asOf, cur);
  const marketValue = shares * px;
  const value = marketValue + cash; // cash: undeployed DRIP remainder still in the account
  const valueCad = value * rNow;
  const totalCad = valueCad + paidOutCad + realizedCad - boughtCad;
  const startShares = events.reduce((t, e) => t + (e.t === 'buy' ? e.shares : e.t === 'sell' ? -(e.shares || 0) : 0), 0);
  const st = q.st || {};
  const fwdDps = st.fwd ?? st.ttm ?? 0;
  const fwdNet = shares * fwdDps * (1 - w);

  return {
    pos, q, cur, w, shares, startShares, dripShares, cash, invested, investedCad,
    px, marketValue, value, valueCad, rNow,
    realized, realizedCad, divGross, divNet, divNetCad, whtTotal, whtCad: whtTotal * rNow, reinvested, paidOut, paidOutCad,
    totalCad, boughtCad, totalPct: boughtCad ? totalCad / boughtCad : NaN,
    priceGainCad: valueCad - investedCad - reinvested * rNow,
    fwdNet, fwdNetCad: fwdNet * rNow,
    yld: px ? fwdDps / px : NaN,
    yoc: investedCad ? (fwdNet * rNow) / investedCad : NaN,
    xirr: xirr([...flows, [asOf, valueCad]]),
    firstDate, ledger, steps, flows,
  };
}

/** Month-end series of value, capital and cumulative dividends for one simulated position (CAD). */
export function monthlySeries(sim, fx, months) {
  const out = [];
  const { q, steps, cur } = sim;
  let si = -1;
  for (const m of months) {
    const end = monthEnd(m);
    while (si + 1 < steps.length && steps[si + 1][0] <= end) si++;
    if (si < 0) { out.push({ m, value: 0, invested: 0, divs: 0, shares: 0 }); continue; }
    const [, sh, , , invCad] = steps[si];
    const r = fxOn(fx, end, cur);
    out.push({ m, value: sh * priceOn(q.c, end) * r, invested: invCad, shares: sh });
  }
  return out;
}
export function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const t = today();
  return d > t ? t : d;
}
export function monthsFrom(startIso, endIso = today()) {
  const out = [];
  let [y, m] = startIso.slice(0, 7).split('-').map(Number);
  const [ey, em] = endIso.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/** Expected payments over the next 12 months, from each security's own payment pattern. */
export function upcoming(sim, fx, from = today()) {
  const { q, shares, w, cur } = sim;
  const st = q.st || {};
  if (!shares || !st.freq) return [];
  const yearAgo = addDays(from, -365);
  const last = (q.div || []).filter(([d]) => d > yearAgo && d <= from);
  const rate = st.freq >= 4 ? (st.lastDiv ?? 0) : null;
  const r = fxOn(fx, from, cur);
  if (st.freq === 12 && last.length >= 6) {
    // Monthly payers: one payment per month on their usual ex-dividend day.
    const days = last.slice(-6).map(([d]) => +d.slice(8, 10)).sort((a, b) => a - b);
    const day = days[Math.floor(days.length / 2)];
    const out = [];
    const [y0, m0] = from.slice(0, 7).split('-').map(Number);
    for (let i = 0; i < 13 && out.length < 12; i++) {
      const y = y0 + Math.floor((m0 - 1 + i) / 12), m = ((m0 - 1 + i) % 12) + 1;
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const ex = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
      if (ex <= (st.lastEx || from) || ex <= from) continue;
      const net = shares * (rate ?? 0) * (1 - w);
      out.push({ sym: q.s, d: q.d, ex, pay: addDays(ex, PAY_LAG_DAYS), dps: rate, net, netCad: net * r, account: sim.pos.account });
    }
    return out;
  }
  return last.map(([d, amt]) => {
    const ex = addDays(d, 365);
    const dps = rate ?? amt;
    const net = shares * dps * (1 - w);
    return { sym: q.s, d: q.d, ex, pay: addDays(ex, PAY_LAG_DAYS), dps, net, netCad: net * r, account: sim.pos.account };
  }).filter(p => p.ex > from);
}

/** Internal rate of return on dated cash flows [[iso, amount], ...]. */
export function xirr(flows) {
  const f = flows.filter(([, a]) => Number.isFinite(a) && a !== 0);
  if (f.length < 2 || !f.some(x => x[1] < 0) || !f.some(x => x[1] > 0)) return NaN;
  const t0 = Date.parse(f[0][0]);
  const ts = f.map(([d]) => (Date.parse(d) - t0) / (365.25 * DAY));
  const span = Math.max(...ts);
  if (span < 0.08) return NaN; // under a month: annualising is meaningless
  const npv = r => f.reduce((s, [, a], i) => s + a / Math.pow(1 + r, ts[i]), 0);
  let lo = -0.99, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/**
 * Income snowball: grow every position year by year.
 * Dividend growth and price growth come from each security's own 5-year history, capped to sane ranges.
 * opts: { years, monthly (CAD contribution), drip (bool), haircut (0..1 applied to growth rates) }
 */
export function project(sims, opts) {
  const years = opts.years ?? 20, monthly = opts.monthly ?? 0, hc = opts.haircut ?? 0;
  const book = sims.filter(s => s.shares > 0).map(s => {
    const st = s.q.st || {};
    const g = clamp((st.g5 ?? st.g3 ?? 0.02) * (1 - hc), -0.05, 0.08);
    const p = clamp((st.p5 ?? st.p3 ?? 0.02) * (1 - hc), -0.06, 0.08);
    const px = s.px * s.rNow, dps = (st.fwd ?? 0) * s.rNow;
    return { shares: s.shares, px, dps, w: s.w, g, p, drip: s.pos.drip !== 'off', yMax: px > 0 ? (dps / px) * 1.5 : 0 };
  });
  const total0 = book.reduce((t, b) => t + b.shares * b.px, 0) || 1;
  book.forEach(b => (b.weight = (b.shares * b.px) / total0));
  const rows = [];
  let contributed = 0, cashTaken = 0;
  const snap = y => {
    const value = book.reduce((t, b) => t + b.shares * b.px, 0);
    const income = book.reduce((t, b) => t + b.shares * b.dps * (1 - b.w), 0);
    rows.push({ year: y, value, income, monthly: income / 12, contributed, cashTaken });
  };
  snap(0);
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      for (const b of book) {
        const pxM = b.px * Math.pow(1 + b.p, m / 12);
        const inc = b.shares * b.dps * (1 - b.w) / 12;
        if (opts.drip !== false && b.drip) b.shares += inc / pxM; else cashTaken += inc;
        if (monthly > 0) b.shares += (monthly * b.weight) / pxM;
      }
      contributed += monthly;
    }
    for (const b of book) { b.px *= 1 + b.p; b.dps = Math.min(b.dps * (1 + b.g), b.px * b.yMax); } // payouts that outrun a falling price get cut
    snap(y);
  }
  return rows;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));


const ID = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);
export const freqName = (f, t = ID) => t({ 52: 'Weekly', 12: 'Monthly', 4: 'Quarterly', 2: 'Semi-annual', 1: 'Annual' }[f] || 'Irregular');

/* ------------------------------------------------------------ Yield X-ray */
/** Option-income and leveraged-yield funds, paired with the plain fund that holds the same kind of stocks. */
export const TWINS = {
  'ZWC.TO': 'ZDV.TO', 'ZWB.TO': 'ZEB.TO', 'ZWU.TO': 'ZUT.TO', 'ZWH.TO': 'ZDY.TO', 'ZWK.TO': 'ZEB.TO', 'ZWS.TO': 'ZDY.TO',
  'ZWT.TO': 'XQQ.TO', 'ZWE.TO': 'XEF.TO', 'ZWA.TO': 'ZSP.TO', 'ZPAY.TO': 'ZSP.TO',
  'HMAX.TO': 'XFN.TO', 'QMAX.TO': 'XQQ.TO', 'UMAX.TO': 'ZUT.TO', 'SMAX.TO': 'ZSP.TO', 'EMAX.TO': 'XEG.TO',
  'HDIV.TO': 'XIU.TO', 'HYLD.TO': 'ZSP.TO', 'HCAL.TO': 'ZEB.TO', 'HFIN.TO': 'XFN.TO', 'BANK.TO': 'ZEB.TO', 'RBNK.TO': 'ZEB.TO',
  'ENCC.TO': 'XEG.TO', 'QQCL.TO': 'QQC.TO', 'USCL.TO': 'ZSP.TO', 'HPYT.TO': 'XBB.TO',
  JEPI: 'SPY', JEPQ: 'QQQ', QYLD: 'QQQ', XYLD: 'SPY', RYLD: 'IWM', DIVO: 'VYM', SPYI: 'SPY', QQQI: 'QQQ',
};
export const twinOf = sym => TWINS[sym] || null;
export const isYieldFund = sym => sym in TWINS;

/** Put the same dollars into another security on the same dates (sales sell the same fraction). */
export function replayInto(sim, otherQ, fx, over = {}) {
  const lots = [];
  let skipped = 0;
  for (const l of sim.ledger) {
    if (l.kind === 'buy') {
      const rIn = fxOn(fx, l.date, sim.cur), rOut = fxOn(fx, l.date, otherQ.cur || 'CAD');
      const amtOther = (l.amount * rIn) / rOut;
      const px = priceOn(otherQ.c, l.date);
      if (!(px > 0) || l.date < otherQ.c.d[0]) { skipped++; continue; }
      lots.push({ id: 'r' + lots.length, date: l.date, shares: amtOther / px / splitFactorAfter(otherQ, l.date), cost: amtOther });
    } else if (l.kind === 'sell') lots.push({ id: 'r' + lots.length, date: l.date, shares: -1, frac: l.fracSold });
  }
  const pos = { ...sim.pos, sym: otherQ.s, lots, ...over };
  const r = simulate(pos, otherQ, fx);
  r.skipped = skipped;
  return r;
}

/** $10,000 into a fund and into its plain twin on the same day, dividends reinvested, inside a TFSA. */
export function headToHead(q, twinQ, fx, years = 5, amount = 10000) {
  const start = [addDays(today(), -Math.round(365.25 * years)), q.c.d[0], twinQ.c.d[0]].sort().pop();
  const r = fxOn(fx, start, q.cur);
  const px = priceOn(q.c, start);
  const pos = { id: 'h2h', sym: q.s, account: 'TFSA', drip: 'frac', lots: [{ id: 'a', date: start, shares: amount / r / px / splitFactorAfter(q, start), cost: amount / r }] };
  const a = simulate(pos, q, fx);
  const b = replayInto(a, twinQ, fx);
  return { start, years: yearsBetween(start, today()), a, b };
}

/** One sentence-ready comparison for the portfolio. */
export function xray(sim, twinSim) {
  const incomeA = sim.divNetCad, incomeB = twinSim.divNetCad;
  const endA = sim.valueCad + sim.paidOutCad + sim.realizedCad, endB = twinSim.valueCad + twinSim.paidOutCad + twinSim.realizedCad;
  return { incomeA, incomeB, extraIncome: incomeA - incomeB, endA, endB, gap: endA - endB, xirrA: sim.xirr, xirrB: twinSim.xirr };
}

/* ------------------------------------------------------------ what-if */
export function scenarios(sim, fx, extras = []) {
  const base = sim.pos;
  const run = over => simulate({ ...base, ...over }, sim.q, fx);
  const out = [{ key: 'actual', sim }];
  for (const d of ['frac', 'whole', 'off']) if (d !== base.drip) out.push({ key: 'drip:' + d, sim: run({ drip: d }) });
  if (sim.q.ex === 'US' && base.account !== 'RRSP') out.push({ key: 'acct:RRSP', sim: run({ account: 'RRSP' }) });
  if (sim.q.ex === 'US' && base.account !== 'TFSA') out.push({ key: 'acct:TFSA', sim: run({ account: 'TFSA' }) });
  for (const [key, q] of extras) if (q && q.s !== sim.q.s) out.push({ key, sim: replayInto(sim, q, fx), q });
  return out;
}

/* ------------------------------------------------------------ account placement */
export function placement(sims) {
  // kinds: us-to-rrsp, income-to-tfsa, rrsp-swap (Canadian-listed US fund in an RRSP), cdr-in-rrsp
  const moves = [];
  for (const s of sims) {
    const gross = s.w ? s.fwdNetCad / (1 - s.w) : s.fwdNetCad;
    if (s.q.ex === 'US' && WHT_ACCOUNTS.has(s.pos.account) && gross > 0)
      moves.push({ kind: 'us-to-rrsp', s, save: gross * 0.15 });
    if (s.pos.account === 'Non-registered' && s.q.ex === 'CA' && (s.q.st?.fyld ?? 0) >= 0.05 && gross > 0)
      moves.push({ kind: 'income-to-tfsa', s, taxable: gross });
    if ((s.pos.account === 'RRSP' || s.pos.account === 'LIRA') && s.q.wh === 'CA-US' && US_EQUIV[s.q.s] && gross > 0) {
      const save = (gross / 0.85) * 0.15;
      moves.push({ kind: 'rrsp-swap', s, to: US_EQUIV[s.q.s], save, fx: s.valueCad * FX_FEE, payback: save > 0 ? (s.valueCad * FX_FEE) / save : Infinity });
    }
    if ((s.pos.account === 'RRSP' || s.pos.account === 'LIRA') && s.q.wh === 'CDR' && gross > 0)
      moves.push({ kind: 'cdr-in-rrsp', s, to: s.q.d, save: gross * 0.15, fx: s.valueCad * FX_FEE });
  }
  return moves.sort((a, b) => (b.save || 0) - (a.save || 0));
}

/* ------------------------------------------------------------ paycheque mode */
/** Fill bills in the order given with a monthly income figure. */
export function coverBills(bills, monthly) {
  let left = monthly;
  return bills.map(b => {
    const amt = Math.max(0, +b.amount || 0);
    const paid = Math.min(amt, Math.max(0, left));
    left -= paid;
    return { ...b, amt, paid, share: amt ? paid / amt : 0 };
  });
}

/* ------------------------------------------------------------ research note */
export function analystRead(q, sim, t = ID, fm = {}) {
  const st = q.st || {}, f = q.f || {};
  const P = fm.pct || (v => (v * 100).toFixed(1) + '%');
  const N = fm.num || (v => v.toFixed(2));
  const out = [];
  const kind = q.type === 'ETF' ? t('fund') : t('company');
  if (st.fyld != null) {
    let s = t('Pays {freq} with a forward yield of {y}', { freq: freqName(st.freq, t).toLowerCase(), y: P(st.fyld) });
    if (st.yAvg5 != null && st.yVsAvg != null) {
      const rel = st.yVsAvg;
      s += Math.abs(rel) < 0.08 ? t(', close to its 5-year average of {a}.', { a: P(st.yAvg5) })
        : rel > 0 ? t(', {r} above its 5-year average of {a}. Either the price has fallen or the payout has grown faster than the price; check which before reading it as cheap.', { r: P(rel), a: P(st.yAvg5) })
        : t(', {r} below its 5-year average of {a}, so the price has risen faster than the payout.', { r: P(-rel), a: P(st.yAvg5) });
    } else s += '.';
    out.push([t('Income'), s]);
  }
  const g = st.g5 ?? st.g3;
  if (g != null) {
    let s = t(g >= 0 ? 'The payout has grown {g} a year over {n} years' : 'The payout has shrunk {g} a year over {n} years', { g: P(Math.abs(g)), n: st.g5 != null ? 5 : 3 });
    s += st.streak >= 3 ? t(', with {n} straight years of increases.', { n: st.streak }) : '.';
    if (st.cuts10 > 0) s += ' ' + t('It was cut in {n} of the last 10 calendar years, so treat the current rate as variable.', { n: st.cuts10 });
    else if (st.hist >= 10) s += ' ' + t('No annual cuts in the last 10 years.');
    if (st.lastChg != null && st.lastChg < -0.05) s += ' ' + t('The latest payment is {p} lower than the ones before it.', { p: P(-st.lastChg) });
    if (st.lastChg != null && st.lastChg > 0.02) s += ' ' + t('The latest payment is {p} higher than the run-rate before it.', { p: P(st.lastChg) });
    out.push([t('Dividend growth'), s]);
  }
  const tr = st.tr5 ?? st.tr3, p = st.p5 ?? st.p3;
  if (tr != null && p != null) {
    let s = t('Over {n} years it returned {tr} a year with dividends reinvested: {p} from price and roughly {i} from income.', { n: st.tr5 != null ? 5 : 3, tr: P(tr), p: P(p), i: P(tr - p) });
    if (st.erosion) s += ' ' + t('The price has drifted down while paying a high yield. That is NAV erosion: part of each payout is your own capital coming back, typical of covered-call and leveraged income strategies. Inside a DRIP the share count rises but each share is worth less.');
    else if (p > 0.04 && (st.fyld ?? 0) < 0.04) s += ' ' + t('Most of the return comes from growth, so this is a growth engine more than an income engine.');
    else if ((st.fyld ?? 0) >= 0.06) s += ' ' + t('Most of the return comes from income, so this is an income engine.');
    else s += ' ' + t('It balances income and growth.');
    out.push([t('Total return'), s]);
  }
  if (st.mdd != null) {
    let s = t('Worst peak-to-trough fall in 5 years: {d}', { d: P(st.mdd) });
    if (st.vol != null) s += t(', annual volatility {v}', { v: P(st.vol) });
    s += '.';
    if (f.beta != null) s += ' ' + t('Beta {b} versus the market.', { b: N(f.beta) });
    if (st.cv != null && st.cv > 0.25) s += ' ' + t('Payments vary a lot from one to the next, so budget on the average, not the last one.');
    out.push([t('Risk'), s]);
  }
  const fs = [];
  if (f.mer != null) fs.push(t('management fee {m}%', { m: N(f.mer) }));
  if (f.pe != null) fs.push(t('P/E {pe}', { pe: N(f.pe) }) + (f.fpe ? ' ' + t('(forward {f})', { f: N(f.fpe) }) : ''));
  if (f.payout != null && q.type !== 'ETF') fs.push(t('payout ratio {p}', { p: P(f.payout) }) + (f.payout > 0.9 ? ' ' + t('(high: earnings barely cover it, though REITs, utilities and pipelines often run on cash-flow payout instead)') : ''));
  if (f.de != null) fs.push(t('debt-to-equity {d}%', { d: Math.round(f.de) }));
  if (f.roe != null) fs.push(t('return on equity {r}', { r: P(f.roe) }));
  if (f.earn_g != null) fs.push(t('earnings growth {g} year on year', { g: P(f.earn_g) }));
  if (fs.length) out.push([t('Fundamentals'), t('For this {k}: {list}.', { k: kind, list: fs.join(', ') })]);
  if (q.ex === 'US') out.push([t('Account placement'), t('US-listed: 15% of each dividend is withheld by the IRS. In an RRSP nothing is withheld; in a TFSA, FHSA or RESP the 15% is lost for good; in a non-registered account you can usually claim it back as a foreign tax credit.')]);
  else if ((st.fyld ?? 0) > 0.05) out.push([t('Account placement'), t('High-yield Canadian income is best sheltered in a TFSA or RRSP. In a non-registered account eligible dividends get the dividend tax credit, but option premium and return of capital are taxed differently, so check the fund’s annual tax breakdown.')]);
  const sc = st.score ?? 0;
  const verdict = t(sc >= 80 ? 'Core holding quality' : sc >= 65 ? 'Solid' : sc >= 50 ? 'Mixed: watch it' : 'Weak: review the thesis');
  out.push([t('Verdict'), t('{v} (score {s}/100{lim}). Check every quarter: the payout run-rate, yield versus its 5-year average, and {last}.', { v: verdict, s: sc, lim: st.limited ? t(', short history') : '', last: st.erosion ? t('whether the price keeps sliding') : t('total return versus a plain index fund') })]);
  if (sim && sim.shares > 0) {
    out.push([t('Your position'), t('You started with {a} shares and DRIP has added {b}, {p} more shares from reinvested dividends. Your yield on cost is {y}.', { a: (fm.sh || String)(sim.startShares), b: (fm.sh || String)(sim.dripShares), p: P(sim.startShares ? sim.dripShares / sim.startShares : 0), y: P(sim.yoc || 0) })]);
  }
  return out;
}

/** Portfolio-level alerts worth showing at the top. */
export function alerts(sims, totalCad, t = ID, fm = {}) {
  const M = fm.money || (v => '$' + v.toFixed(2)), P = fm.pct || (v => (v * 100).toFixed(1) + '%');
  const a = [];
  for (const s of sims) {
    const st = s.q.st || {}, d = s.q.d;
    if (st.lastChg != null && st.lastChg < -0.05) a.push({ lvl: 'bad', text: t('{s} cut its latest payment by {p}.', { s: d, p: P(-st.lastChg) }) });
    if (st.erosion) a.push({ lvl: 'warn', text: t('{s} shows NAV erosion: a high yield with a falling price over 5 years.', { s: d }) });
    if (s.w > 0 && WHT_ACCOUNTS.has(s.pos.account) && s.fwdNetCad > 1) a.push({ lvl: 'warn', text: t('{s} in your {a}: {m} a year lost to US withholding. An RRSP avoids it.', { s: d, a: t(s.pos.account), m: M(s.fwdNetCad / (1 - s.w) * s.w) }) });
    if (totalCad && s.valueCad / totalCad > 0.3) a.push({ lvl: 'info', text: t('{s} is {p} of the portfolio.', { s: d, p: P(s.valueCad / totalCad) }) });
    if (st.lastChg != null && st.lastChg > 0.02) a.push({ lvl: 'good', text: t('{s} raised its payment by {p}.', { s: d, p: P(st.lastChg) }) });
  }
  return a;
}

/* ------------------------------------------------------------ valuation versus its own history */
/**
 * Cheap / fair / expensive versus the security's OWN history. Inputs come from a quote's stats or an
 * index row: y (current yield), ya (5-year average yield), ya10, yp (share of the last 5 years with a
 * lower yield), r52 (0 = at the 52-week low, 1 = at the high). Education, not a recommendation.
 */
export function valuation(v) {
  const sig = [];
  let score = 0, n = 0;
  const payer = v.y >= 0.01 && v.ya > 0;
  if (payer) {
    const d = v.y / v.ya - 1;
    const s = d > 0.2 ? 2 : d > 0.08 ? 1 : d < -0.2 ? -2 : d < -0.08 ? -1 : 0;
    score += s; n++; sig.push({ k: 'yield', d, s });
    if (v.ya10 > 0) sig.push({ k: 'yield10', d: v.y / v.ya10 - 1 });
    if (v.yp != null) { const s2 = v.yp >= 0.8 ? 1 : v.yp <= 0.2 ? -1 : 0; score += s2; n++; sig.push({ k: 'pct', p: v.yp, s: s2 }); }
  }
  if (v.r52 != null) { const s3 = v.r52 <= 0.2 ? 1 : v.r52 >= 0.9 ? -1 : 0; score += s3; n++; sig.push({ k: 'range', r: v.r52, s: s3 }); }
  if (!n) return null;
  const kind = !payer ? 'range' : score >= 2 ? 'cheap' : score <= -2 ? 'expensive' : 'fair';
  const fair = payer && v.fwd > 0 && !v.erosion ? v.fwd / v.ya : null;
  const caution = kind === 'cheap' && (v.cut || (v.cuts10 || 0) > 0 || (v.payout || 0) > 1 || v.erosion);
  return { kind, score, pos: Math.max(0, Math.min(1, 0.5 - score / 8)), sig, fair, fair10: payer && v.fwd > 0 && v.ya10 > 0 && !v.erosion ? v.fwd / v.ya10 : null, caution, optionIncome: !!v.erosion || (v.tags || []).includes('covered-call') };
}
export const valuationFromQuote = q => {
  const st = q.st || {};
  return valuation({ y: st.fyld ?? st.yld, ya: st.yAvg5, ya10: st.yAvg10, yp: st.yPct5, r52: st.r52, fwd: st.fwd, erosion: st.erosion, cut: (st.lastChg ?? 0) < -0.05, cuts10: st.cuts10, payout: q.type === 'ETF' ? null : q.f?.payout, tags: q.tags });
};
export const valuationFromRow = r => valuation({ y: r.y, ya: r.ya, yp: r.yp, r52: r.r52, erosion: r.er, cut: r.cut, tags: r.tags });

/* ------------------------------------------------------------ projection ideas */
const withDrip = sims => sims.map(s => ({ ...s, pos: { ...s.pos, drip: s.pos.drip === 'off' ? 'frac' : s.pos.drip } }));
const goalYear = (sims, o, goal) => { if (!goal) return null; const r = project(sims, { ...o, years: 40 }).find(x => x.monthly >= goal); return r ? r.year : null; };
/** Ranked ways to grow the income in the projection. Each idea carries its monthly-income effect at the horizon. */
export function planIdeas(sims, o, goal) {
  const base = project(sims, o), end = base[base.length - 1].monthly, gy = goalYear(sims, o, goal);
  const ideas = [];
  const step = o.monthly >= 1000 ? 250 : 100;
  const more = project(sims, { ...o, monthly: o.monthly + step });
  ideas.push({ kind: 'more', step, gain: more[more.length - 1].monthly - end, goalYears: gy != null ? gy - (goalYear(sims, { ...o, monthly: o.monthly + step }, goal) ?? gy) : null });
  const off = sims.filter(s => s.shares > 0 && s.pos.drip === 'off');
  if (!o.drip || off.length) {
    const d = project(withDrip(sims), { ...o, drip: true });
    const gain = d[d.length - 1].monthly - end;
    if (gain > 0.5) ideas.push({ kind: 'drip', gain, syms: o.drip ? off.map(s => s.q.d) : null, cashLost: base[base.length - 1].cashTaken });
  }
  for (const m of placement(sims)) if (m.save > 0) ideas.push({ kind: 'place', move: m, gain: m.save / 12 });
  if (goal && end < goal) {
    let lo = o.monthly, hi = Math.max(1000, o.monthly * 4);
    while (project(sims, { ...o, monthly: hi }).at(-1).monthly < goal && hi < 50000) hi *= 2;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (project(sims, { ...o, monthly: mid }).at(-1).monthly >= goal) hi = mid; else lo = mid; }
    if (hi < 50000) ideas.push({ kind: 'goal', need: Math.ceil(hi / 10) * 10, gain: goal - end });
  }
  return { ideas: ideas.sort((a, b) => b.gain - a.gain), goalYear: gy };
}

/* ------------------------------------------------------------ growth comparison */
/** Outcome of a simulated position: what you have now plus cash taken out along the way. */
export const outcome = s => s.valueCad + s.paidOutCad + s.realizedCad;
