"""Exercise the offline UI with local servers and an installed Chrome/Edge."""
import argparse
import csv
import io
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect


def run(url, reference, executable, out):
    out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=executable,headless=True)
        context=browser.new_context(viewport={"width":1440,"height":900},reduced_motion="reduce")
        context.route("**/*",lambda route: route.continue_() if urlparse(route.request.url).hostname in {"localhost","127.0.0.1"} else route.abort())
        page=context.new_page()
        if reference:
            page.goto(reference+"/residences.html")
            page.wait_for_timeout(1800)
            page.screenshot(path=out/"template-desktop.png")
        errors=[]
        page.on("pageerror",lambda exc:errors.append(str(exc)))
        page.goto(url)
        expect(page.get_by_text("REGIONAL NETWORK",exact=True)).to_be_visible()
        page.get_by_role("button",name="W1 ",exact=False).first.click()
        page.get_by_text("Edit network inputs",exact=True).click()
        total = int(page.locator('.metric').filter(has_text='Customer orders').locator('strong').inner_text())
        assert total > 100
        stock=page.get_by_label("Stock (units)")
        stock.fill(str(int(stock.input_value())+1))
        page.get_by_role("button",name="Apply edits").click()
        expect(page.get_by_role("button",name="Apply edits")).to_be_disabled()
        expect(page.locator('.metric').filter(has_text='Baseline on time').locator('strong')).to_have_text(str(total),timeout=20000)
        page.get_by_text("Import CSV edits",exact=True).click()
        imported_stock = str(int(stock.input_value())+1)
        page.get_by_label("Import warehouses CSV").set_input_files(
            {"name":"warehouse-edits.csv","mimeType":"text/csv","buffer":f"id,stock_units\nW1,{int(stock.input_value())+1}".encode()})
        expect(stock).to_have_value(imported_stock)
        expect(page.locator('.metric').filter(has_text='Baseline on time').locator('strong')).to_have_text(str(total),timeout=20000)
        page.get_by_text("Edit network inputs",exact=True).click()
        for width in [1440,768,390]:
            page.set_viewport_size({"width":width,"height":900})
            page.evaluate("window.scrollTo(0,0)")
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
            page.screenshot(path=out/f"overview-{width}.png")
            page.evaluate("window.scrollTo(0,document.body.scrollHeight)")
            assert page.evaluate("document.documentElement.scrollHeight<=innerHeight || scrollY>0")
            page.evaluate("window.scrollTo(0,0)")
        page.emulate_media(reduced_motion="no-preference")
        page.get_by_role("button",name="Menu",exact=True).click()
        page.get_by_role("button",name="Disruption simulator",exact=True).click()
        assert page.locator("article").evaluate("el=>getComputedStyle(el).animationName")=="enter"
        page.get_by_label("Disruption",exact=True).select_option("outage")
        page.get_by_role("button",name="Calculate natural recovery").click()
        expect(page.get_by_text("OPTIMAL",exact=True)).to_be_visible(timeout=25000)
        page.get_by_role("button",name="Set recovery target").click()
        page.get_by_label("Budget (INR)").fill("1")
        page.get_by_role("button",name="Optimize recovery").click()
        expect(page.get_by_text("Stage C · CP-SAT",exact=True)).to_be_visible(timeout=20000)
        if page.get_by_text("INFEASIBLE",exact=True).count():
            page.get_by_label("Required on-time service").fill("70")
            page.get_by_role("button",name="Optimize recovery").click()
        expect(page.get_by_text("Budget below minimum",exact=True)).to_be_visible(timeout=20000)
        page.get_by_role("button",name="Compare scenarios").click()
        expect(page.get_by_text("Disrupted before reassignment",exact=True)).to_be_visible()
        page.get_by_role("button",name="Open action sheet").click()
        expect(page.get_by_role("heading",name="Passed")).to_be_visible()
        page.get_by_role("button",name="Verify plan").click()
        with page.expect_download() as event:
            page.get_by_role("link",name="Export CSV").click()
        rows=list(csv.DictReader(io.StringIO(event.value.path().read_text())))
        assert len(rows)==total and all(r["verified"]=="PASS" for r in rows)
        page.get_by_label("Operating region").select_option("guwahati")
        expect(page.get_by_role("heading",name="Guwahati")).to_be_visible()
        expect(page.get_by_text("Previous results are stale.",exact=False)).to_be_visible()
        page.route("**/api/network/mumbai",lambda r:r.fulfill(status=503,json={"detail":"Disconnected test"}))
        page.get_by_label("Operating region").select_option("mumbai")
        expect(page.get_by_role("alert")).to_contain_text("Disconnected test")
        assert not errors,errors
        print(f"Browser flow passed, {len(rows)} verified CSV rows, desktop/tablet/mobile and local-only requests.")
        browser.close()


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",default="http://127.0.0.1:8000")
    parser.add_argument("--reference")
    parser.add_argument("--browser",default=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    parser.add_argument("--output",type=Path,default=Path("work/qa"))
    args=parser.parse_args()
    run(args.url,args.reference,args.browser,args.output)

