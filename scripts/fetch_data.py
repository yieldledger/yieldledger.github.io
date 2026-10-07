#!/usr/bin/env python3
"""Yield Ledger daily data job.

For every symbol in tickers.txt this pulls daily closes, the full dividend and
split history and the available fundamentals, computes a research scorecard,
and writes:

  site/data/q/<SYMBOL>.json   one file per security
  site/data/fx/USDCAD.json    CAD per USD, daily
  site/data/index.json        screener rows for every security
  site/data/meta.json         run time and counts

Prices are split-adjusted but NOT dividend-adjusted, so the site can replay
dividends and DRIP purchases at the real price on each date.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import pathlib
import re
import sys
import time

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "data"
START = "2005-01-01"
TODAY = pd.Timestamp(dt.date.today())


# ---------------------------------------------------------------- helpers
def safe_name(sym: str) -> str:
    return re.sub(r"[^A-Za-z0-9.\-]", "_", sym)


def listing(sym: str) -> str:
    return "CA" if re.search(r"\.(TO|NE|V|CN)$", sym) else "US"


def display(sym: str) -> str:
    return re.sub(r"\.(TO|NE|V|CN)$", "", sym)


def num(x, nd=4):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, nd)


def read_universe() -> list[str]:
    syms: list[str] = []
    for line in (ROOT / "tickers.txt").read_text().splitlines():
        s = line.split("#")[0].strip()
        if s and s not in syms:
            syms.append(s)
    return syms


def clean_index(h: pd.DataFrame) -> pd.DataFrame:
    idx = pd.DatetimeIndex(h.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    h = h.copy()
    h.index = idx.normalize()
    h = h[~h.index.duplicated(keep="last")].sort_index()
    return h


def cagr(a, b, years):
    if a is None or b is None or years <= 0 or a <= 0 or b <= 0:
        return None
    return (b / a) ** (1 / years) - 1


def value_at(s: pd.Series, when: pd.Timestamp):
    s2 = s[s.index <= when]
    return float(s2.iloc[-1]) if len(s2) else None


def clamp(x, lo, hi):
    return max(lo, min(hi, x))



# ---------------------------------------------------------------- Canadian tax profile and themes
# wh: how US/foreign withholding hits this security
#   US      US-listed: 15% in TFSA/FHSA/RESP, none in RRSP, recoverable in non-registered
#   CA-US   Canadian-listed fund holding US stocks (or US-listed ETFs): 15% taken inside the fund in every account
#   CA-INTL Canadian-listed fund holding international stocks: foreign withholding taken inside the fund
#   CA-MIX  Canadian all-in-one / global mix: partly foreign withholding inside the fund
#   CDR     Canadian Depositary Receipt: 15% in every account, RRSP included
#   CA      Canadian stocks and Canadian-only funds: none
# proxy: a US-listed fund tracking the same index, used for holdings look-through and for the RRSP swap
META = {
    "VFV.TO": {"wh": "CA-US", "proxy": "VOO"}, "ZSP.TO": {"wh": "CA-US", "proxy": "SPY"}, "XUS.TO": {"wh": "CA-US", "proxy": "SPY"},
    "XSP.TO": {"wh": "CA-US", "proxy": "SPY", "hedged": True}, "HXS.TO": {"wh": "CA-US", "proxy": "SPY", "swap": True},
    "VUN.TO": {"wh": "CA-US", "proxy": "VTI"}, "XUU.TO": {"wh": "CA-US", "proxy": "VTI"},
    "ZQQ.TO": {"wh": "CA-US", "proxy": "QQQ", "hedged": True}, "XQQ.TO": {"wh": "CA-US", "proxy": "QQQ", "hedged": True},
    "QQC.TO": {"wh": "CA-US", "proxy": "QQQ"}, "HXQ.TO": {"wh": "CA-US", "proxy": "QQQ", "swap": True},
    "VGG.TO": {"wh": "CA-US", "proxy": "VIG"}, "ZDY.TO": {"wh": "CA-US"}, "XDU.TO": {"wh": "CA-US"},
    "ZWS.TO": {"wh": "CA-US"}, "ZWA.TO": {"wh": "CA-US"}, "ZWH.TO": {"wh": "CA-US"}, "ZWT.TO": {"wh": "CA-US"},
    "QQCL.TO": {"wh": "CA-US", "proxy": "QQQ"}, "USCL.TO": {"wh": "CA-US", "proxy": "SPY"},
    "QMAX.TO": {"wh": "CA-US"}, "SMAX.TO": {"wh": "CA-US"}, "HYLD.TO": {"wh": "CA-MIX"}, "ZPAY.TO": {"wh": "CA-US"},
    "TEC.TO": {"wh": "CA-US"}, "ZUQ.TO": {"wh": "CA-US"},
    "XEF.TO": {"wh": "CA-INTL"}, "ZDI.TO": {"wh": "CA-INTL"}, "XEC.TO": {"wh": "CA-INTL"}, "ZWE.TO": {"wh": "CA-INTL"},
    "XAW.TO": {"wh": "CA-MIX"}, "VXC.TO": {"wh": "CA-MIX"}, "XEQT.TO": {"wh": "CA-MIX"}, "VEQT.TO": {"wh": "CA-MIX"},
    "VGRO.TO": {"wh": "CA-MIX"}, "VBAL.TO": {"wh": "CA-MIX"}, "HUTL.TO": {"wh": "CA-MIX"}, "ZBK.TO": {"wh": "CA-US"},
    "UMAX.TO": {"wh": "CA-MIX"}, "HPYT.TO": {"wh": "CA-US"},
}
THEME_RULES = [
    ("utilities", r"utilit|infrastructure"),
    ("banks", r"\bbank|financial|lifeco|insur"),
    ("reit", r"\breit|real estate|propert"),
    ("energy", r"energy|oil|gas\b|pipeline|midstream|petrol"),
    ("telecom", r"telecom|communication"),
    ("covered-call", r"covered call|yield maximizer|premium income|option income|enhanced yield|\bincome etf\b|buywrite|yield shares"),
    ("nasdaq", r"nasdaq|technology|\btech\b|innovation"),
    ("sp500", r"s&p 500|s&p500"),
    ("dividend", r"dividend|yield|income|aristocrat"),
    ("all-in-one", r"all-equity|all equity|growth etf portfolio|balanced etf|asset allocation|equity etf portfolio"),
    ("bonds", r"\bbond|aggregate|fixed income|treasur"),
    ("cash", r"\bcash\b|savings|money market|high interest"),
    ("international", r"international|eafe|emerging|developed|world ex"),
    ("healthcare", r"health|pharma"),
    ("gold", r"\bgold\b|precious metal|\bminers?\b"),
    ("leveraged", r"bull plus|bear plus|daily bull|daily bear|\b-?[123](\.\d+)?x\b|inverse|leveraged|ultra"),
    ("crypto", r"bitcoin|ether(eum)?\b|crypto|solana|\bxrp\b|blockchain"),
]
SECTOR_TAG = {"Utilities": "utilities", "Financial Services": "banks", "Real Estate": "reit", "Energy": "energy",
              "Communication Services": "telecom", "Technology": "nasdaq", "Healthcare": "healthcare"}


def classify(sym: str, name: str, info: dict, kind: str, freq: int, cdr_hint: bool = False) -> dict:
    m = META.get(sym, {})
    text = " ".join(str(x or "") for x in (name, info.get("category"), info.get("longBusinessSummary", "")[:300] if kind == "ETF" else "")).lower()
    tags = set(m.get("tags", []))
    for tag, rx in THEME_RULES:
        if re.search(rx, text if kind == "ETF" else str(name).lower()):
            tags.add(tag)
    if kind == "Stock" and info.get("sector") in SECTOR_TAG:
        tags.add(SECTOR_TAG[info["sector"]])
    if sym.endswith("-UN.TO") and re.search(r"reit|real estate|propert", text + str(name).lower()):
        tags.add("reit")
    if freq >= 12:
        tags.add("monthly")
    ex = listing(sym)
    is_cdr = sym.endswith(".NE") and (cdr_hint or "cdr" in text or "depositary" in text)
    wh = m.get("wh") or ("CDR" if is_cdr else "US" if ex == "US" else None)
    cat = str(info.get("category") or "").lower()
    if not wh and kind == "ETF" and cat:
        if re.match(r"(us|u\.s\.) ", cat) or "us equity" in cat:
            wh = "CA-US"
        elif re.search(r"international|emerging|global|world|foreign", cat):
            wh = "CA-INTL" if "global" not in cat else "CA-MIX"
    if not wh:
        if kind == "ETF" and re.search(r"s&p 500|u\.s\.|\bus\b|nasdaq|american|dow jones", text):
            wh = "CA-US"
        elif kind == "ETF" and re.search(r"international|eafe|emerging|global|world", text):
            wh = "CA-INTL" if not re.search(r"canad", text) else "CA-MIX"
        else:
            wh = "CA"
    if wh in ("US", "CA-US", "CDR") or "sp500" in tags:
        tags.add("us")
    if is_cdr:
        tags.add("cdr")
    return {"wh": wh, "tags": sorted(tags), "proxy": m.get("proxy"), "hedged": m.get("hedged", False), "swap": m.get("swap", False)}


# ---------------------------------------------------------------- research scorecard
def compute_stats(close: pd.Series, divs: pd.Series, info: dict) -> dict:
    """close: daily split-adjusted closes. divs: per-share dividends indexed by ex-date."""
    close = close.dropna()
    divs = divs[divs > 0]
    last = close.index[-1]
    first = close.index[0]
    px = float(close.iloc[-1])
    hist_years = (last - first).days / 365.25

    def ttm_at(when):
        return float(divs[(divs.index > when - pd.Timedelta(days=365)) & (divs.index <= when)].sum())

    ttm = ttm_at(last)
    n12 = int(((divs.index > last - pd.Timedelta(days=365)) & (divs.index <= last)).sum())
    freq = 52 if n12 >= 40 else 12 if n12 >= 10 else 4 if n12 >= 3 else n12
    # Yahoo sometimes drops a monthly payment. A monthly payer with 10 or 11 payments in the last year
    # that also paid monthly the year before is missing data, not cutting: scale the year up to 12.
    n_prev = int(((divs.index > last - pd.Timedelta(days=730)) & (divs.index <= last - pd.Timedelta(days=365))).sum())
    if freq == 12 and 10 <= n12 < 12 and n_prev >= 12 and ttm > 0:
        ttm = ttm * 12 / n12

    recent = divs[divs.index > last - pd.Timedelta(days=400)]
    last_div = float(divs.iloc[-1]) if len(divs) else 0.0
    fwd_dps = last_div * freq if freq >= 4 else ttm
    # If the last payment looks like a one-off special, fall back to the TTM figure.
    if freq >= 4 and len(recent) >= 3 and last_div > 1.8 * float(recent.iloc[:-1].median()):
        fwd_dps = ttm

    st: dict = {
        "freq": freq,
        "ttm": num(ttm),
        "fwd": num(fwd_dps),
        "yld": num(ttm / px) if px else None,
        "fyld": num(fwd_dps / px) if px else None,
        "lastDiv": num(last_div),
        "lastEx": divs.index[-1].strftime("%Y-%m-%d") if len(divs) else None,
        "hist": round(hist_years, 1),
    }

    # Dividend growth on trailing-twelve-month totals
    for n in (1, 3, 5, 10):
        if hist_years >= n + 1:
            st[f"g{n}"] = num(cagr(ttm_at(last - pd.DateOffset(years=n)), ttm, n))

    # Calendar-year totals for cut and streak detection
    annual = divs.groupby(divs.index.year).sum()
    full_years = list(range(first.year + 1, last.year))
    A = {y: float(annual.get(y, 0.0)) for y in full_years}
    cuts, streak = 0, 0
    for y in full_years[-10:]:
        prev = A.get(y - 1, 0.0)
        if prev > 0 and A[y] < prev * 0.95:
            cuts += 1
    for y in reversed(full_years):
        prev = A.get(y - 1, 0.0)
        if prev > 0 and A[y] >= prev * 1.001:
            streak += 1
        else:
            break
    st["cuts10"] = cuts
    st["streak"] = streak
    st["annual"] = [[int(y), num(v)] for y, v in annual.items() if y >= last.year - 15]

    # Total-return index: dividends reinvested at the ex-date close
    d = divs.groupby(divs.index).sum().reindex(close.index, fill_value=0.0)
    tr = close * (1 + d / close).cumprod()
    for n in (1, 3, 5, 10):
        if hist_years >= n:
            then = last - pd.DateOffset(years=n)
            st[f"tr{n}"] = num(cagr(value_at(tr, then), float(tr.iloc[-1]), n))
            st[f"p{n}"] = num(cagr(value_at(close, then), px, n))

    win = tr[tr.index > last - pd.DateOffset(years=5)]
    if len(win) > 60:
        m = win.resample("ME").last().pct_change().dropna()
        if len(m) >= 12:
            st["vol"] = num(float(m.std() * math.sqrt(12)))
        st["mdd"] = num(float(-(win / win.cummax() - 1).min()))

    # Yield versus its own 5-year average (a simple valuation signal)
    ttm_roll = d.rolling("365D").sum()
    ys = (ttm_roll / close)[close.index > max(first + pd.Timedelta(days=370), last - pd.DateOffset(years=5))]
    ys = ys[ys > 0]
    if len(ys) > 120:
        avg = float(ys.resample("ME").last().mean())
        st["yAvg5"] = num(avg)
        if avg > 0 and st["yld"]:
            st["yVsAvg"] = num(st["yld"] / avg - 1)
        ym = ys.resample("ME").last().dropna()
        if len(ym) >= 12 and st.get("yld"):
            st["yPct5"] = num(float((ym < st["yld"]).mean()))  # share of the last 5 years with a lower yield
    ys10 = (ttm_roll / close)[close.index > max(first + pd.Timedelta(days=370), last - pd.DateOffset(years=10))]
    ys10 = ys10[ys10 > 0]
    if len(ys10) > 120:
        ym10 = ys10.resample("ME").last().dropna()
        if hist_years >= 7:
            st["yAvg10"] = num(float(ym10.mean()))
        st["yHist"] = [[x.strftime("%Y-%m"), num(float(v))] for x, v in ym10.items()]

    # Where the price sits in its 52-week and 5-year range (0 = at the low, 1 = at the high)
    for key, yrs in (("r52", 1), ("r5", 5)):
        w = close[close.index > last - pd.DateOffset(years=yrs)]
        if len(w) > 40 and float(w.max()) > float(w.min()):
            st[key] = num((px - float(w.min())) / (float(w.max()) - float(w.min())))
            st[key + "lo"], st[key + "hi"] = num(float(w.min())), num(float(w.max()))

    # Distribution stability: coefficient of variation of the last 2 years of payments
    k = max(8, min(24, 2 * (freq or 4)))
    lastk = divs.iloc[-k:]
    if len(lastk) >= 6 and lastk.mean() > 0:
        st["cv"] = num(float(lastk.std() / lastk.mean()))

    # Latest payment versus the run-rate before it
    if len(divs) >= 4 and freq >= 4:
        prior = float(divs.iloc[-4:-1].median())
        if prior > 0:
            st["lastChg"] = num(last_div / prior - 1)

    # NAV erosion: high yield funded partly by a falling price
    pg = st.get("p5", st.get("p3"))
    st["erosion"] = bool(st["yld"] and st["yld"] > 0.06 and pg is not None and pg < -0.01)

    # ---- Quality score, 0-100, every part shown on the site
    g = st.get("g5", st.get("g3"))
    t = st.get("tr5", st.get("tr3"))
    dd = st.get("mdd")
    parts = {
        "growth": round(clamp(((g if g is not None else 0) + 0.02) / 0.10, 0, 1) * 25, 1),
        "reliability": round(max(0, 20 - cuts * 7) + min(streak, 10) / 10 * 5, 1),
        "return": round(clamp((t if t is not None else 0) / 0.12, 0, 1) * 25, 1),
        "risk": round(clamp(1 - ((dd if dd is not None else 0.35) - 0.15) / 0.35, 0, 1) * 15, 1),
        "sustain": round(max(0, 10 - (10 if st["erosion"] else 0) - (4 if (st["yld"] or 0) > 0.10 else 0)), 1),
    }
    if not len(divs):
        parts["growth"] = 0
        parts["reliability"] = 0
        parts["sustain"] = 0
    st["parts"] = parts
    st["score"] = round(sum(parts.values()))
    st["limited"] = hist_years < 5
    return st


def fundamentals(info: dict) -> dict:
    f = {
        "pe": num(info.get("trailingPE"), 2),
        "fpe": num(info.get("forwardPE"), 2),
        "payout": num(info.get("payoutRatio")),
        "beta": num(info.get("beta") or info.get("beta3Year"), 2),
        "mcap": num(info.get("marketCap"), 0),
        "aum": num(info.get("totalAssets"), 0),
        "mer": num(info.get("netExpenseRatio"), 3),  # Yahoo reports this in percent, e.g. 0.22
        "sector": info.get("sector") or None,
        "industry": info.get("industry") or None,
        "category": info.get("category") or None,
        "family": info.get("fundFamily") or None,
        "hi52": num(info.get("fiftyTwoWeekHigh")),
        "lo52": num(info.get("fiftyTwoWeekLow")),
        "eps": num(info.get("trailingEps")),
        "de": num(info.get("debtToEquity"), 1),
        "roe": num(info.get("returnOnEquity")),
        "fcf": num(info.get("freeCashflow"), 0),
        "rev_g": num(info.get("revenueGrowth")),
        "earn_g": num(info.get("earningsGrowth")),
    }
    return {k: v for k, v in f.items() if v is not None}


# ---------------------------------------------------------------- universe discovery
UNIVERSE = OUT / "universe.json"
from collections import defaultdict
DIAG = defaultdict(int)
PROFILE_VERSION = 2  # bump to force every profile to refresh
HOLD = {"refused": 0, "off": False}
THROTTLED = {"on": False}


def _screen_all(query, max_rows=4000, sort="ticker", asc=True, size=250):
    import yfinance as yf
    out, offset = [], 0
    while offset < max_rows:
        for attempt in range(3):
            try:
                res = yf.screen(query, offset=offset, size=min(size, max_rows - offset), sortField=sort, sortAsc=asc)
                break
            except Exception as e:  # throttling: back off and retry
                if attempt == 2:
                    print(f"  screener failed at offset {offset}: {e}", file=sys.stderr)
                    return out
                time.sleep(5 * (attempt + 1))
        quotes = (res or {}).get("quotes", [])
        out.extend(quotes)
        if len(quotes) < size:
            break
        offset += size
        time.sleep(1)
    return out


def discover() -> dict:
    """Ask Yahoo's screener for every Canadian ETF, every CDR, Canadian dividend stocks,
    the largest US ETFs and long-running US dividend growers."""
    from yfinance import ETFQuery, EquityQuery
    found = {}

    def keep(q, src):
        sym = q.get("symbol")
        if not sym:
            return
        found.setdefault(sym, {"src": src, "name": q.get("longName") or q.get("shortName"), "qt": q.get("quoteType"), "cur": q.get("currency")})

    ca_etf = _screen_all(ETFQuery("eq", ["region", "ca"]))
    for q in ca_etf:
        sym = q.get("symbol", "")
        if not re.search(r"\.(TO|NE|V)$", sym):
            continue
        if re.search(r"-U\.(TO|NE)$", sym) and sym != "DLR-U.TO":
            continue  # US-dollar units duplicate the CAD units
        keep(q, "ca-etf")
    print(f"discovered {sum(1 for v in found.values() if v['src'] == 'ca-etf')} Canadian ETFs")

    for q in _screen_all(EquityQuery("eq", ["exchange", "NEO"])):
        if re.search(r"\bCDR\b|depositary", str(q.get("longName") or q.get("shortName") or ""), re.I):
            keep(q, "cdr")  # plainly named CDRs come from tickers.txt
    print(f"discovered {sum(1 for v in found.values() if v['src'] == 'cdr')} CDRs")

    ca_div = EquityQuery("and", [EquityQuery("eq", ["region", "ca"]), EquityQuery("is-in", ["exchange", "TOR"]),
                                 EquityQuery("gt", ["forward_dividend_yield", 0]), EquityQuery("gt", ["intradaymarketcap", 3e8])])
    for q in _screen_all(ca_div, max_rows=600):
        keep(q, "ca-stock")
    print(f"discovered {sum(1 for v in found.values() if v['src'] == 'ca-stock')} Canadian dividend stocks")

    for q in _screen_all(ETFQuery("eq", ["region", "us"]), max_rows=300, sort="fundnetassets", asc=False):
        keep(q, "us-etf")
    us_div = EquityQuery("and", [EquityQuery("eq", ["region", "us"]), EquityQuery("gte", ["consecutive_years_of_dividend_growth_count", 10]),
                                 EquityQuery("gt", ["intradaymarketcap", 1e10])])
    for q in _screen_all(us_div, max_rows=400):
        keep(q, "us-stock")
    print(f"discovered {len(found)} securities in total")
    return found


def load_universe(force: bool) -> tuple[list[str], dict]:
    curated = read_universe()
    cache = {}
    if UNIVERSE.exists():
        try:
            cache = json.loads(UNIVERSE.read_text())
        except Exception:
            cache = {}
    age = (TODAY - pd.Timestamp(cache.get("updated", "2000-01-01"))).days
    meta = cache.get("syms", {})
    if force or age >= 7 or not meta:
        try:
            fresh = discover()
            if len(fresh) > 200:  # a thin answer means the screener misbehaved; keep the old list
                meta = fresh
                UNIVERSE.write_text(json.dumps({"updated": TODAY.strftime("%Y-%m-%d"), "syms": meta}, separators=(",", ":")))
        except Exception as e:
            print(f"discovery failed, keeping previous universe: {e}", file=sys.stderr)
    meta = {k: v for k, v in meta.items() if v.get("src") not in ("neo", "cdr-base")}
    for s in curated:
        meta.setdefault(s, {"src": "curated"})
    # Yahoo lists many TSX ETFs a second time under a Cboe Canada (.NE) symbol with no data: keep the TSX one
    for s in [s for s in meta if s.endswith(".NE") and s[:-3] + ".TO" in meta]:
        meta.pop(s, None)
    # Every CDR needs its US share, used to rebuild history when Yahoo has none for the CDR
    for s in [s for s, m in meta.items() if s.endswith(".NE") and m.get("src") in ("cdr", "curated") and re.fullmatch(r"[A-Z]{1,5}(\.[A-Z])?\.NE", s)]:
        meta.setdefault(cdr_base(s), {"src": "cdr-base"})
    return sorted(meta), meta


def cdr_base(sym: str) -> str:
    return sym[:-3].replace(".", "-")


def synth_cdr(sym: str, base_h: pd.DataFrame) -> pd.DataFrame | None:
    """A CDR tracks its US share at a fixed ratio, hedged to CAD. When Yahoo has a CDR quote but no history,
    rebuild the history from the US share scaled to today's CDR price."""
    import yfinance as yf
    try:
        last = float(yf.Ticker(sym).fast_info.get("lastPrice") or 0)
    except Exception:
        last = 0
    if not last or base_h is None or base_h.empty:
        return None
    k = last / float(base_h["Close"].dropna().iloc[-1])
    h = base_h[["Close"]].copy() * k
    h["Dividends"] = base_h.get("Dividends", 0) * k
    h["Stock Splits"] = base_h.get("Stock Splits", 0)
    return h


