import os
import re
import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE
    from .fixtures import use_default_timeouts
except ImportError:
    from config import BASE_URL, HEADLESS_MODE
    from fixtures import use_default_timeouts


class TestVersionInformation(unittest.TestCase):

    def test_version(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            
            context = browser.new_context()
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(BASE_URL)

            # ---------------------
            phlynx_version_regex = re.compile(r"^PhLynx v[\d]+\.[\d]+\.[\d]+[\*]?$")
            version_regex = re.compile(r"^v[\d]+\.[\d]+\.[\d]+[\*]?$")
            
            main_version = page.get_by_test_id("app-version")
            expect(main_version).to_have_text(phlynx_version_regex)
            page.get_by_role("link", name="About").click()
            version_chip = page.get_by_test_id("build-version")
            expect(version_chip).to_have_text(version_regex)
            # ---------------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()

