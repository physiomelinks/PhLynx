"""Annotation coupling end to end: module sidecars plus an ApiCoord instance file place, name and bind instances,
the annotations suggest their connections, and the bindings survive an OMEX round trip. A module's variables are
annotated by hand in the Annotations tab, with OLS mocked.

The committed tests use the synthetic toy model in tests/resources/annotations/toy. The private variant runs only
where unpublished fixtures exist (PHLYNX_ANNOTATIONS_PRIVATE, else the gitignored vitest private folder).
"""

import glob
import json
import os
import re
import tempfile
import unittest
import zipfile
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


NODE = ".vue-flow__node"
EDGE = ".vue-flow__edge"
BADGE = ".suggested-edge__badge"
APP_MOUNT_TIMEOUT = 60000

TOY = os.path.join(RESOURCE_PATH, "annotations", "toy")
TOY_MATHS = ["pool.cellml", "porter.cellml", "wall.cellml", "toy-units.cellml"]
TOY_SIDECARS = ["pool.ttl", "porter.ttl", "wall.ttl"]
TOY_APICOORDS = "toy-apicoords.ttl"
# The toy's reservoirs: the outside pool and the vessel.
TOY_HELD = ["outside", "vessel"]
TOY_INSTANCES = ["cell", "outside", "porter_in", "porter_out", "vessel", "wall"]
# With the reservoirs held: six connections, the vessel's (the coalesced-lyph fallback) low confidence.
TOY_EDGES = {
    "outside -> porter_in": 1,
    "porter_in -> cell": 3,
    "porter_in -> wall": 2,
    "cell -> porter_out": 3,
    "wall -> porter_out": 2,
    "porter_out -> vessel": 1,
}

PRIVATE = os.environ.get(
    "PHLYNX_ANNOTATIONS_PRIVATE",
    os.path.abspath(os.path.join(RESOURCE_PATH, "..", "vitest", "fixtures", "annotations", "private")),
)
PRIVATE_EXPECTED = os.path.join(PRIVATE, "expected.json")


# The toy pool's sidecar with only its kind, so the Annotations tab starts with no variable annotated.
POOL_KIND_ONLY = """@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix sbo: <http://purl.obolibrary.org/obo/SBO_> .
@prefix m: <./pool.cellml#> .

m:pool bqbiol:is sbo:0000290 .
"""

OLS_ROUTE = "https://www.ebi.ac.uk/ols4/api/**"
UNIPROT_ROUTE = "https://rest.uniprot.org/**"
# The ChEBI terms the mocked OLS knows.
OLS_TERMS = [
    {"iri": "http://purl.obolibrary.org/obo/CHEBI_26708", "obo_id": "CHEBI:26708", "label": "sodium atom",
     "synonym": ["Na"], "is_obsolete": False},
    {"iri": "http://purl.obolibrary.org/obo/CHEBI_29101", "obo_id": "CHEBI:29101", "label": "sodium(1+)",
     "synonym": ["Na+"], "is_obsolete": False},
]


def private_files(*parts):
    return sorted(glob.glob(os.path.join(PRIVATE, *parts)))

# Downloads go to the browser's save, not the File System Access picker, which Playwright can't answer.
USE_DOWNLOADS = "delete window.showSaveFilePicker"

# The main canvas's nodes and edges, by instance name.
READ_FLOW = """() => {
    let c = document.querySelector('.vue-flow').__vueParentComponent
    while (c && !c.exposed?.edges) c = c.parent
    const { nodes, edges } = c.exposed
    const name = (id) => nodes.value.find((n) => n.id === id)?.data.name
    return {
        nodes: nodes.value.map((n) => ({
            name: n.data.name,
            apiCoord: n.data.apiCoord?.name ?? null,
            held: !!n.data.annotationOverlay?.heldConstant,
        })),
        edges: edges.value.map((e) => ({
            source: name(e.source),
            target: name(e.target),
            couplings: (e.data?.couplings ?? []).map((c) => ({
                source: c.sourcePort.variables?.[0],
                target: c.targetPort.variables?.[0],
                annotated: !!(c.sourcePort.annotation && c.targetPort.annotation),
            })),
        })),
    }
}"""


def toy(name):
    return os.path.join(TOY, name)