# ---------------------------------------------------------------- prices (batched)
def download_prices(syms: list[str], chunk: int = 60) -> dict[str, pd.DataFrame]:
    import yfinance as yf
    out = {}
    for i in range(0, len(syms), chunk):
        part = syms[i:i + chunk]
        for attempt in range(3):
            try:
                df = yf.download(part, start=START, auto_adjust=False, actions=True, group_by="ticker",
                                 threads=8, progress=False)
                break
            except Exception as e:
                if attempt == 2:
                    print(f"  price batch {i} failed: {e}", file=sys.stderr)
                    df = None
                time.sleep(60 if "Rate" in type(e).__name__ or "Too Many" in str(e) else 10 * (attempt + 1))
        if df is None or df.empty:
            continue
        for s in part:
            try:
                h = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                h = h.dropna(subset=["Close"])
                if len(h) > 5:
                    out[s] = clean_index(h)
            except KeyError:
                pass
        got = sum(1 for x in part if x in out)
        print(f"prices {min(i + chunk, len(syms))}/{len(syms)}: {len(out)} with data")
        if got == 0 and len(part) > 10:  # an empty batch usually means throttling: cool down before the next
            DIAG["empty_batches"] += 1
            time.sleep(45)
        time.sleep(2)
    # Second pass, one at a time: the bulk endpoint drops some exchanges (notably Cboe Canada .NE)
    missing = [s for s in syms if s not in out]
    variants = [("start2015", {"start": "2015-01-01"}), ("10y", {"period": "10y"}), ("5y", {"period": "5y"}), ("1y", {"period": "1y"})]
    winner = None  # once one variant works, try it first for the rest
    probe_fail = 0
    for n, s in enumerate(missing[:1200]):
        order = ([v for v in variants if v[0] == winner] + [v for v in variants if v[0] != winner]) if winner else variants
        got = False
        h = chart_history(s)
        if h is not None:
            out[s] = h
            DIAG["retry_ok_chart"] += 1
            DIAG.setdefault("retry_ok_sample", s)
            winner = winner or "chart"
            time.sleep(0.2)
            continue
        for name, kw in order:
            try:
                h = yf.Ticker(s).history(auto_adjust=False, actions=True, **kw)
                if h is not None and len(h.dropna(subset=["Close"])) > 5:
                    out[s] = clean_index(h.dropna(subset=["Close"]))
                    DIAG[f"retry_ok_{name}"] += 1
                    DIAG.setdefault("retry_ok_sample", s)
                    winner, got = name, True
                    break
            except Exception as e:
                DIAG.setdefault("retry_msg", f"{s} {name}: {type(e).__name__}: {str(e)[:140]}")
                if "RateLimit" in type(e).__name__:
                    THROTTLED["on"] = True
                    break
            time.sleep(0.2)
        if THROTTLED["on"]:
            DIAG["retry_stopped_throttled"] = n
            break
        if not got:
            DIAG["retry_none"] += 1
            probe_fail = probe_fail + 1 if not winner else probe_fail
            if not winner and probe_fail >= 60:  # nothing works for this kind of symbol: stop wasting the run
                DIAG["retry_gave_up_after"] = n + 1
                break
    try:  # what does Yahoo say about a known Cboe Canada listing?
        fi = yf.Ticker("AMZN.NE").fast_info
        DIAG["probe_AMZN.NE"] = f"last={fi.get('lastPrice')} exch={fi.get('exchange')} cur={fi.get('currency')}"
    except Exception as e:
        DIAG["probe_AMZN.NE"] = f"{type(e).__name__}: {str(e)[:120]}"
    return out



