"""Annotations tab end-to-end tests.

A module's variables are annotated by hand in the instance editor's Annotations tab, with OLS mocked, on the synthetic
toy model in tests/resources/annotations/toy.
"""

import os
import re
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


NODE = ".vue-flow__node"
APP_MOUNT_TIMEOUT = 60000

TOY = os.path.join(RESOURCE_PATH, "annotations", "toy")
POOL_FILES = ["pool.cellml", "toy-units.cellml"]

OLS_ROUTE = "https://www.ebi.ac.uk/ols4/api/**"
UNIPROT_ROUTE = "https://rest.uniprot.org/**"
# The ChEBI terms the mocked OLS knows.
OLS_TERMS = [
    {"iri": "http://purl.obolibrary.org/obo/CHEBI_26708", "obo_id": "CHEBI:26708", "label": "sodium atom",
     "synonym": ["Na"], "is_obsolete": False},
    {"iri": "http://purl.obolibrary.org/obo/CHEBI_29101", "obo_id": "CHEBI:29101", "label": "sodium(1+)",
     "synonym": ["Na+"], "is_obsolete": False},
]


def toy(name):
    return os.path.join(TOY, name)


def mock_ontology_services(target, requests):
    """Answer OLS from OLS_TERMS and fail UniProt on a page or context, recording each OLS URL in requests."""

    def answer_ols(route):
        url = route.request.url
        requests.append(url)
        if "/select?" in url:
            query = parse_qs(urlparse(url).query).get("q", [""])[0].lower()
            docs = [t for t in OLS_TERMS if any(query in v.lower() for v in [t["label"], *t["synonym"]])]
            route.fulfill(json={"response": {"numFound": len(docs), "docs": docs}})
            return
        term = next((t for t in OLS_TERMS if t["iri"].rsplit("/", 1)[1] in url), None)
        if term:
            route.fulfill(json=term)
        else:
            route.fulfill(status=404, json={})

    target.route(OLS_ROUTE, answer_ols)
    target.route(UNIPROT_ROUTE, lambda route: route.fulfill(status=503, body=""))


def open_menu(page, index, label):
    """Open the toolbar's index-th split button menu (0 Import, 1 Export) and pick an item."""
    page.locator(".file-io-buttons .p-splitbutton").nth(index).locator(".p-splitbutton-dropdown").click()
    item = page.get_by_role("menuitem", name=label, exact=True)
    # The CellML items enable once libcellml is ready.
    expect(item).to_be_enabled(timeout=APP_MOUNT_TIMEOUT)
    item.click()


def import_files(page, label, *file_groups):
    """Import through the named Import item, one file group per field of its dialog."""
    open_menu(page, 0, label)
    dialog = page.locator(".p-dialog").filter(has=page.locator("input[type=file]"))
    expect(dialog).to_be_visible()
    for index, files in enumerate(file_groups):
        dialog.locator("input[type=file]").nth(index).set_input_files(files)
    confirm = dialog.locator(".p-dialog-footer button").filter(has_text=re.compile(r"^Import$"))
    expect(confirm).to_be_enabled()
    confirm.click()
    expect(dialog).to_be_hidden(timeout=30000)


def open_app(page):
    page.goto(BASE_URL)
    expect(page.locator(".vue-flow__pane")).to_be_visible(timeout=APP_MOUNT_TIMEOUT)


def place(page, name, x=700, y=450):
    """Drags the named library module onto the canvas."""
    card = page.locator(".mlc__card--draggable").filter(has_text=name).first
    if not card.is_visible():
        page.locator(".mlc__group-header").filter(has_text=re.compile(re.escape(name), re.IGNORECASE)).first.click()
    card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": x, "y": y})
    expect(page.locator(NODE)).to_have_count(1)