def file_payload(path):
    with open(path, "rb") as f:
        return {"name": os.path.basename(path), "mimeType": "text/plain", "buffer": f.read()}


def node_named(page, name):
    """The instance node with exactly this name."""
    return page.locator(NODE).filter(has=page.get_by_role("button", name=f"Rename {name}", exact=True))


def kind_only_pool_sidecars():
    """The toy's sidecars as file payloads, with the pool's annotating only its kind."""
    pool = {"name": "pool.ttl", "mimeType": "text/plain", "buffer": POOL_KIND_ONLY.encode()}
    return [pool] + [file_payload(toy(name)) for name in ["porter.ttl", "wall.ttl"]]


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


def edge_counts(flow):
    return {f"{e['source']} -> {e['target']}": len(e["couplings"]) for e in flow["edges"]}


def coupling_tuples(flow):
    return sorted(
        f"{e['source']}.{c['source']} -> {e['target']}.{c['target']}" for e in flow["edges"] for c in e["couplings"]
    )


def bindings(flow):
    return sorted((n["name"], n["apiCoord"], n["held"]) for n in flow["nodes"])


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


def apply_annotations(page, maths, sidecars, apicoords, held):
    """Import the maths, then Import > Annotations, tick the reservoirs and Apply."""
    import_files(page, "CellML File", maths)
    import_files(page, "Annotations", sidecars, apicoords)
    dialog = page.get_by_role("dialog", name="Apply Annotations")
    expect(dialog.locator("[data-test=instances]")).to_be_visible()
    for name in held:
        dialog.get_by_label(f"Hold {name} constant").check()
    dialog.locator("[data-test=apply]").click()
    expect(dialog).to_be_hidden()


def export_omex(page, path):
    open_menu(page, 1, "OpenCOR")
    dialog = page.locator(".p-dialog").filter(has=page.locator(".p-dialog-footer button", has_text="Save"))
    expect(dialog).to_be_visible()
    with page.expect_download(timeout=30000) as download:
        dialog.locator(".p-dialog-footer button").filter(has_text=re.compile(r"^Save$")).click()
    download.value.save_as(path)
    return path