def chart_history(sym: str) -> pd.DataFrame | None:
    """Daily history straight from Yahoo's chart endpoint. Used when yfinance's own history call comes back empty,
    which happens for Cboe Canada (.NE) listings."""
    from yfinance.data import YfData
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{sym}"
    tries = [{"range": "max"}, {"period1": str(int(pd.Timestamp(START).timestamp())), "period2": str(int(time.time()))}, {"range": "10y"}]
    for extra in tries:
        try:
            js = YfData().get_raw_json(url, params={"interval": "1d", "events": "div,splits", "includePrePost": "false", **extra})
            res = (js.get("chart") or {}).get("result") or []
            if not res:
                continue
            r = res[0]
            ts = r.get("timestamp") or []
            q = ((r.get("indicators") or {}).get("quote") or [{}])[0]
            closes = q.get("close") or []
            if len(ts) < 6 or not closes:
                continue
            tz = (r.get("meta") or {}).get("exchangeTimezoneName") or "America/Toronto"
            idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert(tz)
            h = pd.DataFrame({"Close": pd.to_numeric(pd.Series(closes), errors="coerce").values}, index=idx)
            h["Dividends"] = 0.0
            h["Stock Splits"] = 0.0
            ev = r.get("events") or {}
            for d in (ev.get("dividends") or {}).values():
                t = pd.Timestamp(d["date"], unit="s", tz="UTC").tz_convert(tz)
                i = h.index.get_indexer([t], method="nearest")[0]
                h.iloc[i, h.columns.get_loc("Dividends")] += float(d.get("amount") or 0)
            for d in (ev.get("splits") or {}).values():
                num_, den = float(d.get("numerator") or 0), float(d.get("denominator") or 0)
                if num_ and den:
                    t = pd.Timestamp(d["date"], unit="s", tz="UTC").tz_convert(tz)
                    i = h.index.get_indexer([t], method="nearest")[0]
                    h.iloc[i, h.columns.get_loc("Stock Splits")] = num_ / den
            h = h.dropna(subset=["Close"])
            if len(h) > 5:
                return clean_index(h)
        except Exception as e:
            DIAG.setdefault("chart_msg", f"{sym}: {type(e).__name__}: {str(e)[:140]}")
    return None


