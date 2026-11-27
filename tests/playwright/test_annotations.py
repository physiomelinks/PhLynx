"""Annotation end-to-end tests, on the synthetic toy model in tests/resources/annotations/toy.

Toy modules dropped on an epithelial-cell template couple through their annotations once their side-cars are imported,
and a reservoir's summed flows can be held at 0. A module's variables are annotated by hand in the instance editor's
Annotations tab, with OLS mocked.
"""

import os
import re
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from .fixtures import use_default_timeouts, wait_for_library, wait_until_still
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from fixtures import use_default_timeouts, wait_for_library, wait_until_still


NODE = ".vue-flow__node"
APP_MOUNT_TIMEOUT = 60000

TOY = os.path.join(RESOURCE_PATH, "annotations", "toy")
POOL_FILES = ["pool.cellml", "toy-units.cellml"]
TOY_MATHS = ["pool.cellml", "porter.cellml", "toy-units.cellml"]

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

# The main canvas's nodes and edges, by instance name, whichever view is shown.
READ_FLOW = """() => {
    let c = [...document.querySelectorAll('.vue-flow')].find((el) => !el.closest('.bio-flow')).__vueParentComponent
    while (c && !c.exposed?.edges) c = c.parent
    const { nodes, edges } = c.exposed
    const name = (id) => nodes.value.find((n) => n.id === id)?.data.name
    return {
        nodes: nodes.value.map((n) => ({
            id: n.id,
            name: n.data.name,
            site: n.data.bioView?.site ?? null,
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

OLS_ROUTE = "https://www.ebi.ac.uk/ols4/api/**"
UNIPROT_ROUTE = "https://rest.uniprot.org/**"
# The ChEBI terms the mocked OLS knows.
OLS_TERMS = [
    {"iri": "http://purl.obolibrary.org/obo/CHEBI_26708", "obo_id": "CHEBI:26708", "label": "sodium atom",
     "synonym": ["Na"], "is_obsolete": False},
    {"iri": "http://purl.obolibrary.org/obo/CHEBI_29101", "obo_id": "CHEBI:29101", "label": "sodium(1+)",
     "synonym": ["Na+"], "is_obsolete": False},
    {"iri": "http://purl.obolibrary.org/obo/GO_0001750", "obo_id": "GO:0001750", "label": "photoreceptor outer segment",
     "synonym": [], "is_obsolete": False, "annotation": {"has_obo_namespace": ["cellular_component"]}},
    {"iri": "http://purl.obolibrary.org/obo/GO_0001917", "obo_id": "GO:0001917", "label": "photoreceptor inner segment",
     "synonym": [], "is_obsolete": False, "annotation": {"has_obo_namespace": ["cellular_component"]}},
]


def toy(name):
    return os.path.join(TOY, name)


# The toy instance each epithelial-cell site holds in the coupling test.
TOY_SITES = {"apical-fluid": "outside", "basolateral-fluid": "vessel", "cell.apical": "porter_in", "cell.basolateral": "porter_out"}


def toy_names(flow):
    """Node name -> the toy instance its site makes it."""
    return {n["name"]: TOY_SITES.get((n["site"] or "").split("/", 1)[-1]) for n in flow["nodes"]}


def coupling_pairs(flow):
    """Each edge's couplings as 'a.x - b.y' by toy instance, the two ends in name order, whichever way it runs."""
    names = toy_names(flow)
    pairs = []
    for e in flow["edges"]:
        for c in e["couplings"]:
            ends = sorted([f"{names[e['source']]}.{c['source']}", f"{names[e['target']]}.{c['target']}"])
            pairs.append(" - ".join(ends))
    return sorted(pairs)


# Gives the app a finished run of eleven points, t = 0..10 s, in which every given node's v_A_i goes 1, 0.8 ... -1.
RUN_WITH_FALLING_FLOWS = """(ids) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationResults')
    const t = Float64Array.from({ length: 11 }, (_, i) => i)
    const variables = new Map()
    const mapping = new Map()
    for (const id of ids) {
        variables.set(`${id}/v_A_i`, { kind: 'algebraic', unit: 'mol/s', values: t.map((x) => (5 - x) / 5) })
        mapping.set(`${id}::v_A_i`, `${id}/v_A_i`)
    }
    store.mapping = mapping
    store.results = { voi: { name: 't', unit: 's', values: t }, variables }
}"""


# Gives the app a finished run of eleven points, t = 0..10 s, in which the nth given node's c_A goes from n to 10 n mM.
RUN_WITH_RISING_CONCENTRATIONS = """(ids) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationResults')
    const t = Float64Array.from({ length: 11 }, (_, i) => i)
    const variables = new Map()
    const mapping = new Map()
    ids.forEach((id, n) => {
        variables.set(`${id}/c_A`, { kind: 'state', unit: 'mM', values: t.map((x) => (n + 1) * (1 + 0.9 * x)) })
        mapping.set(`${id}::c_A`, `${id}/c_A`)
    })
    store.mapping = mapping
    store.results = { voi: { name: 't', unit: 's', values: t }, variables }
}"""

def piece(page, path):
    """An empty piece of the placed template, by its path in the template ('cell', 'apical-fluid', ...)."""
    return page.locator(f'{BIO_NODE}[data-id^="tpl:"][data-id$="/{path}"]')


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
    # The menu fills once the app has mounted.
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
    # Drops and the library's cards wait for the built-in library.
    wait_for_library(page)


def place(page, name, x=700, y=450):
    """Drags the named library module onto the canvas."""
    card = page.locator(".mlc__card--draggable").filter(has_text=name).first
    if not card.is_visible():
        page.locator(".mlc__group-header").filter(has_text=re.compile(re.escape(name), re.IGNORECASE)).first.click()
    card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": x, "y": y})
    expect(page.locator(NODE)).to_have_count(1)


