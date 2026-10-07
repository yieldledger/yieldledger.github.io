import { createAuth } from './auth.js';
import * as D from './data.js';
import * as E from './engine.js';
import { lineChart, barChart, sparkline } from './charts.js';
import { parseQuick, parseExport } from './importer.js';
import { t, tp, getLang, setLang, loc, MONTHS } from './i18n.js';

/* ------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fin = v => Number.isFinite(v);
let NF = {};
function buildFormats() {
  const L = loc();
  NF = {
    cad: new Intl.NumberFormat(L, { style: 'currency', currency: 'CAD' }),
    cad0: new Intl.NumberFormat(L, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }),
    usd: new Intl.NumberFormat(L, { style: 'currency', currency: 'USD' }),
    pct: d => new Intl.NumberFormat(L, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }),
    num: d => new Intl.NumberFormat(L, { minimumFractionDigits: d, maximumFractionDigits: d }),
    sh: new Intl.NumberFormat(L, { maximumFractionDigits: 3 }),
  };
}
buildFormats();
const money = v => (fin(v) ? NF.cad.format(v) : '—');
const money0 = v => (fin(v) ? NF.cad0.format(v) : '—');
const nat = (v, cur) => (fin(v) ? (cur === 'USD' ? NF.usd : NF.cad).format(v) : '—');
const pct = (v, d = 2) => (fin(v) ? NF.pct(d).format(v) : '—');
const sgnPct = (v, d = 2) => (fin(v) ? (v >= 0 ? '+' : '−') + NF.pct(d).format(Math.abs(v)) : '—');
const sgnMoney = v => (fin(v) ? (v >= 0 ? '+' : '−') + NF.cad.format(Math.abs(v)) : '—');
const shares = v => (fin(v) ? NF.sh.format(v) : '—');
const num = (v, d = 2) => (fin(v) ? NF.num(d).format(v) : '—');
const cls = v => (!fin(v) ? '' : v >= 0 ? 'pos' : 'neg');
const sum = (a, f) => a.reduce((x, y) => x + (Number(f(y)) || 0), 0);
const MON = () => MONTHS[getLang()];
const dfmt = iso => (!iso ? '—' : getLang() === 'fr' ? `${+iso.slice(8, 10)} ${MON()[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : `${MON()[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`);
const mfmt = ym => `${MON()[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const mshort = ym => `${MON()[+ym.slice(5, 7) - 1]} ’${ym.slice(2, 4)}`;
const shortM = v => {
  const a = Math.abs(v), s = v < 0 ? '−' : '', fr = getLang() === 'fr';
  const f = (x, d) => NF.num(d).format(x);
  if (a >= 1e6) return fr ? `${s}${f(a / 1e6, a >= 1e7 ? 0 : 1)} M$` : `${s}$${f(a / 1e6, a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return fr ? `${s}${f(a / 1e3, a >= 1e4 ? 0 : 1)} k$` : `${s}$${f(a / 1e3, a >= 1e4 ? 0 : 1)}k`;
  const d = a >= 10 || a === 0 ? 0 : 2;
  return fr ? `${s}${f(a, d)} $` : `${s}$${f(a, d)}`;
};
const FM = () => ({ pct: v => pct(v, 1), num: v => num(v, 2), money, sh: shares });
const acct = a => t(a);
const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const scoreCls = s => (s >= 80 ? 'a' : s >= 65 ? 'b' : s >= 50 ? 'c' : 'd');
const scoreBadge = s => (fin(s) ? `<span class="score ${scoreCls(s)}" title="${esc(t('Quality score out of 100'))}">${s}</span>` : '<span class="muted">—</span>');
const CFG = window.YL_CONFIG || {};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const DRIP = () => ({ frac: t('DRIP (fractional)'), whole: t('DRIP (whole shares)'), off: t('Cash payout') });
let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3600); }

/* ------------------------------------------------------------ state */
const DEMO = {
  v: 1, settings: { account: 'TFSA', drip: 'frac', goal: 500 },
  bills: [{ id: 'b1', name: 'Phone', amount: 65 }, { id: 'b2', name: 'Internet', amount: 85 }, { id: 'b3', name: 'Hydro', amount: 140 }, { id: 'b4', name: 'Car insurance', amount: 160 }, { id: 'b5', name: 'Groceries', amount: 600 }],
  positions: [
    { id: 'd1', sym: 'VDY.TO', account: 'TFSA', drip: 'frac', lots: [{ id: 'l1', date: '2022-01-17', shares: 120 }, { id: 'l2', date: '2024-03-01', shares: 40 }] },
    { id: 'd2', sym: 'XEI.TO', account: 'TFSA', drip: 'frac', lots: [{ id: 'l3', date: '2022-06-01', shares: 250 }] },
    { id: 'd3', sym: 'ZWC.TO', account: 'TFSA', drip: 'whole', lots: [{ id: 'l4', date: '2023-02-01', shares: 300 }] },
    { id: 'd4', sym: 'HMAX.TO', account: 'TFSA', drip: 'frac', lots: [{ id: 'l5', date: '2024-01-15', shares: 400 }] },
    { id: 'd5', sym: 'SCHD', account: 'TFSA', drip: 'frac', lots: [{ id: 'l6', date: '2023-01-03', shares: 100 }] },
    { id: 'd6', sym: 'ENB.TO', account: 'RRSP', drip: 'off', lots: [{ id: 'l7', date: '2021-11-01', shares: 80 }] },
    { id: 'd7', sym: 'SCHD', account: 'RRSP', drip: 'frac', lots: [{ id: 'l8', date: '2024-06-03', shares: 60 }] },
    { id: 'd8', sym: 'VFV.TO', account: 'RRSP', drip: 'frac', lots: [{ id: 'l9', date: '2022-03-01', shares: 50 }] },
  ],
};
const emptyPf = () => ({ v: 1, positions: [], bills: [], settings: { account: 'TFSA', drip: 'frac', goal: 1000 } });
const S = { auth: null, user: null, demo: false, pf: null, rows: [], fx: null, meta: null, quotes: {}, twins: {}, sims: [], missing: [], lastRoute: '', whatIf: {} };

async function recompute() {
  const ps = S.pf?.positions || [];
  S.quotes = await D.loadQuotes(ps.map(p => p.sym));
  S.sims = []; S.missing = [];
  for (const p of ps) {
    const q = S.quotes[p.sym];
    if (q && q.c && q.c.d.length) S.sims.push(E.simulate(p, q, S.fx)); else S.missing.push(p);
  }
  const twinSyms = [...new Set(S.sims.map(s => E.twinOf(s.q.s)).filter(Boolean))];
  S.twins = await D.loadQuotes(twinSyms);
}
let saving = Promise.resolve();
function persist() {
  if (S.demo || !S.pf) return saving;
  const snapshot = JSON.parse(JSON.stringify(S.pf));
  saving = saving.then(() => S.auth.save(snapshot)).catch(e => toast(e.message || t('Could not save your changes.')));
  return saving;
}
async function changed(nextHash) { await recompute(); persist(); if (nextHash && location.hash !== nextHash) location.hash = nextHash; else route(); }

/* ------------------------------------------------------------ portfolio maths */
function totals() {
  const sims = S.sims, td = E.today(), yearAgo = E.addDays(td, -365);
  const valueCad = sum(sims, s => s.valueCad), investedCad = sum(sims, s => s.investedCad), boughtCad = sum(sims, s => s.boughtCad);
  const totalCad = sum(sims, s => s.totalCad), fwd = sum(sims, s => s.fwdNetCad);
  const divRows = sims.flatMap(s => s.ledger.filter(l => l.kind === 'div').map(l => ({ ...l, s })));
  const flows = sims.flatMap(s => s.flows).sort((a, b) => a[0].localeCompare(b[0]));
  const whtLost = sum(sims.filter(s => s.w > 0 && E.WHT_ACCOUNTS.has(s.pos.account)), s => (s.fwdNetCad / (1 - s.w)) * s.w);
  return {
    valueCad, investedCad, boughtCad, totalCad, totalPct: boughtCad ? totalCad / boughtCad : NaN, fwd,
    divAll: sum(sims, s => s.divNetCad), reinvCad: sum(sims, s => s.reinvested * s.rNow), last12: sum(divRows.filter(r => r.pay > yearAgo), r => r.netCad), whtLost,
    dripValue: sum(sims, s => s.dripShares * s.px * s.rNow), xirr: E.xirr([...flows, [td, valueCad]]),
    yld: valueCad ? fwd / valueCad : NaN, yoc: investedCad ? fwd / investedCad : NaN, divRows,
    first: sims.map(s => s.firstDate).sort()[0],
  };
}
function incomeByMonth() {
  const hist = new Map(), proj = new Map();
  const add = (m, key, sym, v) => { const o = m.get(key) || { total: 0, by: {} }; o.total += v; o.by[sym] = (o.by[sym] || 0) + v; m.set(key, o); };
  for (const s of S.sims) {
    for (const l of s.ledger) if (l.kind === 'div') add(hist, E.monthKey(l.pay), s.q.d, l.netCad);
    for (const u of E.upcoming(s, S.fx)) add(proj, E.monthKey(u.pay), s.q.d, u.netCad);
  }
  return { hist, proj };
}
const next12 = () => { const out = []; const d = new Date(); for (let i = 0; i < 12; i++) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)).toISOString().slice(0, 7)); return out; };
function next12Income() {
  const { hist, proj } = incomeByMonth(), cur = E.today().slice(0, 7);
  return next12().map(m => ({ m, v: (m === cur ? hist.get(m)?.total || 0 : 0) + (proj.get(m)?.total || 0) }));
}
function xrays() {
  return S.sims.map(s => {
    const tq = S.twins[E.twinOf(s.q.s)];
    if (!tq || !s.shares) return null;
    const twinSim = E.replayInto(s, tq, S.fx);
    return { s, tq, twinSim, x: E.xray(s, twinSim) };
  }).filter(Boolean);
}

/* ------------------------------------------------------------ boot & routing */
async function boot() {
  const [idx, fx, meta] = await Promise.all([D.loadIndex(), D.loadFx(), D.loadMeta()]);
  S.rows = idx.rows || []; S.fx = fx; S.meta = meta;
  S.auth = await createAuth();
  S.user = S.auth.current();
  S.auth.onChange(async u => {
    S.user = u;
    if (u) { await loadPortfolio(); location.hash = '#/'; route(); }
    else if (!S.demo) { S.pf = null; S.sims = []; location.hash = '#/login'; route(); }
  });
  if (S.user) await loadPortfolio();
  window.addEventListener('hashchange', route);
  route();
}
async function loadPortfolio() {
  try { S.pf = (await S.auth.load()) || emptyPf(); }
  catch (e) { S.pf = emptyPf(); toast(t('Could not load your saved portfolio: {e}', { e: e.message })); }
  S.pf.settings = { ...emptyPf().settings, ...(S.pf.settings || {}) };
  S.pf.positions = S.pf.positions || [];
  S.pf.bills = S.pf.bills || [];
  if (S.pf.settings.lang && S.pf.settings.lang !== getLang()) { setLang(S.pf.settings.lang); buildFormats(); }
  await recompute();
}
async function startDemo() { S.demo = true; S.pf = structuredClone(DEMO);  await recompute(); location.hash = '#/'; route(); }

function route() {
  feedbackButton(); $('#fb-open').textContent = t('Feedback');
  const h = location.hash || '#/';
  if (!S.user && !S.demo) return viewLogin();
  if (h === '#/login') { location.hash = '#/'; return; }
  const [, a, b] = h.split('/');
  if (h !== S.lastRoute) window.scrollTo(0, 0);
  S.lastRoute = h;
  if (!a) return viewPortfolio();
  if (a === 'income') return viewIncome();
  if (a === 'bills') return viewBills();
  if (a === 'plan') return viewPlan();
  if (a === 'research') return viewResearch();
  if (a === 'add') return viewAdd();
  if (a === 'settings') return viewSettings();
  if (a === 'h') return viewDetail({ posId: decodeURIComponent(b || '') });
  if (a === 't') return viewDetail({ sym: decodeURIComponent(b || '') });
  return viewPortfolio();
}