def reset_yahoo_session() -> None:
    """Drop Yahoo's cookie and crumb so the next call fetches fresh ones (fixes runs of HTTP 401)."""
    try:
        from yfinance.data import YfData
        d = YfData()
        d._cookie, d._crumb = None, None
    except Exception:
        pass


def fetch_profile(sym: str, is_fund: bool):
    """Slow per-security calls: company/fund profile and top holdings. Refreshed on a rolling weekly cycle."""
    import yfinance as yf
    t = yf.Ticker(sym)
    info = {}
    for attempt in range(2):
        try:
            info = t.info or {}
            break
        except Exception as e:
            DIAG.setdefault("info_msg", f"{sym}: {type(e).__name__}: {str(e)[:140]}")
            if "RateLimit" in type(e).__name__:
                THROTTLED["on"] = True
                break
            if "401" in str(e) or "Unauthorized" in str(e) or "Crumb" in str(e):
                reset_yahoo_session()
            time.sleep(4)
    top = []
    if is_fund and HOLD["off"]:
        return info, top, False
    if is_fund:
        try:
            th = t.funds_data.top_holdings
            if th is not None and not th.empty:
                cols = {c.lower(): c for c in th.columns}
                ncol = cols.get("name") or next((c for c in th.columns if "name" in c.lower()), None)
                wcol = cols.get("holding percent") or next((c for c in th.columns if "percent" in c.lower() or "weight" in c.lower()), None)
                for idx, row in th.head(10).iterrows():
                    top.append({"s": str(idx), "n": str(row.get(ncol, "")) if ncol else "", "w": num(row.get(wcol)) if wcol else None})
            else:
                DIAG["top_empty"] += 1
        except Exception as e:
            DIAG["top_err"] += 1
            DIAG.setdefault("top_msg", f"{sym}: {type(e).__name__}: {str(e)[:160]}")
            if "401" in str(e) or "429" in str(e) or "Too Many" in str(e):
                HOLD["refused"] += 1
                reset_yahoo_session()
                time.sleep(min(60, 10 * HOLD["refused"]))
                if HOLD["refused"] >= 8:
                    HOLD["off"] = True  # Yahoo has stopped answering: leave the rest for the next run
            return info, top, False
    if info:
        DIAG["info_ok"] += 1
    else:
        DIAG["info_fail"] += 1
    if top:
        DIAG["top_ok"] += 1
        HOLD["refused"] = 0
    if not info:
        DIAG["info_empty"] += 1
    return info, top, True