def pool_with_glucose():
    """The pool's side-car with glucose too, uncoupled: its area stands in for its concentration. Gives its path."""
    with open(toy("pool.ttl")) as source:
        pool = source.read().replace(
            "m:v1l1fufqx bqbiol:isVersionOf opb:00295 ;\n    bqbiol:isPropertyOf local:membrane .",
            "m:v1l1fufqx bqbiol:isVersionOf opb:00340 ;\n    bqbiol:isPropertyOf local:Glc_self .\n"
            "local:Glc_self bqbiol:is chebi:17634 ;\n    bqbiol:isPartOf local:entity_self .",
        )
    assert "Glc_self" in pool
    folder = tempfile.mkdtemp()
    path = os.path.join(folder, "pool.ttl")
    with open(path, "w") as target:
        target.write(pool)
    return path


# A main-canvas node's stored species order, whichever view is shown.
READ_SPECIES_ORDER = """(id) => {
    let c = [...document.querySelectorAll('.vue-flow')].find((el) => !el.closest('.bio-flow')).__vueParentComponent
    while (c && !c.exposed?.edges) c = c.parent
    return c.exposed.nodes.value.find((n) => n.id === id)?.data.bioView?.speciesOrder ?? null
}"""


# The ends of a species' paths' legs on screen, those nearest the given compartment's token first.
LEG_ENDS_JS = """([species, nodeId]) => {
    const token = document.querySelector(`[data-testid=bio-species-token][data-node="${nodeId}"][data-species="${species}"]`)
    const box = token.getBoundingClientRect()
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const ends = []
    for (const leg of document.querySelectorAll(`[data-testid=bio-species-path][data-species="${species}"] > path.bio-species-leg`)) {
        const matrix = leg.getScreenCTM()
        for (const at of [0, leg.getTotalLength()]) {
            const point = leg.getPointAtLength(at).matrixTransform(matrix)
            ends.push({ x: point.x, y: point.y })
        }
    }
    const away = (point) => Math.hypot(point.x - centre.x, point.y - centre.y)
    return ends.sort((a, b) => away(a) - away(b))
}"""


class TestAnnotationsTab(unittest.TestCase):
    """The instance editor's Annotations tab, on the toy pool."""

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        use_default_timeouts(self.context)
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


