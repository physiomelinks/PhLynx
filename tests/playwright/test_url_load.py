import os
import re
import time
import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


MANIFEST_PATTERN = "**/manifests/vitalworkshop.json"


def delay_manifest(route):
    # Hold the manifest back so libCellML is always ready first, reproducing the URL load race.
    time.sleep(3)
    route.continue_()


class TestLoadViaUrl(unittest.TestCase):

    def test_workspace_json_base64(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            page = context.new_page()
            page.route(MANIFEST_PATTERN, delay_manifest)

            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()

            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}")

            # ---------- START -----------
            page.get_by_text("SN_varicositycell_modules.cellmlvar_SN").click()
            expect(page.get_by_text("SN_varicositycell_modules.cellmlvar_SN")).to_be_visible()
            expect(page.get_by_text("SN_axoncell_modules.cellmlaxon_SN")).to_be_visible()
            expect(page.get_by_text("SN_somacell_modules.cellmlsoma_SN")).to_be_visible()
            expect(page.get_by_role("main")).to_contain_text("var_SN")
            expect(page.get_by_role("main")).to_contain_text("axon_SN")
            expect(page.get_by_role("main")).to_contain_text("soma_SN")
            expect(page.locator(".vue-flow__edge-interaction").first).to_be_visible()
            expect(page.locator("svg:nth-child(3) > .vue-flow__edge > .vue-flow__edge-interaction")).to_be_visible()
            page.close()
            # ----------- END ------------

            context.close()
            browser.close()

    def test_workspace_json_base64_without_manifest(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            page = context.new_page()
            page.route(MANIFEST_PATTERN, lambda route: route.abort())

            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()

            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}")

            # ---------- START -----------
            expect(page.get_by_text("SN_varicositycell_modules.cellmlvar_SN")).to_be_visible()
            expect(page.get_by_role("main")).to_contain_text("var_SN")
            expect(page.get_by_role("main")).to_contain_text("axon_SN")
            expect(page.get_by_role("main")).to_contain_text("soma_SN")
            page.close()
            # ----------- END ------------

            context.close()
            browser.close()

    def test_workspace_omex_base64(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            page = context.new_page()
            page.route(MANIFEST_PATTERN, delay_manifest)

            with open(os.path.join(RESOURCE_PATH, "workspace-omex.base64")) as f:
                workspace_omex = f.read().strip()

            page.goto(BASE_URL + f"?open=omex#{workspace_omex}")

            # ---------- START -----------
            page.get_by_text("SN_varicositycell_modules.cellmlvar_SN").click()
            expect(page.get_by_text("SN_varicositycell_modules.cellmlvar_SN")).to_be_visible()
            expect(page.get_by_text("SN_axoncell_modules.cellmlaxon_SN")).to_be_visible()
            expect(page.get_by_text("SN_somacell_modules.cellmlsoma_SN")).to_be_visible()
            expect(page.locator("svg:nth-child(3) > .vue-flow__edge > .vue-flow__edge-interaction")).to_be_visible()
            expect(page.locator(".vue-flow__edge-interaction").first).to_be_visible()
            expect(page.get_by_role("main")).to_contain_text("var_SN")
            expect(page.get_by_role("main")).to_contain_text("axon_SN")
            expect(page.get_by_role("main")).to_contain_text("soma_SN")
            page.locator("button:nth-child(17)").click()
            page.get_by_label("axon_SN5 vars1 plotted").get_by_role("cell", name="V", exact=True).click()
            expect(page.get_by_label("Plot 1")).to_contain_text("Plot 1")
            page.get_by_role("tab", name="Parameter Scan Setup").click()
            page.get_by_role("cell", name="C", exact=True).click()
            expect(page.get_by_test_id("param-min-C")).to_have_value("9");
            expect(page.get_by_test_id("param-default-C")).to_have_value("10");
            expect(page.get_by_test_id("param-max-C")).to_have_value("11");
            page.get_by_role("tab", name="Simulation Parameters").click()
            expect(page.get_by_test_id("sim-initial-point")).to_have_value("0");
            expect(page.get_by_test_id("sim-starting-point")).to_have_value("0");
            expect(page.get_by_test_id("sim-ending-point")).to_have_value("20");
            expect(page.get_by_test_id("sim-point-interval")).to_have_value("0.001");
            page.get_by_role("button", name="Save").click()
            page.locator(".vue-flow__pane").click()
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