def compress(close: pd.Series) -> pd.Series:
    """Daily closes for the last 3 years, weekly before that: enough for DRIP replay, a third of the size."""
    cut = close.index[-1] - pd.DateOffset(years=3)
    old = close[close.index < cut]
    old = old.groupby(old.index.to_period("W")).tail(1)
    return pd.concat([old, close[close.index >= cut]])


def norm_holding(sym: str) -> str:
    s = str(sym).upper()
    return s if re.search(r"\.(TO|NE|V)$", s) else s.replace(".", "-")


def build_record(sym: str, h: pd.DataFrame, info: dict, top: list, umeta: dict | None = None) -> dict:
    umeta = umeta or {}
    close = h["Close"].astype(float).dropna()
    divs = h.get("Dividends", pd.Series(dtype=float)).astype(float).fillna(0)
    divs = divs[divs > 0]
    spl = h.get("Stock Splits", pd.Series(dtype=float)).astype(float).fillna(0)
    spl = spl[spl > 0]
    qtype = (info.get("quoteType") or umeta.get("qt") or "").upper()
    name = info.get("longName") or info.get("shortName") or umeta.get("name") or display(sym)
    kind = "ETF" if qtype in ("ETF", "MUTUALFUND") else "Stock"
    if not qtype and re.search(r"\bETF\b|Fund|Index", str(name), re.I):
        kind = "ETF"
    st = compute_stats(close, divs, info)
    cc = compress(close)
    return {
        "s": sym,
        "d": display(sym),
        "name": name,
        "type": kind,
        "cur": (info.get("currency") or umeta.get("cur") or ("CAD" if listing(sym) == "CA" else "USD")).upper(),
        "ex": listing(sym),
        "asof": close.index[-1].strftime("%Y-%m-%d"),
        "px": num(close.iloc[-1]),
        "c": {"d": [x.strftime("%Y-%m-%d") for x in cc.index], "v": [num(v) for v in cc.values]},
        "div": [[x.strftime("%Y-%m-%d"), num(v, 6)] for x, v in divs.items()],
        "spl": [[x.strftime("%Y-%m-%d"), num(v, 6)] for x, v in spl.items()],
        "st": st,
        **classify(sym, name, info, kind, st.get("freq", 0), bool(umeta.get("cdr"))),
        "f": fundamentals(info),
        "top": [{"s": norm_holding(t["s"]), "n": t["n"], "w": t["w"]} for t in top],
        "about": (info.get("longBusinessSummary") or "")[:900],
    }