class TestAnnotationCoupling(unittest.TestCase):
    """Toy modules placed on an epithelial cell couple by their annotations, and a reservoir can be held at 0."""

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        use_default_timeouts(self.context)
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    def flow(self):
        return self.page.evaluate(READ_FLOW)

    def open_physiology_with_template(self):
        """Import the toy maths, switch to the physiological view and place an epithelial cell."""
        page = self.page
        open_app(page)
        import_files(page, "CellML File", [toy(name) for name in TOY_MATHS])
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()
        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text("Epithelial cell", exact=True).click()
        expect(page.locator("[data-testid=bio-template-title]")).to_have_count(1)
        page.keyboard.press("Escape")
        expect(page.locator(".p-contextmenu")).to_be_hidden()
        page.locator(f"{BIO} .vue-flow__controls-zoomout").click()

    def drop_module(self, name, point):
        """Drag the named library module onto a screen point of the physiological view."""
        page = self.page
        card = page.locator(LIBRARY_CARD).filter(has_text=f"{name}:default").first
        if not card.is_visible():
            page.locator(".mlc__group-header").filter(has_text=re.compile(re.escape(name), re.IGNORECASE)).first.click()
        expect(card).to_be_visible()
        transfer = page.evaluate_handle("() => new DataTransfer()")
        card.dispatch_event("dragstart", {"dataTransfer": transfer})
        page.evaluate(DRAG_OVER_AND_DROP_JS, [point[0], point[1], transfer])
        card.dispatch_event("dragend", {"dataTransfer": transfer})

    def open_editor(self, toy_name):
        """Open the editor of the instance standing for a toy instance from the physiological view."""
        page = self.page
        flow = self.flow()
        names = toy_names(flow)
        node_id = next(n["id"] for n in flow["nodes"] if names[n["name"]] == toy_name)
        page.locator(f'{BIO_NODE}[data-id="{node_id}"]').dispatch_event("dblclick")
        editor = page.locator(".module-editor-dialog")
        expect(editor.get_by_role("tab", name=re.compile(r"Ports \(")).first).to_be_visible(timeout=30000)
        editor.get_by_role("tab", name=re.compile(r"Annotations \(")).click()
        return editor

    def save_editor(self, editor, removes_couplings=False):
        page = self.page
        editor.get_by_role("button", name="Save", exact=True).click()
        if removes_couplings:
            confirm = page.locator(".p-confirmdialog").filter(has_text="Remove Couplings?")
            expect(confirm).to_be_visible()
            confirm.get_by_role("button", name="Save", exact=True).click()
        expect(editor).to_be_hidden(timeout=30000)

    def import_sidecar(self, name, sidecar):
        """Import a module's side-car through one of its instances' Annotations tab, and save it."""
        editor = self.open_editor(name)
        editor.locator("[data-test=import-file]").set_input_files(toy(sidecar))
        confirm = self.page.locator(".p-confirmdialog").filter(has_text="Import annotations")
        expect(confirm).to_be_visible()
        confirm.get_by_role("button", name="Import", exact=True).click()
        expect(editor.get_by_role("tab", name=re.compile(r"Annotations \("))).not_to_have_text(re.compile(r"\(0/"))
        self.save_editor(editor)

    def place_toys(self):
        """Drop the pools in the apical and basolateral fluids, and the porters on the apical and basolateral facets."""
        page = self.page
        cell = piece(page, "cell").bounding_box()
        lumen = piece(page, "apical-fluid").bounding_box()
        interstitium = piece(page, "basolateral-fluid").bounding_box()
        drops = [
            ("pool", (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3)),
            ("pool", (interstitium["x"] + 20, interstitium["y"] + interstitium["height"] * 2 / 3)),
            ("porter", (cell["x"] + cell["width"] / 2, cell["y"])),
            ("porter", (cell["x"] + cell["width"] / 2, cell["y"] + cell["height"])),
        ]
        for count, (module, point) in enumerate(drops, start=1):
            self.drop_module(module, point)
            expect(page.locator(f'{BIO_NODE}:not([data-id^="tpl:"])')).to_have_count(count)

    def test_imports_module_side_cars_from_the_menu_and_shows_species_mode(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        self.assertEqual(coupling_pairs(self.flow()), [])

        # Each side-car goes to the library module its subject names, and the placed instances couple at once.
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("porter.ttl")])
        self.assertEqual(
            coupling_pairs(self.flow()),
            [
                "outside.c_A - porter_in.c_A_o",
                "outside.v_A - porter_in.v_A_o",
                "porter_out.c_A_o - vessel.c_A",
                "porter_out.v_A_o - vessel.v_A",
            ],
        )

        # Species mode is offered without leaving the view.
        page.mouse.click(450, 200, button="right")
        expect(page.locator(".p-contextmenu").get_by_text("Species Mode", exact=True)).to_be_visible()

    def show_species(self, scope, at=(450, 200)):
        """Turn species mode on from the pane menu, showing the coupled species, those with fluxes, or every one."""
        page = self.page
        page.mouse.click(*at, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Species Mode", exact=True).hover()
        menu.get_by_text(scope, exact=True).click()
        expect(menu).to_be_hidden()

    def test_focusing_a_species_sets_the_others_back(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        # The pools also hold glucose, uncoupled.
        import_files(page, "Module Annotations", [pool_with_glucose(), toy("porter.ttl")])
        self.show_species("All Annotated Species")

        tokens = page.locator("[data-testid=bio-species-token]")
        sodium = tokens.and_(page.locator('[data-species="CHEBI:29101"]'))
        glucose = tokens.and_(page.locator('[data-species="CHEBI:17634"]'))
        expect(sodium).to_have_count(2)
        expect(glucose).to_have_count(2)
        dimmed = page.locator(".bio-species--dimmed")
        expect(dimmed).to_have_count(0)

        # Focusing the lumen's sodium sets glucose back everywhere, but not sodium elsewhere.
        sodium.first.click()
        expect(page.locator(".bio-species-token--focused")).to_have_count(1)
        expect(glucose.and_(dimmed)).to_have_count(2)
        expect(sodium.and_(dimmed)).to_have_count(0)

        # Clearing the focus brings everything back. Clicked through the pane's locator, which waits until nothing
        # (a notification, say) covers the spot.
        pane = page.locator(f"{BIO} .vue-flow__pane")
        pane.click(position={"x": pane.bounding_box()["width"] - 80, "y": 80})
        expect(page.locator(".bio-species-token--focused")).to_have_count(0)
        expect(dimmed).to_have_count(0)

    def test_a_held_reservoir_shows_as_a_dependence_of_its_protein(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("porter.ttl")])
        self.show_species("Coupled Species")
        expect(page.locator("[data-testid=bio-species-token]")).to_have_count(2)
        dependences = page.locator("[data-testid=bio-species-dependence]")
        # Amount and flow are coupled both sides: what the porters carry, not what they depend on.
        expect(dependences).to_have_count(0)

        # Held, the lumen's sodium is only read by the porter facing it.
        editor = self.open_editor("outside")
        editor.locator("[data-test=hold-constant-checkbox]").click()
        self.save_editor(editor, removes_couplings=True)
        ids = {toy_names(self.flow())[n["name"]]: n["id"] for n in self.flow()["nodes"]}
        expect(dependences).to_have_count(1)
        expect(dependences).to_have_attribute("data-node", ids["outside"])
        expect(dependences).to_have_attribute("data-protein", ids["porter_in"])
        expect(dependences.locator("circle")).to_have_count(1)

        # Focusing its species firms it up.
        page.locator(f'[data-testid=bio-species-token][data-node="{ids["outside"]}"]').click()
        expect(dependences).to_have_class(re.compile(r"bio-species-dependence--focused"))
        expect(dependences).not_to_have_class(re.compile(r"bio-species--dimmed"))

    def place_cell_pool(self):
        """Drop a pool inside the cell, under its name, so the porters carry species between it and the fluids."""
        page = self.page
        hint = piece(page, "cell").get_by_text("Drop a module").bounding_box()
        count = page.locator(f'{BIO_NODE}:not([data-id^="tpl:"])').count()
        self.drop_module("pool", (hint["x"] + hint["width"] / 2, hint["y"] + hint["height"] / 2))
        expect(page.locator(f'{BIO_NODE}:not([data-id^="tpl:"])')).to_have_count(count + 1)

    def test_a_cardiomyocyte_couples_each_protein_to_the_spaces_either_side_of_it(self):
        page = self.page
        open_app(page)
        import_files(page, "CellML File", [toy(name) for name in TOY_MATHS])
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()
        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text("Cardiomyocyte", exact=True).click()
        expect(page.locator("[data-testid=bio-template-title]")).to_have_count(1)
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        fit = page.locator(f"{BIO} .vue-flow__controls-fitview")
        placed = page.locator(f'{BIO_NODE}:not([data-id^="tpl:"])')

        def drop(name, point):
            count = placed.count()
            self.drop_module(name, point)
            expect(placed).to_have_count(count + 1)
            fit.click()
            wait_until_still(page)

        def centre(box):
            return (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)

        def cells():
            """The cell nodes' boxes, smallest first: the SR, then the myocyte."""
            boxes = page.locator(f"{BIO} .vue-flow__node-bioCell").evaluate_all(
                "els => els.map(e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height} })"
            )
            return sorted(boxes, key=lambda box: box["width"])

        fit.click()
        wait_until_still(page)
        # A pool in each space: the cleft, the SR, the cytosol and outside the cell.
        drop("pool", centre(piece(page, "cleft").bounding_box()))
        drop("pool", centre(piece(page, "sr").bounding_box()))
        hint = piece(page, "myocyte").get_by_text("Drop a module").last.bounding_box()
        drop("pool", (hint["x"] + hint["width"] / 2, hint["y"] + 6))
        outside = piece(page, "extracellular").bounding_box()
        drop("pool", (outside["x"] + 40, outside["y"] + 40))
        # A porter on the T-tubule, and one on each side of the SR.
        fold = page.locator("[data-testid=bio-fold]").bounding_box()
        drop("porter", (fold["x"] + 2, fold["y"] + fold["height"] * 0.6))
        sr = cells()[0]
        drop("porter", (sr["x"] + sr["width"], sr["y"] + sr["height"] / 2))
        sr = cells()[0]
        drop("porter", (sr["x"] + sr["width"] / 2, sr["y"] + sr["height"]))
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("porter.ttl")])

        def couplings():
            flow = self.flow()
            site = {n["name"]: (n["site"] or "/").split("/", 1)[1] for n in flow["nodes"]}
            found = set()
            for edge in flow["edges"]:
                for c in edge["couplings"]:
                    found.add(" - ".join(sorted([f"{site[edge['source']]}:{c['source']}", f"{site[edge['target']]}:{c['target']}"])))
            return found

        expected = {
            # The T-tubule's porter: the space outside the cell beyond it, the cleft within, and its cell's membrane.
            "extracellular:c_A - myocyte.t-tubule:c_A_o",
            "cleft:c_A - myocyte.t-tubule:c_A_i",
            "myocyte.t-tubule:area - myocyte:area",
            # The junctional SR's: the cleft outside it, the SR's lumen within.
            "cleft:c_A - sr.junctional:c_A_o",
            "sr.junctional:c_A_i - sr:c_A",
            # The network SR's: the cytosol outside it.
            "myocyte:c_A - sr.network:c_A_o",
            "sr.network:c_A_i - sr:c_A",
        }
        self.assertTrue(expected <= couplings(), expected - couplings())

    def test_a_junction_couples_the_two_spaces_of_a_cell_it_lies_between(self):
        page = self.page
        open_app(page)
        import_files(page, "CellML File", [toy(name) for name in [*TOY_MATHS, "duct.cellml"]])
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()
        # A rod: an outer and an inner segment inside one cell, each with its own GO term, and a cilium between them.
        page.locator("[data-testid=library-tab-build]").click()
        with page.expect_file_chooser() as chooser:
            page.locator("[data-testid=bio-palette-load-template]").click()
        chooser.value.set_files(toy("rod.template.json"))
        expect(page.locator("[data-testid=bio-template-title]")).to_have_count(1)
        page.locator("[data-testid=library-tab-modules]").click()
        fit = page.locator(f"{BIO} .vue-flow__controls-fitview")
        placed = page.locator(f'{BIO_NODE}:not([data-id^="tpl:"])')

        def drop(name, box):
            count = placed.count()
            self.drop_module(name, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2))
            expect(placed).to_have_count(count + 1)
            fit.click()
            wait_until_still(page)

        fit.click()
        wait_until_still(page)
        drop("pool", piece(page, "outer-segment").bounding_box())
        drop("pool", piece(page, "inner-segment").bounding_box())
        drop("duct", page.locator("[data-testid=bio-process-zone]").bounding_box())
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("duct.ttl")])

        flow = self.flow()
        site = {n["name"]: (n["site"] or "/").split("/", 1)[1] for n in flow["nodes"]}
        found = set()
        for edge in flow["edges"]:
            for c in edge["couplings"]:
                found.add(" - ".join(sorted([f"{site[edge['source']]}:{c['source']}", f"{site[edge['target']]}:{c['target']}"])))
        # Each end of the duct finds its own segment by the segment's term, though both are cytoplasm.
        expected = {
            "outer-segment:c_A - rod.cilium:c_A_a",
            "inner-segment:c_A - rod.cilium:c_A_b",
            "outer-segment:v_A - rod.cilium:v_A_a",
            "inner-segment:v_A - rod.cilium:v_A_b",
        }
        self.assertTrue(expected <= found, (expected - found, found))

        # Species mode draws the flux from one segment to the other through the cilium.
        page.locator("[data-testid=bio-species-toggle]").click()
        expect(page.locator("[data-testid=bio-species-token]")).to_have_count(2)
        expect(page.locator(f'[data-testid=bio-species-path][data-protein]')).to_have_count(2)

    def test_the_species_menu_hides_a_species_with_its_paths_and_still_lists_it(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        self.place_cell_pool()
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("porter.ttl")])
        pane = page.locator(f"{BIO} .vue-flow__pane").bounding_box()
        spare = (pane["x"] + pane["width"] - 40, pane["y"] + pane["height"] / 2)
        self.show_species("Coupled Species", spare)
        tokens = page.locator("[data-testid=bio-species-token]")
        paths = page.locator("[data-testid=bio-species-path]")
        expect(tokens).to_have_count(3)
        expect(paths).to_have_count(2)

        page.locator("[data-testid=bio-species-menu-button]").click()
        menu = page.locator("[data-testid=bio-species-menu]")
        sodium = menu.locator("[data-testid=bio-species-menu-item]")
        expect(sodium).to_have_count(1)
        expect(sodium).to_have_text("Na⁺")
        expect(menu.locator("input[type=radio]:checked")).to_have_value("coupled")

        sodium.locator("input").uncheck()
        expect(tokens).to_have_count(0)
        expect(paths).to_have_count(0)
        expect(sodium).to_have_count(1)

        menu.get_by_role("button", name="All").click()
        expect(tokens).to_have_count(3)
        expect(paths).to_have_count(2)

        # The same choice of scope as the pane's menu.
        menu.get_by_label("Species with fluxes").check()
        expect(menu.locator("input[type=radio]:checked")).to_have_value("fluxes")

    def test_species_mode_joins_a_process_in_the_cell_to_the_species_it_exchanges(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        cell = piece(page, "cell").bounding_box()
        self.place_cell_pool()
        # A porter dropped in the cell's process area is a process, coupled to the cell's pool.
        self.drop_module("porter", (cell["x"] + cell["width"] * 0.3, cell["y"] + cell["height"] * 0.42))
        card = page.locator(f"{BIO} .vue-flow__node-bioCard")
        expect(card).to_have_count(1)
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("porter.ttl")])
        pane = page.locator(f"{BIO} .vue-flow__pane").bounding_box()
        self.show_species("Species with Fluxes", (pane["x"] + pane["width"] - 40, pane["y"] + pane["height"] / 2))

        # One leg between the process and the cell's Na⁺, beside the two proteins' paths of two legs each.
        paths = page.locator("[data-testid=bio-species-path]")
        expect(paths).to_have_count(3)
        exchange = paths.and_(page.locator(f'[data-protein="{card.get_attribute("data-id")}"]'))
        expect(exchange).to_have_count(1)
        expect(exchange.locator(".bio-species-leg")).to_have_count(1)

    def test_species_mode_scrubs_and_plays_a_run_s_flows(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        self.place_cell_pool()
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("porter.ttl")])
        pane = page.locator(f"{BIO} .vue-flow__pane").bounding_box()
        self.show_species("Coupled Species", (pane["x"] + pane["width"] - 40, pane["y"] + pane["height"] / 2))
        bar = page.locator("[data-testid=bio-species-playback]")
        expect(bar).to_have_count(0)

        # A run in which each porter's flow into the cell falls from 1 through nothing to -1.
        page.evaluate(RUN_WITH_FALLING_FLOWS, [n["id"] for n in self.flow()["nodes"]])
        expect(bar).to_be_visible()
        readout = page.locator("[data-testid=bio-species-voi]")
        expect(readout).to_have_text("t = 10 s")
        apical = page.locator("[data-testid=bio-species-path]").first
        expect(apical).to_have_attribute("data-direction", "out")

        scrubber = page.locator("[data-testid=bio-species-scrubber]")
        scrubber.fill("0")
        expect(readout).to_have_text("t = 0 s")
        expect(apical).to_have_attribute("data-direction", "in")
        scrubber.fill("5")
        expect(readout).to_have_text("t = 5 s")
        expect(apical).to_have_attribute("data-direction", "")

        # Played, the cursor moves on by itself; the way back shows the end of the run again.
        scrubber.fill("0")
        page.locator("[data-testid=bio-species-play]").click()
        expect(readout).not_to_have_text("t = 0 s")
        page.locator("[data-testid=bio-species-play]").click()
        page.locator("[data-testid=bio-species-playback-reset]").click()
        expect(readout).to_have_text("t = 10 s")

    def test_focusing_a_species_tints_its_compartments_by_its_concentration(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        self.place_cell_pool()
        import_files(page, "Module Annotations", [toy("pool.ttl"), toy("porter.ttl")])
        pane = page.locator(f"{BIO} .vue-flow__pane").bounding_box()
        self.show_species("Coupled Species", (pane["x"] + pane["width"] - 40, pane["y"] + pane["height"] / 2))
        page.evaluate(RUN_WITH_RISING_CONCENTRATIONS, [n["id"] for n in self.flow()["nodes"]])
        regions = page.locator("[data-testid=bio-region][data-tint]")
        cell_tint = page.locator("[data-testid=bio-concentration-tint]")
        expect(regions).to_have_count(0)
        # Each compartment's own colour, under any tint.
        bases = lambda: set(
            page.locator("[data-testid=bio-region]").evaluate_all(
                "(els) => els.map((el) => getComputedStyle(el).backgroundColor)"
            )
        )
        self.assertGreater(len(bases()), 1)

        # Every compartment holding the species is tinted, the one holding most fully, over one neutral colour.
        page.locator("[data-testid=bio-species-token]").first.click()
        expect(regions).to_have_count(2)
        expect(cell_tint).to_have_count(1)
        self.assertEqual(len(bases()), 1)
        tints = lambda: sorted(float(t) for t in regions.evaluate_all("(els) => els.map((el) => el.dataset.tint)"))
        before = tints()
        self.assertTrue(all(0 < t <= 1 for t in before), before)

        # Scrubbed back to the start, each holds a tenth as much, and is tinted a tenth as strongly.
        page.locator("[data-testid=bio-species-scrubber]").fill("0")
        expect(page.locator("[data-testid=bio-species-voi]")).to_have_text("t = 0 s")
        for now, then in zip(tints(), before):
            self.assertAlmostEqual(now, then / 10, places=3)

        # Clicking off the species clears the tint, once nothing covers the spot.
        page.locator(f"{BIO} .vue-flow__pane").click(position={"x": pane["width"] - 80, "y": 80})
        expect(page.locator(".bio-species-token--focused")).to_have_count(0)
        expect(regions).to_have_count(0)
        expect(cell_tint).to_have_count(0)
        self.assertGreater(len(bases()), 1)

    def test_species_with_fluxes_hides_tokens_with_no_path_but_keeps_the_focused_one(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        self.place_cell_pool()
        # The pools also hold glucose, uncoupled: tokens with no path.
        import_files(page, "Module Annotations", [pool_with_glucose(), toy("porter.ttl")])
        tokens = page.locator("[data-testid=bio-species-token]")
        glucose = tokens.and_(page.locator('[data-species="CHEBI:17634"]'))
        paths = page.locator("[data-testid=bio-species-path]")
        # The pane's right, clear of the template and the minimap.
        pane = page.locator(f"{BIO} .vue-flow__pane").bounding_box()
        spare = (pane["x"] + pane["width"] - 40, pane["y"] + pane["height"] / 2)
        self.show_species("Coupled Species", spare)
        expect(tokens).to_have_count(3)
        expect(paths).to_have_count(2)

        # Held, the lumen keeps its path: the porter facing it still carries sodium into it, its flow just not summed.
        editor = self.open_editor("outside")
        editor.locator("[data-test=hold-constant-checkbox]").click()
        self.save_editor(editor, removes_couplings=True)
        ids = {toy_names(self.flow())[n["name"]]: n["id"] for n in self.flow()["nodes"]}
        lumen = tokens.and_(page.locator(f'[data-node="{ids["outside"]}"]'))
        expect(paths).to_have_count(2)
        expect(page.locator("[data-testid=bio-species-dependence]")).to_have_count(0)
        expect(lumen).to_have_count(1)

        # Glucose has no path: shown with every annotated species, gone with only those with fluxes.
        self.show_species("All Annotated Species", spare)
        expect(glucose).to_have_count(3)
        self.show_species("Species with Fluxes", spare)
        expect(glucose).to_have_count(0)
        expect(lumen).to_have_count(1)
        expect(paths).to_have_count(2)

        # Focused, it stays: from All Annotated Species into Species with Fluxes, until the focus is cleared.
        self.show_species("All Annotated Species", spare)
        lumen_glucose = glucose.and_(page.locator(f'[data-node="{ids["outside"]}"]'))
        lumen_glucose.click()
        expect(page.locator(".bio-species-token--focused")).to_have_count(1)
        self.show_species("Species with Fluxes", spare)
        expect(glucose).to_have_count(1)
        expect(lumen_glucose).to_have_class(re.compile(r"bio-species-token--focused"))
        page.mouse.click(*spare)
        expect(glucose).to_have_count(0)

    def chip_order(self, node_id):
        """The species of a compartment's chips, left to right."""
        chips = self.page.locator(f'[data-testid=bio-species-token][data-node="{node_id}"]')
        found = [(chips.nth(i).bounding_box(), chips.nth(i).get_attribute("data-species")) for i in range(chips.count())]
        return [species for box, species in sorted(found, key=lambda entry: entry[0]["x"])]

    def drag_chip(self, chip, dx, dy=0):
        page = self.page
        box = chip.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(x + dx * step / 10, y + dy * step / 10)
        page.mouse.up()

    def test_dragging_a_species_chip_reorders_its_compartment_in_one_undo_step(self):
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        import_files(page, "Module Annotations", [pool_with_glucose(), toy("porter.ttl")])
        self.show_species("All Annotated Species")
        ids = {toy_names(self.flow())[n["name"]]: n["id"] for n in self.flow()["nodes"]}
        lumen = ids["outside"]
        chips = page.locator(f'[data-testid=bio-species-token][data-node="{lumen}"]')
        expect(chips).to_have_count(2)
        auto = self.chip_order(lumen)
        first = chips.and_(page.locator(f'[data-species="{auto[0]}"]'))
        second = chips.and_(page.locator(f'[data-species="{auto[1]}"]'))
        y = first.bounding_box()["y"]

        # Dragged past its neighbour, the first chip goes second, and the order is kept on the compartment.
        reach = second.bounding_box()["x"] + second.bounding_box()["width"] - first.bounding_box()["x"]
        self.drag_chip(first, reach)
        self.wait_for_order(lumen, auto[::-1])
        expect(page.locator(".bio-species-token--focused")).to_have_count(0)
        self.assertEqual(self.chip_order(lumen), auto[::-1])
        # It stays in its row: no transform is left behind.
        self.assertAlmostEqual(first.bounding_box()["y"], y, delta=1)
        self.assertIsNone(first.get_attribute("transform"))

        # Dragged down, out of its compartment, it stays in its row there, and nothing changes.
        self.drag_chip(first, 0, 300)
        self.assertEqual(self.chip_order(lumen), auto[::-1])
        self.assertAlmostEqual(first.bounding_box()["y"], y, delta=1)
        expect(chips).to_have_count(2)

        # One undo puts the automatic order back.
        page.locator("button:has(.pi-undo)").first.click()
        self.wait_for_order(lumen, None)
        self.assertEqual(self.chip_order(lumen), auto)

        # Reordered again, Reset Species Order on the compartment's menu restores the automatic order.
        self.drag_chip(first, reach)
        self.wait_for_order(lumen, auto[::-1])
        region = page.locator(f'{BIO_NODE}[data-id="{lumen}"]')
        region.click(button="right", position={"x": 12, "y": 12})
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Reset Species Order", exact=True).click()
        self.wait_for_order(lumen, None)
        self.assertEqual(self.chip_order(lumen), auto)

        # A click without a drag still focuses it.
        first.click()
        expect(page.locator(".bio-species-token--focused")).to_have_count(1)

    def species_with_glucose(self):
        """An epithelial cell with the toys placed, glucose in the pools, and every annotated species shown."""
        page = self.page
        self.open_physiology_with_template()
        self.place_toys()
        self.place_cell_pool()
        import_files(page, "Module Annotations", [pool_with_glucose(), toy("porter.ttl")])
        pane = page.locator(f"{BIO} .vue-flow__pane").bounding_box()
        self.show_species("All Annotated Species", (pane["x"] + pane["width"] - 40, pane["y"] + pane["height"] / 2))
        return {toy_names(self.flow())[n["name"]]: n["id"] for n in self.flow()["nodes"]}

    def centre(self, locator):
        box = locator.bounding_box()
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    def leg_ends(self, species, node_id):
        """The screen points a species' paths' legs end at, nearest the given compartment's token first."""
        return self.page.evaluate(LEG_ENDS_JS, [species, node_id])

    def test_species_move_with_a_template_while_it_is_dragged(self):
        page = self.page
        ids = self.species_with_glucose()
        lumen = ids["outside"]
        # Its token with a path through the porter, into the cell.
        species = page.locator("[data-testid=bio-species-path]").first.get_attribute("data-species")
        token = page.locator(f'[data-testid=bio-species-token][data-node="{lumen}"][data-species="{species}"]')
        expect(page.locator("[data-testid=bio-species-path]")).not_to_have_count(0)
        path = page.locator(f'[data-testid=bio-species-path][data-species="{species}"] > path.bio-species-leg').first
        token_at, path_at = self.centre(token), self.centre(path)

        # Partway through a drag of the template's name, the tokens and their paths have gone with it.
        title = page.locator("[data-testid=bio-template-title]")
        x, y = self.centre(title)
        dx, dy = 120, 60
        page.mouse.move(x, y)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(x + dx * step / 10, y + dy * step / 10)
        wait_until_still(page)
        # As far as the template's name went (the drag's threshold takes a little of the pointer's way).
        title_now = self.centre(title)
        dx, dy = title_now[0] - x, title_now[1] - y
        self.assertGreater(dx, 60)
        moved, path_moved = self.centre(token), self.centre(path)
        self.assertAlmostEqual(moved[0] - token_at[0], dx, delta=2)
        self.assertAlmostEqual(moved[1] - token_at[1], dy, delta=2)
        self.assertAlmostEqual(path_moved[0] - path_at[0], dx, delta=2)
        self.assertAlmostEqual(path_moved[1] - path_at[1], dy, delta=2)
        self.assertEqual(token.get_attribute("data-species"), species)

        # Let go, the layout takes over where the drag left them.
        page.mouse.up()
        wait_until_still(page)
        dropped = self.centre(token)
        self.assertAlmostEqual(dropped[0], moved[0], delta=4)
        self.assertAlmostEqual(dropped[1], moved[1], delta=4)
        self.assertIsNone(token.evaluate("(el) => el.style.transform || null"))

        # One undo puts the template, and its species, back.
        page.locator("button:has(.pi-undo)").first.click()
        wait_until_still(page)
        back = self.centre(token)
        self.assertAlmostEqual(back[0], token_at[0], delta=4)
        self.assertAlmostEqual(back[1], token_at[1], delta=4)

    def test_a_dragged_chip_takes_its_paths_and_the_others_make_room(self):
        page = self.page
        ids = self.species_with_glucose()
        lumen = ids["outside"]
        chips = page.locator(f'[data-testid=bio-species-token][data-node="{lumen}"]')
        expect(chips).to_have_count(2)
        auto = self.chip_order(lumen)
        # The chip with a path through the porter, and the other.
        with_path = next(s for s in auto if page.locator(f'[data-testid=bio-species-path][data-species="{s}"]').count())
        other = next(s for s in auto if s != with_path)
        moving = chips.and_(page.locator(f'[data-species="{with_path}"]'))
        neighbour = chips.and_(page.locator(f'[data-species="{other}"]'))
        neighbour_at = self.centre(neighbour)
        x, y = self.centre(moving)
        # Over the neighbour's far side, so the order would swap.
        reach = (neighbour_at[0] - x) + (1 if neighbour_at[0] > x else -1) * neighbour.bounding_box()["width"] * 0.6

        page.mouse.move(x, y)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(x + reach * step / 10, y)
        wait_until_still(page)
        # The chip's leg ends where the chip now is, and its neighbour has slid the other way.
        chip_now = self.centre(moving)
        self.assertAlmostEqual(chip_now[0], x + reach, delta=4)
        end = self.leg_ends(with_path, lumen)[0]
        self.assertLess(abs(end["x"] - chip_now[0]), moving.bounding_box()["width"] / 2 + 2)
        self.assertLess(abs(end["y"] - chip_now[1]), 60)
        shifted = self.centre(neighbour)[0] - neighbour_at[0]
        self.assertGreater(abs(shifted), 10)
        self.assertEqual(shifted > 0, reach < 0)
        # Nothing is kept yet.
        self.assertIsNone(page.evaluate(f"({READ_SPECIES_ORDER})('{lumen}')"))

        # Let go, the swapped order is kept, with the chips where the drag showed them.
        neighbour_shown = self.centre(neighbour)
        page.mouse.up()
        self.wait_for_order(lumen, auto[::-1])
        wait_until_still(page)
        self.assertEqual(self.chip_order(lumen), auto[::-1])
        self.assertAlmostEqual(self.centre(neighbour)[0], neighbour_shown[0], delta=4)
        self.assertIsNone(neighbour.evaluate("(el) => el.style.transform || null"))
        end = self.leg_ends(with_path, lumen)[0]
        self.assertLess(abs(end["x"] - self.centre(moving)[0]), moving.bounding_box()["width"] / 2 + 2)

        # One undo puts the automatic order back.
        page.locator("button:has(.pi-undo)").first.click()
        self.wait_for_order(lumen, None)
        self.assertEqual(self.chip_order(lumen), auto)

        # Escape partway through a drag puts everything back and keeps nothing.
        start = self.centre(neighbour)
        x, y = self.centre(moving)
        page.mouse.move(x, y)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(x + reach * step / 10, y)
        wait_until_still(page)
        page.keyboard.press("Escape")
        page.mouse.up()
        wait_until_still(page)
        self.assertAlmostEqual(self.centre(neighbour)[0], start[0], delta=1)
        self.assertAlmostEqual(self.centre(moving)[0], x, delta=1)
        self.assertIsNone(page.evaluate(f"({READ_SPECIES_ORDER})('{lumen}')"))
        expect(page.locator(".bio-species-token--focused")).to_have_count(0)

    def wait_for_order(self, node_id, order):
        """Wait until a compartment's stored species order is as given (None: none stored)."""
        self.page.wait_for_function(
            f"([id, want]) => JSON.stringify(({READ_SPECIES_ORDER})(id)) === JSON.stringify(want)",
            arg=[node_id, order],
        )

    def test_placed_modules_couple_by_their_annotations_and_a_held_reservoir_sums_nothing(self):
        page = self.page
        self.open_physiology_with_template()

        # The pools in the apical and basolateral fluids, the porters on the apical and basolateral facets.
        cell = piece(page, "cell").bounding_box()
        lumen = piece(page, "apical-fluid").bounding_box()
        interstitium = piece(page, "basolateral-fluid").bounding_box()
        drops = [
            ("pool", (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3)),
            ("pool", (interstitium["x"] + 20, interstitium["y"] + interstitium["height"] * 2 / 3)),
            ("porter", (cell["x"] + cell["width"] / 2, cell["y"])),
            ("porter", (cell["x"] + cell["width"] / 2, cell["y"] + cell["height"])),
        ]
        for count, (module, point) in enumerate(drops, start=1):
            self.drop_module(module, point)
            expect(page.locator(f'{BIO_NODE}:not([data-id^="tpl:"])')).to_have_count(count)
        flow = self.flow()
        self.assertEqual(sorted(toy_names(flow).values()), ["outside", "porter_in", "porter_out", "vessel"])
        # Each porter is joined to the fluid it faces; nothing couples them yet.
        self.assertEqual(len(flow["edges"]), 2)
        self.assertEqual(coupling_pairs(flow), [])

        # With the side-cars, the placed instances couple by property, species and place.
        self.import_sidecar("outside", "pool.ttl")
        # A side-car saved from the editor shows in the view at once: species mode is offered.
        page.mouse.click(450, 200, button="right")
        expect(page.locator(".p-contextmenu").get_by_text("Species Mode", exact=True)).to_be_visible()
        page.locator(".p-contextmenu").get_by_text("Species Mode", exact=True).hover()
        expect(page.locator(".p-contextmenu").get_by_text("Show Species", exact=True)).to_be_visible()
        page.locator(".p-contextmenu").get_by_text("Show Species", exact=True).click()
        expect(page.locator(".p-contextmenu")).to_be_hidden()
        self.import_sidecar("porter_in", "porter.ttl")
        flow = self.flow()
        self.assertEqual(
            coupling_pairs(flow),
            [
                "outside.c_A - porter_in.c_A_o",
                "outside.v_A - porter_in.v_A_o",
                "porter_out.c_A_o - vessel.c_A",
                "porter_out.v_A_o - vessel.v_A",
            ],
        )
        self.assertTrue(all(c["annotated"] for e in flow["edges"] for c in e["couplings"]))

        # Held at 0, the outside's summed flow no longer takes the porter's flux.
        editor = self.open_editor("outside")
        editor.locator("[data-test=hold-constant-checkbox]").click()
        self.save_editor(editor, removes_couplings=True)
        flow = self.flow()
        self.assertIn(("outside", True), [(toy_names(flow)[n["name"]], n["held"]) for n in flow["nodes"]])
        self.assertNotIn("outside.v_A - porter_in.v_A_o", coupling_pairs(flow))
        self.assertIn("outside.c_A - porter_in.c_A_o", coupling_pairs(flow))


def pick(page, testid, pattern):
    """Choose the first option matching a pattern in one of the placing dialog's dropdowns."""
    page.locator(f"[data-testid={testid}]").click()
    page.get_by_role("option").filter(has_text=re.compile(pattern)).first.click()


def edge_pairs(flow):
    """Each edge's two ends by name, in name order, with its couplings as 'a.x - b.y' in name order."""
    pairs = {}
    for e in flow["edges"]:
        ends = tuple(sorted([e["source"], e["target"]]))
        pairs[ends] = sorted(
            " - ".join(sorted([f"{e['source']}.{c['source']}", f"{e['target']}.{c['target']}"])) for c in e["couplings"]
        )
    return pairs


class TestAddedCellMembrane(unittest.TestCase):
    """A membrane and the proteins on a cell added by hand join up, whichever comes first."""

    setUp = TestAnnotationCoupling.setUp
    tearDown = TestAnnotationCoupling.tearDown
    flow = TestAnnotationCoupling.flow
    drop_module = TestAnnotationCoupling.drop_module

    def add_cell(self, sidecars, membrane):
        """Import the toys (and their side-cars), then add a pool cell, with the wall as its membrane if asked."""
        page = self.page
        open_app(page)
        import_files(page, "CellML File", [toy(name) for name in [*TOY_MATHS, "wall.cellml"]])
        if sidecars:
            import_files(page, "Module Annotations", [toy(name) for name in ["pool.ttl", "porter.ttl", "wall.ttl"]])
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()
        page.mouse.click(600, 400, button="right")
        page.locator(".p-contextmenu").get_by_text("Add Cell…").click()
        dialog = page.locator("[data-testid=bio-place-dialog]")
        expect(dialog).to_be_visible()
        pick(page, "bio-place-module", r"^pool")
        if membrane:
            pick(page, "bio-place-membrane", r"^wall")
        page.locator("[data-testid=bio-place-confirm]").click()
        expect(dialog).to_be_hidden()

    def drop_porters(self):
        """Drop a porter on the cell's top facet and one on its bottom facet."""
        page = self.page
        cell = page.locator(f"{BIO} .vue-flow__node-bioCell").first.bounding_box()
        middle = cell["x"] + cell["width"] / 2
        for count, y in enumerate([cell["y"], cell["y"] + cell["height"]], start=1):
            self.drop_module("porter", (middle, y))
            expect(page.locator(f"{BIO} .vue-flow__node-bioProtein")).to_have_count(count)

    def wait_for_edges(self, count):
        self.page.wait_for_function(f"() => ({READ_FLOW})().edges.length === {count}", timeout=10000)
        return edge_pairs(self.flow())

    def test_membrane_first_then_proteins_join_it(self):
        self.add_cell(sidecars=False, membrane=True)
        self.drop_porters()
        # The toys have no ports without their side-cars: joined, not coupled.
        self.assertEqual(
            self.wait_for_edges(5),
            {
                ("pool", "wall"): [],
                ("pool", "porter"): [],
                ("porter", "wall"): [],
                ("pool", "porter_1"): [],
                ("porter_1", "wall"): [],
            }
        )

    def test_proteins_first_then_membrane_joins_them_in_one_step(self):
        page = self.page
        self.add_cell(sidecars=True, membrane=False)
        self.drop_porters()
        self.drop_module("wall", (1400, 850))
        dialog = page.locator("[data-testid=bio-place-dialog]")
        expect(dialog).to_be_visible()
        pick(page, "bio-place-role", r"^A cell.s membrane")
        pick(page, "bio-place-cell", r"^pool")
        page.locator("[data-testid=bio-place-confirm]").click()
        expect(dialog).to_be_hidden()
        pairs = self.wait_for_edges(5)
        # Coupled through the side-cars' annotations.
        self.assertEqual(pairs[("porter", "wall")], ["porter.j_A - wall.i_tot", "porter.u - wall.u"])
        self.assertEqual(pairs[("porter_1", "wall")], ["porter_1.j_A - wall.i_tot", "porter_1.u - wall.u"])
        # Joined but not coupled: the pool's concentration, flux, volume and membrane area, and the wall's potential
        # and charge flow, share no quantity.
        self.assertEqual(pairs[("pool", "wall")], [])

        # Adding the membrane and joining it is one step.
        button = page.locator("button:has(.pi-undo)").first
        expect(button).to_be_enabled()
        button.click()
        self.assertEqual(set(self.wait_for_edges(2)), {("pool", "porter"), ("pool", "porter_1")})
        self.assertNotIn("wall", [n["name"] for n in self.flow()["nodes"]])


if __name__ == "__main__":
    unittest.main()
