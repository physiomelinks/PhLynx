import sys
import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE
except ImportError:
    from config import BASE_URL, HEADLESS_MODE


BIO = ".bio-flow"
BIO_NODE = f"{BIO} .vue-flow__node"
LIBRARY_CARD = ".mlc__card--draggable"

# Drag a library card onto the screen point the way the browser would: dragstart on the card, then dragover and
# drop on whatever is under the point, sharing one DataTransfer so the drop sees what the card put in it.
DRAG_OVER_AND_DROP_JS = """
([x, y, transfer]) => {
    const target = document.elementFromPoint(x, y);
    for (const type of ['dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, {
            dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
    }
}
"""


def piece(page, path):
    """An empty piece of the placed template, by its path in the template ('cell', 'apical-fluid', ...)."""
    return page.locator(f'{BIO_NODE}[data-id^="tpl:"][data-id$="/{path}"]')


def bound(page, kind):
    """Diagram instances drawn as one kind of node in the physiological view (bioRegion, bioProtein, ...)."""
    return page.locator(f'{BIO} .vue-flow__node-{kind}:not([data-id^="tpl:"])')


def undo(page):
    button = page.locator("button:has(.pi-undo)").first
    expect(button).to_be_enabled()
    button.click()


class TestBioTemplates(unittest.TestCase):

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    # ---------- helpers -----------

    def open_physiology_with_template(self, name):
        """Open the app, switch to the physiological view and place a template from the pane's menu."""
        page = self.page
        page.goto(BASE_URL)
        expect(page.locator(".vue-flow__pane").first).to_be_visible()
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()

        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text(name, exact=True).click()
        expect(page.locator("[data-testid=bio-template-title]")).to_have_count(1)
        # Room for the whole template, and the library's first group open to drag from.
        page.locator(f"{BIO} .vue-flow__controls-zoomout").click()
        page.locator(".mlc__group-header").first.click()
        expect(page.locator(LIBRARY_CARD).nth(2)).to_be_visible()

    def drop_module(self, index, point):
        """Drag the library's index-th module onto a screen point of the physiological view."""
        page = self.page
        transfer = page.evaluate_handle("() => new DataTransfer()")
        page.locator(LIBRARY_CARD).nth(index).dispatch_event("dragstart", {"dataTransfer": transfer})
        page.evaluate(DRAG_OVER_AND_DROP_JS, [point[0], point[1], transfer])

    # ---------- dropping modules on template sites -----------

    def test_drop_modules_on_epithelial_cell_sites_replace_and_undo(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")

        # On the apical facet's slot, along the top of the cell: a membrane protein in that slot.
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        protein_box = protein.bounding_box()
        self.assertAlmostEqual(protein_box["y"] + protein_box["height"] / 2, cell["y"], delta=2)

        # On the apical fluid, clear of the slots: the band becomes that module's.
        lumen = piece(page, "apical-fluid").bounding_box()
        point = (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3)
        self.drop_module(1, point)
        expect(piece(page, "apical-fluid")).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_count(1)
        first = bound(page, "bioRegion").get_attribute("data-id")

        # Another on the same fluid replaces it, and the one it replaced becomes a card.
        self.drop_module(2, point)
        expect(bound(page, "bioRegion")).to_have_count(1)
        expect(bound(page, "bioRegion")).not_to_have_attribute("data-id", first)
        expect(bound(page, "bioCard")).to_have_count(1)
        expect(bound(page, "bioCard")).to_have_attribute("data-id", first)

        # One undo takes back the whole replacing drop: the new instance goes, and the first is bound again.
        undo(page)
        expect(bound(page, "bioCard")).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_attribute("data-id", first)
        expect(bound(page, "bioProtein")).to_have_count(1)


    def test_dragging_a_template_with_a_bound_protein_keeps_it_bound(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        lumen = piece(page, "apical-fluid").bounding_box()
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        protein, region = bound(page, "bioProtein"), bound(page, "bioRegion")
        expect(region).to_have_count(1)

        # Both selected, dragged by the compartment: the template moves, and the protein moves with it, bound.
        protein.click()
        modifier = "Meta" if sys.platform == "darwin" else "Control"
        box = region.bounding_box()
        start = (box["x"] + 10, box["y"] + 10)
        page.keyboard.down(modifier)
        page.mouse.click(*start)
        page.keyboard.up(modifier)
        expect(page.locator(f"{BIO} .vue-flow__node.selected")).to_have_count(2)
        before = protein.bounding_box()
        page.mouse.move(*start)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(start[0] + 12 * step, start[1] + 6 * step)
        page.mouse.up()

        expect(protein).to_have_count(1)
        expect(page.locator(f"{BIO} .vue-flow__node-bioProtein[data-id^='tpl:']")).to_have_count(0)
        after, moved = protein.bounding_box(), region.bounding_box()
        self.assertGreater(moved["x"] - box["x"], 50)
        self.assertAlmostEqual(after["x"] - before["x"], moved["x"] - box["x"], delta=2)
        self.assertAlmostEqual(after["y"] - before["y"], moved["y"] - box["y"], delta=2)
        undo(page)
        expect(protein).to_have_count(1)
        self.assertAlmostEqual(protein.bounding_box()["x"], before["x"], delta=2)


if __name__ == "__main__":
    unittest.main()
