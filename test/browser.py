"""Drive the page in Chrome: run the example, check the verdict, save a shot.
uv run --with playwright python test/browser.py URL OUT.png"""
import sys
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    pg = b.new_page(viewport={"width": 1000, "height": 900})
    errs = []
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url)
    pg.click("#ex")
    pg.wait_for_selector("#out:not([hidden])", timeout=60000)
    print("verdict:", pg.inner_text("#verdict"))
    print("rows:", pg.locator("#t tbody tr").count())
    print("foot:", pg.inner_text("#foot"))
    with pg.expect_download() as d:
        pg.click("#dl")
    print("download:", d.value.suggested_filename)
    pg.locator("#out").screenshot(path=out)
    print("errors:", errs or "none")
    b.close()