class TestAnnotationCoupling(unittest.TestCase):

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        self.context.add_init_script(USE_DOWNLOADS)
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    def flow(self, page=None):
        return (page or self.page).evaluate(READ_FLOW)

    def apply_toy(self):
        page = self.page
        open_app(page)
        apply_annotations(
            page,
            [toy(name) for name in TOY_MATHS],
            [toy(name) for name in TOY_SIDECARS],
            toy(TOY_APICOORDS),
            TOY_HELD,
        )
        # Instances are named after the ApiCoord subjects.
        expect(page.locator(NODE)).to_have_count(len(TOY_INSTANCES))
        self.assertEqual(sorted(n["name"] for n in self.flow()["nodes"]), TOY_INSTANCES)

    def accept_all(self, edges):
        page = self.page
        page.locator("[data-test=accept-all]").click()
        expect(page.locator(EDGE)).to_have_count(edges)
        expect(page.locator(BADGE)).to_have_count(0)

    def test_suggests_accepts_and_undo_brings_the_suggestions_back(self):
        page = self.page
        self.apply_toy()

        # Every edge is suggested, not made; the vessel's comes from the coalesced-lyph fallback.
        expect(page.locator(BADGE)).to_have_count(len(TOY_EDGES))
        count = page.locator(".suggestion-panel [data-test=count]")
        expect(count).to_contain_text(f"{len(TOY_EDGES)} suggested connections")
        expect(count).to_contain_text("(1 low confidence)")
        expect(page.locator(f"{BADGE}.suggested-edge__badge--low")).to_have_count(1)
        expect(page.locator(EDGE)).to_have_count(0)
        self.assertEqual(
            sorted((n["name"], n["held"]) for n in self.flow()["nodes"]),
            sorted((name, name in TOY_HELD) for name in TOY_INSTANCES),
        )

        self.accept_all(len(TOY_EDGES))
        flow = self.flow()
        self.assertEqual(edge_counts(flow), TOY_EDGES)
        self.assertTrue(all(c["annotated"] for e in flow["edges"] for c in e["couplings"]))
        self.assertIn("porter_out.c_A_o -> vessel.c_A", coupling_tuples(flow))
        self.assertIn("porter_in.j_A -> wall.i_tot", coupling_tuples(flow))

        # Accept all is one step: undo removes every edge and the suggestions come back.
        expect(page.locator("button:has(.pi-undo)")).to_be_enabled()
        page.locator(".vue-flow__pane").click(position={"x": 1500, "y": 120})
        page.keyboard.press("ControlOrMeta+z")
        expect(page.locator(EDGE)).to_have_count(0)
        expect(page.locator(BADGE)).to_have_count(len(TOY_EDGES))

    def test_ports_show_chips_and_bindings_survive_an_omex_round_trip(self):
        page = self.page
        self.apply_toy()
        self.accept_all(len(TOY_EDGES))
        before = self.flow()

        # The Ports tab shows an annotated port's meaning as chips, with no label to edit.
        page.locator(NODE).filter(has_text="porter_in").first.dblclick()
        editor = page.locator(".module-editor-dialog")
        ports_tab = editor.get_by_role("tab", name=re.compile(r"Ports \("))
        expect(ports_tab).to_be_visible(timeout=30000)
        ports_tab.click()
        expect(editor.locator(".annotation-chips").first).to_be_visible()
        expect(editor.get_by_placeholder("Enter label")).to_have_count(0)
        editor.get_by_role("button", name="Cancel").click()
        expect(editor).to_be_hidden()

        # The archive carries the sidecars, the instance file as imported and the combined annotations.
        archive = os.path.join(self.enterContext(tempfile.TemporaryDirectory()), "toy.omex")
        export_omex(page, archive)
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            with open(toy(TOY_APICOORDS), "rb") as f:
                self.assertEqual(bundle.read(TOY_APICOORDS), f.read())
            contents = [bundle.read(name) for name in names]
            for sidecar in TOY_SIDECARS:
                with open(toy(sidecar), "rb") as f:
                    self.assertIn(f.read(), contents, f"{sidecar} is not in the archive")
            self.assertIn("annotations.ttl", names)
            combined = bundle.read("annotations.ttl").decode()
            cellml = bundle.read("model.cellml").decode()
        for name in TOY_INSTANCES:
            self.assertIn(f'id="{name}"', cellml)
            self.assertIn(f"model:{name} ", combined)

        # A fresh page imports it with the same instances, bindings, reservoirs and couplings.
        page2 = self.context.new_page()
        open_app(page2)
        import_files(page2, "COMBINE Archive", archive)
        expect(page2.locator(NODE)).to_have_count(len(TOY_INSTANCES), timeout=30000)
        expect(page2.locator(EDGE)).to_have_count(len(TOY_EDGES))
        after = self.flow(page2)
        self.assertEqual(bindings(after), bindings(before))
        self.assertEqual(coupling_tuples(after), coupling_tuples(before))
        # Everything is already connected, so nothing is suggested.
        expect(page2.locator(BADGE)).to_have_count(0)


