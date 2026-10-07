"""Marketing screenshots of the live demo, taken with real market data. Usage: python scripts/screenshots.py site out"""
import asyncio, functools, http.server, sys, threading, pathlib
from playwright.async_api import async_playwright

SITE, OUT = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:8799/index.html"

async def shoot(pg, name, sel=None, pad=12):
    await pg.wait_for_timeout(700)
    if sel:
        el = pg.locator(sel).first
        await el.scroll_into_view_if_needed()
        await pg.evaluate("document.querySelectorAll('.topbar').forEach(e => e.style.position = 'static')")
        await el.scroll_into_view_if_needed()
        box = await el.bounding_box()
        vw = pg.viewport_size["width"]
        box["height"] = min(box["height"], pg.viewport_size["height"] * 1.5)
        await pg.screenshot(path=str(OUT / f"{name}.png"), full_page=True,
                            clip={"x": 0, "y": max(0, box["y"] - pad + await pg.evaluate("scrollY")), "width": vw, "height": box["height"] + 2 * pad})
    else:
        await pg.screenshot(path=str(OUT / f"{name}.png"))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for tag, w, h, scale in (("phone", 390, 844, 3), ("desktop", 1280, 860, 2)):
            ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale, color_scheme="light")
            pg = await ctx.new_page()
            await pg.add_init_script("try{localStorage.setItem('yl.guide','0');localStorage.setItem('yl.lang','en')}catch(e){}")
            await pg.goto(BASE); await pg.wait_for_selector(".login"); await pg.wait_for_timeout(500)
            await pg.screenshot(path=str(OUT / f"{tag}-0-login.png"))
            await pg.click("[data-act=demo]"); await pg.wait_for_selector("#ch-value svg")
            await pg.evaluate("document.querySelector('.alerts')?.remove(); document.querySelector('#fb-open').style.display='none'")
            await shoot(pg, f"{tag}-1-portfolio")
            await pg.wait_for_selector(".xr")
            await shoot(pg, f"{tag}-2-yield-xray", ".xr-grid")
            await pg.wait_for_selector("#vs-growth .xr-cmp", timeout=15000)
            await shoot(pg, f"{tag}-3-dividends-vs-growth", "#vs-growth")
            await pg.goto(BASE + "#/t/ENB.TO"); await pg.wait_for_selector(".val-head")
            await pg.evaluate("document.querySelector('#fb-open').style.display='none'")
            await shoot(pg, f"{tag}-4-price-check", "section:has(.val-head)")
            await pg.goto(BASE + "#/research"); await pg.wait_for_selector("#rs-q")
            await pg.fill("#rs-q", "Amazon"); await pg.wait_for_selector(".own"); await pg.wait_for_timeout(600)
            await pg.evaluate("document.querySelector('#fb-open').style.display='none'")
            await shoot(pg, f"{tag}-5-amazon-search", "#rs-out")
            await pg.goto(BASE + "#/bills"); await pg.wait_for_selector(".pay-hero")
            await pg.evaluate("document.querySelector('#fb-open').style.display='none'")
            await shoot(pg, f"{tag}-6-paycheque", ".pay-hero")
            await ctx.close()
        await b.close()
    srv.shutdown()

asyncio.run(main())
