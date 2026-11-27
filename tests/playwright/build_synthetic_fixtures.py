"""Builds the synthetic workspaces in tests/resources/synthetic from their CellML, through the app itself.

Each <name>.cellml there is dropped onto an empty workspace, which the app turns into instances and edges, and the
saved workspace is written to <name>-workspace.json, trimmed of the copies of the built-in library every save
carries: the app registers its own on start, so the file keeps only what the model adds.

Run it against the dev server, with the requirements in tests/requirements.txt:

    PHLYNX_BASE_URL=http://localhost:5173/ python tests/playwright/build_synthetic_fixtures.py
"""
import glob
import json
import os

from playwright.sync_api import expect, sync_playwright

from config import BASE_URL
from fixtures import SYNTHETIC_PATH, wait_for_library

DROP_FILE_JS = """
([name, content]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], name, { type: 'application/xml' }));
    document.querySelector('.dnd-flow').dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
    );
}
"""

# Stands in for the browser's save picker, keeping what the app writes.
CAPTURE_SAVE_JS = """
window.__saved = null;
window.showSaveFilePicker = async () => ({
    name: 'workspace.json',
    createWritable: async () => {
        const parts = [];
        return { write: async (part) => parts.push(part), close: async () => { window.__saved = await new Blob(parts).text() } };
    },
});
"""


def own_entries(workspace, file_name):
    """Keeps the store's entries for the math from file_name, dropping the built-in library's."""
    store = workspace["store"]
    maths = {ref for ref, _ in store["availableMath"] if ref.startswith(file_name + ":")}
    store["availableMath"] = [entry for entry in store["availableMath"] if entry[0] in maths]
    store["availableModules"] = [entry for entry in store["availableModules"] if entry[1].get("mathRef") in maths]
    store["availableCollections"] = [entry for entry in store["availableCollections"] if entry[0] in maths]
    store["mathDefaults"] = [entry for entry in store["mathDefaults"] if entry[0] in maths]
    store["availableUnits"] = [units for units in store["availableUnits"] if units.get("componentFile") == file_name]
    return workspace


def build(playwright, cellml_path):
    """Drops the CellML file onto an empty workspace and writes the trimmed workspace the app saves."""
    file_name = os.path.basename(cellml_path)
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.add_init_script(CAPTURE_SAVE_JS)
    page.goto(BASE_URL)
    wait_for_library(page)
    with open(cellml_path) as f:
        page.evaluate(DROP_FILE_JS, [file_name, f.read()])
    expect(page.locator(".vue-flow__node").first).to_be_visible()
    # Let the layout settle, so the saved positions are where the app put the nodes.
    page.wait_for_timeout(1000)
    page.keyboard.press("ControlOrMeta+s")
    page.wait_for_function("window.__saved !== null")
    workspace = own_entries(json.loads(page.evaluate("window.__saved")), file_name)
    browser.close()

    out = cellml_path.removesuffix(".cellml") + "-workspace.json"
    with open(out, "w") as f:
        json.dump(workspace, f, indent=2)
        f.write("\n")
    print(f"{os.path.relpath(out)}: {len(workspace['flow']['nodes'])} nodes, {len(workspace['flow']['edges'])} edges")


if __name__ == "__main__":
    with sync_playwright() as playwright:
        for path in sorted(glob.glob(os.path.join(SYNTHETIC_PATH, "*.cellml"))):
            build(playwright, path)