def index_row(r: dict) -> dict:
    st = r["st"]
    return {
        "s": r["s"], "d": r["d"], "n": r["name"], "t": r["type"], "ex": r["ex"], "cur": r["cur"],
        "px": r["px"], "y": st.get("yld"), "fy": st.get("fyld"), "fr": st.get("freq"),
        "g5": st.get("g5"), "tr5": st.get("tr5"), "p5": st.get("p5"), "sc": st.get("score"),
        "mer": r["f"].get("mer"), "cut": (st.get("lastChg") or 0) < -0.05, "er": st.get("erosion"),
        "lim": st.get("limited"), "tr1": st.get("tr1"), "g1": st.get("g1"), "p1": st.get("p1"),
        "wh": r.get("wh"), "tags": r.get("tags", []), "px_": r.get("proxy"), "hdg": r.get("hedged"),
        "cat": r["f"].get("category") or r["f"].get("sector"), "aum": r["f"].get("aum") or r["f"].get("mcap"),
        "h": [[t["s"], t["n"], t["w"]] for t in r.get("top", [])[:10]],
        "hp": r.get("topFrom"),
        "apx": r.get("approx"),
        "ya": st.get("yAvg5"), "yp": st.get("yPct5"), "r52": st.get("r52"),
        "sk": spark(r.get("c")),
    }


