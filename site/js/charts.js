// Small SVG charts with hover read-outs. Colours come from CSS classes, so both themes work.
const NS = 'http://www.w3.org/2000/svg';
const observers = new WeakMap();

function niceTicks(min, max, n = 4) {
  if (!(max > min)) { max = min + 1; }
  const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}
export const shortMoney = v => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return s + '$' + (a >= 100 ? a.toFixed(0) : a.toFixed(a >= 10 ? 0 : 2).replace(/\.00$/, ''));
};

function mount(el, draw) {
  el.classList.add('chart');
  const run = () => { const w = el.clientWidth; if (w > 0) draw(w); };
  run();
  if (!observers.has(el)) {
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - last) > 4) { last = el.clientWidth; el._draw && el._draw(); } });
    ro.observe(el); observers.set(el, ro);
  }
  el._draw = run;
}
function tipBox(el) {
  let t = el.querySelector('.tip');
  if (!t) { t = document.createElement('div'); t.className = 'tip'; t.hidden = true; el.appendChild(t); }
  return t;
}
function place(el, tip, x, y, w) {
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + 'px';
  tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
}

/** Line/area chart. opts: { x: labels[], series: [{ name, v: [], cls, area }], fmtY, fmtX, height, tip(i) } */
export function lineChart(el, opts) {
  mount(el, W => {
    const H = opts.height || (W < 520 ? 210 : 260);
    const pl = W < 520 ? 46 : 56, pr = 10, pt = 14, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    const all = opts.series.flatMap(s => s.v).filter(Number.isFinite);
    const min = Math.min(0, ...all), max = Math.max(...all, opts.floor ?? 1);
    const ticks = niceTicks(min, max * 1.04);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const n = opts.x.length;
    const X = i => pl + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw), Y = v => pt + ih - ((v - y0) / (y1 - y0)) * ih;
    const fmtY = opts.fmtY || shortMoney;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${opts.label || 'Chart'}">`;
    for (const t of ticks) s += `<line class="g" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${pl - 8}" y="${Y(t) + 4}" text-anchor="end">${fmtY(t)}</text>`;
    const every = Math.max(1, Math.ceil(n / (W < 520 ? 4 : 7)));
    for (let i = 0; i < n; i += every) s += `<text class="ax" x="${X(i)}" y="${H - 7}" text-anchor="middle">${(opts.fmtX || (x => x))(opts.x[i])}</text>`;
    for (const se of opts.series) {
      const pts = se.v.map((v, i) => Number.isFinite(v) ? `${X(i).toFixed(1)},${Y(v).toFixed(1)}` : null).filter(Boolean);
      if (!pts.length) continue;
      if (se.area) s += `<path class="area ${se.cls}" d="M${pts[0].split(',')[0]},${Y(Math.max(0, y0))} L${pts.join(' L')} L${pts[pts.length - 1].split(',')[0]},${Y(Math.max(0, y0))} Z"/>`;
      s += `<polyline class="ln ${se.cls}" points="${pts.join(' ')}"/>`;
      const li = se.v.length - 1;
      if (Number.isFinite(se.v[li])) s += `<circle class="dot ${se.cls}" cx="${X(li)}" cy="${Y(se.v[li])}" r="3.5"/>`;
    }
    for (const m of opts.marks || []) { const v = opts.series[0].v[m]; if (Number.isFinite(v)) s += `<circle class="mk" cx="${X(m).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.3"/>`; }
    s += `<line class="cross" x1="0" x2="0" y1="${pt}" y2="${pt + ih}" visibility="hidden"/><rect class="hit" x="${pl}" y="${pt}" width="${iw}" height="${ih}"/></svg>`;
    el.innerHTML = s;
    const svg = el.querySelector('svg'), cross = svg.querySelector('.cross'), tip = tipBox(el);
    const move = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pl) / iw) * (n - 1))));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = opts.tip ? opts.tip(i) : `<b>${opts.x[i]}</b>` + opts.series.map(se => `<div><i class="sw ${se.cls}"></i>${se.name}: ${fmtY(se.v[i])}</div>`).join('');
      place(el, tip, X(i), pt + 10, W);
    };
    const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('mousemove', move); svg.addEventListener('touchmove', move, { passive: true });
    svg.addEventListener('mouseleave', leave); svg.addEventListener('touchend', leave);
  });
}

/** Bar chart. opts: { x: labels[], v: [], cls: [] per bar, fmtY, fmtX, height, tip(i), mark: index to label } */
export function barChart(el, opts) {
  mount(el, W => {
    const H = opts.height || (W < 520 ? 200 : 240);
    const pl = W < 520 ? 44 : 54, pr = 6, pt = 18, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    const vals = opts.v.map(v => (Number.isFinite(v) ? v : 0));
    const ticks = niceTicks(0, Math.max(...vals, 1e-9) * 1.06);
    const top = ticks[ticks.length - 1];
    const n = vals.length, slot = iw / Math.max(n, 1), bw = Math.max(2, Math.min(38, slot * 0.68));
    const Y = v => pt + ih - (v / top) * ih;
    const fmtY = opts.fmtY || shortMoney;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${opts.label || 'Bar chart'}">`;
    for (const t of ticks) s += `<line class="g" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${pl - 8}" y="${Y(t) + 4}" text-anchor="end">${fmtY(t)}</text>`;
    const every = Math.max(1, Math.ceil(n / (W < 520 ? 6 : 12)));
    vals.forEach((v, i) => {
      const x = pl + slot * i + (slot - bw) / 2, h = v > 0 ? Math.max(1.5, (v / top) * ih) : 0;
      s += `<rect class="bar ${(opts.cls && opts.cls[i]) || ''}" data-i="${i}" x="${x.toFixed(1)}" y="${(pt + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
      if (i % every === 0) s += `<text class="ax" x="${(pl + slot * i + slot / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${(opts.fmtX || (x => x))(opts.x[i])}</text>`;
    });
    if (opts.mark != null && vals[opts.mark] > 0) s += `<text class="vl" x="${(pl + slot * opts.mark + slot / 2).toFixed(1)}" y="${(Y(vals[opts.mark]) - 5).toFixed(1)}" text-anchor="middle">${fmtY(vals[opts.mark])}</text>`;
    s += `<rect class="hit" x="${pl}" y="${pt}" width="${iw}" height="${ih}"/></svg>`;
    el.innerHTML = s;
    const svg = el.querySelector('svg'), tip = tipBox(el);
    let hi = null;
    const move = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.floor((px - pl) / slot)));
      hi && hi.classList.remove('hl'); hi = svg.querySelector(`.bar[data-i="${i}"]`); hi && hi.classList.add('hl');
      tip.innerHTML = opts.tip ? opts.tip(i) : `<b>${opts.x[i]}</b><div>${fmtY(vals[i])}</div>`;
      place(el, tip, pl + slot * i + slot / 2, Y(vals[i]), W);
    };
    const leave = () => { tip.hidden = true; hi && hi.classList.remove('hl'); };
    svg.addEventListener('mousemove', move); svg.addEventListener('touchmove', move, { passive: true });
    svg.addEventListener('mouseleave', leave); svg.addEventListener('touchend', leave);
  });
}

/** Tiny 1-year sparkline from the 26-character code in the research index ("A" = low, "_" = high). */
const SPARK = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function sparkline(code, w = 72, h = 26) {
  if (!code) return '';
  const v = [...code].map(c => SPARK.indexOf(c)), n = v.length;
  const pts = v.map((x, i) => `${((i / (n - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - (x / 63) * (h - 6)).toFixed(1)}`).join(' ');
  const up = v[n - 1] >= v[0];
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