class TestAnnotationsTab(unittest.TestCase):
    """The instance editor's Annotations tab, on the toy pool with only its kind annotated."""

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

    def open_editor(self, name):
        page = self.page
        node_named(page, name).dblclick()
        editor = page.locator(".module-editor-dialog")
        expect(editor.get_by_role("tab", name=re.compile(r"Ports \(")).first).to_be_visible(timeout=30000)
        return editor

    def test_annotates_c_a_by_hand_and_its_port_couples_with_the_porter(self):
        page = self.page
        open_app(page)
        apply_annotations(page, [toy(name) for name in TOY_MATHS], kind_only_pool_sidecars(), toy(TOY_APICOORDS), TOY_HELD)
        expect(page.locator(NODE)).to_have_count(len(TOY_INSTANCES))
        # The pool has no annotated variables yet, so only the wall couples with the porters.
        expect(page.locator(BADGE)).to_have_count(2)

        editor = self.open_editor("cell")
        tab = editor.get_by_role("tab", name=re.compile(r"Annotations \("))
        expect(tab).to_have_text(re.compile(r"Annotations \(0/1\)"))
        tab.click()
        expect(editor.locator("[data-test=shared-banner]")).to_contain_text("Shared by 3 instances")

        row = editor.locator(".annotation-row[data-variable=c_A]")
        row.locator("[data-test=annotate]").click()
        form = row.locator("[data-test=annotation-editor]")

        row.locator("[data-test=property]").click()
        page.get_by_role("option", name=re.compile(r"OPB:00340")).click()

        # Species lookups beyond the local table go to OLS: sodium atom comes only from the mocked search.
        species = row.locator("[data-test=species] input")
        species.fill("sodium")
        options = page.locator(".p-autocomplete-option")
        expect(options.filter(has_text="CHEBI:26708")).to_be_visible(timeout=10000)
        self.assertTrue(any("/select?" in url and "ontology=chebi" in url for url in self.ols_requests))
        options.filter(has_text="CHEBI:29101").first.click()

        row.locator("[data-test=location]").get_by_text("This compartment", exact=True).click()
        expect(form.locator("[data-test=derived]")).to_contain_text("port will be created")
        form.locator("[data-test=done]").click()
        expect(form).to_have_count(0)

        expect(row.locator(".annotation-chips")).to_be_visible()
        expect(tab).to_have_text(re.compile(r"Annotations \(1/1\)"))
        editor.get_by_role("button", name="Save", exact=True).click()
        expect(editor).to_be_hidden()

        # The saved annotation gives the pool a port, shown as chips in the Ports tab.
        editor = self.open_editor("cell")
        editor.get_by_role("tab", name=re.compile(r"Ports \(")).click()
        expect(editor.locator(".annotation-chips").first).to_be_visible()
        editor.get_by_role("button", name="Cancel").click()
        expect(editor).to_be_hidden()

        # Every pool instance shares the port, so the porters now couple with the cell, the outside and the vessel.
        expect(page.locator(BADGE)).to_have_count(len(TOY_EDGES))
        page.locator("[data-test=accept-all]").click()
        expect(page.locator(BADGE)).to_have_count(0)
        couplings = coupling_tuples(page.evaluate(READ_FLOW))
        self.assertIn("porter_in.c_A_i -> cell.c_A", couplings)
        self.assertIn("outside.c_A -> porter_in.c_A_o", couplings)
        self.assertIn("porter_out.c_A_o -> vessel.c_A", couplings)


@unittest.skipUnless(os.path.exists(PRIVATE_EXPECTED), "private annotation fixtures not present")
class TestPrivateAnnotationCoupling(unittest.TestCase):
    """Regenerates the unpublished reference model from its maths, sidecars and instance file."""

    def setUp(self):
        with open(PRIVATE_EXPECTED) as f:
            self.expected = json.load(f)
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    def test_regenerates_the_expected_edges_and_couplings(self):
        page = self.page
        expected = self.expected
        maths = private_files("maths", "*.cellml")
        units = private_files("units", "*.cellml")
        sidecars = private_files("sidecars", "*.ttl")
        # The instance file is the one RDF file at the top of the folder.
        instance_files = private_files("*.ttl") + private_files("*.rdf")
        if not units:
            self.skipTest("the private maths' units files are not in units/")
        self.assertEqual(len(instance_files), 1, "expected one instance file in the private folder")
        held = [i["name"] for i in expected["instances"] if i.get("kind") in ("layer", "lyph")]

        open_app(page)
        apply_annotations(page, maths + units, sidecars, instance_files[0], held)
        expect(page.locator(NODE)).to_have_count(len(expected["instances"]))
        expect(page.locator(BADGE)).to_have_count(len(expected["edges"]), timeout=30000)
        expect(page.locator(".suggestion-panel [data-test=count]")).to_contain_text(
            f"({expected['lowConfidence']} low confidence)"
        )

        page.locator("[data-test=accept-all]").click()
        expect(page.locator(EDGE)).to_have_count(len(expected["edges"]))
        flow = page.evaluate(READ_FLOW)
        self.assertEqual(
            sorted(n["name"] for n in flow["nodes"]), sorted(i["name"] for i in expected["instances"])
        )
        want = sorted(
            f"{e['source']}.{sv} -> {e['target']}.{tv}" for e in expected["edges"] for sv, tv in e["couplings"]
        )
        self.assertEqual(coupling_tuples(flow), want)


if __name__ == "__main__":
    unittest.main()
