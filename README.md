# Yield Ledger

Dividend growth and DRIP tracking for Canadian investors.

Enter a ticker, a share count and the date you bought. Yield Ledger replays every dividend since then, reinvests it at that day's price (fractional or whole-share DRIP), and shows the result: shares bought versus shares now, capital invested, total return and annualized return, yield on cost, income by month, a 12-month payment calendar, and a 5 to 30-year income projection.

Search by theme (utilities, banks, REITs, covered call…) or by company ("Amazon" lists the CDR, the US listing and every ETF holding it). Every security shows what you keep of its yield in a TFSA, RRSP or non-registered account after US withholding, including the 15% that Canadian-listed US-equity funds lose inside the fund.

Every ETF and stock gets a research note built from its own history: payout growth over 1, 3, 5 and 10 years, years of increases, cuts, total return versus price return, drawdown, volatility, yield versus its 5-year average, NAV-erosion detection, fees and fundamentals, and a 0–100 quality score.

Each security also gets a **price check** (cheap, fair or pricey against its own yield and price history, framed as education, not advice) and a **dividends vs growth** comparison against the S&P 500, Nasdaq 100, TSX 60 or the fund's top holding. Projections rank ways to grow your income. The site installs to a phone's home screen as an app and works offline with the last data it loaded.

## Tip jar

Create a Stripe Payment Link ("Customers choose what to pay") and paste it into `donateUrl` in `site/config.js`. A "Support Yield Ledger" button then appears in Settings and the footer.

## How it runs (free)

| Piece | Where | Cost |
| --- | --- | --- |
| Website | GitHub Pages, from `site/` | Free (public repo) |
| Market data | GitHub Actions job `.github/workflows/deploy.yml`, weekdays 6:40 pm Toronto | Free |
| Data source | Yahoo Finance via `yfinance` | Free, personal and demo use only |
| Accounts | In the browser by default; Supabase for real cloud accounts | Free tier |

The daily job runs `scripts/fetch_data.py`:

1. **Universe, weekly.** Yahoo's screener lists every Canadian-listed ETF (about 1,000 after dropping US-dollar duplicate units), every CDR on Cboe Canada, Canadian dividend stocks over $300M, the 300 largest US ETFs and US stocks with 10+ years of dividend growth. Everything in `tickers.txt` is always included on top.
2. **Prices, daily.** Batched downloads of closes, dividends and splits since 2005 (about 30 requests for the whole market). History older than 3 years is stored weekly to keep files small.
3. **Profiles, rolling.** Fund categories, fees, fundamentals and top-10 holdings refresh for the 600 oldest each run, so the whole market is refreshed about once a week without tripping Yahoo's rate limits.
4. **Scorecard, tags and tax profile** are computed for every security, then `site/data/` is saved to the Actions cache (not git) and the site is redeployed.

Run it by hand from the Actions tab ("Run workflow"); tick "Re-scan the whole market" to rebuild the universe immediately.

## Always track a ticker

Add the Yahoo symbol to `tickers.txt` (Canadian listings end in `.TO`, Cboe Canada in `.NE`) and push. It is included on the next data run.

## Turn on cloud accounts

1. Create a free project at supabase.com.
2. In the SQL editor, run `supabase/schema.sql`.
3. Under Authentication → URL configuration, add your site URL (`https://yieldledger.github.io/`).
4. Paste the project URL and anon key into `site/config.js` and push.

Accounts then sync across devices. Row-level security keeps each portfolio visible only to its owner.

## Run locally

```
pip install -r scripts/requirements.txt
python scripts/fetch_data.py VDY.TO SCHD   # quick run for a few symbols
python -m http.server -d site 8000
```

## Before selling it

- Yahoo's data is not licensed for commercial use. A paid product needs a licensed feed such as EODHD, Financial Modeling Prep, Polygon or Twelve Data.
- Move the code to a private repository and host on Cloudflare Pages or Netlify, both free with private repos.
- The research notes describe history and are framed as education. Personal buy or sell recommendations would bring Canadian securities registration rules into play.