SPARK = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def spark(c: dict | None, n: int = 26) -> str | None:
    """One year of closes as 26 points, each scaled to 0-63 and written as one character."""
    if not c or len(c.get("d", [])) < 30:
        return None
    d, v = c["d"], c["v"]
    cut = (pd.Timestamp(d[-1]) - pd.DateOffset(years=1)).strftime("%Y-%m-%d")
    pts = [x for x, day in zip(v, d) if day >= cut and x is not None]
    if len(pts) < 20:
        return None
    pick = [pts[round(i * (len(pts) - 1) / (n - 1))] for i in range(n)]
    lo, hi = min(pick), max(pick)
    if hi <= lo:
        return SPARK[32] * n
    return "".join(SPARK[round((x - lo) / (hi - lo) * 63)] for x in pick)


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    force = "--discover" in argv
    max_profiles = int(next((a.split("=")[1] for a in argv if a.startswith("--profiles=")), "600"))
    (OUT / "q").mkdir(parents=True, exist_ok=True)
    (OUT / "fx").mkdir(parents=True, exist_ok=True)

    syms, umeta = (args, {}) if args else load_universe(force)
    print(f"universe: {len(syms)} securities")

    # FX first: CAD per USD
    try:
        import yfinance as yf
        fx = clean_index(yf.Ticker("CAD=X").history(start=START, auto_adjust=False))["Close"].dropna()
        (OUT / "fx" / "USDCAD.json").write_text(json.dumps(
            {"d": [x.strftime("%Y-%m-%d") for x in fx.index], "v": [num(v) for v in fx.values]}, separators=(",", ":")))
        print(f"FX USDCAD ok, last {float(fx.iloc[-1]):.4f}")
    except Exception as e:
        print(f"FX failed: {e}", file=sys.stderr)

    prices = download_prices(syms)
    approx = set()
    for s in syms:
        if not s.endswith(".NE") or listing(cdr_base(s)) != "US" or cdr_base(s) not in prices:
            continue
        m = umeta.setdefault(s, {})
        # A Cboe Canada listing with no history of its own whose ticker trades in the US is a CDR
        # (CDRs are often named plainly, e.g. "Amazon.com, Inc."). Listings with their own history
        # count as CDRs only when Yahoo says so or we list them ourselves.
        if s in prices and m.get("src") not in ("cdr", "curated"):
            continue
        m["cdr"] = True
        if s not in prices:
            h = synth_cdr(s, prices.get(cdr_base(s)))
            if h is not None:
                prices[s] = h
                approx.add(s)
                DIAG["cdr_rebuilt"] += 1
    # US shares fetched only to back CDRs are not listed on their own unless they were already in the universe
    helper_only = {cdr_base(s) for s in syms if s.endswith(".NE")} & {s for s in syms if (umeta.get(s) or {}).get("src") == "cdr-base"}

    # Rolling profile refresh: oldest first, a few hundred per run
    prev = {}
    for s in syms:
        f = OUT / "q" / f"{safe_name(s)}.json"
        if f.exists():
            try:
                r = json.loads(f.read_text())
                stale = r.get("pv", 1) < PROFILE_VERSION
                prev[s] = {"info_asof": "2000-01-01" if stale else r.get("info_asof", "2000-01-01"), "info": r.get("_info", {}), "top": r.get("top", []), "topFrom": r.get("topFrom")}
            except Exception:
                pass
    order = sorted([s for s in syms if s in prices], key=lambda s: prev.get(s, {}).get("info_asof", "2000-01-01"))
    refresh = set(s for s in order if (TODAY - pd.Timestamp(prev.get(s, {}).get("info_asof", "2000-01-01"))).days >= 7)
    refresh = set(sorted(refresh, key=lambda s: prev.get(s, {}).get("info_asof", "2000-01-01"))[:max_profiles])
    print(f"refreshing profiles for {len(refresh)} securities")

    KEEP = ("longName", "shortName", "quoteType", "currency", "category", "sector", "industry", "fundFamily", "netExpenseRatio",
            "trailingPE", "forwardPE", "payoutRatio", "beta", "beta3Year", "marketCap", "totalAssets", "fiftyTwoWeekHigh",
            "fiftyTwoWeekLow", "trailingEps", "debtToEquity", "returnOnEquity", "freeCashflow", "revenueGrowth",
            "earningsGrowth", "longBusinessSummary")
    rows, failed, done = {}, [], 0
    for s in order:
        try:
            p = prev.get(s, {})
            info, top, asof = p.get("info", {}), p.get("top", []) if not p.get("topFrom") else [], p.get("info_asof", "2000-01-01")
            if s in refresh and not THROTTLED["on"]:
                is_fund = (umeta.get(s, {}).get("qt") or info.get("quoteType") or "").upper() in ("ETF", "MUTUALFUND") or umeta.get(s, {}).get("src") in ("ca-etf", "us-etf")
                info_new, top_new, top_ok = fetch_profile(s, is_fund)
                if info_new:
                    info = {k: info_new.get(k) for k in KEEP if info_new.get(k) is not None}
                    top = top_new or top
                    if top_ok:  # a refused holdings request is retried on the next run
                        asof = TODAY.strftime("%Y-%m-%d")
                done += 1
                time.sleep(0.6 if is_fund else 0.3)
            rec = build_record(s, prices[s], info, top, umeta.get(s))
            rec["_info"], rec["info_asof"], rec["pv"] = info, asof, PROFILE_VERSION if asof != "2000-01-01" else 1
            if s in approx:
                rec["approx"] = cdr_base(s)
            (OUT / "q" / f"{safe_name(s)}.json").write_text(json.dumps(rec, separators=(",", ":")))
            rows[s] = index_row(rec)
        except Exception as e:
            failed.append(s)
            print(f"{s}: FAILED {e}", file=sys.stderr)
    failed += [s for s in syms if s not in prices and s not in helper_only]
    kept = 0
    for s in failed:
        f = OUT / "q" / f"{safe_name(s)}.json"
        if f.exists():
            try:
                rows[s] = index_row(json.loads(f.read_text()))
                kept += 1
            except Exception:
                pass
    DIAG["kept_last_known"] = kept
    print(f"built {len(rows)} records, {done} profiles refreshed, {len(failed)} failed")

    # Holdings look-through: funds with no published holdings borrow them from a US fund tracking the same index
    for sym, row in rows.items():
        proxy = row.get("px_")
        if row.get("h") or not proxy or proxy not in rows or not rows[proxy].get("h"):
            continue
        row["h"], row["hp"] = rows[proxy]["h"], proxy
        f = OUT / "q" / f"{safe_name(sym)}.json"
        rec = json.loads(f.read_text())
        rec["top"], rec["topFrom"] = [{"s": a, "n": b, "w": c} for a, b, c in row["h"]], proxy
        f.write_text(json.dumps(rec, separators=(",", ":")))

    # Remove files for securities that left the universe (delisted funds)
    live = {f"{safe_name(s)}.json" for s in syms} | {f"{safe_name(s)}.json" for s in rows}
    for f in (OUT / "q").glob("*.json"):
        if f.name not in live and not args:
            f.unlink()

    out_rows = sorted(rows.values(), key=lambda r: r["d"])
    (OUT / "index.json").write_text(json.dumps({"asof": TODAY.strftime("%Y-%m-%d"), "rows": out_rows}, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps({
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ok": len(rows), "failed": failed[:200], "nfailed": len(failed), "count": len(out_rows),
        "profiles": done}, indent=1))
    report(rows, failed, done, umeta)
    return 0 if rows else 1


def report(rows: dict, failed: list, done: int, umeta: dict) -> None:
    """One-line notices that show up on the workflow run page and through the API."""
    from collections import Counter
    src = Counter((umeta.get(s, {}) or {}).get("src", "curated") for s in rows)
    wh = Counter(r.get("wh") for r in rows.values())
    fsrc = Counter((umeta.get(s, {}) or {}).get("src", "curated") for s in failed)
    fsuf = Counter(re.sub(r"^[^.]*", "", s) or "(none)" for s in failed)
    held = sum(1 for r in rows.values() if r.get("h"))
    amzn = sum(1 for r in rows.values() if any(h[0] == "AMZN" for h in r.get("h") or []))
    DIAG["holdings_paused"] = HOLD["off"]
    DIAG["throttled"] = THROTTLED["on"]
    lines = [f"UNIVERSE {len(rows)} built, {len(failed)} failed, {done} profiles. Sources {dict(src)}. Tax {dict(wh)}",
             f"FAILED by source {dict(fsrc)} by suffix {dict(fsuf.most_common(8))} sample {failed[:25]}",
             f"PROFILES {dict(DIAG)}",
             f"HOLDINGS {held} have top holdings; AMZN held by {amzn}"]
    for s in ("VDY.TO", "HMAX.TO", "VFV.TO", "SCHD", "AMZN.NE", "ZUT.TO", "XEQT.TO"):
        r = rows.get(s)
        extra = ""
        if s == "VDY.TO" and (OUT / "q" / f"{s}.json").exists():
            rec = json.loads((OUT / "q" / f"{s}.json").read_text())
            extra = f" px={rec.get('px')} ttm={rec['st'].get('ttm')} fy={rec['st'].get('fyld')} ya={rec['st'].get('yAvg5')} divs={rec.get('div', [])[-14:]}"
        lines.append(f"{s}: " + extra + (f" y={r.get('y')} fr={r.get('fr')} sc={r.get('sc')} wh={r.get('wh')} tags={r.get('tags')} h={len(r.get('h') or [])} cat={r.get('cat')}" if r else "missing"))
    # GitHub keeps at most 10 annotations per step, so everything goes in one
    print("::notice title=Data run::" + " %0A".join(l.replace("\n", " ") for l in lines))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