const LOGO = `<span class="brand-mark"><svg viewBox="0 0 16 16"><path d="M2 14h3V9H2zm4.5 0h3V6h-3zM11 14h3V2h-3z" fill="#C99A2E"/></svg></span>`;
const langToggle = () => `<div class="seg lang" role="group" aria-label="Language / Langue"><button data-lang="en" aria-pressed="${getLang() === 'en'}">EN</button><button data-lang="fr" aria-pressed="${getLang() === 'fr'}">FR</button></div>`;
function shell(active, inner) {
  const nav = [['#/', t('Portfolio'), 'home'], ['#/income', t('Income'), 'income'], ['#/bills', t('Paycheque'), 'bills'], ['#/plan', t('Projections'), 'plan'], ['#/research', t('Research'), 'research'], ['#/add', t('Add holdings'), 'add'], ['#/settings', t('Settings'), 'settings']];
  $('#app').innerHTML = `
  <header class="topbar"><div class="topbar-in">
    <a class="brand" href="#/">${LOGO}Yield Ledger</a>
    <nav class="nav" aria-label="${esc(t('Main'))}">${nav.map(([h, l, k]) => `<a href="${h}" ${k === active ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>
    <div class="who">${langToggle()}${S.demo ? `<button class="btn sm" data-act="exit-demo">${t('Sign in')}</button>` : `<span class="email">${esc(S.user?.email)}</span><button class="btn sm ghost" data-act="sign-out">${t('Sign out')}</button>`}</div>
  </div></header>
  ${S.demo ? `<div class="demo-bar"><div><span><b>${t('Demo portfolio.')}</b> ${t('Real tickers, real prices and real dividend history; the holdings are made up. Create an account to track your own.')}</span><button class="btn sm primary" data-act="exit-demo">${t('Create your account')}</button></div></div>` : ''}
  <main id="main">${inner}</main>`;
}
function dataFoot() {
  const m = S.meta;
  return `<footer class="foot"><span>${m ? t('Market data updated {d} for {n} securities. Prices refresh after each trading day’s close.', { d: esc(new Date(m.updated).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' })), n: m.count }) : t('Market data has not been loaded yet. The first daily update fills it in.')}</span>
  <span>${t('Dividend payment dates are estimated as 7 days after the ex-dividend date. DRIP purchases are replayed at the closing price on that date. Data from Yahoo Finance. For tracking and education, not financial advice.')}</span>
  <span class="foot-links"><a href="#/settings">${t('Install the app')}</a>${CFG.donateUrl ? ` · <a href="${esc(CFG.donateUrl)}" target="_blank" rel="noopener">${t('Support Yield Ledger')}</a>` : ''}</span></footer>`;
}
const noHoldings = (active, title) => shell(active, `<div class="page-head"><div><h1>${title}</h1></div></div><div class="panel empty"><h3>${t('No holdings yet')}</h3><a class="btn primary" href="#/add">${t('Add holdings')}</a></div>`);

/* ------------------------------------------------------------ login */
function viewLogin() {
  const tape = ['VDY.TO', 'XEI.TO', 'ZWC.TO', 'SCHD', 'ENB.TO', 'HMAX.TO'].map(s => S.rows.find(r => r.s === s)).filter(Boolean);
  const cloud = S.auth.mode === 'cloud';
  $('#app').innerHTML = `
  <div class="login">
    <section class="login-side">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><a class="brand" href="#/login">${LOGO}Yield Ledger</a>${langToggle()}</div>
      <h1>${t('Watch every dividend')} <em>${t('buy you more shares.')}</em></h1>
      <ul>
        <li><span>${t('Enter a ticker, a share count and a date. Every dividend since then is replayed and reinvested for you, month by month.')}</span></li>
        <li><span>${t('Yield X-ray: see whether a covered-call ETF’s big yield actually beat the plain fund it is built on.')}</span></li>
        <li><span>${t('Built for Canadian accounts: TFSA, RRSP, FHSA and the 15% US withholding that quietly drains a TFSA.')}</span></li>
        <li><span>${t('Paycheque mode: watch your dividends take over your phone bill, your hydro, your groceries.')}</span></li>
      </ul>
      ${tape.length ? `<div class="ticker-tape" aria-label="${esc(t('Current yields'))}">${tape.map(r => `<span><b>${esc(r.d)}</b> ${pct(r.y)}</span>`).join('')}</div>` : ''}
    </section>
    <section class="login-main"><div class="login-card">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="in">${t('Sign in')}</button>
        <button role="tab" aria-selected="false" data-tab="up">${t('Create account')}</button>
      </div>
      <form id="auth-form" novalidate>
        <h2 id="auth-title">${t('Welcome back')}</h2>
        <div class="field"><label for="a-email">${t('Email')}</label><input id="a-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="a-pw">${t('Password')}</label><input id="a-pw" type="password" autocomplete="current-password" minlength="8" required></div>
        <p class="err" id="a-err" hidden></p><p class="ok-msg" id="a-ok" hidden></p>
        <button class="btn primary" type="submit" id="a-go" style="justify-content:center">${t('Sign in')}</button>
        ${cloud ? `<button class="btn ghost sm" type="button" id="a-reset" style="justify-self:start">${t('Forgot password?')}</button>` : ''}
      </form>
      <div class="divider">${t('or')}</div>
      <button class="btn" data-act="demo" style="justify-content:center">${t('Explore the demo portfolio')}</button>
      <p class="fine">${cloud ? t('Your portfolio is stored in your account and syncs across devices.') : t('Accounts are stored in this browser. Your portfolio stays on this device.')}</p>
    </div></section>
  </div>`;
  let mode = 'in';
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.tab;
    $$('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $('#auth-title').textContent = mode === 'in' ? t('Welcome back') : t('Create your account');
    $('#a-go').textContent = mode === 'in' ? t('Sign in') : t('Create account');
    $('#a-pw').autocomplete = mode === 'in' ? 'current-password' : 'new-password';
    $('#a-err').hidden = true;
  }));
  $('#auth-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = $('#a-email').value.trim(), pw = $('#a-pw').value, err = $('#a-err');
    err.hidden = true; $('#a-ok').hidden = true;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = t('Enter a valid email address.'); err.hidden = false; return; }
    if (pw.length < 8) { err.textContent = t('Use a password of at least 8 characters.'); err.hidden = false; return; }
    $('#a-go').disabled = true;
    try {
      const r = mode === 'in' ? await S.auth.signIn(email, pw) : await S.auth.signUp(email, pw);
      if (r && r.pendingConfirm) { $('#a-ok').textContent = t('Check your email to confirm your account, then sign in.'); $('#a-ok').hidden = false; }
      else { S.demo = false; S.user = r; await loadPortfolio(); location.hash = S.pf.positions.length ? '#/' : '#/add'; route(); }
    } catch (e) { err.textContent = t(e.message); err.hidden = false; }
    finally { const b = $('#a-go'); if (b) b.disabled = false; }
  });
  $('#a-reset')?.addEventListener('click', async () => {
    const email = $('#a-email').value.trim();
    if (!email) { $('#a-err').textContent = t('Enter your email first.'); $('#a-err').hidden = false; return; }
    try { await S.auth.resetPassword(email); $('#a-ok').textContent = t('Password reset email sent.'); $('#a-ok').hidden = false; }
    catch (e) { $('#a-err').textContent = e.message; $('#a-err').hidden = false; }
  });
}

/* ------------------------------------------------------------ portfolio */
function kpi(label, v, s, extra = '') { return `<div class="kpi ${extra}"><span class="label">${label}</span><span class="v">${v}</span><span class="s">${s}</span></div>`; }
function holdingChips(s) {
  const st = s.q.st || {};
  return `<div class="chips"><span class="chip">${esc(acct(s.pos.account))}</span>${s.pos.drip !== 'off' ? '<span class="chip drip">DRIP</span>' : `<span class="chip">${t('Cash')}</span>`}${s.w && E.WHT_ACCOUNTS.has(s.pos.account) ? `<span class="chip wht">${t('15% US withholding')}</span>` : ''}${st.erosion ? `<span class="chip warn">${t('NAV erosion')}</span>` : ''}${st.lastChg != null && st.lastChg < -0.05 ? `<span class="chip bad">${t('Payout cut')}</span>` : ''}</div>`;
}
function xrayRow(r) {
  const { s, tq, x } = r;
  const ahead = x.gap >= 0;
  return `<div class="xr ${ahead ? 'ahead' : 'behind'}">
    <div class="xr-h"><a class="tk" href="#/h/${encodeURIComponent(s.pos.id)}">${esc(s.q.d)}</a> <span class="muted">${t('vs plain {t}', { t: esc(tq.d) })}</span>${r.twinSim.skipped ? ` <span class="chip">${t('partial history')}</span>` : ''}</div>
    <div class="xr-cols">
      <div><span class="label">${t('Extra dividends from {s}', { s: esc(s.q.d) })}</span><b class="${cls(x.extraIncome)}">${sgnMoney(x.extraIncome)}</b></div>
      <div><span class="label">${t('Ahead or behind overall')}</span><b class="${cls(x.gap)}">${sgnMoney(x.gap)}</b></div>
    </div>
    <div class="xr-cols">
      <div><span class="label">${t('{s} per year', { s: esc(s.q.d) })}</span><b class="${cls(x.xirrA)}">${sgnPct(x.xirrA, 1)}</b></div>
      <div><span class="label">${t('{s} per year', { s: esc(tq.d) })}</span><b class="${cls(x.xirrB)}">${sgnPct(x.xirrB, 1)}</b></div>
    </div>
    <p>${ahead ? t('{a} paid you {i} more in dividends and you are still {g} ahead overall. The yield is earning its keep.', { a: esc(s.q.d), i: money0(Math.abs(x.extraIncome)), g: money0(Math.abs(x.gap)) })
      : x.extraIncome > 0 ? t('{a} paid you {i} more in dividends, but you would have {g} more in total with plain {b}. The extra yield cost you growth.', { a: esc(s.q.d), b: esc(tq.d), i: money0(x.extraIncome), g: money0(Math.abs(x.gap)) })
      : t('Plain {b} beat {a} on both income and total return over your holding period.', { a: esc(s.q.d), b: esc(tq.d) })}</p>
  </div>`;
}
function placementBlock() {
  const moves = E.placement(S.sims);
  if (!moves.length) return '';
  const save = sum(moves, m => m.save || 0);
  return `<section class="sec"><div class="sec-head"><h2>${t('Account placement')}</h2>${save ? `<span class="pill-good">${t('Up to {m} a year to keep', { m: money0(save) })}</span>` : ''}</div>
    <div class="panel stack">${moves.map(m => m.kind === 'us-to-rrsp'
      ? `<div class="move"><b class="mono">${esc(m.s.q.d)}</b><span>${t('In your {a}, 15% of every dividend goes to the IRS for good. Held in an RRSP, that {m} a year would stay with you.', { a: esc(acct(m.s.pos.account)), m: `<b>${money(m.save)}</b>` })}</span></div>`
      : m.kind === 'rrsp-swap'
      ? `<div class="move"><b class="mono">${esc(m.s.q.d)}</b><span>${t('In your RRSP, the US keeps 15% of the dividends inside this Canadian-listed fund. The US-listed {u} tracks the same index and skips it in an RRSP: about {m} a year. Converting costs about {fx} once at Wealthsimple’s 1.5%, so it pays back in {y}.', { u: `<b>${esc(m.to)}</b>`, m: `<b>${money(m.save)}</b>`, fx: money(m.fx), y: m.payback < 50 ? tp(Math.ceil(m.payback), '{n} year', '{n} years') : t('a long time') })}</span></div>`
      : m.kind === 'cdr-in-rrsp'
      ? `<div class="move"><b class="mono">${esc(m.s.q.d)}</b><span>${t('A CDR in an RRSP still loses 15% of dividends: about {m} a year. The US-listed share would not, but buying it costs about {fx} in currency conversion.', { m: `<b>${money(m.save)}</b>`, fx: money(m.fx) })}</span></div>`
      : `<div class="move"><b class="mono">${esc(m.s.q.d)}</b><span>${t('{m} a year of distributions is taxable in your non-registered account. Room in a TFSA would make it tax-free.', { m: `<b>${money(m.taxable)}</b>` })}</span></div>`).join('')}
      <p class="muted" style="margin:0;font-size:12.5px">${t('A calculation, not advice: contribution room, your tax bracket, currency conversion and the cost of selling all matter. RRSP withholding relief applies only to US-listed securities held directly.')}</p></div></section>`;
}
function viewPortfolio() {
  if (!S.pf.positions.length) {
    shell('home', `<div class="page-head"><div><h1>${t('Your portfolio')}</h1><p>${t('Nothing here yet.')}</p></div></div>
      <div class="panel empty"><h3>${t('Add your first holding')}</h3><p>${t('Ticker, number of shares and the date you bought. Everything else is filled in for you, including every dividend and DRIP purchase since that date.')}</p>
      <div class="tools"><a class="btn primary" href="#/add">${t('Add holdings')}</a><a class="btn" href="#/research">${t('Browse dividend ETFs and stocks')}</a></div></div>${dataFoot()}`);
    return;
  }
  const T = totals();
  const al = E.alerts(S.sims, T.valueCad, t, FM());
  const xr = xrays();
  const sims = [...S.sims].sort((a, b) => b.valueCad - a.valueCad);
  const months = T.first ? E.monthsFrom(T.first) : [];
  const series = S.sims.map(s => E.monthlySeries(s, S.fx, months));
  const val = months.map((_, i) => sum(series, x => x[i].value)), inv = months.map((_, i) => sum(series, x => x[i].invested));
  const byAcct = {};
  for (const s of S.sims) byAcct[s.pos.account] = (byAcct[s.pos.account] || 0) + s.valueCad;
  shell('home', `
  <div class="page-head"><div><h1>${t('Portfolio')}</h1><p class="lede">${t('Everything you own, what it is worth today and what it pays you. Tap any holding for the details.')}</p><p>${tp(S.sims.length, '{n} position', '{n} positions')} · ${t('values in CAD')} · ${t('priced {d}', { d: esc(dfmt(S.sims[0]?.q.asof)) })}</p></div>
    <div class="tools"><a class="btn" href="#/add">${t('Add holdings')}</a></div></div>
  ${S.missing.length ? `<div class="alert warn"><i></i><span>${t('Waiting for market data on {s}.', { s: S.missing.map(p => esc(p.sym)).join(', ') })}</span></div>` : ''}
  ${al.length ? `<div class="alerts">${al.slice(0, 5).map(a => `<div class="alert ${a.lvl}"><i></i><span>${esc(a.text)}</span></div>`).join('')}</div>` : ''}
  ${guideBlock()}
  <section class="kpis" aria-label="${esc(t('Summary'))}">
    ${kpi(t('Market value'), money0(T.valueCad), t('{m} of it from DRIP shares', { m: money0(T.dripValue) }))}
    ${kpi(t('Capital invested'), money0(T.investedCad), t('Your own money in, excluding reinvested dividends'))}
    ${kpi(t('Total return'), `<span class="${cls(T.totalCad)}">${sgnMoney(T.totalCad)}</span>`, `<span class="${cls(T.totalPct)}">${sgnPct(T.totalPct)}</span> ${t('total')} · <span class="${cls(T.xirr)}">${sgnPct(T.xirr)}</span> ${t('a year')}`)}
    ${kpi(t('Yield on cost'), pct(T.yoc), t('Current yield {y}', { y: pct(T.yld) }))}
    ${kpi(t('Forward income'), money(T.fwd), t('{m} a month on average', { m: money(T.fwd / 12) }), 'income')}
    ${kpi(t('Dividends, last 12 months'), money(T.last12), t('{m} since you started', { m: money(T.divAll) }), 'income')}
    ${kpi(t('Reinvested by DRIP'), money(T.reinvCad), t('{n} shares added', { n: shares(sum(S.sims, s => s.dripShares)) }))}
    ${kpi(t('US withholding lost'), money(T.whtLost), T.whtLost > 0 ? t('A year, in TFSA/FHSA/RESP') : t('None at the moment'))}
  </section>
  <section class="sec"><div class="sec-head"><h2>${t('Value and capital')}</h2><span class="muted" style="font-size:13px">${t('The space between the two lines is your gain')}</span><div class="legend"><span><i class="sw c1"></i>${t('Market value')}</span><span><i class="sw c2"></i>${t('Capital invested')}</span></div></div>
    <div class="panel"><div id="ch-value"></div></div></section>
  ${xr.length ? `<section class="sec"><div class="sec-head"><h2>${t('Yield X-ray')}</h2><span class="muted" style="font-size:13px">${t('Your high-yield funds against the plain fund they are built on, same dollars, same dates')}</span></div><div class="xr-grid">${xr.map(xrayRow).join('')}</div></section>` : ''}
  <section class="sec"><div class="sec-head"><h2>${t('Holdings')}</h2><span class="muted" style="font-size:13px">${t('Tap a holding for its research note, what-if replays and DRIP ledger')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('Holding')}</th><th>${t('Value')}</th><th>${t('Shares bought → now')}</th><th>${t('Yield · on cost')}</th><th>${t('Income / yr')}</th><th>${t('Total return')}</th><th>${t('Score')}</th></tr></thead><tbody>
    ${sims.map(s => `<tr class="link" data-href="#/h/${encodeURIComponent(s.pos.id)}">
      <td class="txt"><a class="tk" href="#/h/${encodeURIComponent(s.pos.id)}">${esc(s.q.d)}</a><span class="nm">${esc(s.q.name)}</span>${holdingChips(s)}</td>
      <td>${money0(s.valueCad)}<small>${pct(T.valueCad ? s.valueCad / T.valueCad : NaN, 1)}</small></td>
      <td>${shares(s.startShares)} → ${shares(s.shares)}<small class="${cls(s.dripShares)}">${s.dripShares > 0 ? t('+{p} from DRIP', { p: pct(s.startShares ? s.dripShares / s.startShares : NaN, 1) }) : t('no DRIP')}</small></td>
      <td>${pct(s.yld)}<small>${t('{p} on cost', { p: pct(s.yoc) })}</small></td>
      <td>${money(s.fwdNetCad)}<small>${t('{m} / mo', { m: money(s.fwdNetCad / 12) })}</small></td>
      <td class="${cls(s.totalCad)}">${sgnMoney(s.totalCad)}<small class="${cls(s.totalPct)}">${sgnPct(s.totalPct)} · ${sgnPct(s.xirr, 1)}${t('/yr')}</small></td>
      <td>${scoreBadge(s.q.st?.score)}</td></tr>`).join('')}
    </tbody></table></div></section>
  ${placementBlock()}
  <section class="sec" id="vs-growth"></section>
  <section class="cols">
    <div class="sec"><h2 style="font-size:18px">${t('Weight by holding')}</h2><div class="panel">${sims.map(s => hbar(s.q.d + (S.sims.filter(x => x.q.s === s.q.s).length > 1 ? ' ' + acct(s.pos.account).slice(0, 4) : ''), T.valueCad ? s.valueCad / T.valueCad : 0)).join('')}</div></div>
    <div class="sec"><h2 style="font-size:18px">${t('Weight by account')}</h2><div class="panel">${Object.entries(byAcct).sort((a, b) => b[1] - a[1]).map(([a, v]) => hbar(acct(a), T.valueCad ? v / T.valueCad : 0, 'gold')).join('')}</div></div>
  </section>
  ${dataFoot()}`);
  if (months.length > 1) lineChart($('#ch-value'), {
    x: months, fmtX: mshort, fmtY: shortM, label: t('Market value and capital invested by month'),
    series: [{ name: t('Market value'), v: val, cls: 'c1', area: true }, { name: t('Capital invested'), v: inv, cls: 'c2' }],
    tip: i => `<b>${mfmt(months[i])}</b><div class="r"><span>${t('Value')}</span><span>${money0(val[i])}</span></div><div class="r"><span>${t('Capital')}</span><span>${money0(inv[i])}</span></div><div class="r"><span>${t('Gain')}</span><span>${sgnMoney(val[i] - inv[i])}</span></div>`,
  });
  else $('#ch-value').innerHTML = `<p class="muted" style="margin:0">${t('The chart fills in after your first full month.')}</p>`;
  $('#guide')?.addEventListener('toggle', e => store.set('yl.guide', e.target.open ? '1' : '0'));
  drawVsGrowth();
}
const GUIDE = [
  ['Market value', 'What your holdings would sell for today, in Canadian dollars.'],
  ['Capital invested', 'The money you put in yourself. Reinvested dividends are not counted, so the gap to market value is your real gain.'],
  ['Total return', 'Price gains plus every dividend, in dollars and as a yearly rate that accounts for when you added money.'],
  ['Yield on cost', 'Your yearly dividends as a share of what you paid. It rises as payouts grow, even if the price does not.'],
  ['Forward income', 'What your holdings should pay over the next 12 months at today’s rates, after US withholding.'],
  ['Reinvested by DRIP', 'Dividends that bought more shares automatically, and how many shares that added.'],
  ['US withholding lost', 'The 15% the US keeps on US dividends in a TFSA, FHSA or RESP. It cannot be recovered.'],
  ['Yield X-ray', 'Covered-call and high-yield funds compared with the plain fund they are built on. Shows whether the extra income cost you growth.'],
  ['Account placement', 'Holdings that would be taxed less in a different account, and by how much.'],
  ['Dividends vs growth', 'The same dollars on the same dates put into a growth index instead, to see what the dividend focus gained or cost you.'],
];
function guideBlock() {
  const open = store.get('yl.guide') !== '0';
  return `<details class="guide panel" id="guide" ${open ? 'open' : ''}><summary>${t('How to read this page')}</summary>
    <dl>${GUIDE.map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${t(v)}</dd></div>`).join('')}</dl></details>`;
}

/* ------------------------------------------------------------ dividends vs growth */
const BENCH = [['VFV.TO', 'S&P 500'], ['QQC.TO', 'Nasdaq 100'], ['XIU.TO', 'TSX 60']];
const benchList = () => BENCH.filter(([s]) => S.rows.some(r => r.s === s));
let benchPick = 'VFV.TO';
async function drawVsGrowth() {
  const el = $('#vs-growth'); if (!el) return;
  const list = benchList();
  if (!list.length || !S.sims.length) { el.remove(); return; }
  if (!list.some(([s]) => s === benchPick)) benchPick = list[0][0];
  const bq = await D.loadQuote(benchPick);
  if (!bq || !$('#vs-growth')) return;
  const pairs = S.sims.filter(s => s.q.s !== bq.s).map(s => [s, E.replayInto(s, bq, S.fx)]);
  const kept = pairs.filter(([, b]) => !b.skipped), skipped = pairs.length - kept.length;
  const mine = kept.map(p => p[0]), alt = kept.map(p => p[1]);
  if (!mine.length) { el.remove(); return; }
  const a = sum(mine, E.outcome), b = sum(alt, E.outcome), gap = b - a;
  const incA = sum(mine, s => s.fwdNetCad), incB = sum(alt, s => s.fwdNetCad);
  const divA = sum(mine, s => s.divNetCad), divB = sum(alt, s => s.divNetCad);
  const name = list.find(([s]) => s === benchPick)[1], bd = bq.d;
  el.innerHTML = `<div class="sec-head"><h2>${t('Dividends vs growth')}</h2><span class="muted" style="font-size:13px">${t('Your exact purchases, put into an index fund instead')}</span></div>
    <div class="panel stack">
      <div class="seg" role="group" aria-label="${esc(t('Compare with'))}">${list.map(([s, n]) => `<button data-bench="${s}" aria-pressed="${s === benchPick}">${esc(n)} · ${esc(s.replace('.TO', ''))}</button>`).join('')}</div>
      <div class="xr-cmp">
        <div><span class="label">${t('Your holdings')}</span><b>${money0(a)}</b><small>${t('{m} a year in dividends', { m: money0(incA) })}</small></div>
        <div><span class="label">${t('Same money in {s}', { s: esc(bd) })}</span><b>${money0(b)}</b><small>${t('{m} a year in dividends', { m: money0(incB) })}</small></div>
        <div><span class="label">${t('Difference')}</span><b class="${cls(-gap)}">${sgnMoney(-gap)}</b><small>${t('Income difference {i}', { i: sgnMoney(incA - incB) })} ${t('a year')}</small></div>
      </div>
      <p class="verdict ${gap <= 0 ? 'ahead' : 'behind'}">${gap <= 0
        ? t('Your dividend picks beat the {n} by {g}, and they pay {i} more a year.', { n: esc(name), g: money0(-gap), i: money0(Math.max(0, incA - incB)) })
        : incA > incB ? t('With the {n} you would have {g} more today, but {i} a year less in dividends. That is the trade: more income now, less growth.', { n: esc(name), g: money0(gap), i: money0(incA - incB) })
        : t('The {n} beat your holdings on both growth and income over this period, by {g}.', { n: esc(name), g: money0(gap) })}</p>
      <div class="legend"><span><i class="sw c1"></i>${t('Your holdings')}</span><span><i class="sw c3"></i>${esc(bd)}</span></div><div id="ch-vs"></div>
      <p class="muted" style="margin:0;font-size:12.5px">${t('Dividends received so far: {a} from your holdings, {b} from {s}.', { a: money0(divA), b: money0(divB), s: esc(bd) })}${skipped ? ' ' + tp(skipped, '{n} holding bought before {s} existed is left out of both sides.', '{n} holdings bought before {s} existed are left out of both sides.', { s: esc(bd) }) : ''} ${t('Past results, not a forecast.')}</p>
    </div>`;
  const first = mine.map(s => s.firstDate).sort()[0], months = E.monthsFrom(first);
  if (months.length > 1) {
    const ser = list2 => { const ms = list2.map(s => E.monthlySeries(s, S.fx, months)); const paid = list2.map(s => months.map(m => sum(s.ledger.filter(l => l.kind === 'div' && s.pos.drip === 'off' && E.monthKey(l.pay) <= m), l => l.netCad))); return months.map((_, i) => sum(ms, x => x[i].value) + sum(paid, p => p[i])); };
    const va = ser(mine), vb = ser(alt);
    lineChart($('#ch-vs'), { x: months, fmtX: mshort, fmtY: shortM, series: [{ name: t('Your holdings'), v: va, cls: 'c1' }, { name: bd, v: vb, cls: 'c3' }], tip: i => `<b>${mfmt(months[i])}</b><div class="r"><span>${t('Your holdings')}</span><span>${money0(va[i])}</span></div><div class="r"><span>${esc(bd)}</span><span>${money0(vb[i])}</span></div>` });
  }
  $$('[data-bench]', el).forEach(btn => btn.addEventListener('click', () => { benchPick = btn.dataset.bench; drawVsGrowth(); }));
}
const hbar = (label, w, extra = '') => `<div class="hbar"><span class="mono">${esc(label)}</span><span class="track ${extra}"><span style="width:${(Math.max(0, Math.min(1, w)) * 100).toFixed(1)}%"></span></span><span class="mono" style="text-align:right">${pct(w, 1)}</span></div>`;

/* ------------------------------------------------------------ income */
function viewIncome() {
  if (!S.sims.length) return noHoldings('income', t('Income'));
  const T = totals();
  const { hist, proj } = incomeByMonth();
  const start = T.first ? E.monthsFrom(T.first) : [];
  const fut = next12();
  const cur = E.today().slice(0, 7);
  const histMonths = start.filter(m => m < cur);
  const months = [...histMonths, ...fut];
  const vals = months.map(m => (m < cur ? hist.get(m)?.total || 0 : (m === cur ? (hist.get(m)?.total || 0) : 0) + (proj.get(m)?.total || 0)));
  const nextTot = sum(next12Income(), x => x.v);
  const goal = +S.pf.settings.goal || 0, avgNext = nextTot / 12;
  const up = S.sims.flatMap(s => E.upcoming(s, S.fx));
  const ledger = T.divRows.sort((a, b) => b.pay.localeCompare(a.pay));
  shell('income', `
  <div class="page-head"><div><h1>${t('Dividend income')}</h1><p>${t('After US withholding, in CAD. DRIP growth is already counted in the share counts.')}</p></div></div>
  <section class="kpis">
    ${kpi(t('Last 12 months'), money(T.last12), t('Received'), 'income')}
    ${kpi(t('Next 12 months'), money(nextTot), t('Expected at current rates'), 'income')}
    ${kpi(t('Average month ahead'), money(avgNext), goal ? t('{p} of your {g} monthly goal', { p: pct(avgNext / goal, 0), g: money0(goal) }) : t('Set a monthly goal in Settings'))}
    ${kpi(t('Since you started'), money(T.divAll), t('{m} reinvested', { m: money(T.reinvCad) }))}
  </section>
  <section class="sec"><div class="sec-head"><h2>${t('By month')}</h2><div class="legend"><span><i class="sw gb"></i>${t('Received')}</span><span><i class="sw proj"></i>${t('Expected')}</span></div></div>
    <div class="panel"><div id="ch-inc"></div>
    <div class="foot-stats"><span>${t('Best month so far')} <b>${money(Math.max(0, ...histMonths.map(m => hist.get(m)?.total || 0)))}</b></span><span>${t('Payments a year')} <b>${up.length}</b></span>${goal ? `<span>${t('Goal')} <b>${money0(goal)}</b>${t('/mo')}</span>` : ''}</div></div></section>
  <section class="sec"><div class="sec-head"><h2>${t('Payment calendar, next 12 months')}</h2></div>
    <div class="cal">${fut.map(m => {
      const ps = up.filter(u => E.monthKey(u.pay) === m).sort((a, b) => a.pay.localeCompare(b.pay));
      return `<div class="cal-m"><header><b>${mfmt(m)}</b><span>${money(sum(ps, p => p.netCad))}</span></header><ul>${ps.length ? ps.map(p => `<li><span><span class="mono">${esc(p.d)}</span> <span class="muted">~${+p.pay.slice(8)}</span></span><span>${money(p.netCad)}</span></li>`).join('') : `<li class="muted">${t('No payments expected')}</li>`}</ul></div>`;
    }).join('')}</div></section>
  <section class="sec"><div class="sec-head"><h2>${t('Every payment')}</h2><span class="muted" style="font-size:13px">${t('{n} payments replayed', { n: ledger.length })}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('Paid (est.)')}</th><th>${t('Holding')}</th><th>${t('Shares held')}</th><th>${t('Per share')}</th><th>${t('Withheld')}</th><th>${t('Net (CAD)')}</th><th>${t('DRIP shares')}</th></tr></thead>
    <tbody id="led-body">${ledgerRows(ledger.slice(0, 60))}</tbody></table></div>
    ${ledger.length > 60 ? `<button class="btn" id="led-more" style="justify-self:start">${t('Show all {n}', { n: ledger.length })}</button>` : ''}</section>
  ${dataFoot()}`);
  barChart($('#ch-inc'), {
    x: months, v: vals, cls: months.map(m => (m < cur ? '' : 'proj')), fmtX: mshort, fmtY: shortM, label: t('Dividend income by month'),
    mark: vals.indexOf(Math.max(...vals)),
    tip: i => {
      const m = months[i], src = m < cur ? hist.get(m) : proj.get(m);
      const by = Object.entries(src?.by || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
      return `<b>${mfmt(m)} ${m >= cur ? t('(expected)') : ''}</b><div class="r"><span>${t('Total')}</span><span>${money(vals[i])}</span></div>${by.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><span>${money(v)}</span></div>`).join('')}`;
    },
  });
  $('#led-more')?.addEventListener('click', e => { $('#led-body').innerHTML = ledgerRows(ledger); e.target.remove(); });
}
const ledgerRows = rows => rows.map(r => `<tr><td>${esc(dfmt(r.pay))}</td><td class="txt"><a class="tk" href="#/h/${encodeURIComponent(r.s.pos.id)}">${esc(r.s.q.d)}</a> <span class="muted" style="font-size:12px">${esc(acct(r.s.pos.account))}</span></td><td>${shares(r.held)}</td><td>${nat(r.dps, r.s.cur)}</td><td>${r.wht ? nat(r.wht, r.s.cur) : '—'}</td><td class="gold">${money(r.netCad)}</td><td>${r.bought ? '+' + shares(r.bought) : '—'}</td></tr>`).join('');

/* ------------------------------------------------------------ paycheque mode */
const BILL_PRESETS = [['Phone', 65], ['Internet', 85], ['Hydro', 140], ['Streaming', 30], ['Car insurance', 160], ['Home insurance', 90], ['Groceries', 600], ['Gas', 200], ['Property tax', 350], ['Rent or mortgage', 2000]];
function viewBills() {
  if (!S.sims.length) return noHoldings('bills', t('Paycheque'));
  const bills = S.pf.bills;
  const T = totals();
  const n12 = next12Income();
  const avg = sum(n12, x => x.v) / 12;
  const cov = E.coverBills(bills, avg);
  const paid = cov.filter(b => b.share >= 0.999), part = cov.find(b => b.share > 0 && b.share < 0.999), nextUp = cov.find(b => b.share < 0.999);
  const need = nextUp ? nextUp.amt - nextUp.paid : 0;
  const yieldNet = T.valueCad ? T.fwd / T.valueCad : 0;
  const capNeeded = yieldNet > 0 ? (need * 12) / yieldNet : NaN;
  const totalBills = sum(cov, b => b.amt);
  const names = list => { const a = list.map(b => esc(t(b.name))); return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' ' + t('and') + ' ' + a[a.length - 1]; };
  let headline;
  if (!bills.length) headline = t('Add your monthly bills and see which ones your dividends already pay.');
  else if (!paid.length && !part) headline = t('Your dividends don’t cover a full bill yet. Here is what it takes.');
  else if (!paid.length) headline = t('Your dividends pay {p} of your {b} bill.', { p: pct(part.share, 0), b: esc(t(part.name)) });
  else headline = t('Your dividends pay for {list}', { list: names(paid) }) + (part ? t(', plus {p} of {b}.', { p: pct(part.share, 0), b: esc(t(part.name)) }) : '.');
  shell('bills', `
  <div class="page-head"><div><h1>${t('Paycheque')}</h1><p>${t('Your dividends, matched to the bills they already pay. Bills are paid in the order listed.')}</p></div></div>
  <section class="pay-hero panel"><p class="hero-line">${headline}</p>
    <div class="foot-stats"><span>${t('Average month ahead')} <b>${money(avg)}</b></span><span>${t('Monthly bills')} <b>${money(totalBills)}</b></span><span>${t('Covered')} <b>${pct(totalBills ? Math.min(1, avg / totalBills) : 0, 0)}</b></span></div></section>
  ${nextUp ? `<section class="kpis kpis3">
    ${kpi(t('Next bill to take over'), esc(t(nextUp.name)), t('{m} a month still to cover', { m: money(need) }))}
    ${kpi(t('Extra invested to get there'), money0(capNeeded), t('At your portfolio’s current net yield of {y}', { y: pct(yieldNet) }))}
    ${kpi(t('Or with DRIP alone'), dripEta(need), t('Using each holding’s own 5-year dividend growth, halved'))}
  </section>` : ''}
  <section class="cols">
    <div class="sec"><h2 style="font-size:18px">${t('Your bills')}</h2><div class="panel stack" id="bill-list">
      ${cov.map((b, i) => `<div class="bill" data-id="${esc(b.id)}">
        <div class="bill-top"><input class="bill-name" value="${esc(t(b.name))}" aria-label="${esc(t('Bill name'))}"><input class="bill-amt" type="number" min="0" step="5" inputmode="decimal" value="${b.amt}" aria-label="${esc(t('Monthly amount'))}">
          <span class="bill-ctl"><button class="x" data-act="bill-up" data-i="${i}" aria-label="${esc(t('Move up'))}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="x" data-act="bill-del" data-i="${i}" aria-label="${esc(t('Remove'))}">×</button></span></div>
        <div class="bill-bar"><span style="width:${(b.share * 100).toFixed(1)}%"></span></div>
        <div class="bill-sub">${b.share >= 0.999 ? `<b class="pos">${t('Paid by dividends')}</b>` : b.share > 0 ? t('{p} covered · {m} to go', { p: pct(b.share, 0), m: money(b.amt - b.paid) }) : t('Not covered yet')}</div>
      </div>`).join('') || `<p class="muted" style="margin:0">${t('No bills yet. Add one below or pick a common one.')}</p>`}
      <form id="bill-add" class="bill-top" novalidate><input id="bn" placeholder="${esc(t('Bill'))}" aria-label="${esc(t('Bill name'))}"><input id="ba" type="number" min="0" step="5" inputmode="decimal" placeholder="${esc(t('$ / month'))}" aria-label="${esc(t('Monthly amount'))}"><button class="btn primary sm" type="submit">${t('Add')}</button></form>
      <div class="chips">${BILL_PRESETS.filter(([n]) => !bills.some(b => b.name === n || b.name === t(n))).map(([n, a]) => `<button class="chip-btn" data-act="bill-preset" data-n="${esc(t(n))}" data-a="${a}">+ ${esc(t(n))}</button>`).join('')}</div>
    </div></div>
    <div class="sec"><h2 style="font-size:18px">${t('Month by month')}</h2><div class="panel"><div id="ch-bills"></div>
      <div class="tbl-wrap" style="margin-top:12px;border:0"><table class="tbl"><thead><tr><th>${t('Month')}</th><th>${t('Dividends')}</th><th>${t('Bills paid')}</th></tr></thead><tbody>
      ${n12.map(x => { const full = E.coverBills(bills, x.v).filter(b => b.share >= 0.999); return `<tr><td>${mfmt(x.m)}</td><td class="gold">${money(x.v)}</td><td class="txt">${full.length ? full.map(b => esc(t(b.name))).join(', ') : '<span class="muted">—</span>'}</td></tr>`; }).join('')}
      </tbody></table></div></div></div>
  </section>
  ${dataFoot()}`);
  barChart($('#ch-bills'), { x: n12.map(x => x.m), v: n12.map(x => x.v), cls: n12.map(x => (totalBills && x.v >= totalBills ? 'acc' : '')), fmtX: m => MON()[+m.slice(5, 7) - 1], fmtY: shortM, tip: i => `<b>${mfmt(n12[i].m)}</b><div>${money(n12[i].v)}</div>` });
  $$('.bill').forEach(row => {
    const b = bills.find(x => x.id === row.dataset.id);
    row.querySelector('.bill-name').addEventListener('change', e => { b.name = e.target.value.trim() || b.name; persist(); viewBills(); });
    row.querySelector('.bill-amt').addEventListener('change', e => { b.amount = Math.max(0, +e.target.value || 0); persist(); viewBills(); });
  });
  $('#bill-add').addEventListener('submit', e => {
    e.preventDefault();
    const n = $('#bn').value.trim(), a = +$('#ba').value;
    if (!n || !(a > 0)) { toast(t('Enter a bill name and a monthly amount.')); return; }
    bills.push({ id: rid('b'), name: n, amount: a }); persist(); viewBills();
  });
}
function dripEta(need) {
  const rows = E.project(S.sims, { years: 30, monthly: 0, haircut: 0.5, drip: true });
  const base = rows[0].monthly, hit = rows.find(r => r.monthly - base >= need);
  return hit ? tp(hit.year, '{n} year', '{n} years') : t('Over 30 years');
}

/* ------------------------------------------------------------ projections */
function viewPlan() {
  if (!S.sims.length) return noHoldings('plan', t('Projections'));
  const st = S.pf.settings;
  const o = { years: st.planYears || 20, monthly: st.planMonthly ?? 500, haircut: st.planHaircut ?? 0.5, drip: st.planDrip !== false };
  shell('plan', `
  <div class="page-head"><div><h1>${t('Income snowball')}</h1><p>${t('Where your dividends go if every holding keeps its own 5-year track record, with your monthly contributions on top.')}</p></div></div>
  <div class="panel"><div class="form-grid">
    <div class="field"><label for="pl-m">${t('Monthly contribution ($)')}</label><input id="pl-m" type="number" min="0" step="50" inputmode="decimal" value="${o.monthly}"></div>
    <div class="field"><label for="pl-y">${t('Years')}</label><select id="pl-y">${[5, 10, 15, 20, 25, 30].map(y => `<option ${y === o.years ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <div class="field"><label for="pl-h">${t('Growth assumption')}</label><select id="pl-h"><option value="0" ${o.haircut === 0 ? 'selected' : ''}>${t('Each holding’s own 5-year history')}</option><option value="0.5" ${o.haircut === 0.5 ? 'selected' : ''}>${t('Conservative: half of history')}</option><option value="1" ${o.haircut === 1 ? 'selected' : ''}>${t('No growth at all')}</option></select></div>
    <div class="field"><label for="pl-d">${t('Dividends')}</label><select id="pl-d"><option value="1" ${o.drip ? 'selected' : ''}>${t('Reinvest (DRIP)')}</option><option value="0" ${!o.drip ? 'selected' : ''}>${t('Take as cash')}</option></select></div>
  </div></div>
  <div id="plan-out" class="sec" style="gap:20px"></div>
  ${dataFoot()}`);
  const draw = () => {
    o.monthly = Math.max(0, +$('#pl-m').value || 0); o.years = +$('#pl-y').value; o.haircut = +$('#pl-h').value; o.drip = $('#pl-d').value === '1';
    Object.assign(S.pf.settings, { planMonthly: o.monthly, planYears: o.years, planHaircut: o.haircut, planDrip: o.drip }); persist();
    const rows = E.project(S.sims, o);
    const end = rows[rows.length - 1], goal = +st.goal || 0;
    const hit = goal ? rows.find(r => r.monthly >= goal) : null;
    const yr = new Date().getFullYear();
    $('#plan-out').innerHTML = `
    <section class="kpis">
      ${kpi(t('Monthly income in year {n}', { n: o.years }), money0(end.monthly), t('Today {m} a month', { m: money0(rows[0].monthly) }), 'income')}
      ${kpi(t('Portfolio in year {n}', { n: o.years }), money0(end.value), t('{m} of it contributed', { m: money0(end.contributed) }))}
      ${kpi(t('Monthly goal'), goal ? money0(goal) : t('Not set'), goal ? (hit ? t('Reached in year {n} ({y})', { n: hit.year, y: yr + hit.year }) : t('Not reached in {n} years', { n: o.years })) : t('Set one in Settings'))}
      ${kpi(t('Income taken as cash'), money0(end.cashTaken), o.drip ? t('Everything reinvested') : t('Over the whole period'))}
    </section>
    ${ideasBlock(o, goal)}
    <section class="cols">
      <div class="sec"><h2 style="font-size:18px">${t('Monthly income by year')}</h2><div class="panel"><div id="ch-pinc"></div></div></div>
      <div class="sec"><h2 style="font-size:18px">${t('Portfolio value')}</h2><div class="panel"><div id="ch-pval"></div></div></div>
    </section>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('Year')}</th><th>${t('Portfolio')}</th><th>${t('Contributed')}</th><th>${t('Income / yr')}</th><th>${t('Income / mo')}</th></tr></thead><tbody>
    ${rows.filter(r => r.year % (o.years > 15 ? 5 : 1) === 0 || r.year === o.years).map(r => `<tr><td>${r.year === 0 ? t('Today') : t('Year {n} · {y}', { n: r.year, y: yr + r.year })}</td><td>${money0(r.value)}</td><td>${money0(r.contributed)}</td><td>${money0(r.income)}</td><td class="gold">${money0(r.monthly)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="margin:0;font-size:13px">${t('Dividend growth is capped between −5% and +8% a year and price growth between −6% and +8% a year per holding, so one hot stretch of history doesn’t run away with the forecast. Projections are estimates, not promises.')} ${t('A holding’s yield is also kept within 1.5 times today’s, because payouts that outrun a falling price usually get cut.')}</p>`;
    const yrs = rows.map(r => String(r.year)), lbl = y => (y === '0' ? t('Now') : t('Y') + y);
    barChart($('#ch-pinc'), { x: yrs, v: rows.map(r => r.monthly), cls: rows.map(() => 'acc'), fmtX: lbl, fmtY: shortM, mark: rows.length - 1, tip: i => `<b>${i === 0 ? t('Today') : t('Year {n}', { n: i })}</b><div>${t('{m} a month', { m: money0(rows[i].monthly) })}</div>` });
    lineChart($('#ch-pval'), { x: yrs, fmtX: lbl, fmtY: shortM, series: [{ name: t('Value'), v: rows.map(r => r.value), cls: 'c1', area: true }, { name: t('Contributed'), v: rows.map(r => r.contributed), cls: 'c2' }] });
  };
  ['#pl-m', '#pl-y', '#pl-h', '#pl-d'].forEach(s => $(s).addEventListener('change', draw));
  $('#pl-m').addEventListener('input', () => { clearTimeout(viewPlan.tm); viewPlan.tm = setTimeout(draw, 350); });
  draw();
}

function ideasBlock(o, goal) {
  const { ideas } = E.planIdeas(S.sims, o, goal);
  if (!ideas.length) return '';
  const card = x => {
    let h, p;
    if (x.kind === 'more') {
      h = t('Invest {m} more a month', { m: money0(x.step) });
      p = t('Adds about {g} a month of income by year {n}.', { g: money0(x.gain), n: o.years }) + (x.goalYears > 0 ? ' ' + tp(x.goalYears, 'You reach your goal {n} year sooner.', 'You reach your goal {n} years sooner.') : '');
    } else if (x.kind === 'drip') {
      h = x.syms && x.syms.length ? t('Reinvest the dividends from {s}', { s: x.syms.join(', ') }) : t('Reinvest your dividends (DRIP)');
      p = t('Adds about {g} a month of income by year {n}, instead of taking the cash.', { g: money0(x.gain), n: o.years });
    } else if (x.kind === 'place') {
      const m = x.move;
      h = m.kind === 'rrsp-swap' ? t('Hold {u} instead of {s} in your RRSP', { u: m.to, s: m.s.q.d }) : m.kind === 'cdr-in-rrsp' ? t('Hold the US share instead of the {s} CDR in your RRSP', { s: m.s.q.d }) : t('Hold {s} in an RRSP instead of your {a}', { s: m.s.q.d, a: acct(m.s.pos.account) });
      p = t('Keeps about {g} a month that US withholding takes today ({y} a year).', { g: money0(x.gain), y: money0(m.save) });
    } else {
      h = t('Reach your {g} goal by year {n}', { g: money0(goal), n: o.years });
      p = t('You would need to invest about {m} a month instead of {c}.', { m: `<b>${money0(x.need)}</b>`, c: money0(o.monthly) });
    }
    return `<div class="idea"><div class="idea-gain"><b>+${money0(x.gain)}</b><small>${t('a month')}</small></div><div><h4>${esc(h)}</h4><p>${p}</p></div></div>`;
  };
  return `<section class="sec"><div class="sec-head"><h2>${t('Ways to grow your income')}</h2><span class="muted" style="font-size:13px">${t('Ranked by the extra monthly income at the end of your plan')}</span></div>
    <div class="ideas">${ideas.slice(0, 5).map(card).join('')}</div>
    <p class="muted" style="margin:0;font-size:12.5px">${t('Calculations from your own holdings and the assumptions above, not advice. Contribution room, taxes and fees matter.')}</p></section>`;
}

/* ------------------------------------------------------------ research: smart search */
const THEMES = [
  ['utilities', 'Utilities', /utilit|services? publics?|hydro|power|électric/i],
  ['banks', 'Banks & financials', /bank|banque|financ|insur|assur|lifeco/i],
  ['reit', 'REITs & real estate', /reit|\bfpi\b|real estate|immobil/i],
  ['energy', 'Energy & pipelines', /energ|oil|pétrol|pipeline|\bgas\b|\bgaz\b/i],
  ['telecom', 'Telecom', /telecom|télécom|telco/i],
  ['covered-call', 'Covered call', /covered|options?\b|yield ?max|couvert/i],
  ['us', 'US exposure', /^us$|u\.s\.|american|améric|états|s&p|sp500/i],
  ['nasdaq', 'Nasdaq & tech', /nasdaq|\btech/i],
  ['monthly', 'Monthly payers', /monthly|mensuel/i],
  ['dividend', 'Dividend funds', /^dividend|^dividende/i],
  ['all-in-one', 'All-in-one', /all.?in.?one|tout.?en.?un|asset alloc/i],
  ['international', 'International', /international|\bintl\b|emerging|émergent|eafe/i],
  ['bonds', 'Bonds', /bond|obligat/i],
  ['cash', 'Cash & savings', /^cash|savings|épargne|encaisse|money market/i],
  ['cdr', 'CDRs', /\bcdrs?\b|depositary|certificats? d/i],
  ['gold', 'Gold & miners', /^or$|\bgold\b|miner|mines/i],
  ['healthcare', 'Healthcare', /health|santé|pharma/i],
  ['crypto', 'Crypto', /crypto|bitcoin|ether/i],
  ['leveraged', 'Leveraged & inverse', /leverag|inverse|levier|bull|bear/i],
];
const COMPANIES = [
  [/amazon/i, 'AMZN'], [/apple/i, 'AAPL'], [/microsoft/i, 'MSFT'], [/nvidia/i, 'NVDA'], [/google|alphabet/i, 'GOOGL'],
  [/\bmeta\b|facebook/i, 'META'], [/tesla/i, 'TSLA'], [/berkshire/i, 'BRK-B'], [/costco/i, 'COST'], [/jp ?morgan/i, 'JPM'],
  [/broadcom/i, 'AVGO'], [/coca.?cola|\bcoke\b/i, 'KO'], [/royal bank|\brbc\b/i, 'RY'], [/\btd\b|toronto.?dominion/i, 'TD'],
  [/enbridge/i, 'ENB'], [/shopify/i, 'SHOP'], [/johnson/i, 'JNJ'], [/exxon/i, 'XOM'], [/chevron/i, 'CVX'], [/scotia/i, 'BNS'],
];
const WH_BADGE = { US: 'US-listed', 'CA-US': '15% inside fund', CDR: 'CDR', 'CA-INTL': 'Foreign tax inside fund', 'CA-MIX': 'Partly foreign' };
const RS = { q: '', theme: '', ex: 'all', t: 'all', sort: '', dir: -1, acct: 'TFSA', hideLev: true, limit: 100 };
const baseSym = s => s.replace(/\.(TO|NE|V)$/, '').replace(/-UN$/, '.UN');
function holdingKey(q) {
  const raw = q.trim();
  if (raw.length < 2) return null;
  for (const [rx, sym] of COMPANIES) if (rx.test(raw)) return { sym, label: raw };
  const up = raw.toUpperCase();
  if (/^[A-Z.\-]{1,6}$/.test(up)) return { sym: up.replace(/\.(TO|NE)$/, ''), label: up, symbolOnly: true };
  return raw.length >= 4 ? { text: raw.toLowerCase(), label: raw } : null;
}
function holdersOf(key) {
  const out = [];
  for (const r of S.rows) {
    for (const [hs, hn, w] of r.h || []) {
      const hb = baseSym(String(hs).toUpperCase());
      const hit = key.sym ? (hb === key.sym || hb === key.sym.replace('-', '.') || hb === key.sym.replace(/^GOOGL$/, 'GOOG')) : String(hn || '').toLowerCase().includes(key.text);
      if (hit && !(w === 0)) { out.push({ r, w, hn, lev: w > 1 }); break; }
    }
  }
  return out.sort((a, b) => (b.w || 0) - (a.w || 0));
}
function keepCell(r) {
  const k = E.keep(r, RS.acct);
  const note = { lost: t('15% withheld'), credit: t('15% withheld, claimable'), inside: t('15% already taken inside'), 'inside-credit': t('Foreign tax inside, claimable'), 'inside-varies': t('Foreign tax inside') }[k.how];
  return `<td class="${k.how === 'lost' ? 'neg-soft' : ''}">${pct(k.kept)}${note ? `<small>${esc(note)}</small>` : ''}</td>`;
}
function whChip(r) { return WH_BADGE[r.wh] ? ` <span class="chip ${r.wh === 'CA' ? '' : 'wht'}" title="${esc(t(WH_HELP[r.wh] || ''))}">${esc(t(WH_BADGE[r.wh]))}</span>` : ''; }
const WH_HELP = {
  US: 'US-listed: 15% of dividends withheld in a TFSA, none in an RRSP, claimable in a non-registered account. Buying from a CAD account costs a currency conversion.',
  'CA-US': 'Canadian-listed fund holding US stocks: the US keeps 15% of the dividends inside the fund, in every account including an RRSP.',
  CDR: 'Canadian Depositary Receipt: priced in CAD with no currency conversion, but 15% of US dividends is withheld in every account, RRSP included.',
  'CA-INTL': 'Canadian-listed fund holding foreign stocks: foreign countries withhold tax on dividends inside the fund.',
  'CA-MIX': 'Global or all-in-one fund: part of the dividends lose foreign withholding inside the fund.',
};
function rowCells(r, extra = '') {
  return `<td class="txt"><a class="tk" href="#/t/${encodeURIComponent(r.s)}">${esc(r.d)}</a> <span class="chip">${r.ex === 'CA' ? (r.s.endsWith('.NE') ? 'Cboe CA' : 'TSX') : 'US'}</span> <span class="chip">${esc(t(r.t))}</span>${whChip(r)}${r.cut ? ` <span class="chip bad">${t('Cut')}</span>` : ''}${r.er ? ` <span class="chip warn">${t('Erosion')}</span>` : ''}${valChip(E.valuationFromRow(r))}<span class="nm">${esc(r.n)}</span></td>
    ${extra}<td class="spark-cell"><button class="spark-btn" data-chart="${esc(r.s)}" aria-expanded="false" aria-label="${esc(t('Show the price chart for {s}', { s: r.d }))}">${sparkline(r.sk)}<small class="${cls(r.p1)}">${sgnPct(r.p1, 1)}</small></button></td><td>${pct(r.y)}<small>${esc(E.freqName(r.fr, t))}</small></td>${keepCell(r)}
    <td class="${cls(r.tr1)}">${sgnPct(r.tr1, 1)}</td><td class="${cls(r.g1)}">${sgnPct(r.g1, 1)}</td><td class="${cls(r.tr5)}">${sgnPct(r.tr5, 1)}${r.tr5 != null ? t('/yr') : ''}</td>
    <td>${r.mer != null ? num(r.mer, 2) + ' %' : '—'}</td><td>${scoreBadge(r.sc)}${r.lim ? `<small>${t('short history')}</small>` : ''}</td>
    <td><a class="btn sm" href="#/add" data-prefill="${esc(r.s)}">${t('Add')}</a></td>`;
}
const VAL_LBL = { cheap: 'Cheap vs its history', fair: 'Fair vs its history', expensive: 'Pricey vs its history' };
const valChip = v => (v && (v.kind === 'cheap' || v.kind === 'expensive') ? ` <span class="chip val-${v.kind}" title="${esc(t('Based on its yield and price against its own past, not a recommendation'))}">${esc(t(VAL_LBL[v.kind]))}</span>` : '');
const COLS = () => [['p1', t('Price, 1 year')], ['y', t('Yield')], ['keep', t('You keep in {a}', { a: acct(RS.acct) })], ['tr1', t('1-year return')], ['g1', t('1-year dividend growth')], ['tr5', t('5-year return')], ['mer', t('Fee')], ['sc', t('Score')]];
function sortRows(rows, def) {
  const k = RS.sort || def;
  const val = r => (k === 'keep' ? E.keep(r, RS.acct).kept : k === 'w' ? r._w : k === 'aum' ? (r.aum || 0) * (r.cur === 'USD' ? 1.37 : 1) : r[k]);
  return rows.sort((a, b) => ((val(a) ?? -1e9) - (val(b) ?? -1e9)) * (RS.sort ? RS.dir : -1));
}
function head(extra = '') { return `<thead><tr><th>${t('Security')}</th>${extra}${COLS().map(([k, l]) => `<th><button data-sort="${k}">${esc(l)}${RS.sort === k ? (RS.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}<th></th></tr></thead>`; }
const limited = rows => rows.slice(0, RS.limit);
const moreBtn = rows => (rows.length > RS.limit ? `<button class="btn" data-more="1" style="justify-self:start">${t('Show {n} more', { n: Math.min(200, rows.length - RS.limit) })} · ${t('{n} in total', { n: rows.length })}</button>` : '');
function median(a) { const v = a.filter(fin).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : NaN; }
function statStrip(rows, label) {
  if (!rows.length) return '';
  const best = [...rows].filter(r => fin(r.tr1)).sort((a, b) => b.tr1 - a.tr1)[0];
  const keepBest = [...rows].sort((a, b) => E.keep(b, RS.acct).kept - E.keep(a, RS.acct).kept)[0];
  return `<div class="foot-stats stat-strip"><span>${esc(label)} <b>${rows.length}</b></span><span>${t('Median yield')} <b>${pct(median(rows.map(r => r.y)))}</b></span><span>${t('Pay monthly')} <b>${rows.filter(r => r.fr >= 12).length}</b></span>${best ? `<span>${t('Best 1-year')} <b>${esc(best.d)} ${sgnPct(best.tr1, 1)}</b></span>` : ''}${keepBest ? `<span>${t('Highest kept yield in {a}', { a: acct(RS.acct) })} <b>${esc(keepBest.d)} ${pct(E.keep(keepBest, RS.acct).kept)}</b></span>` : ''}</div>`;
}
function waysToOwn(key, holders) {
  const direct = S.rows.find(r => r.ex === 'US' && baseSym(r.s) === key.sym);
  const cdr = S.rows.find(r => r.s === key.sym + '.NE' || r.s === key.sym.replace('GOOGL', 'GOOG') + '.NE');
  const ca = S.rows.find(r => r.s === key.sym + '.TO');
  const name = (direct || cdr || ca)?.n || holders[0]?.hn || key.label;
  const opts = [];
  if (ca) opts.push([ca, t('Canadian listing'), t('Priced in CAD. No withholding on Canadian dividends.')]);
  if (direct) opts.push([direct, t('US listing'), t('Pay in USD: from a CAD account at Wealthsimple that is a {f} conversion each way. In an RRSP, no US withholding on dividends.', { f: pct(E.FX_FEE, 1) })]);
  if (cdr) opts.push([cdr, t('CDR on Cboe Canada'), t('Priced in CAD with no currency conversion and a built-in currency hedge. 15% US withholding on dividends in every account, RRSP included.')]);
  const top1 = holders.find(h => (h.w || 0) <= 1) || holders[0];
  if (holders.length) opts.push([null, t('Through an ETF'), t('{n} tracked ETFs hold it. The biggest weight is {s} at {w}.', { n: holders.length, s: esc(top1.r.d), w: pct(top1.w, 1) })]);
  if (!opts.length) return '';
  const divNote = (direct || cdr) && !((direct || cdr).y > 0) ? `<p class="muted" style="margin:0;font-size:13px">${t('{n} pays no dividend, so withholding tax does not affect it; the currency conversion still does.', { n: esc(name) })}</p>` : '';
  return `<section class="panel stack own"><h2 style="font-size:19px">${t('Ways to own {n} from Canada', { n: esc(name) })}</h2>
    <div class="own-grid">${opts.map(([r, h, p]) => `<div class="own-opt"><span class="label">${esc(h)}</span>${r ? `<a class="tk" href="#/t/${encodeURIComponent(r.s)}">${esc(r.d)}</a> <span class="muted mono" style="font-size:13px">${pct(r.y)}</span>` : ''}<p>${p}</p></div>`).join('')}</div>${divNote}</section>`;
}
function viewResearch() {
  shell('research', `
  <div class="page-head"><div><h1>${t('Research')}</h1><p>${t('Search a theme like “utilities” or “banks”, a company like “Amazon” to find the ETFs that hold it, or any ticker.')}</p></div></div>
  <div class="panel stack search-panel">
    <div class="search-row"><input id="rs-q" type="search" placeholder="${esc(t('Try: utilities, banks, Amazon, covered call, VDY'))}" value="${esc(RS.q)}" autocomplete="off">
      <div class="seg" role="group" aria-label="${esc(t('Account'))}">${E.TAX_ACCOUNTS.map(a => `<button data-acct="${a}" aria-pressed="${RS.acct === a}">${esc(acct(a))}</button>`).join('')}</div></div>
    <div class="chips theme-chips">${THEMES.map(([k, l]) => `<button class="chip-btn ${RS.theme === k ? 'on' : ''}" data-theme="${k}">${esc(t(l))}</button>`).join('')}</div>
    <div class="filter-row"><div class="seg" role="group">${[['all', t('All')], ['CA', t('Canadian-listed')], ['US', t('US-listed')]].map(([k, l]) => `<button data-ex="${k}" aria-pressed="${RS.ex === k}">${l}</button>`).join('')}</div>
      <div class="seg" role="group">${[['all', t('All')], ['ETF', t('ETFs')], ['Stock', t('Stocks')]].map(([k, l]) => `<button data-t="${k}" aria-pressed="${RS.t === k}">${l}</button>`).join('')}</div>
      <label class="check-inline"><input type="checkbox" id="rs-lev" ${RS.hideLev ? 'checked' : ''}> ${t('Hide leveraged, inverse and crypto')}</label></div>
  </div>
  <div id="rs-out" class="sec" style="gap:18px"></div>
  ${S.rows.length ? '' : `<p class="muted">${t('The research list fills in after the first daily data update.')}</p>`}
  ${dataFoot()}`);
  const draw = () => {
    const q = RS.q.trim();
    let theme0 = RS.theme ? THEMES.find(x => x[0] === RS.theme) : (q ? THEMES.find(([, , rx]) => rx.test(q)) : null);
    const exotic = r => (r.tags || []).some(x => x === 'leveraged' || x === 'crypto');
    const base = S.rows.filter(r => (RS.ex === 'all' || r.ex === RS.ex) && (RS.t === 'all' || r.t === RS.t) && (!RS.hideLev || !exotic(r) || (theme0 && (theme0[0] === 'leveraged' || theme0[0] === 'crypto'))));
    let theme = RS.theme ? THEMES.find(x => x[0] === RS.theme) : null;
    if (!theme && q) theme = THEMES.find(([, , rx]) => rx.test(q));
    let html = '';
    if (theme) {
      const rows = sortRows(base.filter(r => (r.tags || []).includes(theme[0])), 'y');
      html = `<div class="sec-head"><h2>${esc(t(theme[1]))}</h2></div>${statStrip(rows, t('Securities'))}
        <div class="tbl-wrap"><table class="tbl">${head()}<tbody>${limited(rows).map(r => `<tr class="link" data-href="#/t/${encodeURIComponent(r.s)}">${rowCells(r)}</tr>`).join('') || `<tr><td colspan="11" class="txt muted">${t('No matches.')}</td></tr>`}</tbody></table></div>${moreBtn(rows)}`;
    } else if (q) {
      const up = q.toUpperCase();
      const text = base.filter(r => r.d.toUpperCase().includes(up) || (r.n || '').toUpperCase().includes(up));
      const key = holdingKey(q);
      const holders = key ? holdersOf(key).filter(h => base.includes(h.r)) : [];
      if (holders.length || (key && key.sym && !key.symbolOnly)) html += waysToOwn(key, holders);
      if (holders.length) {
        holders.forEach(h => (h.r._w = h.w));
        const rows = sortRows(holders.map(h => h.r), 'w');
        html += `<div class="sec-head"><h2>${t('ETFs that hold {n}', { n: esc(holders[0].hn || key.label) })}</h2><span class="muted" style="font-size:13px">${t('From each fund’s top 10 holdings')}</span></div>${statStrip(rows, t('Funds'))}
          <div class="tbl-wrap"><table class="tbl">${head(`<th><button data-sort="w">${t('Weight')}${RS.sort === 'w' ? (RS.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`)}<tbody>${limited(rows).map(r => `<tr class="link" data-href="#/t/${encodeURIComponent(r.s)}">${rowCells(r, `<td><b>${pct(r._w, 1)}</b>${r._w > 1 ? `<small>${t('uses leverage')}</small>` : (S.rows.find(x => x.s === r.s) || {}).hp ? `<small>${t('via {p}', { p: esc(r.hp) })}</small>` : ''}</td>`)}</tr>`).join('')}</tbody></table></div>${moreBtn(rows)}`;
      }
      const textOnly = text.filter(r => !holders.some(h => h.r === r));
      if (textOnly.length || !holders.length) {
        const rows = sortRows(textOnly, 'sc');
        html += `<div class="sec-head"><h2>${holders.length ? t('Other matches') : t('Matches for “{q}”', { q: esc(q) })}</h2></div>
          <div class="tbl-wrap"><table class="tbl">${head()}<tbody>${limited(rows).map(r => `<tr class="link" data-href="#/t/${encodeURIComponent(r.s)}">${rowCells(r)}</tr>`).join('') || `<tr><td colspan="11" class="txt muted">${t('No matches.')}</td></tr>`}</tbody></table></div>${moreBtn(rows)}`;
      }
    } else {
      const rows = sortRows(base.slice(), 'aum');
      html = `<div class="sec-head"><h2>${t('Most widely held')}</h2><span class="muted" style="font-size:13px">${t('Sorted by fund size or market value until you pick a column')}</span></div>${statStrip(rows, t('Securities'))}<div class="tbl-wrap"><table class="tbl">${head()}<tbody>${limited(rows).map(r => `<tr class="link" data-href="#/t/${encodeURIComponent(r.s)}">${rowCells(r)}</tr>`).join('')}</tbody></table></div>${moreBtn(rows)}`;
    }
    $('#rs-out').innerHTML = html;
    $$('[data-more]', $('#rs-out')).forEach(b => b.addEventListener('click', () => { RS.limit += 200; draw(); }));
    $$('[data-chart]', $('#rs-out')).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); toggleRowChart(b); }));
    $$('[data-sort]', $('#rs-out')).forEach(b => b.addEventListener('click', () => { if (RS.sort === b.dataset.sort) RS.dir *= -1; else { RS.sort = b.dataset.sort; RS.dir = -1; } draw(); }));
  };
  let tm;
  $('#rs-q').addEventListener('input', e => { RS.q = e.target.value; RS.theme = ''; RS.limit = 100; $$('[data-theme]').forEach(x => x.classList.remove('on')); clearTimeout(tm); tm = setTimeout(draw, 120); });
  $$('[data-theme]').forEach(b => b.addEventListener('click', () => { RS.theme = RS.theme === b.dataset.theme ? '' : b.dataset.theme; RS.q = ''; RS.limit = 100; $('#rs-q').value = ''; RS.sort = ''; $$('[data-theme]').forEach(x => x.classList.toggle('on', x.dataset.theme === RS.theme)); draw(); }));
  $('#rs-lev').addEventListener('change', e => { RS.hideLev = e.target.checked; draw(); });
  $$('[data-acct]').forEach(b => b.addEventListener('click', () => { RS.acct = b.dataset.acct; $$('[data-acct]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
  $$('[data-ex]').forEach(b => b.addEventListener('click', () => { RS.ex = b.dataset.ex; $$('[data-ex]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
  $$('[data-t]').forEach(b => b.addEventListener('click', () => { RS.t = b.dataset.t; $$('[data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
  draw();
}


async function toggleRowChart(btn) {
  const tr = btn.closest('tr'), next = tr.nextElementSibling;
  if (next && next.classList.contains('xrow')) { next.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const sym = btn.dataset.chart, x = document.createElement('tr');
  x.className = 'xrow'; x.innerHTML = `<td colspan="${tr.children.length}" class="txt"><div class="xrow-in"><div class="muted">${t('Loading…')}</div></div></td>`;
  tr.after(x); btn.setAttribute('aria-expanded', 'true');
  const q = await D.loadQuote(sym), box = $('.xrow-in', x);
  if (!q) { box.innerHTML = `<p class="muted" style="margin:0">${t('No price history yet.')}</p>`; return; }
  const st = q.st || {}, v = E.valuationFromQuote(q);
  box.innerHTML = `<div class="xrow-head"><b>${esc(q.d)}</b> <span class="muted">${esc(q.name)}</span><span class="spacer"></span><a class="btn sm" href="#/t/${encodeURIComponent(q.s)}">${t('Full research')} →</a></div>
    <div class="legend"><span><i class="sw c1"></i>${t('Price, 5 years')}</span>${q.div?.length ? `<span><i class="sw mk"></i>${t('Dividend paid')}</span>` : ''}</div>
    <div class="xrow-chart"></div>
    <div class="foot-stats">${st.r52lo != null ? `<span>${t('52-week range')} <b>${nat(st.r52lo, q.cur)} – ${nat(st.r52hi, q.cur)}</b></span>` : ''}<span>${t('Yield')} <b>${pct(st.fyld ?? st.yld)}</b></span>${st.yAvg5 ? `<span>${t('5-year average yield')} <b>${pct(st.yAvg5)}</b></span>` : ''}${v ? `<span>${t('Valuation')} <b>${esc(t(VAL_LBL[v.kind] || 'Price range only'))}</b></span>` : ''}</div>`;
  priceChart($('.xrow-chart', x), q, 5);
}
/** Weekly closes over the last few years, with a dot wherever a dividend went ex. */
function priceChart(el, q, years = 5) {
  const c = q.c, from = E.addDays(E.today(), -Math.round(365.25 * years)), idx = [];
  let start = c.d.findIndex(d => d >= from); if (start < 0) start = 0;
  for (let i = start, last = ''; i < c.d.length; i++) { const wk = c.d[i].slice(0, 8) + String(Math.floor(+c.d[i].slice(8) / 7)); if (wk !== last) { idx.push(i); last = wk; } }
  if (idx[idx.length - 1] !== c.d.length - 1) idx.push(c.d.length - 1);
  const xs = idx.map(i => c.d[i]), divAt = new Map();
  for (const [d, a] of q.div || []) {
    if (d < from) continue;
    let k = xs.findIndex(x => x >= d); if (k < 0) k = xs.length - 1;
    divAt.set(k, (divAt.get(k) || 0) + a);
  }
  const natS = v => nat(v, q.cur).replace(/[.,]00(?=\s|$)/, '');
  lineChart(el, { x: xs, series: [{ name: t('Close'), v: idx.map(i => c.v[i]), cls: 'c1', area: true }], marks: [...divAt.keys()], fmtY: natS, fmtX: d => `${MON()[+d.slice(5, 7) - 1]} ’${d.slice(2, 4)}`, label: t('Price, 5 years'),
    tip: k => `<b>${dfmt(xs[k])}</b><div>${nat(c.v[idx[k]], q.cur)}</div>${divAt.has(k) ? `<div class="gold">${t('Dividend {v} per share', { v: nat(divAt.get(k), q.cur) })}</div>` : ''}` });
}

/* ------------------------------------------------------------ Canadian alternatives to a US security */
const ALT_TAGS = ['dividend', 'covered-call', 'nasdaq', 'sp500', 'utilities', 'banks', 'reit', 'energy', 'healthcare', 'bonds', 'international', 'gold'];
function canadianAlternatives(q) {
  if (q.ex !== 'US' && q.wh !== 'CDR') return '';
  const base = q.s.replace(/\.NE$/, '');
  const picks = new Map();
  const add = (r, why) => { if (r && r.s !== q.s && !picks.has(r.s)) picks.set(r.s, { r, why }); };
  for (const r of S.rows) if (E.US_EQUIV[r.s] === base || r.px_ === base) add(r, t('Tracks the same index'));
  if (q.type === 'Stock') {
    add(S.rows.find(r => r.s === base + '.NE'), t('CDR of the same company'));
    for (const r of S.rows) if (r.ex === 'CA' && (r.h || []).some(([hs, , w]) => baseSym(String(hs).toUpperCase()) === base && w > 0.02)) add(r, t('Holds {s}', { s: esc(q.d) }));
  } else {
    const want = (q.tags || []).filter(x => ALT_TAGS.includes(x));
    if (want.length) S.rows.filter(r => r.ex === 'CA' && r.t === 'ETF' && !(r.tags || []).includes('leveraged') && want.every(x => (r.tags || []).includes(x)) && (r.tags || []).includes('us'))
      .sort((a, b) => (b.aum || 0) - (a.aum || 0)).slice(0, 6).forEach(r => add(r, t('Same theme, Canadian-listed')));
  }
  const list = [...picks.values()].slice(0, 8);
  if (!list.length) return '';
  const self = { r: S.rows.find(r => r.s === q.s) || { s: q.s, d: q.d, n: q.name, y: q.st?.yld, wh: q.wh, ex: q.ex, tr1: q.st?.tr1, tr5: q.st?.tr5, mer: q.f?.mer }, why: t('This security') };
  const rowH = ({ r, why }) => { const kt = E.keep(r, 'TFSA'), kr = E.keep(r, 'RRSP'); return `<tr class="${r.s === q.s ? 'hl-row' : 'link'}" ${r.s === q.s ? '' : `data-href="#/t/${encodeURIComponent(r.s)}"`}><td class="txt"><a class="tk" href="#/t/${encodeURIComponent(r.s)}">${esc(r.d)}</a>${whChip(r)}<span class="nm">${esc(r.n)}</span><small>${why}</small></td><td>${pct(r.y)}</td><td>${pct(kt.kept)}</td><td>${pct(kr.kept)}</td><td>${r.ex === 'US' ? pct(E.FX_FEE, 1) : '—'}</td><td class="${cls(r.tr1)}">${sgnPct(r.tr1, 1)}</td><td class="${cls(r.tr5)}">${sgnPct(r.tr5, 1)}</td><td>${r.mer != null ? num(r.mer, 2) + ' %' : '—'}</td></tr>`; };
  return `<section class="sec"><div class="sec-head"><h2>${t('Canadian alternatives')}</h2><span class="muted" style="font-size:13px">${t('Same exposure without the currency conversion, and what each keeps per account')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('Security')}</th><th>${t('Yield')}</th><th>${t('You keep in {a}', { a: acct('TFSA') })}</th><th>${t('You keep in {a}', { a: acct('RRSP') })}</th><th>${t('Currency cost')}</th><th>${t('1-year return')}</th><th>${t('5-year return')}</th><th>${t('Fee')}</th></tr></thead>
    <tbody>${[self, ...list].map(rowH).join('')}</tbody></table></div>
    <p class="muted" style="margin:0;font-size:13px">${t('Rule of thumb: US-listed in an RRSP, Canadian-listed in a TFSA if you want to skip currency conversion. Compare the kept yield and the 5-year return, not the headline yield.')}</p></section>`;
}

/* ------------------------------------------------------------ tax & currency panel on a security page */
function taxPanel(q) {
  const row = { y: q.st?.fyld ?? q.st?.yld ?? 0, wh: q.wh, ex: q.ex };
  const lines = E.TAX_ACCOUNTS.map(a => {
    const k = E.keep(row, a);
    const how = { none: t('Nothing withheld'), lost: t('15% withheld and lost'), credit: t('15% withheld; usually claimable as a foreign tax credit'), inside: t('About 15% of the underlying dividends is kept by the US inside the fund'), 'inside-credit': t('Foreign tax paid inside the fund; reported on your T3 and usually claimable'), 'inside-varies': t('Foreign countries keep part of the dividends inside the fund') }[k.how];
    return `<tr><td class="txt"><b>${esc(acct(a))}</b></td><td>${pct(k.kept)}</td><td class="txt">${esc(how)}</td></tr>`;
  }).join('');
  const notes = [];
  if (q.ex === 'US') notes.push(t('Buying from a CAD account at Wealthsimple costs a {f} currency conversion each way. A USD account or Norbert’s gambit cuts that cost.', { f: pct(E.FX_FEE, 1) }));
  if (q.wh === 'CA-US' && E.US_EQUIV[q.s]) {
    const save10k = 10000 * (row.y / 0.85) * 0.15;
    notes.push(t('In an RRSP, the US-listed {u} tracks the same index without the 15% loss: about {m} a year more per $10,000. Converting to USD costs about {fx} once at Wealthsimple’s rate.', { u: esc(E.US_EQUIV[q.s]), m: money(save10k), fx: money(10000 * E.FX_FEE) }));
  }
  if (q.wh === 'CA-US' && !E.US_EQUIV[q.s]) notes.push(t('Priced in CAD, so no currency conversion when you buy. The trade-off is the 15% kept inside the fund, which an RRSP cannot avoid.'));
  if (q.wh === 'CDR') notes.push(t('Priced in CAD with no currency conversion and a built-in currency hedge. Because the depositary bank is the shareholder of record, the RRSP exemption does not apply.'));
  return `<section class="sec"><div class="sec-head"><h2>${t('Tax and currency for Canadians')}</h2><span class="muted" style="font-size:13px">${t('What you keep of the {y} yield in each account', { y: pct(row.y) })}</span></div>
    <div class="panel stack"><div class="tbl-wrap" style="border:0"><table class="tbl left"><thead><tr><th>${t('Account')}</th><th>${t('You keep')}</th><th>${t('Why')}</th></tr></thead><tbody>${lines}</tbody></table></div>
    ${notes.map(n => `<p style="margin:0">${n}</p>`).join('')}</div></section>`;
}

/* ------------------------------------------------------------ holding / security detail */
async function viewDetail({ posId, sym }) {
  const sim = posId ? S.sims.find(s => s.pos.id === posId) : null;
  const pos = posId ? S.pf.positions.find(p => p.id === posId) : null;
  if (posId && !pos) { location.hash = '#/'; return; }
  const symbol = sim ? sim.q.s : pos ? pos.sym : sym;
  shell(posId ? 'home' : 'research', `<div class="loading">${t('Loading research…')}</div>`);
  const q = sim ? sim.q : await D.loadQuote(symbol);
  if (!q) { $('#main').innerHTML = `<div class="panel empty"><h3>${t('No market data for {s} yet', { s: esc(symbol) })}</h3><p>${t('It is not in the tracked list, or the first daily update hasn’t run.')}</p>${pos ? `<button class="btn danger" data-act="del-pos" data-id="${esc(pos.id)}">${t('Remove this holding')}</button>` : ''}</div>`; return; }
  const twinSym = E.twinOf(q.s);
  const twinQ = twinSym ? (S.twins[twinSym] || await D.loadQuote(twinSym)) : null;
  const st = q.st || {}, f = q.f || {};
  const others = S.sims.filter(s => s.q.s === q.s && (!sim || s.pos.id !== sim.pos.id));
  const read = E.analystRead(q, sim, t, FM());
  const sc = st.score ?? 0, parts = st.parts || {};
  const ringCol = sc >= 80 ? 'var(--pos)' : sc >= 65 ? 'var(--accent)' : sc >= 50 ? 'var(--warn)' : 'var(--neg)';
  const M = (l, v, c = '') => `<div><span class="label">${l}</span><div class="v ${c}">${v}</div></div>`;
  const yrs = n => (st[`g${n}`] != null || st[`tr${n}`] != null);
  const tx = twinQ ? (sim && sim.shares ? { mode: 'mine', a: sim, b: E.replayInto(sim, twinQ, S.fx) } : { mode: 'h2h', ...E.headToHead(q, twinQ, S.fx) }) : null;
  $('#main').innerHTML = `
  <div class="detail-head"><div>
      <a href="${posId ? '#/' : '#/research'}" class="muted" style="font-size:14px;text-decoration:none">← ${posId ? t('Portfolio') : t('Research')}</a>
      <h1>${esc(q.d)}</h1><div class="nm2">${esc(q.name)}</div>
      <div class="chips"><span class="chip">${q.ex === 'CA' ? 'TSX' : 'US'} · ${esc(q.cur)}</span><span class="chip">${esc(t(q.type))}</span><span class="chip">${t('Pays {f}', { f: E.freqName(st.freq, t).toLowerCase() })}</span>${f.sector ? `<span class="chip">${esc(f.sector)}</span>` : ''}${f.category ? `<span class="chip">${esc(f.category)}</span>` : ''}${st.erosion ? `<span class="chip warn">${t('NAV erosion')}</span>` : ''}${st.lastChg != null && st.lastChg < -0.05 ? `<span class="chip bad">${t('Latest payment cut')}</span>` : ''}</div>
    </div>
    <div class="px-big"><div class="v">${nat(q.px, q.cur)}</div><div class="muted" style="font-size:13px">${t('Close {d} · yield {y}', { d: esc(dfmt(q.asof)), y: pct(st.fyld) })}</div>
      ${!posId ? `<a class="btn primary sm" href="#/add" data-prefill="${esc(q.s)}" style="margin-top:8px">${t('Add to portfolio')}</a>` : ''}</div>
  </div>
  ${sim ? `
  <section class="kpis">
    ${kpi(t('Shares bought → now'), `${shares(sim.startShares)} → ${shares(sim.shares)}`, t('+{n} from DRIP ({p})', { n: shares(sim.dripShares), p: pct(sim.startShares ? sim.dripShares / sim.startShares : 0, 1) }))}
    ${kpi(t('Market value'), money(sim.valueCad), sim.cur === 'USD' ? t('{v} at {r}', { v: nat(sim.value, 'USD'), r: num(sim.rNow, 4) }) : `${esc(acct(sim.pos.account))} · ${esc(DRIP()[sim.pos.drip])}`)}
    ${kpi(t('Capital invested'), money(sim.investedCad), t('Since {d}', { d: esc(dfmt(sim.firstDate)) }))}
    ${kpi(t('Total return'), `<span class="${cls(sim.totalCad)}">${sgnMoney(sim.totalCad)}</span>`, `<span class="${cls(sim.totalPct)}">${sgnPct(sim.totalPct)}</span> · <span class="${cls(sim.xirr)}">${sgnPct(sim.xirr)}</span> ${t('a year')}`)}
    ${kpi(t('Dividends received'), money(sim.divNetCad), t('{m} reinvested', { m: money(sim.reinvested * sim.rNow) }) + (sim.whtTotal ? ' · ' + t('{m} withheld', { m: money(sim.whtCad) }) : ''), 'income')}
    ${kpi(t('Forward income'), money(sim.fwdNetCad), t('{m} a month', { m: money(sim.fwdNetCad / 12) }), 'income')}
    ${kpi(t('Yield on cost'), pct(sim.yoc), t('Current yield {y}', { y: pct(sim.yld) }))}
    ${kpi(t('Price gain'), `<span class="${cls(sim.priceGainCad)}">${sgnMoney(sim.priceGainCad)}</span>`, t('Value minus capital and reinvested dividends'))}
  </section>
  <section class="cols">
    <div class="sec"><div class="sec-head"><h2 style="font-size:18px">${t('Your position')}</h2><div class="legend"><span><i class="sw c1"></i>${t('Value')}</span><span><i class="sw c2"></i>${t('Capital')}</span></div></div><div class="panel"><div id="ch-pos"></div></div></div>
    <div class="sec"><div class="sec-head"><h2 style="font-size:18px">${t('Share count')}</h2><div class="legend"><span><i class="sw c3"></i>${t('Shares, growing with DRIP')}</span></div></div><div class="panel"><div id="ch-sh"></div></div></div>
  </section>` : ''}
  ${q.approx ? `<div class="alert info"><i></i><span>${t('Yahoo publishes a price for this CDR but no history, so its history here is rebuilt from {b} at the CDR’s current ratio. Recent prices are exact; older ones are close but not exact.', { b: esc(q.approx) })}</span></div>` : ''}
  ${valuationPanel(q)}
  ${tx ? xrayDetail(q, twinQ, tx) : ''}
  ${!sim ? `<section class="sec" id="vs-growth-q"></section>` : ''}
  ${taxPanel(q)}
  ${canadianAlternatives(q)}
  ${sim ? `<section class="sec"><div class="sec-head"><h2>${t('What if')}</h2><span class="muted" style="font-size:13px">${t('Your exact purchases, replayed with one thing changed')}</span></div>
    <div class="panel stack"><div class="bench-row"><span class="label">${t('Compare with growth')}</span><div class="chips">${benchFor(q).map(([sy, n]) => `<button class="chip-btn ${S.whatIf[sim.pos.id] === sy ? 'on' : ''}" data-wi="${esc(sy)}">${esc(n)}</button>`).join('')}</div></div>
    <p class="verdict" id="wi-sum" hidden></p>
    <div class="field" style="max-width:420px"><label for="wi-sym">${t('Or compare with any security')}</label><input id="wi-sym" list="wi-list" autocomplete="off" placeholder="${esc(t('Type a ticker, e.g. VDY'))}" value="${esc(S.rows.find(r => r.s === S.whatIf[sim.pos.id])?.d || '')}"><datalist id="wi-list">${S.rows.filter(r => r.s !== q.s).map(r => `<option value="${esc(r.d)}">${esc(r.n)}</option>`).join('')}</datalist></div>
    <div class="tbl-wrap" id="wi-out"></div></div></section>` : ''}
  <section class="sec"><div class="sec-head"><h2>${t('Research note')}</h2><span class="muted" style="font-size:13px">${t('Written from the numbers, updated every trading day')}</span></div>
    <div class="panel"><div class="score-wrap" style="margin-bottom:18px">
      <div class="ring" style="background:conic-gradient(${ringCol} ${sc * 3.6}deg, var(--sunk) 0)"><div><b>${sc}</b><small>${t('of 100')}</small></div></div>
      <div class="parts">${[['growth', t('Payout growth'), 25], ['reliability', t('Reliability'), 25], ['return', t('Total return'), 25], ['risk', t('Drawdown risk'), 15], ['sustain', t('Sustainability'), 10]].map(([k, l, m]) => `<div class="part"><span>${l}</span><span class="track"><span style="width:${((parts[k] || 0) / m) * 100}%"></span></span><span class="mono">${num(parts[k] ?? 0, (parts[k] ?? 0) % 1 ? 1 : 0)}/${m}</span></div>`).join('')}</div>
    </div>
    <div class="read">${read.map(([h, p]) => `<div><h4>${esc(h)}</h4><p>${esc(p)}</p></div>`).join('')}</div></div></section>
  <section class="sec"><h2 style="font-size:18px">${t('Key figures')}</h2>
    <div class="metrics">
      ${M(t('Forward yield'), pct(st.fyld))}${M(t('5-year average yield'), pct(st.yAvg5))}${M(t('Trailing 12-month payout'), nat(st.ttm, q.cur))}${M(t('Latest payment'), `${nat(st.lastDiv, q.cur)}${st.lastChg != null ? ` <small class="${cls(st.lastChg)}">${sgnPct(st.lastChg, 1)}</small>` : ''}`)}
      ${[1, 3, 5, 10].filter(yrs).map(n => M(t('Dividend growth {n}y', { n }), sgnPct(st[`g${n}`], 1), cls(st[`g${n}`]))).join('')}
      ${[1, 3, 5, 10].filter(yrs).map(n => M(t('Total return {n}y / yr', { n }), sgnPct(st[`tr${n}`], 1), cls(st[`tr${n}`]))).join('')}
      ${[1, 3, 5, 10].filter(n => st[`p${n}`] != null).map(n => M(t('Price {n}y / yr', { n }), sgnPct(st[`p${n}`], 1), cls(st[`p${n}`]))).join('')}
      ${M(t('Years of increases'), st.streak ?? '—')}${M(t('Cuts in 10 years'), st.cuts10 ?? '—')}${M(t('Max drawdown 5y'), st.mdd != null ? '−' + pct(st.mdd, 1) : '—')}${M(t('Volatility 5y'), pct(st.vol, 1))}
      ${f.mer != null ? M(t('Management fee'), num(f.mer, 2) + ' %') : ''}${f.pe != null ? M(t('P/E (forward)'), `${num(f.pe, 1)}${f.fpe ? ` (${num(f.fpe, 1)})` : ''}`) : ''}${f.payout != null && q.type !== 'ETF' ? M(t('Payout ratio'), pct(f.payout, 0)) : ''}${f.beta != null ? M(t('Beta'), num(f.beta, 2)) : ''}
      ${f.aum ? M(t('Fund assets'), shortM(f.aum)) : ''}${f.mcap ? M(t('Market cap'), shortM(f.mcap)) : ''}${f.de != null ? M(t('Debt / equity'), num(f.de, 0) + ' %') : ''}${f.roe != null ? M(t('Return on equity'), pct(f.roe, 1)) : ''}
    </div></section>
  <section class="cols">
    <div class="sec"><div class="sec-head"><h2 style="font-size:18px">${t('Dividends per share by year')}</h2><div class="legend"><span><i class="sw gb"></i>${t('Full year')}</span><span><i class="sw proj"></i>${t('{y} so far', { y: new Date().getFullYear() })}</span></div></div><div class="panel"><div id="ch-ann"></div></div></div>
    <div class="sec"><div class="sec-head"><h2 style="font-size:18px">${t('Price, 5 years')}</h2>${q.div?.length ? `<div class="legend"><span><i class="sw mk"></i>${t('Dividend paid')}</span></div>` : ''}</div><div class="panel"><div id="ch-px"></div></div></div>
  </section>
  ${q.top && q.top.length ? `<section class="sec"><h2 style="font-size:18px">${t('Top holdings')}</h2><div class="panel">${q.top.map(x => hbar(x.s, x.w || 0)).join('')}<p class="muted" style="font-size:12.5px;margin:8px 0 0">${q.top.map(x => `${esc(x.s)}: ${esc(x.n)}`).join(' · ')}</p></div></section>` : ''}
  ${q.about ? `<section class="sec"><h2 style="font-size:18px">${t('About')}</h2><div class="panel"><p style="margin:0;max-width:75ch">${esc(q.about)}</p>${getLang() === 'fr' ? `<p class="muted" style="font-size:12.5px;margin:6px 0 0">${t('Description provided in English by the data source.')}</p>` : ''}</div></section>` : ''}
  ${sim ? positionAdmin(sim) : ''}
  ${others.length ? `<p class="muted">${t('You also hold {s} in {list}.', { s: esc(q.d), list: others.map(o => `<a href="#/h/${encodeURIComponent(o.pos.id)}">${esc(acct(o.pos.account))}</a>`).join(', ') })}</p>` : ''}
  ${dataFoot()}`;
  const ann = st.annual || [];
  const natS = v => nat(v, q.cur).replace(/[.,]00(?=\s|$)/, '');
  barChart($('#ch-ann'), { x: ann.map(a => String(a[0])), v: ann.map(a => a[1]), cls: ann.map(a => (a[0] === new Date().getFullYear() ? 'proj' : '')), fmtY: natS, fmtX: y => '’' + y.slice(2), tip: i => `<b>${ann[i][0]}</b><div>${t('{v} per share', { v: nat(ann[i][1], q.cur) })}</div>` });
  priceChart($('#ch-px'), q, 5);
  drawYieldHistory(q);
  if (tx) drawXrayChart(tx, q, twinQ);
  if (!sim) drawGrowthForQuote(q);
  if (sim) {
    const months = E.monthsFrom(sim.firstDate), ms = E.monthlySeries(sim, S.fx, months);
    if (months.length > 1) {
      lineChart($('#ch-pos'), { x: months, fmtX: mshort, fmtY: shortM, series: [{ name: t('Value'), v: ms.map(x => x.value), cls: 'c1', area: true }, { name: t('Capital'), v: ms.map(x => x.invested), cls: 'c2' }] });
      lineChart($('#ch-sh'), { x: months, fmtX: mshort, fmtY: v => shares(v), series: [{ name: t('Shares'), v: ms.map(x => x.shares), cls: 'c3', area: true }], tip: i => `<b>${mfmt(months[i])}</b><div>${t('{n} shares', { n: shares(ms[i].shares) })}</div>` });
    } else { $('#ch-pos').innerHTML = $('#ch-sh').innerHTML = `<p class="muted" style="margin:0">${t('Fills in after the first full month.')}</p>`; }
    if (!S.whatIf[sim.pos.id]) S.whatIf[sim.pos.id] = benchFor(q)[0]?.[0];
    $$('[data-wi]').forEach(x => x.classList.toggle('on', x.dataset.wi === S.whatIf[sim.pos.id]));
    drawWhatIf(sim, twinQ);
    $$('[data-wi]').forEach(b => b.addEventListener('click', () => { S.whatIf[sim.pos.id] = b.dataset.wi; $('#wi-sym').value = ''; $$('[data-wi]').forEach(x => x.classList.toggle('on', x === b)); drawWhatIf(sim, twinQ); }));
    $('#wi-sym').addEventListener('change', e => { const r = D.resolveSymbol(e.target.value, S.rows); if (!r) return; S.whatIf[sim.pos.id] = r.s; $$('[data-wi]').forEach(x => x.classList.toggle('on', x.dataset.wi === r.s)); drawWhatIf(sim, twinQ); });
    wirePositionAdmin(sim);
  }
}
/* ------------------------------------------------------------ growth comparison and valuation on a security page */
function benchFor(q) {
  const out = benchList().filter(([sy]) => sy !== q.s).map(([sy, n]) => [sy, `${n} · ${sy.replace('.TO', '')}`]);
  if (q.type === 'ETF' && q.top?.length) {
    const r = D.resolveSymbol(String(q.top[0].s).replace(/\.(TO|NE)$/, ''), S.rows);
    if (r && r.s !== q.s && !out.some(([sy]) => sy === r.s)) out.push([r.s, t('Top holding · {s}', { s: r.d })]);
  }
  return out;
}
let qBench = '';
async function drawGrowthForQuote(q) {
  const el = $('#vs-growth-q'); if (!el) return;
  const list = benchFor(q);
  if (!list.length) { el.remove(); return; }
  if (!list.some(([sy]) => sy === qBench)) qBench = list[0][0];
  const bq = await D.loadQuote(qBench);
  if (!bq || !$('#vs-growth-q')) return;
  const h = E.headToHead(q, bq, S.fx), a = E.outcome(h.a), b = E.outcome(h.b), gap = b - a;
  const yrs = Math.max(1, Math.round(h.years));
  el.innerHTML = `<div class="sec-head"><h2>${t('Dividends vs growth')}</h2><span class="muted" style="font-size:13px">${t('{m} put into each on {d}, dividends reinvested, in a TFSA', { m: money0(10000), d: esc(dfmt(h.start)) })}</span></div>
    <div class="panel stack"><div class="chips">${list.map(([sy, n]) => `<button class="chip-btn ${sy === qBench ? 'on' : ''}" data-qb="${esc(sy)}">${esc(n)}</button>`).join('')}</div>
    <div class="xr-cmp">
      <div><span class="label">${esc(q.d)}</span><b>${money0(a)}</b><small>${t('{i} in dividends', { i: money0(h.a.divNetCad) })} · ${sgnPct(h.a.xirr, 1)}${t('/yr')}</small></div>
      <div><span class="label">${esc(bq.d)}</span><b>${money0(b)}</b><small>${t('{i} in dividends', { i: money0(h.b.divNetCad) })} · ${sgnPct(h.b.xirr, 1)}${t('/yr')}</small></div>
      <div><span class="label">${t('Difference')}</span><b class="${cls(-gap)}">${sgnMoney(-gap)}</b><small>${tp(yrs, 'over {n} year', 'over {n} years')}</small></div>
    </div>
    <p class="verdict ${gap <= 0 ? 'ahead' : 'behind'}">${gap <= 0 ? t('{a} beat {b} over this period, dividends included.', { a: esc(q.d), b: esc(bq.d) }) : h.a.divNetCad > h.b.divNetCad ? t('{b} would have left you {g} richer, even though {a} paid {i} more in dividends.', { a: esc(q.d), b: esc(bq.d), g: money0(gap), i: money0(h.a.divNetCad - h.b.divNetCad) }) : t('{b} came out {g} ahead on both growth and income.', { b: esc(bq.d), g: money0(gap) })} ${t('Past results, not a forecast.')}</p></div>`;
  $$('[data-qb]', el).forEach(btn => btn.addEventListener('click', () => { qBench = btn.dataset.qb; drawGrowthForQuote(q); }));
}
function valuationPanel(q) {
  const v = E.valuationFromQuote(q);
  if (!v) return '';
  const st = q.st || {}, y = st.fyld ?? st.yld;
  const P = x => pct(Math.abs(x), 0);
  const lines = v.sig.map(g => {
    if (g.k === 'yield') return Math.abs(g.d) < 0.03 ? t('The yield of {y} is close to its 5-year average of {a}.', { y: pct(y), a: pct(st.yAvg5) })
      : g.d > 0 ? t('The yield of {y} is {d} higher than its 5-year average of {a}: you get more dividend for each dollar than usual.', { y: pct(y), d: P(g.d), a: pct(st.yAvg5) })
      : t('The yield of {y} is {d} lower than its 5-year average of {a}: each dollar of dividend costs more than usual.', { y: pct(y), d: P(g.d), a: pct(st.yAvg5) });
    if (g.k === 'yield10') return g.d >= 0 ? t('Against its 10-year average yield of {a}, today’s yield is {d} higher.', { a: pct(st.yAvg10), d: P(g.d) }) : t('Against its 10-year average yield of {a}, today’s yield is {d} lower.', { a: pct(st.yAvg10), d: P(g.d) });
    if (g.k === 'pct') return t('Over the last 5 years, the yield was lower than today {p} of the time.', { p: pct(g.p, 0) });
    return t('The price is {p} of the way from its 52-week low of {lo} to its high of {hi}.', { p: pct(g.r, 0), lo: nat(st.r52lo, q.cur), hi: nat(st.r52hi, q.cur) });
  });
  const head = { cheap: t('Cheap vs its history'), fair: t('Fair vs its history'), expensive: t('Pricey vs its history'), range: t('Price range only') }[v.kind];
  const sub = { cheap: t('Signals point to a lower price than usual for what it pays.'), fair: t('Signals are mixed or close to normal.'), expensive: t('Signals point to a higher price than usual for what it pays.'), range: t('It pays little or no dividend, so only the price range is shown.') }[v.kind];
  const fairTxt = v.fair ? t('At its 5-year average yield, today’s payout of {d} a share points to a price around {f}{f10}. It last closed at {p}.', { d: nat(st.fwd, q.cur), f: `<b>${nat(v.fair, q.cur)}</b>`, f10: v.fair10 ? t(' ({f} at its 10-year average)', { f: nat(v.fair10, q.cur) }) : '', p: nat(q.px, q.cur) }) : '';
  return `<section class="sec"><div class="sec-head"><h2>${t('Price check')}</h2><span class="muted" style="font-size:13px">${t('Cheap or expensive compared with its own history?')}</span></div>
    <div class="panel stack">
      <div class="val-head"><span class="val-badge val-${v.kind}">${esc(head)}</span><span>${esc(sub)}</span></div>
      ${v.kind !== 'range' ? `<div class="gauge" aria-hidden="true"><div class="gauge-bar"><i style="left:${(v.pos * 100).toFixed(1)}%"></i></div><div class="gauge-lbl"><span>${t('Cheap')}</span><span>${t('Fair')}</span><span>${t('Pricey')}</span></div></div>` : ''}
      <ul class="val-reasons">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
      ${fairTxt ? `<p style="margin:0">${fairTxt}</p>` : ''}
      ${v.caution ? `<div class="alert warn"><i></i><span>${t('A yield well above normal sometimes means the market expects a cut. This one has cut before or pays out more than it earns, so check the research note below.')}</span></div>` : ''}
      ${v.optionIncome ? `<p class="muted" style="margin:0;font-size:13px">${t('This fund’s yield comes mostly from selling options, so it rises and falls with market volatility. Yield-based signals are less reliable here.')}</p>` : ''}
      ${st.yHist?.length > 12 ? `<div><div class="legend"><span><i class="sw c3"></i>${t('Yield')}</span><span><i class="sw c2"></i>${t('5-year average')}</span></div><div id="ch-yh"></div></div>` : ''}
      <p class="muted" style="margin:0;font-size:12.5px">${t('This compares the security with its own past. It is not a recommendation to buy or sell, and the past may not repeat.')}</p>
    </div></section>`;
}
function drawYieldHistory(q) {
  const el = $('#ch-yh'), h = q.st?.yHist;
  if (!el || !h) return;
  const avg = q.st.yAvg5;
  lineChart(el, { x: h.map(r => r[0]), floor: 0.001, fmtX: mshort, fmtY: v => pct(v, 1), label: t('Yield history'), series: [{ name: t('Yield'), v: h.map(r => r[1]), cls: 'c3' }, ...(avg ? [{ name: t('5-year average'), v: h.map(() => avg), cls: 'c2' }] : [])],
    tip: i => `<b>${mfmt(h[i][0])}</b><div>${t('Yield')} ${pct(h[i][1])}</div>` });
}
function xrayDetail(q, twinQ, tx) {
  const { a, b } = tx;
  const endA = a.valueCad + a.paidOutCad + a.realizedCad, endB = b.valueCad + b.paidOutCad + b.realizedCad;
  const extra = a.divNetCad - b.divNetCad, gap = endA - endB;
  const intro = tx.mode === 'mine'
    ? t('Your purchases of {a}, replayed dollar for dollar into {b} on the same dates, dividends reinvested the same way.', { a: esc(q.d), b: esc(twinQ.d) })
    : t('{m} put into {a} and into {b} on {d}, dividends reinvested, inside a TFSA.', { m: money0(10000), a: esc(q.d), b: esc(twinQ.d), d: esc(dfmt(tx.start)) });
  const verdict = gap >= 0 ? t('The extra yield has paid off: {a} is ahead on total return.', { a: esc(q.d) })
    : extra > 0 ? t('{a} paid {i} more in dividends but ended {g} behind plain {b}. That gap is the growth the option strategy gave up.', { a: esc(q.d), b: esc(twinQ.d), i: money0(extra), g: money0(-gap) })
    : t('Plain {b} won on both income and total return.', { b: esc(twinQ.d) });
  return `<section class="sec"><div class="sec-head"><h2>${t('Yield X-ray')}</h2><span class="muted" style="font-size:13px">${t('{a} vs its plain twin {b}', { a: esc(q.d), b: esc(twinQ.d) })}</span></div>
    <div class="panel stack"><p style="margin:0">${intro}${b.skipped ? ' ' + t('Part of your history predates {b}’s data, so those purchases are left out of its side.', { b: esc(twinQ.d) }) : ''}</p>
    <div class="xr-cmp">
      <div><span class="label">${esc(q.d)}</span><b>${money0(endA)}</b><small>${t('{i} in dividends', { i: money0(a.divNetCad) })} · ${sgnPct(a.xirr, 1)}${t('/yr')}</small></div>
      <div><span class="label">${esc(twinQ.d)}</span><b>${money0(endB)}</b><small>${t('{i} in dividends', { i: money0(b.divNetCad) })} · ${sgnPct(b.xirr, 1)}${t('/yr')}</small></div>
      <div><span class="label">${t('Difference')}</span><b class="${cls(gap)}">${sgnMoney(gap)}</b><small>${t('Income difference {i}', { i: sgnMoney(extra) })}</small></div>
    </div>
    <p class="verdict ${gap >= 0 ? 'ahead' : 'behind'}">${verdict}</p>
    <div class="legend"><span><i class="sw c1"></i>${esc(q.d)}</span><span><i class="sw c3"></i>${esc(twinQ.d)}</span></div><div id="ch-xr"></div></div></section>`;
}
function drawXrayChart(tx, q, twinQ) {
  const months = E.monthsFrom(tx.a.firstDate);
  if (months.length < 2) return;
  const A = E.monthlySeries(tx.a, S.fx, months), B = E.monthlySeries(tx.b, S.fx, months);
  const cumPaid = sim => months.map(m => sum(sim.ledger.filter(l => l.kind === 'div' && sim.pos.drip === 'off' && E.monthKey(l.pay) <= m), l => l.netCad));
  const pa = cumPaid(tx.a), pb = cumPaid(tx.b);
  const va = A.map((x, i) => x.value + pa[i]), vb = B.map((x, i) => x.value + pb[i]);
  lineChart($('#ch-xr'), { x: months, fmtX: mshort, fmtY: shortM, series: [{ name: q.d, v: va, cls: 'c1' }, { name: twinQ.d, v: vb, cls: 'c3' }], tip: i => `<b>${mfmt(months[i])}</b><div class="r"><span>${esc(q.d)}</span><span>${money0(va[i])}</span></div><div class="r"><span>${esc(twinQ.d)}</span><span>${money0(vb[i])}</span></div>` });
}
function drawWhatIf(sim, twinQ) {
  const pick = S.whatIf[sim.pos.id];
  (async () => {
    const extras = [];
    if (twinQ) extras.push(['twin', twinQ]);
    if (pick && pick !== twinQ?.s) extras.push(['pick', await D.loadQuote(pick)]);
    const sc = E.scenarios(sim, S.fx, extras);
    const label = x => {
      if (x.key === 'actual') return `<b>${t('What you did')}</b><small>${esc(acct(sim.pos.account))} · ${esc(DRIP()[sim.pos.drip])}</small>`;
      if (x.key.startsWith('drip:')) return `${esc(DRIP()[x.key.slice(5)])}<small>${t('instead of {d}', { d: esc(DRIP()[sim.pos.drip].toLowerCase()) })}</small>`;
      if (x.key.startsWith('acct:')) return `${t('Held in your {a}', { a: esc(acct(x.key.slice(5))) })}<small>${t('withholding {w}', { w: pct(x.sim.w, 0) })}</small>`;
      return `${t('Bought {s} instead', { s: esc(x.q.d) })}<small>${x.key === 'twin' ? t('plain twin') : esc(x.q.name)}${x.sim.skipped ? ' · ' + t('partial history') : ''}</small>`;
    };
    const base = sim.totalCad, alt = sc.find(x => x.key === 'pick') || (pick === twinQ?.s ? sc.find(x => x.key === 'twin') : null);
    const sumEl = $('#wi-sum');
    if (sumEl && alt) {
      const gap = E.outcome(alt.sim) - E.outcome(sim), inc = sim.fwdNetCad - alt.sim.fwdNetCad, dv = sim.divNetCad - alt.sim.divNetCad;
      sumEl.hidden = false; sumEl.className = 'verdict ' + (gap <= 0 ? 'ahead' : 'behind');
      sumEl.innerHTML = (gap > 0 ? t('Same dollars, same dates into {b}: you would have {g} more today.', { b: `<b>${esc(alt.q.d)}</b>`, g: `<b>${money0(gap)}</b>` }) : t('Same dollars, same dates into {b}: you would have {g} less today. Your pick is ahead.', { b: `<b>${esc(alt.q.d)}</b>`, g: `<b>${money0(-gap)}</b>` }))
        + ' ' + (dv >= 0 ? t('You collected {d} more in dividends and earn {i} more a year now.', { d: money0(dv), i: money0(Math.max(0, inc)) }) : t('It would also have paid you {d} more in dividends.', { d: money0(-dv) }))
        + (alt.sim.skipped ? ' ' + t('Some purchases predate its history and are left out.') : '');
    } else if (sumEl) sumEl.hidden = true;
    $('#wi-out').innerHTML = `<table class="tbl"><thead><tr><th>${t('Scenario')}</th><th>${t('Value today')}</th><th>${t('Dividends')}</th><th>${t('Total return')}</th><th>${t('Per year')}</th><th>${t('Income / yr')}</th><th>${t('vs actual')}</th></tr></thead><tbody>
      ${sc.map(x => `<tr${x.key === 'actual' ? ' class="hl-row"' : ''}><td class="txt">${label(x)}</td><td>${money0(x.sim.valueCad)}</td><td class="gold">${money0(x.sim.divNetCad)}</td><td class="${cls(x.sim.totalCad)}">${sgnMoney(x.sim.totalCad)}</td><td class="${cls(x.sim.xirr)}">${sgnPct(x.sim.xirr, 1)}</td><td>${money0(x.sim.fwdNetCad)}</td><td class="${cls(x.sim.totalCad - base)}">${x.key === 'actual' ? '—' : sgnMoney(x.sim.totalCad - base)}</td></tr>`).join('')}
      </tbody></table>`;
  })();
}
function positionAdmin(sim) {
  const p = sim.pos, rows = sim.ledger.slice().reverse();
  return `
  <section class="sec"><div class="sec-head"><h2>${t('DRIP ledger')}</h2><span class="muted" style="font-size:13px">${t('Every buy, sale, dividend and reinvestment, replayed')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('Date')}</th><th>${t('Event')}</th><th>${t('Shares held')}</th><th>${t('Per share')}</th><th>${t('Net amount')}</th><th>${t('Price')}</th><th>${t('Shares bought')}</th><th>${t('Shares after')}</th></tr></thead><tbody id="dl-body">
    ${dripRows(rows.slice(0, 36), sim)}</tbody></table></div>
    ${rows.length > 36 ? `<button class="btn" id="dl-more" style="justify-self:start">${t('Show all {n}', { n: rows.length })}</button>` : ''}</section>
  <section class="sec"><h2 style="font-size:18px">${t('Manage this holding')}</h2>
    <div class="panel stack">
      <div class="form-grid">
        <div class="field"><label for="pa-acct">${t('Account')}</label><select id="pa-acct">${E.ACCOUNTS.map(a => `<option value="${a}" ${a === p.account ? 'selected' : ''}>${esc(acct(a))}</option>`).join('')}</select></div>
        <div class="field"><label for="pa-drip">${t('Dividends')}</label><select id="pa-drip">${Object.entries(DRIP()).map(([k, l]) => `<option value="${k}" ${k === p.drip ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field wide"><span class="lbl">${t('Wealthsimple reinvests fractional shares. Many brokers only buy whole shares and leave the rest as cash.')}</span></div>
      </div>
      <div><span class="label">${t('Purchases and sales')}</span>
        <div class="tbl-wrap" style="margin-top:6px"><table class="tbl"><thead><tr><th>${t('Date')}</th><th>${t('Shares')}</th><th>${t('Amount')}</th><th></th></tr></thead><tbody>
        ${p.lots.slice().sort((a, b) => a.date.localeCompare(b.date)).map(l => `<tr><td>${esc(dfmt(l.date))}</td><td>${l.shares < 0 ? t('Sold {n}', { n: shares(-l.shares) }) : shares(l.shares)}</td><td>${l.cost ? nat(+l.cost, sim.cur) : `<span class="muted">${t('at close')}</span>`}</td><td><button class="btn sm ghost danger" data-act="del-lot" data-id="${esc(l.id)}">${t('Remove')}</button></td></tr>`).join('')}
        </tbody></table></div></div>
      <form id="lot-form" class="form-grid" novalidate>
        <div class="field"><label for="lt-side">${t('Add a')}</label><select id="lt-side"><option value="buy">${t('Purchase')}</option><option value="sell">${t('Sale')}</option></select></div>
        <div class="field"><label for="lt-date">${t('Date')}</label><input id="lt-date" type="date" value="${E.today()}" max="${E.today()}"></div>
        <div class="field"><label for="lt-sh">${t('Shares')}</label><input id="lt-sh" type="number" step="any" min="0" inputmode="decimal"></div>
        <div class="field"><label for="lt-cost">${t('Amount ({c}, optional)', { c: esc(sim.cur) })}</label><input id="lt-cost" type="number" step="any" min="0" inputmode="decimal" placeholder="${esc(t('Close price × shares'))}"></div>
        <p class="err" id="lt-err" hidden style="grid-column:1/-1"></p>
        <div class="tools" style="grid-column:1/-1"><button class="btn primary" type="submit">${t('Add')}</button></div>
      </form>
      <div id="pos-del" class="tools"><button class="btn danger" data-act="ask-del-pos">${t('Delete this holding')}</button></div>
    </div></section>`;
}
const dripRows = (rows, sim) => rows.map(l => l.kind === 'div'
  ? `<tr><td>${esc(dfmt(l.pay))}</td><td class="txt">${t('Dividend')}</td><td>${shares(l.held)}</td><td>${nat(l.dps, sim.cur)}</td><td class="gold">${nat(l.net, sim.cur)}${l.wht ? `<small>${t('{m} withheld', { m: nat(l.wht, sim.cur) })}</small>` : ''}</td><td>${sim.pos.drip === 'off' ? '—' : nat(l.price, sim.cur)}</td><td>${l.bought ? '+' + shares(l.bought) : '—'}</td><td>${shares(l.after)}</td></tr>`
  : `<tr><td>${esc(dfmt(l.date))}</td><td class="txt">${l.kind === 'buy' ? t('Purchase') : t('Sale')}</td><td>—</td><td>—</td><td>${nat(l.amount, sim.cur)}</td><td>${nat(l.price, sim.cur)}</td><td>${l.kind === 'buy' ? '+' : '−'}${shares(l.shares)}</td><td>${shares(l.after)}</td></tr>`).join('');
function wirePositionAdmin(sim) {
  const p = sim.pos, all = sim.ledger.slice().reverse();
  $('#dl-more')?.addEventListener('click', e => { $('#dl-body').innerHTML = dripRows(all, sim); e.target.remove(); });
  $('#pa-acct').addEventListener('change', e => { p.account = e.target.value; changed(); toast(t('Account updated')); });
  $('#pa-drip').addEventListener('change', e => { p.drip = e.target.value; changed(); toast(t('Dividend setting updated. History replayed.')); });
  $('#lot-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const sh = parseFloat($('#lt-sh').value), date = $('#lt-date').value, cost = parseFloat($('#lt-cost').value), side = $('#lt-side').value;
    const err = $('#lt-err');
    if (!(sh > 0) || !date) { err.textContent = t('Enter a date and a number of shares.'); err.hidden = false; return; }
    if (side === 'sell' && sh > sim.shares + 1e-9) { err.textContent = t('You hold {n} shares.', { n: shares(sim.shares) }); err.hidden = false; return; }
    p.lots.push({ id: rid('l'), date, shares: side === 'sell' ? -sh : sh, cost: cost > 0 ? cost : null });
    changed(); toast(side === 'sell' ? t('Sale added') : t('Purchase added'));
  });
}

/* ------------------------------------------------------------ add holdings */
let prefill = '';
function viewAdd() {
  const st = S.pf.settings;
  const ACCT = (id, v) => `<select id="${id}">${E.ACCOUNTS.map(a => `<option value="${a}" ${a === v ? 'selected' : ''}>${esc(acct(a))}</option>`).join('')}</select>`;
  const pre = prefill ? S.rows.find(r => r.s === prefill) : null;
  shell('add', `
  <div class="page-head"><div><h1>${t('Add holdings')}</h1><p>${t('Ticker, shares and the date you bought. Every dividend and DRIP purchase since then is filled in for you.')}</p></div></div>
  <div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-pane="one">${t('One holding')}</button><button role="tab" aria-selected="false" data-pane="paste">${t('Paste a list')}</button><button role="tab" aria-selected="false" data-pane="file">${t('Import a file')}</button></div>
  <div class="panel" data-p="one"><form id="one-form" class="form-grid" novalidate>
    <div class="field wide ac"><label for="o-sym">${t('Ticker')}</label><input id="o-sym" autocomplete="off" autocapitalize="characters" placeholder="VDY, XEI, SCHD…" value="${esc(pre ? pre.d : prefill)}"><div class="ac-list" id="o-ac" hidden></div><span class="hint" id="o-pick">${pre ? esc(pre.n) : t('Start typing and pick from the list.')}</span></div>
    <div class="field"><label for="o-sh">${t('Shares')}</label><input id="o-sh" type="number" step="any" min="0" inputmode="decimal"></div>
    <div class="field"><label for="o-date">${t('Date bought')}</label><input id="o-date" type="date" max="${E.today()}" value="${E.addDays(E.today(), -365)}"></div>
    <div class="field"><label for="o-acct">${t('Account')}</label>${ACCT('o-acct', st.account)}</div>
    <div class="field"><label for="o-drip">${t('Dividends')}</label><select id="o-drip">${Object.entries(DRIP()).map(([k, l]) => `<option value="${k}" ${k === st.drip ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field wide"><label for="o-cost">${t('Amount paid (optional)')}</label><input id="o-cost" type="number" step="any" min="0" inputmode="decimal" placeholder="${esc(t('Leave blank to use that day’s closing price'))}"></div>
    <p class="err" id="o-err" hidden style="grid-column:1/-1"></p>
    <div class="tools" style="grid-column:1/-1"><button class="btn primary" type="submit">${t('Add holding')}</button><span class="muted" style="font-size:13px">${t('Bought more than once? Add the first purchase here, then add the others from the holding’s page.')}</span></div>
  </form></div>
  <div class="panel stack" data-p="paste" hidden>
    <div class="field"><label for="p-text">${t('One holding per line: ticker, shares, then optionally the date, amount paid and account')}</label>
      <textarea id="p-text" rows="7" placeholder="VDY 150 2024-01-15\nXEI 250 2024-03-01 6250 TFSA\nSCHD 120 2023-09-05 RRSP\nENB 60"></textarea></div>
    <div class="form-grid"><div class="field"><label for="p-date">${t('Date when a line has none')}</label><input id="p-date" type="date" max="${E.today()}" value="${E.addDays(E.today(), -365)}"></div><div class="field"><label for="p-acct">${t('Account when a line has none')}</label>${ACCT('p-acct', st.account)}</div></div>
    <div class="tools"><button class="btn" id="p-prev">${t('Check the list')}</button></div><div id="p-out"></div>
  </div>
  <div class="panel stack" data-p="file" hidden>
    <p style="margin:0">${t('Upload a CSV of your holdings or account activity. Columns for symbol and quantity are found automatically; dates, amounts, account and buy/sell type are used when present. Dividend and DRIP rows are skipped because Yield Ledger replays them itself.')}</p>
    <div class="field"><label for="f-file">${t('CSV file')}</label><input id="f-file" type="file" accept=".csv,text/csv,.txt"></div>
    <div class="form-grid"><div class="field"><label for="f-date">${t('Date when a row has none')}</label><input id="f-date" type="date" max="${E.today()}" value="${E.addDays(E.today(), -365)}"></div><div class="field"><label for="f-acct">${t('Account when a row has none')}</label>${ACCT('f-acct', st.account)}</div></div>
    <div id="f-out"></div>
  </div>
  ${dataFoot()}`);
  prefill = '';
  $$('[data-pane]').forEach(b => b.addEventListener('click', () => {
    $$('[data-pane]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-p]').forEach(p => (p.hidden = p.dataset.p !== b.dataset.pane));
  }));
  let picked = pre || null, hi = 0, list = [];
  const ac = $('#o-ac'), inp = $('#o-sym');
  const showAc = () => {
    list = D.search(S.rows, inp.value);
    ac.hidden = !list.length || document.activeElement !== inp;
    ac.innerHTML = list.map((r, i) => `<button type="button" data-s="${esc(r.s)}" class="${i === hi ? 'on' : ''}"><span class="mono">${esc(r.d)}</span><span class="nmx">${esc(r.n)}</span><span class="muted">${r.ex} · ${pct(r.y, 1)}</span></button>`).join('');
  };
  const pick = s => { picked = S.rows.find(r => r.s === s); inp.value = picked.d; $('#o-pick').textContent = `${picked.n} · ${picked.ex === 'CA' ? 'TSX' : 'US'} · ${t('yield {y}', { y: pct(picked.y) })}`; ac.hidden = true; $('#o-sh').focus(); };
  inp.addEventListener('input', () => { picked = null; hi = 0; $('#o-pick').textContent = t('Start typing and pick from the list.'); showAc(); });
  inp.addEventListener('focus', showAc);
  inp.addEventListener('blur', () => setTimeout(() => (ac.hidden = true), 150));
  inp.addEventListener('keydown', e => {
    if (ac.hidden) return;
    if (e.key === 'ArrowDown') { hi = Math.min(list.length - 1, hi + 1); showAc(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); showAc(); e.preventDefault(); }
    if (e.key === 'Enter' && list[hi]) { pick(list[hi].s); e.preventDefault(); }
  });
  ac.addEventListener('mousedown', e => { const b = e.target.closest('[data-s]'); if (b) { e.preventDefault(); pick(b.dataset.s); } });
  $('#one-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const err = $('#o-err'); err.hidden = true;
    if (!picked) picked = D.resolveSymbol(inp.value, S.rows);
    const sh = parseFloat($('#o-sh').value), date = $('#o-date').value, cost = parseFloat($('#o-cost').value);
    if (!picked) { err.textContent = t('{s} isn’t in the tracked list. Pick one from the suggestions.', { s: inp.value || t('That ticker') }); err.hidden = false; return; }
    if (!(sh > 0) || !date) { err.textContent = t('Enter the number of shares and the date you bought.'); err.hidden = false; return; }
    const id = addRows([{ sym: picked, shares: sh, date, cost: cost > 0 ? cost : null, account: $('#o-acct').value }], $('#o-drip').value);
    toast(t('{s} added. Dividends since {d} replayed.', { s: picked.d, d: dfmt(date) }));
    changed('#/h/' + encodeURIComponent(id));
  });
  $('#p-prev').addEventListener('click', () => preview(parseQuick($('#p-text').value, S.rows, { date: $('#p-date').value, account: $('#p-acct').value }), $('#p-out')));
  $('#f-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const r = parseExport(await file.text(), S.rows, { date: $('#f-date').value, account: $('#f-acct').value });
      preview(r.rows, $('#f-out'), t('Read columns: {c}.', { c: Object.entries(r.columns).map(([k, v]) => `${k} = “${v}”`).join(', ') }) + (r.skipped ? ' ' + t('Skipped {n} dividend, transfer or other rows.', { n: r.skipped }) : ''));
    } catch (er) { $('#f-out').innerHTML = `<p class="err">${esc(t(er.message))}</p>`; }
  });
}
function preview(rows, out, note = '') {
  const good = rows.filter(r => r.sym && r.shares);
  const bad = rows.length - good.length;
  out.innerHTML = `${note ? `<p class="muted" style="font-size:13px;margin:0 0 8px">${esc(note)}</p>` : ''}
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('Line')}</th><th>${t('Security')}</th><th>${t('Shares')}</th><th>${t('Date')}</th><th>${t('Amount')}</th><th>${t('Account')}</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td class="txt muted" style="font-size:12.5px">${esc(r.line.slice(0, 60))}</td><td class="txt">${r.sym ? `<b class="mono">${esc(r.sym.d)}</b> <span class="muted" style="font-size:12px">${r.sym.ex}</span>` : `<span class="neg">${t('{s} not tracked', { s: esc(r.symText || '?') })}</span>`}</td><td>${r.shares ? shares(r.shares) : `<span class="neg">${t('missing')}</span>`}</td><td>${esc(r.date ? dfmt(r.date) : '')}</td><td>${r.cost ? money(r.cost) : `<span class="muted">${t('at close')}</span>`}</td><td class="txt">${esc(acct(r.account))}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="tools" style="margin-top:10px"><button class="btn primary" id="add-all" ${good.length ? '' : 'disabled'}>${tp(good.length, 'Add {n} holding', 'Add {n} holdings')}</button>${bad ? `<span class="muted" style="font-size:13px">${tp(bad, '{n} line will be skipped.', '{n} lines will be skipped.')}</span>` : ''}</div>`;
  $('#add-all', out)?.addEventListener('click', () => { addRows(good, S.pf.settings.drip); toast(t('{n} added. Dividend history replayed.', { n: good.length })); changed('#/'); });
}
function addRows(rows, drip) {
  let last = null;
  for (const r of rows) {
    let p = S.pf.positions.find(x => x.sym === r.sym.s && x.account === r.account);
    if (!p) { p = { id: rid('p'), sym: r.sym.s, account: r.account, drip: drip || 'frac', lots: [] }; S.pf.positions.push(p); }
    p.lots.push({ id: rid('l'), date: r.date, shares: r.shares, cost: r.cost || null });
    last = p.id;
  }
  return last;
}

/* ------------------------------------------------------------ settings */
function viewSettings() {
  const st = S.pf.settings, m = S.meta;
  shell('settings', `
  <div class="page-head"><div><h1>${t('Settings')}</h1></div></div>
  <section class="sec"><h2 style="font-size:18px">${t('Defaults and goal')}</h2><div class="panel"><form id="set-form" class="form-grid" novalidate>
    <div class="field"><label for="s-acct">${t('Default account')}</label><select id="s-acct">${E.ACCOUNTS.map(a => `<option value="${a}" ${a === st.account ? 'selected' : ''}>${esc(acct(a))}</option>`).join('')}</select></div>
    <div class="field"><label for="s-drip">${t('Default dividends')}</label><select id="s-drip">${Object.entries(DRIP()).map(([k, l]) => `<option value="${k}" ${k === st.drip ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="s-goal">${t('Monthly income goal ($)')}</label><input id="s-goal" type="number" min="0" step="50" value="${esc(st.goal || '')}"></div>
    <div class="tools"><button class="btn primary" type="submit">${t('Save')}</button></div>
  </form></div></section>
  <section class="sec"><h2 style="font-size:18px">${t('Your data')}</h2><div class="panel stack">
    <p style="margin:0">${S.demo ? t('You are in the demo. Nothing is saved.') : S.auth.mode === 'cloud' ? t('Signed in as {e}. Your portfolio is saved to your account.', { e: `<b>${esc(S.user.email)}</b>` }) : t('Signed in as {e}. Your portfolio is saved in this browser only, so back it up if you switch devices.', { e: `<b>${esc(S.user.email)}</b>` })}</p>
    <div class="tools"><button class="btn" data-act="export">${t('Download a backup')}</button><label class="btn" for="imp-file">${t('Restore a backup')}</label><input id="imp-file" type="file" accept="application/json,.json" hidden></div>
    ${!S.demo ? `<div id="acct-del" class="tools"><button class="btn danger" data-act="ask-del-acct">${t('Delete my account and data')}</button></div>` : ''}
  </div></section>
  <section class="sec"><h2 style="font-size:18px">${t('Install the app')}</h2><div class="panel stack">
    ${standalone() ? `<p style="margin:0">${t('You are using the installed app.')}</p>` : `<p style="margin:0">${t('Put Yield Ledger on your home screen. It opens full screen like any other app, and your last data stays available offline.')}</p>
    ${installEvt ? `<div class="tools"><button class="btn primary" data-act="install">${t('Install Yield Ledger')}</button></div>` : `<ul class="steps"><li>${t('iPhone or iPad: open this page in Safari, tap Share, then Add to Home Screen.')}</li><li>${t('Android: open this page in Chrome, tap the ⋮ menu, then Install app or Add to Home screen.')}</li><li>${t('Computer: in Chrome or Edge, click the install icon at the right end of the address bar.')}</li></ul>`}`}
  </div></section>
  ${CFG.donateUrl ? `<section class="sec"><h2 style="font-size:18px">${t('Support Yield Ledger')}</h2><div class="panel stack"><p style="margin:0">${t('Yield Ledger is free and built by one person. If it helps you, a tip of any amount keeps the data flowing and new features coming.')}</p><div class="tools"><a class="btn primary" href="${esc(CFG.donateUrl)}" target="_blank" rel="noopener">${t('Leave a tip')}</a><span class="muted" style="font-size:13px">${t('Secure payment through Stripe. Tips are not tax-deductible.')}</span></div></div></section>` : ''}
  <section class="sec"><h2 style="font-size:18px">${t('Market data')}</h2><div class="panel">
    <p style="margin:0">${m ? t('Last update {d}. {n} securities tracked.', { d: esc(new Date(m.updated).toLocaleString(loc(), { dateStyle: 'full', timeStyle: 'short' })), n: m.count }) + (m.failed?.length ? ' ' + t('Could not refresh: {s}.', { s: esc(m.failed.join(', ')) }) : '') : t('No market data yet.')}</p>
    <p class="muted" style="margin:8px 0 0;font-size:13px">${t('Prices, dividends and fundamentals refresh automatically after each trading day’s close.')}</p></div></section>
  ${dataFoot()}`);
  $('#set-form').addEventListener('submit', ev => {
    ev.preventDefault();
    Object.assign(st, { account: $('#s-acct').value, drip: $('#s-drip').value, goal: Math.max(0, +$('#s-goal').value || 0) });
    persist(); toast(t('Settings saved'));
  });
  $('#imp-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.positions)) throw new Error(t('This file is not a Yield Ledger backup.'));
      S.pf = { ...emptyPf(), ...d, settings: { ...emptyPf().settings, ...(d.settings || {}) } };
      await changed('#/'); toast(t('Restored {n} holdings', { n: S.pf.positions.length }));
    } catch (er) { toast(er.message); }
  });
}

/* ------------------------------------------------------------ global clicks */
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act],[data-href],[data-prefill],[data-lang]');
  if (!a) return;
  if (a.dataset.lang) { setLang(a.dataset.lang); buildFormats(); if (S.pf) { S.pf.settings.lang = a.dataset.lang; persist(); } return route(); }
  if (a.dataset.prefill) { prefill = a.dataset.prefill; return; }
  if (a.dataset.href && !e.target.closest('a,button')) { location.hash = a.dataset.href; return; }
  const act = a.dataset.act;
  if (act === 'demo') return startDemo();
  if (act === 'exit-demo') { S.demo = false; S.pf = null; S.sims = []; location.hash = '#/login'; return route(); }
  if (act === 'sign-out') { await saving; await S.auth.signOut(); return; }
  if (act === 'del-lot') {
    const pos = S.pf.positions.find(p => p.lots.some(l => l.id === a.dataset.id));
    pos.lots = pos.lots.filter(l => l.id !== a.dataset.id);
    if (!pos.lots.length) { S.pf.positions = S.pf.positions.filter(p => p !== pos); toast(t('Holding removed')); return changed('#/'); }
    toast(t('Removed')); return changed();
  }
  if (act === 'ask-del-pos') {
    const id = decodeURIComponent(S.lastRoute.split('/')[2] || '');
    $('#pos-del').innerHTML = `<span class="err">${t('Delete this holding and its history?')}</span><button class="btn ghost" data-act="keep">${t('Keep it')}</button><button class="btn danger solid" data-act="del-pos" data-id="${esc(id)}">${t('Delete')}</button>`;
    return;
  }
  if (act === 'keep') return route();
  if (act === 'del-pos') { S.pf.positions = S.pf.positions.filter(p => p.id !== a.dataset.id); toast(t('Holding deleted')); return changed('#/'); }
  if (act === 'bill-preset') { S.pf.bills.push({ id: rid('b'), name: a.dataset.n, amount: +a.dataset.a }); persist(); return viewBills(); }
  if (act === 'bill-del') { S.pf.bills.splice(+a.dataset.i, 1); persist(); return viewBills(); }
  if (act === 'bill-up') { const i = +a.dataset.i, b = S.pf.bills; [b[i - 1], b[i]] = [b[i], b[i - 1]]; persist(); return viewBills(); }
  if (act === 'export') {
    const blob = new Blob([JSON.stringify(S.pf, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `yield-ledger-${E.today()}.json`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000); return;
  }
  if (act === 'ask-del-acct') {
    $('#acct-del').innerHTML = `<span class="err">${t('This permanently deletes your account and portfolio.')}</span><button class="btn ghost" data-act="keep">${t('Cancel')}</button><button class="btn danger solid" data-act="del-acct">${t('Delete everything')}</button>`;
    return;
  }
  if (act === 'feedback') return openFeedback();
  if (act === 'install' && installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; installEvt = null; if (r.outcome === 'accepted') toast(t('Installed. Look for Yield Ledger on your home screen.')); return route(); }
  if (act === 'del-acct') { await S.auth.deleteAccount(); toast(t('Account deleted')); return; }
});

/* ------------------------------------------------------------ feedback */
const REPO = 'https://github.com/yieldledger/yieldledger.github.io';
function feedbackButton() {
  if ($('#fb-open')) return;
  const b = document.createElement('button');
  b.id = 'fb-open'; b.className = 'fb-open'; b.type = 'button'; b.dataset.act = 'feedback';
  document.body.appendChild(b);
  b.textContent = t('Feedback');
}
function openFeedback() {
  $('#fb-dlg')?.remove();
  const kinds = [['confusing', t('Something is confusing')], ['wrong', t('A number looks wrong')], ['idea', t('An idea')], ['other', t('Something else')]];
  const d = document.createElement('dialog');
  d.id = 'fb-dlg'; d.className = 'fb-dlg';
  d.innerHTML = `<form method="dialog" id="fb-form" novalidate>
    <div class="fb-top"><h2>${t('Send feedback')}</h2><button class="x" type="button" data-fb="close" aria-label="${esc(t('Close this window'))}">×</button></div>
    <p class="muted" style="margin:0;font-size:13.5px">${t('Tell us what confused you, what looks wrong or what you wish it did. The page you are on is attached automatically.')}</p>
    <div class="chips fb-kinds" role="radiogroup">${kinds.map(([k, l], i) => `<label class="chip-btn ${i === 0 ? 'on' : ''}"><input type="radio" name="fb-kind" value="${k}" ${i === 0 ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    <div class="field"><label for="fb-msg">${t('Your feedback')}</label><textarea id="fb-msg" rows="5" required maxlength="4000"></textarea></div>
    <div class="field"><label for="fb-email">${t('Email, if you want a reply (optional)')}</label><input id="fb-email" type="email" autocomplete="email"></div>
    <p class="err" id="fb-err" hidden></p>
    <div class="tools"><button class="btn primary" type="submit" id="fb-send">${CFG.feedbackKey ? t('Send') : t('Continue on GitHub')}</button>${CFG.feedbackKey ? '' : `<span class="muted" style="font-size:12.5px">${t('Opens a pre-filled GitHub issue. A free GitHub account is needed.')}</span>`}</div>
  </form>`;
  document.body.appendChild(d);
  d.showModal();
  $$('input[name=fb-kind]', d).forEach(r => r.addEventListener('change', () => $$('.fb-kinds label', d).forEach(l => l.classList.toggle('on', l.querySelector('input').checked))));
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-fb=close]')) d.close(); });
  d.addEventListener('close', () => d.remove());
  $('#fb-form', d).addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = $('#fb-msg', d).value.trim(), email = $('#fb-email', d).value.trim(), kind = $('input[name=fb-kind]:checked', d).value, err = $('#fb-err', d);
    if (msg.length < 3) { err.textContent = t('Write a few words first.'); err.hidden = false; return; }
    const ctx = `Page: ${location.hash || '#/'} · ${S.demo ? 'demo' : 'signed in'} · ${getLang()} · ${window.innerWidth}×${window.innerHeight} · ${standalone() ? 'installed app' : 'browser'} · data ${S.meta?.updated || '?'}`;
    if (!CFG.feedbackKey) {
      const url = `${REPO}/issues/new?title=${encodeURIComponent(`[${kind}] ${msg.slice(0, 60)}`)}&body=${encodeURIComponent(`${msg}\n\n---\n${ctx}`)}&labels=feedback`;
      window.open(url, '_blank', 'noopener'); d.close(); return;
    }
    $('#fb-send', d).disabled = true;
    try {
      const r = await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ access_key: CFG.feedbackKey, subject: `Yield Ledger feedback: ${kind}`, from_name: 'Yield Ledger', email: email || undefined, kind, message: msg, context: ctx, botcheck: '' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.message || r.statusText);
      d.close(); toast(t('Thank you. Your feedback was sent.'));
    } catch (e) { err.textContent = t('Could not send it: {e}. Please try again in a moment.', { e: e.message }); err.hidden = false; $('#fb-send', d).disabled = false; }
  });
}

/* ------------------------------------------------------------ installable app */
let installEvt = null;
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (location.hash === '#/settings') route(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

boot().catch(e => { console.error(e); $('#app').innerHTML = `<div class="loading">${t('Yield Ledger could not start: {e}. Reload the page to try again.', { e: esc(e.message) })}</div>`; });