class TestAnnotationsTab(unittest.TestCase):
    """The instance editor's Annotations tab, on the toy pool."""

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.page = self.context.new_page()
        self.ols_requests = []
        mock_ontology_services(self.page, self.ols_requests)

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    def open_editor(self):
        page = self.page
        page.locator(NODE).first.dblclick()
        editor = page.locator(".module-editor-dialog")
        expect(editor.get_by_role("tab", name=re.compile(r"Ports \(")).first).to_be_visible(timeout=30000)
        return editor

    def test_annotates_c_a_by_hand_and_keeps_it_on_save(self):
        page = self.page
        open_app(page)
        import_files(page, "CellML File", [toy(name) for name in POOL_FILES])
        place(page, "pool")

        editor = self.open_editor()
        tab = editor.get_by_role("tab", name=re.compile(r"Annotations \("))
        expect(tab).to_have_text(re.compile(r"Annotations \(0/"))
        tab.click()

        row = editor.locator(".annotation-row[data-variable=c_A]")
        row.locator("[data-test=what]").click()
        page.get_by_role("option", name="Concentration", exact=True).click()

        # Species lookups beyond the local table go to OLS: sodium atom comes only from the mocked search.
        species = row.locator("[data-test=species] input")
        species.fill("sodium")
        options = page.locator(".p-autocomplete-option")
        expect(options.filter(has_text="CHEBI:26708")).to_be_visible(timeout=10000)
        self.assertTrue(any("/select?" in url and "ontology=chebi" in url for url in self.ols_requests))
        options.filter(has_text="CHEBI:29101").first.click()

        row.locator("[data-test=whose]").click()
        page.get_by_role("option", name="This compartment", exact=True).click()

        expect(tab).to_have_text(re.compile(r"Annotations \(1/"))
        editor.get_by_role("button", name="Save", exact=True).click()
        expect(editor).to_be_hidden()

        # The saved annotation is the module's, so the editor opens with it.
        editor = self.open_editor()
        expect(editor.get_by_role("tab", name=re.compile(r"Annotations \("))).to_have_text(re.compile(r"Annotations \(1/"))
        editor.get_by_role("button", name="Cancel").click()
        expect(editor).to_be_hidden()

    def test_flags_malformed_and_unknown_terms_without_changing_them(self):
        page = self.page
        open_app(page)
        import_files(page, "CellML File", [toy(name) for name in POOL_FILES])
        place(page, "pool")
        # The volume's OPB id has a GO id's digits, and the sodium is a ChEBI id the mocked OLS doesn't know.
        with open(toy("pool.ttl")) as source:
            pool = source.read().replace("opb:00154", "opb:0006096").replace("chebi:29101", "chebi:99999999")
        folder = tempfile.mkdtemp()
        with open(os.path.join(folder, "pool.ttl"), "w") as target:
            target.write(pool)
        import_files(page, "Module Annotations", [os.path.join(folder, "pool.ttl")])

        toasts = page.locator(".p-toast")
        expect(toasts).to_contain_text("volume: OPB:0006096 doesn’t fit OPB’s ids, such as OPB:00340")
        expect(toasts).to_contain_text("c_A: OLS has no term CHEBI:99999999", timeout=10000)

        editor = self.open_editor()
        editor.get_by_role("tab", name=re.compile(r"Annotations \(")).click()
        warning = editor.locator(".annotation-row[data-variable=volume] [data-test=term-warning]")
        expect(warning).to_have_attribute("aria-label", "OPB:0006096 doesn’t fit OPB’s ids, such as OPB:00340")
        expect(editor.locator(".annotation-row[data-variable=c_A] [data-test=term-warning]")).to_have_attribute(
            "aria-label", "OLS has no term CHEBI:99999999"
        )
        expect(editor.locator(".annotation-row[data-variable=area] [data-test=term-warning]")).to_have_count(0)
        editor.get_by_role("button", name="Cancel").click()
        expect(editor).to_be_hidden()


if __name__ == "__main__":
    unittest.main()
