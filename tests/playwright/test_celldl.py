import json
import math
import os
import re
import unittest

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from .test_simulator import IS_DEV_SERVER
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from test_simulator import IS_DEV_SERVER


# Automated browsers skip the isolation service worker unless they opt in (see index.html).
OPT_IN_TO_ISOLATION = "localStorage.setItem('phlynx.isolateUnderAutomation', 'true')"
APP_MOUNT_TIMEOUT = 60000
DIAGRAM_TIMEOUT = 90000
SIMULATION_TIMEOUT = 120000

# An RC circuit's discharge drawn in the CellDL editor: a 0-junction (ID-00000001) bonded to a capacitor
# (ID-00000002) and a resistor (ID-00000003).
RC_DISCHARGE = os.path.join(RESOURCE_PATH, "celldl", "rc_discharge.celldl")
MODULE = "rc_discharge"
JUNCTION, CAPACITOR, RESISTOR = "ID-00000001", "ID-00000002", "ID-00000003"
# An RC circuit's BG-RDF with an empty group for each element: bg2cellml converts it, but the CellDL editor can't
# open it.
UNDRAWN_RC = os.path.join(RESOURCE_PATH, "..", "vitest", "fixtures", "celldl", "rc.celldl")
# The enzyme cycle S + E <=> C -> P + E: its reaction r1 (ID-00000006) has kappa 10. bg2cellml declares Faraday's
# constant F, which no equation uses.
ENZYME = os.path.join(RESOURCE_PATH, "celldl", "enzyme.celldl")
ENZYME_MODULE = "enzyme"
# The library group imported and new diagrams go in, User_Modules.celldl.
CELLDL_GROUP = "User Modules (CellDL)"
REACTION_R1 = "ID-00000006"
# Its reaction r2, and its product P's store and 0-junction.
REACTION_R2 = "ID-00000011"
PRODUCT, PRODUCT_JUNCTION = "ID-00000014", "ID-00000013"

# A + 2 B + ATP <=> C and C + ATP <=> D, drawn in the editor's Reactions panel: composite reaction nodes bonded
# straight to stores, a bondCount of 2, and a copy of the ATP chemostat beside each reaction.
REACTIONS_PANEL = os.path.join(RESOURCE_PATH, "celldl", "reactions_panel.celldl")
REACTIONS_MODULE = "reactions_panel"
# Its A store (ID-00000003), bonded straight to r1's node (ID-00000002).
STORE_A, BOND_A = "ID-00000003", "ID-00000004"

# S1 -> R1 -> S2: two stores and the reaction between them.
ONE_REACTION = os.path.join(RESOURCE_PATH, "celldl", "one_reaction.celldl")
ONE_REACTION_MODULE = "one_reaction"
SECTION_HEADINGS = [
    "// Chemical potentials",
    "// Reaction affinities",
    "// Reaction flux",
    "// Species flux",
    "// Mass conservation",
]

# A CellML module computing an amount X = 2 X0 from its constant X0 of 0.75 mole.
INITIAL_AMOUNT = os.path.join(RESOURCE_PATH, "celldl", "initial_amount.cellml")
INITIAL_AMOUNT_MODULE = "initial_amount"
# A CellML module computing an amount that varies in time, X = X0 (1 + sin t), with X0 = 0.5 mole.
DRIVEN_AMOUNT = os.path.join(RESOURCE_PATH, "celldl", "driven_amount.cellml")
DRIVEN_AMOUNT_MODULE = "driven_amount"

# A mechanical potential source driving an inductor L (ID-00000003) and a resistor through a 1-junction. The
# inductor's acceleration a_L_S2_c is a BG-RDF variable its math computes (dv/dt = a, u = L a).
MECHANICAL_INDUCTOR = os.path.join(RESOURCE_PATH, "celldl", "mechanical_inductor.celldl")
INDUCTOR = "ID-00000003"

# A store's base kind, which only its templates make convertible.
ZERO_STORAGE_NODE = "https://bg-rdf.org/ontologies/bondgraph-framework#ZeroStorageNode"
STORAGE_NODES = [
    "Chemical storage with Zero Node",
    "Chemical storage with saturating activity and Zero Node",
    "Electrical storage with Zero Node",
    "Hydraulic storage with Zero Node",
    "Hydraulic elastic storage with Zero Node",
    "Mechanical storage with Zero Node",
]

DIAGRAM_SVG = ".celldl-pane .celldl-host #svg-container > svg"
# The layer the editor draws location shading in.
REGION_LAYER = "celldl-region-layer"
# The marker a bond is drawn with: its arrowhead style's display marker, whatever the document saved.
BOND_MARKER = """() => {
    const bond = document.querySelector('.celldl-pane .celldl-host #svg-container > svg .celldl-Connection.bondgraph.arrow')
    return bond ? getComputedStyle(bond).markerEnd : null
}"""
# Where each of the diagram's components is, by id, rounded to the pixel.
COMPONENT_CENTRES = """() => Object.fromEntries(
    [...document.querySelectorAll('.celldl-pane .celldl-host #svg-container > svg #celldl-diagram-layer > g.celldl-Component')]
        .map((g) => {
            const box = g.getBBox()
            const m = g.getCTM()
            return [g.id, [Math.round(m.a * (box.x + box.width / 2) + m.e), Math.round(m.d * (box.y + box.height / 2) + m.f)]]
        })
)"""
SHORT_SIMULATION = (
    "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
    ".get('simulationSettings').setSimulationSettings({ endingPoint: 1, pointInterval: 0.01 })"
)


def open_app(playwright, engine="chromium"):
    """Opens an empty workspace, isolated so it can simulate, in Chromium unless another engine is asked for."""
    browser = getattr(playwright, engine).launch(headless=HEADLESS_MODE)
    context = browser.new_context(viewport={"width": 1600, "height": 1000})
    context.add_init_script(OPT_IN_TO_ISOLATION)
    page = context.new_page()
    page.goto(BASE_URL, wait_until="commit")
    page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
    page.locator(".file-io-buttons .p-splitbutton").first.wait_for(timeout=APP_MOUNT_TIMEOUT)
    return browser, page


def skip_unless_dev_server(test, page):
    """Skips a test that imports the app's source modules, which only the dev server serves."""
    if not page.evaluate(IS_DEV_SERVER):
        test.skipTest("The app's source modules aren't served here; run against the dev server.")


def import_diagram(page, files):
    """Imports CellDL diagrams from the Import menu: paths, or Playwright file payloads."""
    page.locator(".file-io-buttons .p-splitbutton").first.locator(".p-splitbutton-dropdown").click()
    page.get_by_role("menuitem", name="CellDL Diagram").click()
    dialog = page.locator(".p-dialog").filter(has_text="Import CellDL Diagram")
    dialog.locator("input[type=file]").set_input_files(files)
    dialog.get_by_role("button", name="Import", exact=True).click()


def place(page, group, name, x=700, y=450):
    """Drags a library module, from its group, onto the canvas."""
    page.locator(".mlc__group-header").filter(has_text=re.compile(rf"^\s*{re.escape(group)}\s*\d+\s*$", re.IGNORECASE)).first.click()
    card = page.locator(".mlc__card--draggable").filter(has_text=name).first
    card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": x, "y": y})
    expect(page.locator(".vue-flow__node").filter(has_text=name)).to_have_count(1)


def open_editor(page, name):
    """Opens an instance's editor, waiting for its diagram if it opens on the CellDL tab."""
    page.locator(".vue-flow__node").filter(has_text=name).first.dblclick()
    dialog = page.locator(".module-editor-dialog")
    dialog.wait_for()
    return dialog


def import_and_open(page):
    """Imports the RC discharge diagram, places it and opens its editor on its diagram."""
    import_diagram(page, RC_DISCHARGE)
    expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
    place(page, CELLDL_GROUP, MODULE)
    dialog = open_editor(page, MODULE)
    wait_for_diagram(page)
    return dialog


def wait_for_diagram(page):
    """Waits for the CellDL tab to show its diagram's elements."""
    page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component").first.wait_for(timeout=DIAGRAM_TIMEOUT)
    expect(page.locator(".celldl-pane-pending")).to_have_count(0, timeout=DIAGRAM_TIMEOUT)


def path_points(page, path_id):
    """A bond's points, as its path draws them."""
    d = page.locator(f'{DIAGRAM_SVG} path[id="{path_id}"]').get_attribute("d")
    return [(float(x), float(y)) for x, y in re.findall(r"[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)", d)]


def wait_for_level_bond(page, path_id, end_x):
    """Waits, up to the diagram timeout, for a bond to be one level line ending at `end_x`, as the editor redraws it
    after an edit: a slow machine can still be rerouting it when the edit's own controls have updated."""
    page.wait_for_function(
        """([selector, endX]) => {
            const d = document.querySelector(selector)?.getAttribute('d') ?? ''
            const points = [...d.matchAll(/[ML]\\s*(-?[\\d.]+)[ ,](-?[\\d.]+)/g)].map(m => [+m[1], +m[2]])
            return points.length === 2 && Math.abs(points[0][1] - points[1][1]) <= 0.5 && Math.abs(points[1][0] - endX) <= 0.5
        }""",
        arg=[f'{DIAGRAM_SVG} path[id="{path_id}"]', end_x],
        timeout=DIAGRAM_TIMEOUT,
    )


def view_box(page):
    """The diagram's view: its x, y, width and height, in SVG coordinates."""
    return [float(n) for n in page.locator(DIAGRAM_SVG).get_attribute("viewBox").split()]


def is_selected(page, element_id):
    return page.locator(f'{DIAGRAM_SVG} [id="{element_id}"].selected, {DIAGRAM_SVG} [id="{element_id}"] .selected')


def element_centre(page, element_id):
    """The centre of a diagram element, on the page."""
    box = page.locator(f'{DIAGRAM_SVG} #celldl-diagram-layer [id="{element_id}"]').bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def click_element(page, element_id):
    x, y = element_centre(page, element_id)
    page.mouse.move(x, y, steps=4)
    page.mouse.click(x, y)


def editor_tab(dialog, label):
    # A tab may carry a "(beta)" suffix, as the CellDL tab does.
    return dialog.locator(".editor-tabs [role=tab]").filter(
        has_text=re.compile(rf"^\s*{re.escape(label)}(\s+\(beta\))?\s*$")
    )


def cellml_text(dialog):
    editor_tab(dialog, "CellML Text").click()
    content = dialog.locator(".cm-content").first
    content.wait_for()
    return content


def text_lines(content):
    """The CellML Text editor's lines, all of them, not only those it has drawn."""
    return content.evaluate(
        """(node) => {
            // CodeMirror draws only the lines in view, so the text is read from the editor's component.
            while (node && !node.__vueParentComponent) node = node.parentElement
            for (let component = node?.__vueParentComponent; component; component = component.parent) {
                const text = component.setupState?.cellmlText
                if (typeof text === 'string') return text.split('\\n')
            }
        }"""
    )


def show_diagram(page, dialog):
    editor_tab(dialog, "CellDL").click()
    wait_for_diagram(page)


def relocate_resistor(page, location):
    """Sets the resistor's location in the editor's properties panel, which renames its variables."""
    click_element(page, RESISTOR)
    host = page.locator(".celldl-pane .celldl-host")
    page.locator("#properties-property-panel").click()
    field = host.locator("label", has_text="Location").locator("xpath=..").locator("input")
    field.fill(location)
    field.press("Tab")
    page.locator("#properties-property-panel").click()


def show_diagram_tab(page, dialog):
    """Shows the CellDL tab of a module that may have no diagram yet, waiting for the editor."""
    editor_tab(dialog, "CellDL").click()
    page.locator(DIAGRAM_SVG).wait_for(state="attached", timeout=DIAGRAM_TIMEOUT)
    expect(page.locator(".celldl-pane-pending")).to_have_count(0, timeout=DIAGRAM_TIMEOUT)


def add_component(page, entry):
    """Places an element from the editor's palette, by its tile's entry id, e.g. `chemical/species`: a click arms
    the tile, a click on the canvas places it there, clear of the palette, and Escape disarms it."""
    page.locator(f'.celldl-pane .palette-tile[data-entry-id="{entry}"]').click()
    box = page.locator(DIAGRAM_SVG).bounding_box()
    page.mouse.click(box["x"] + box["width"] * 0.65, box["y"] + box["height"] * 0.5)
    page.keyboard.press("Escape")


def choose_template(page, template):
    """Chooses the selected element's template in the CellDL editor's Properties panel."""
    host = page.locator(".celldl-pane .celldl-host")
    template_select = host.locator(".p-select").first
    if not template_select.is_visible():
        page.locator("#properties-property-panel").click()
    template_select.click()
    page.locator(".p-select-option").filter(has_text=re.compile(rf"^\s*{re.escape(template)}\s*$")).click()
    expect(template_select).to_contain_text(template)


def selected_tabs(dialog):
    return dialog.locator("[role=tab][aria-selected=true]").all_inner_texts()


def draw_in_editor(page, path):
    """Opens a diagram in the CellDL editor as if drawn there, unsaved. Needs the dev server, which serves /src."""
    with open(path) as f:
        document = f.read()
    page.evaluate(
        """async (data) => {
            const { useCelldlEditorHost } = await import('/src/composables/useCelldlEditorHost.js')
            useCelldlEditorHost().command.value = { command: 'file', options: { action: 'open', data, name: 'drawn.celldl' } }
        }""",
        document,
    )
    page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component").first.wait_for(timeout=DIAGRAM_TIMEOUT)


def parameter_value(dialog, name):
    """The field holding this instance's value of a diagram's variable, in the CellDL Parameters tab. A value still on
    the diagram's shows blank, with the diagram's as its placeholder."""
    dialog.get_by_role("tab", name=re.compile(r"Parameters \(")).click()
    return dialog.locator(f'.celldl-parameters [data-variable="{name}"] input')


def element_row(dialog, element_id):
    """A diagram element's row in the CellDL Parameters tab."""
    return dialog.locator(f'.celldl-parameters tr.element-row--main[data-element-id="{element_id}"]')


def set_element_field(dialog, element_id, label, value):
    """Sets an element's species or location from the CellDL Parameters tab."""
    field = element_row(dialog, element_id).get_by_label(re.compile(rf"^{label} of"))
    field.fill(value)
    field.press("Enter")


def choose_element_type(page, dialog, element_id, template):
    """Chooses an element's type from the CellDL Parameters tab."""
    element_row(dialog, element_id).locator(".p-select").click()
    page.locator(".p-select-option").filter(has_text=re.compile(rf"^\s*{re.escape(template)}\s*$")).click()
    expect(element_row(dialog, element_id).locator(".p-select")).to_contain_text(template)


def type_options(page, dialog, element_id):
    """The types an element's type list in the CellDL Parameters tab offers, closing it again."""
    element_row(dialog, element_id).locator(".p-select").click()
    options = page.locator(".p-select-option")
    options.first.wait_for()
    labels = [label.strip() for label in options.all_inner_texts()]
    page.keyboard.press("Escape")
    expect(options).to_have_count(0)
    return labels


def set_element_type(page, element_id, kind):
    """Sets an element's type in the diagram, as a diagram saved with it would have it, through the editor host."""
    result = page.evaluate(
        """async ([id, value]) => {
            const { useCelldlEditorHost } = await import('/src/composables/useCelldlEditorHost.js')
            return useCelldlEditorHost().setElement([{ id, field: 'type', value }])
        }""",
        [element_id, kind],
    )
    assert result["ok"], result


def accept_overwrite(page):
    """Overwrites the module at the "Overwrite Math?" prompt a save under the module's own name asks."""
    answer_overwrite(page, "Overwrite")


def answer_overwrite(page, choice):
    """Answers the "Overwrite Math?" prompt: Overwrite, Save as new component, or Cancel."""
    prompt = page.locator(".confirm-container").filter(has_text="Overwrite Math?")
    expect(prompt).to_be_visible(timeout=DIAGRAM_TIMEOUT)
    prompt.get_by_role("button", name=choice, exact=True).click()


def save_as_new(page, taken, name):
    """Names a new component in Save As, which refuses taken names, each with why."""
    save_as = page.get_by_role("dialog", name="Save As New Component")
    field = save_as.locator("input")
    save = save_as.get_by_role("button", name="Save", exact=True)
    for used, reason in taken:
        field.fill(used)
        expect(save_as.locator(".error-text")).to_have_text(reason)
        expect(save).to_be_disabled()
    field.fill(name)
    expect(save_as.locator(".error-text")).to_have_count(0)
    save.click()


def has_math(page, math_ref):
    """Whether the library has math under a reference."""
    return page.evaluate(
        """(mathRef) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
            .get('library').availableMath.has(mathRef)""",
        math_ref,
    )


def component_of(dialog):
    """The instance's component name and file, from the editor's header."""
    name = dialog.locator(".header-group--secondary input").input_value()
    return name, dialog.locator(".header-file-name").inner_text().strip()


def stored_document(page, math_ref):
    """The diagram stored for a module's math."""
    return page.evaluate(
        """(mathRef) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
            .get('library').getMathSource(mathRef)?.document ?? null""",
        math_ref,
    )


def saved_math_has(page, text):
    """Whether any of the library's math, as saved, has some text."""
    return page.evaluate(
        """(text) => [...document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
            .get('library').availableMath.values()].some((math) => String(math).includes(text))""",
        text,
    )


def import_cellml(page, path):
    """Imports a CellML file's components as library modules, from the Import menu."""
    page.locator(".file-io-buttons .p-splitbutton").first.locator(".p-splitbutton-dropdown").click()
    page.get_by_role("menuitem", name="CellML File").click()
    dialog = page.locator(".p-dialog").filter(has_text="Import CellML File")
    dialog.locator("input[type=file]").set_input_files(path)
    dialog.get_by_role("button", name="Import", exact=True).click()
    expect(dialog).to_have_count(0)


def add_port(page, dialog, label, variable):
    """Adds a general port carrying one variable in an instance's Ports tab."""
    dialog.get_by_role("tab", name=re.compile(r"Ports \(")).click()
    dialog.get_by_role("button", name=re.compile(r"^Add port$", re.IGNORECASE)).click()
    row = dialog.locator(".p-datatable-tbody tr").last
    row.get_by_placeholder("Enter label").fill(label)
    row.locator(".p-multiselect").click()
    overlay = page.locator(".ports-variable-overlay")
    # PrimeVue only listens for an outside click once the list's opening transition ends, so a click before then
    # leaves it open.
    expect(overlay).not_to_have_class(re.compile(r"-enter-"))
    option = overlay.locator(".p-multiselect-option").filter(has_text=re.compile(rf"^\s*{re.escape(variable)}\s*$"))
    option.click()
    expect(option).to_have_attribute("aria-selected", "true")
    # Closes the list with a click outside it, as Esc would close the editor.
    row.get_by_placeholder("Enter label").click()
    expect(overlay).to_be_hidden(timeout=10000)
    expect(row.locator(".p-multiselect")).to_contain_text(variable)


def drag_edge(page, source, target):
    """Drags from a free handle on one instance to one on another, which may ask before making the edge."""
    def handle(name, side):
        handles = page.locator(".vue-flow__node").filter(has_text=name).first.locator(
            f".vue-flow__handle.handle--ghost.vue-flow__handle-{side}"
        )
        box = handles.nth(handles.count() // 2).bounding_box()
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    start, end = handle(source, "right"), handle(target, "left")
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=15)
    page.mouse.up()


def connect(page, source, target):
    """Draws an edge from a free handle on one instance to one on another."""
    edges = page.locator(".vue-flow__edge").count()
    drag_edge(page, source, target)
    expect(page.locator(".vue-flow__edge")).to_have_count(edges + 1)


def first_value(page, name):
    """The first value of a variable in the latest run's results, by its name's ending."""
    return page.evaluate(
        """(name) => {
            const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                .get('simulationResults').results
            const entry = [...(results?.variables ?? [])].find(([key]) => key === name || key.endsWith('/' + name))
            return entry ? entry[1].values[0] : null
        }""",
        name,
    )


def run_this_instance(page, dialog):
    """Runs the instance on its own from the Plot tab, as saved."""
    dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
    dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
    dialog.get_by_role("button", name="Simulate this instance").click()
    expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)


def final_value(page, name):
    """The last value of a variable in the latest run's results, by its name's ending."""
    return page.evaluate(
        """(name) => {
            const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                .get('simulationResults').results
            const entry = [...(results?.variables ?? [])].find(([key]) => key === name || key.endsWith('/' + name))
            return entry ? entry[1].values[entry[1].values.length - 1] : null
        }""",
        name,
    )


class TestCelldl(unittest.TestCase):

    def test_imports_a_diagram_whose_math_is_read_only_and_values_editable(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)

            # It opens on its diagram, which the editor draws.
            self.assertIn("CellDL", " ".join(selected_tabs(dialog)))
            expect(page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component")).to_have_count(3)

            # Its CellML is generated from the diagram, so it can't be typed in.
            content = cellml_text(dialog)
            expect(content).to_contain_text("ode(q_e_C, t)")
            expect(content).to_have_attribute("contenteditable", "false")

            # Its Parameters tab lists the diagram's elements, not the math's rows: species and location edit the
            # diagram, and values this instance, the diagram's showing as their defaults.
            parameters = dialog.locator(".celldl-parameters")
            expect(dialog.locator(".parameters-table")).to_have_count(0)
            expect(parameters.locator("tr.element-row--main[data-element-id]")).to_have_count(3)
            show_diagram(page, dialog)
            expect(element_row(dialog, RESISTOR).get_by_label(re.compile("^Location of"))).to_be_editable()
            value = parameter_value(dialog, "R_R_i_R")
            expect(value).to_be_editable()
            expect(value).to_have_value("")
            expect(value).to_have_attribute("placeholder", re.compile(r"\S"))
            # ----------- END ------------

            browser.close()

    def test_rejects_a_diagram_the_editor_cannot_open(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            with open(UNDRAWN_RC) as f:
                drawn = f.read()
            undrawn = re.sub(r'<g id="([^"]+)"><rect[^>]*/></g>', r'<g id="\1"/>', drawn)
            self.assertNotEqual(undrawn, drawn)
            import_diagram(page, {"name": "undrawn.celldl", "mimeType": "image/svg+xml", "buffer": undrawn.encode()})

            expect(page.get_by_text("undrawn.celldl can't be imported:")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            expect(page.get_by_text(re.compile(r"The diagram has no drawing of .*, so the CellDL editor can't open it"))).to_be_visible()
            expect(page.locator(".mlc__group-header").filter(has_text=re.compile(r"undrawn", re.IGNORECASE))).to_have_count(0)
            # ----------- END ------------

            browser.close()

    def test_saves_a_diagram_edit_as_the_module_math_unless_it_cannot_convert(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)
            expect(cellml_text(dialog)).to_contain_text("R_R_i_R")
            show_diagram(page, dialog)

            # Moving the resistor to another location renames its variables.
            relocate_resistor(page, "X")
            dialog.get_by_role("button", name="Apply").click()
            accept_overwrite(page)
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            content = cellml_text(dialog)
            expect(content).to_contain_text("R_R_i_X")
            expect(content).not_to_contain_text("R_R_i_R")

            # Without the resistor, the circuit has nothing to discharge through, so it can't convert and nothing saves.
            show_diagram(page, dialog)
            click_element(page, RESISTOR)
            page.keyboard.press("Backspace")
            expect(page.locator(f'{DIAGRAM_SVG} [id="{RESISTOR}"]')).to_have_count(0)
            dialog.get_by_role("button", name="Apply").click()
            error = page.locator(".confirm-container").filter(has_text="Diagram Has Errors")
            expect(error).to_contain_text("The diagram can't be converted, so nothing was saved:")
            error.get_by_role("button").last.click()
            self.assertTrue(saved_math_has(page, "R_R_i_X"))
            # ----------- END ------------

            browser.close()

    def test_saves_a_moved_element_without_asking_to_overwrite_and_undoes_it_in_one_step(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)
            name, file = component_of(dialog)
            math_ref = f"{file}:{name}"
            original = stored_document(page, math_ref)
            glyph = page.locator(f'{DIAGRAM_SVG} [id="{CAPACITOR}"]')
            transform = glyph.get_attribute("transform")

            # Moving the capacitor changes only the diagram, so it saves without the overwrite prompt.
            click_element(page, CAPACITOR)
            x, y = element_centre(page, CAPACITOR)
            page.mouse.down()
            page.mouse.move(x + 60, y + 40, steps=8)
            page.mouse.up()
            moved = glyph.get_attribute("transform")
            self.assertNotEqual(moved, transform)
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            expect(page.locator(".confirm-container").filter(has_text="Overwrite Math?")).to_have_count(0)
            self.assertNotEqual(stored_document(page, math_ref), original)
            self.assertEqual(component_of(open_editor(page, MODULE)), (name, file))
            wait_for_diagram(page)
            self.assertEqual(glyph.get_attribute("transform"), moved)
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()

            # One undo puts the diagram back where it was.
            expect(page.locator("button:has(.pi-undo)")).to_be_enabled()
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_function(
                """([mathRef, original]) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                    .get('library').getMathSource(mathRef)?.document === original""",
                arg=[math_ref, original],
                timeout=DIAGRAM_TIMEOUT,
            )
            open_editor(page, MODULE)
            wait_for_diagram(page)
            self.assertEqual(glyph.get_attribute("transform"), transform)
            # ----------- END ------------

            browser.close()

    def test_shows_the_diagram_math_live_until_cancelled(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)
            expect(page.get_by_text("Live CellML")).to_have_count(0)

            # The CellML Text, and the Parameters tab's names, show the edited diagram's math before it is saved.
            relocate_resistor(page, "X")
            content = cellml_text(dialog)
            expect(content).to_contain_text("R_R_i_X", timeout=DIAGRAM_TIMEOUT)
            expect(content).not_to_contain_text("R_R_i_R")
            expect(content).to_have_attribute("contenteditable", "false")
            expect(element_row(dialog, RESISTOR).locator(".element-names")).to_contain_text("R_R_i_X")
            self.assertTrue(saved_math_has(page, "R_R_i_R"))

            # Cancelling discards the edit, so the math shows as saved again.
            dialog.get_by_role("button", name="Cancel").click()
            page.locator(".confirm-container").get_by_role("button", name="Discard & Close").click()
            expect(dialog).to_be_hidden()
            dialog = open_editor(page, MODULE)
            wait_for_diagram(page)
            content = cellml_text(dialog)
            expect(content).to_contain_text("R_R_i_R")
            expect(content).not_to_contain_text("R_R_i_X")
            # ----------- END ------------

            browser.close()

    def test_plots_a_clicked_element_only_from_the_plot_tab(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            dialog = import_and_open(page)

            # Hovering an element names its variables.
            x, y = element_centre(page, JUNCTION)
            page.mouse.move(x, y, steps=4)
            expect(page.locator(".tooltip-info .tippy-box")).to_contain_text("u_i_C")

            # With the Plot tab shown and Auto-update on, clicking the junction plots its potential, and the tab stays.
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
            expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            expect(dialog.get_by_role("switch", name="Auto-update: plot a variable clicked in the math")).to_be_checked()
            click_element(page, JUNCTION)
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text(f"{MODULE}/u_i_C")
            expect(dialog.get_by_role("tab", name="Plot (1)")).to_have_attribute("aria-selected", "true")
            self.assertIn("CellDL", " ".join(selected_tabs(dialog)))

            # With Parameters shown, clicking the capacitor plots nothing and keeps the tab.
            dialog.get_by_role("tab", name=re.compile(r"Parameters \(")).click()
            click_element(page, CAPACITOR)
            expect(page.locator(f'{DIAGRAM_SVG} [id="{CAPACITOR}"].selected, {DIAGRAM_SVG} [id="{CAPACITOR}"] .selected')).not_to_have_count(0)
            expect(dialog.get_by_role("tab", name=re.compile(r"Parameters \("))).to_have_attribute("aria-selected", "true")
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text(f"{MODULE}/u_i_C")
            # ----------- END ------------

            browser.close()

    def test_takes_an_issue_to_its_element_at_the_same_zoom(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)

            # Naming the product's store as the substrate's makes a second pool named q_S_c, which live conversion
            # warns of, on the product's store.
            set_element_field(dialog, PRODUCT, "Species", "S")
            issues = dialog.locator(".celldl-live-issues")
            expect(issues).to_have_text(re.compile(r"^\s*Converts, with 1 warning"), timeout=DIAGRAM_TIMEOUT)

            # Enter opens the list of issues, whose first link takes focus.
            before = view_box(page)
            issues.focus()
            page.keyboard.press("Enter")
            listed = page.locator(".p-popover .celldl-issue-list li")
            expect(listed).to_have_count(1)
            expect(listed.first).to_contain_text("is named q_S_c by its symbol, species and location")
            link = listed.first.locator(f'.celldl-issue-element[data-element-id="{PRODUCT}"]')
            expect(link).to_be_focused()

            # Following it selects the store and centres it, at the same zoom, flashing it for a moment.
            page.keyboard.press("Enter")
            expect(is_selected(page, PRODUCT)).not_to_have_count(0)
            expect(page.locator(f'{DIAGRAM_SVG} [id="{PRODUCT}"].phlynx-celldl-flash')).to_have_count(1)
            after = view_box(page)
            # The same zoom: the view's size may shift by a fraction of a unit as the canvas settles.
            for was, now in zip(before[2:], after[2:]):
                self.assertAlmostEqual(now, was, delta=was * 1e-3)
            self.assertNotEqual(before[:2], after[:2])
            box = page.locator(DIAGRAM_SVG).bounding_box()
            x, y = element_centre(page, PRODUCT)
            self.assertAlmostEqual(x, box["x"] + box["width"] / 2, delta=2)
            self.assertAlmostEqual(y, box["y"] + box["height"] / 2, delta=2)
            # Escape closes the list, and leaves the editor open.
            page.keyboard.press("Escape")
            expect(page.locator(".p-popover")).to_have_count(0)
            expect(dialog).to_be_visible()

            # Saved from another tab, the warning links to the store too: following it cancels the save and shows the
            # store in the CellDL tab.
            click_element(page, PRODUCT_JUNCTION)
            expect(is_selected(page, PRODUCT)).to_have_count(0)
            cellml_text(dialog)
            dialog.get_by_role("button", name="Apply").click()
            warning = page.locator(".confirm-container").filter(has_text="Diagram Warnings")
            expect(warning).to_contain_text("is named q_S_c", timeout=DIAGRAM_TIMEOUT)
            warning.locator(f'.confirm-issue-link[data-element-id="{PRODUCT}"]').click()
            expect(warning).to_have_count(0)
            expect(editor_tab(dialog, "CellDL")).to_have_attribute("aria-selected", "true")
            expect(is_selected(page, PRODUCT)).not_to_have_count(0, timeout=DIAGRAM_TIMEOUT)
            for was, now in zip(after[2:], view_box(page)[2:]):
                self.assertAlmostEqual(now, was, delta=was * 1e-3)
            self.assertFalse(saved_math_has(page, "q_S_c_2"))
            # ----------- END ------------

            browser.close()

    def test_converts_a_composite_storage_node_drawn_in_the_template(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            show_diagram_tab(page, dialog)
            add_component(page, "chemical/species")
            storage = page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component")
            expect(storage).to_have_count(1)

            # The palette's Species is chemical storage, a composite node the editor lists as a junction too. It's
            # named S1, in the default location c.
            click_element(page, storage.get_attribute("id"))
            choose_template(page, "Chemical storage with Zero Node")

            # Live conversion takes it as a storage node: the template stores 1 for its K, which the math has, and
            # no junction type is asked for. The live status lists its issues a click away.
            dialog.locator(".celldl-live-issues").click(timeout=DIAGRAM_TIMEOUT)
            listed = page.locator(".p-popover .celldl-issue-list")
            expect(listed).to_contain_text("q_S1_c", timeout=DIAGRAM_TIMEOUT)
            self.assertNotIn("must be one, zero or transform nodes", listed.inner_text())
            self.assertNotIn("Missing value for parameter K", listed.inner_text())
            page.keyboard.press("Escape")
            expect(cellml_text(dialog)).to_contain_text("K_q_S1_c", timeout=DIAGRAM_TIMEOUT)
            # ----------- END ------------

            browser.close()

    def test_offers_a_store_the_types_its_properties_panel_does_from_its_parameters_tab(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            skip_unless_dev_server(self, page)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            show_diagram_tab(page, dialog)
            add_component(page, "chemical/species")
            storage = page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component")
            expect(storage).to_have_count(1)
            store = storage.get_attribute("id")
            dialog.get_by_role("tab", name=re.compile(r"Parameters \(")).click()

            # An unbonded store can be any domain's storage node, as in the Properties panel, but not the bare
            # zero storage node, which nothing converts.
            offered = type_options(page, dialog, store)
            self.assertEqual(sorted(offered), sorted(STORAGE_NODES))
            choose_element_type(page, dialog, store, "Electrical storage with Zero Node")
            expect(element_row(dialog, store).locator(".element-names")).to_contain_text("q_S1_c", timeout=DIAGRAM_TIMEOUT)

            # A store saved as a zero storage node shows it, and can be given any of them.
            set_element_type(page, store, ZERO_STORAGE_NODE)
            type_select = element_row(dialog, store).locator(".p-select")
            expect(type_select).to_contain_text("Zero storage node")
            expect(type_select).to_have_class(re.compile(r"\bp-invalid\b"))
            expect(dialog.locator(f'.celldl-parameters tbody[data-section="stores"] tr[data-element-id="{store}"]')).to_have_count(1)
            self.assertEqual(sorted(type_options(page, dialog, store)), sorted(STORAGE_NODES))
            choose_element_type(page, dialog, store, "Mechanical storage with Zero Node")

            # The Properties panel offers the same, with the base kind as well.
            editor_tab(dialog, "CellDL").click()
            click_element(page, store)
            host = page.locator(".celldl-pane .celldl-host")
            template_select = host.locator(".p-select").first
            if not template_select.is_visible():
                page.locator("#properties-property-panel").click()
            expect(template_select).to_contain_text("Mechanical storage with Zero Node")
            template_select.click()
            listbox = template_select.locator("[role=combobox]").get_attribute("aria-controls")
            panel_options = page.locator(f'[id="{listbox}"] .p-select-option')
            panel_options.first.wait_for()
            panel = [label.strip() for label in panel_options.all_inner_texts()]
            self.assertEqual(sorted(panel), sorted(STORAGE_NODES + ["Zero storage node"]))
            # ----------- END ------------

            browser.close()

    def test_saves_every_generated_constant_from_the_template_so_the_whole_model_runs(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            skip_unless_dev_server(self, page)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            show_diagram_tab(page, dialog)
            draw_in_editor(page, ENZYME)
            dialog.get_by_role("button", name="Apply").click()
            save_as = page.locator(".p-dialog").filter(has_text="Save As New Component")
            save_as.locator("input").fill(ENZYME_MODULE)
            save_as.get_by_role("button", name="Save").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)

            # F is a constant no equation uses, yet it keeps its value, so the whole model runs.
            expect(parameter_value(dialog, "F")).to_have_attribute("placeholder", "96485")
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_attribute("placeholder", "10")
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            expect(dialog.get_by_role("switch", name="Simulate the whole model, not this instance")).to_be_checked()
            dialog.get_by_role("button", name="Simulate the whole model").click()
            expect(dialog.get_by_text("Simulated the whole model")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            # ----------- END ------------

            browser.close()

    def test_shows_a_variable_the_math_computes_as_computed_not_as_a_value_to_enter(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            skip_unless_dev_server(self, page)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            show_diagram_tab(page, dialog)
            draw_in_editor(page, MECHANICAL_INDUCTOR)
            dialog.get_by_role("button", name="Apply").click()
            save_as = page.locator(".p-dialog").filter(has_text="Save As New Component")
            save_as.locator("input").fill("mechanical_inductor")
            save_as.get_by_role("button", name="Save").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)

            # The inductor's acceleration is computed, so it has no field and isn't flagged as unset; L still has one.
            expect(parameter_value(dialog, "L_L_S2_c")).to_have_attribute("placeholder", "1")
            acceleration = dialog.locator('.celldl-parameters [data-variable="a_L_S2_c"]')
            expect(acceleration.locator(".computed-value")).to_have_text("computed")
            expect(acceleration.locator("input")).to_have_count(0)
            expect(element_row(dialog, INDUCTOR).locator(".flag--unset")).to_have_count(0)

            # It runs, and the acceleration has values to plot.
            run_this_instance(page, dialog)
            self.assertIsNotNone(final_value(page, "a_L_S2_c"))
            # ----------- END ------------

            browser.close()

    def test_runs_an_instance_value_set_after_the_first_save(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_attribute("placeholder", "10")

            # Run this instance on its own, as saved.
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
            dialog.get_by_role("button", name="Simulate this instance").click()
            expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            before = final_value(page, "q_P_c")
            self.assertIsNotNone(before)

            # The diagram's Properties panel only shows r1's values, pointing to the Parameters tab.
            show_diagram(page, dialog)
            click_element(page, REACTION_R1)
            host = page.locator(".celldl-pane .celldl-host")
            page.locator("#properties-property-panel").click()
            expect(host.locator(".values-hint")).to_have_text("Set values in the Parameters tab")
            page.locator("#properties-property-panel").click()

            # Slowing r1 in the Parameters tab, and applying, gives the instance its own value, so the run changes.
            kappa = parameter_value(dialog, "kappa_Rx_r1_c")
            kappa.fill("1")
            kappa.press("Enter")
            dialog.get_by_role("button", name="Apply").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_attribute("placeholder", "10")
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_value("1")

            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
            dialog.get_by_role("button", name="Simulate this instance").click()
            expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            page.wait_for_function(
                """([name, before]) => {
                    const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                        .get('simulationResults').results
                    const entry = [...(results?.variables ?? [])].find(([key]) => key === name || key.endsWith('/' + name))
                    return entry && entry[1].values[entry[1].values.length - 1] !== before
                }""",
                arg=["q_P_c", before],
                timeout=SIMULATION_TIMEOUT,
            )
            self.assertLess(final_value(page, "q_P_c"), before)
            # ----------- END ------------

            browser.close()

    def test_typing_cellml_in_the_template_locks_its_diagram_until_undone(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            locked = dialog.locator(".editor-tab-locked")
            expect(editor_tab(dialog, "CellDL")).to_be_enabled()

            content = cellml_text(dialog)
            content.click()
            page.keyboard.press("ControlOrMeta+End")
            page.keyboard.type("\nvar k: per_second;")
            expect(locked).to_have_count(1)
            expect(locked).to_contain_text("CellDL")

            # The typing may be undone in more than one step.
            content.click()
            for _ in range(3):
                page.keyboard.press("ControlOrMeta+z")
                try:
                    expect(locked).to_have_count(0, timeout=2000)
                    break
                except AssertionError:
                    pass
            expect(locked).to_have_count(0)
            expect(editor_tab(dialog, "CellDL")).to_be_enabled()
            # ----------- END ------------

            browser.close()

    def test_undoes_in_the_diagram_only_while_working_in_it(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)
            components = page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component")
            add_component(page, "chemical/species")
            expect(components).to_have_count(4)

            # Undo in the Parameters tab leaves the diagram alone.
            dialog.locator(".celldl-parameters .toolbar-note").click()
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_timeout(500)
            expect(components).to_have_count(4)

            # Back in the diagram, the keys undo and redo it. It shows no toolbar or status bar: the palette replaced
            # the tools, and the keys the Undo and Redo buttons.
            expect(page.locator("#editor-undo, #editor-redo, #editor-select-tool, #editor-bondgraph-tool")).to_have_count(0)
            expect(page.locator(".celldl-host #status-msg")).to_be_hidden()
            box = page.locator(DIAGRAM_SVG).bounding_box()
            page.mouse.click(box["x"] + box["width"] * 0.1, box["y"] + box["height"] * 0.1)
            page.keyboard.press("ControlOrMeta+z")
            expect(components).to_have_count(3)
            page.keyboard.press("ControlOrMeta+Shift+z")
            expect(components).to_have_count(4)
            # ----------- END ------------

            browser.close()

    def test_names_and_values_a_diagram_from_its_parameters_tab(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE, x=600, y=350)
            card = page.locator(".mlc__card--draggable").filter(has_text=ENZYME_MODULE).first
            card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": 900, "y": 600})
            instances = page.locator(".vue-flow__node").filter(has_text=ENZYME_MODULE)
            expect(instances).to_have_count(2)
            instances.first.dblclick()
            dialog = page.locator(".module-editor-dialog")
            wait_for_diagram(page)
            glyph = page.locator(f'{DIAGRAM_SVG} [id="{PRODUCT}"]')
            drawn = glyph.inner_html()

            # The product's species, from the table: its 0-junction follows, and the diagram's CellML is renamed.
            set_element_field(dialog, PRODUCT, "Species", "Prod")
            expect(element_row(dialog, PRODUCT_JUNCTION).get_by_label(re.compile("^Species of"))).to_have_value("Prod")
            expect(element_row(dialog, PRODUCT).locator(".element-names")).to_contain_text("q_Prod_c", timeout=DIAGRAM_TIMEOUT)
            # r1's location, and r2's type there and back.
            set_element_field(dialog, REACTION_R1, "Location", "cyt")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt", timeout=DIAGRAM_TIMEOUT)
            choose_element_type(page, dialog, REACTION_R2, "NKE transporter")
            expect(dialog.locator(f'.celldl-parameters tr.element-row--values[data-element-id="{REACTION_R2}"]')).to_contain_text("k_NKE")
            choose_element_type(page, dialog, REACTION_R2, "Chemical reaction")
            expect(element_row(dialog, REACTION_R2).locator(".element-names")).to_contain_text("kappa_Rx_r2_c", timeout=DIAGRAM_TIMEOUT)
            content = cellml_text(dialog)
            expect(content).to_contain_text("q_Prod_c", timeout=DIAGRAM_TIMEOUT)
            expect(content).to_contain_text("kappa_Rx_r1_cyt")
            self.assertTrue(saved_math_has(page, "kappa_Rx_r1_c"))
            show_diagram(page, dialog)
            self.assertNotEqual(glyph.inner_html(), drawn)

            # A value for this instance alone: r1 slowed from the diagram's 10, set before its name is saved.
            kappa = parameter_value(dialog, "kappa_Rx_r1_cyt")
            expect(kappa).to_have_attribute("placeholder", "10")
            kappa.fill("1")
            kappa.press("Enter")
            dialog.get_by_role("button", name="Apply").click()
            accept_overwrite(page)
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            wait_for_diagram(page)
            kappa = parameter_value(dialog, "kappa_Rx_r1_cyt")
            expect(kappa).to_have_value("1")
            self.assertTrue(saved_math_has(page, "kappa_Rx_r1_cyt"))

            run_this_instance(page, dialog)
            slowed = final_value(page, "q_Prod_c")
            self.assertIsNotNone(slowed)
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()

            # The other instance has the diagram's new names, and keeps its default, so its product forms faster.
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            kappa = parameter_value(dialog, "kappa_Rx_r1_cyt")
            expect(kappa).to_have_value("")
            expect(kappa).to_have_attribute("placeholder", "10")
            run_this_instance(page, dialog)
            page.wait_for_function(
                """([name, before]) => {
                    const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                        .get('simulationResults').results
                    const entry = [...(results?.variables ?? [])].find(([key]) => key.endsWith('/' + name))
                    return entry && entry[1].values[entry[1].values.length - 1] !== before
                }""",
                arg=["q_Prod_c", slowed],
                timeout=SIMULATION_TIMEOUT,
            )
            self.assertGreater(final_value(page, "q_Prod_c"), slowed)
            # ----------- END ------------

            browser.close()


    def test_keeps_each_instances_values_when_a_rename_renames_their_variables(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE, x=600, y=350)
            card = page.locator(".mlc__card--draggable").filter(has_text=ENZYME_MODULE).first
            card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": 900, "y": 600})
            instances = page.locator(".vue-flow__node").filter(has_text=ENZYME_MODULE)
            expect(instances).to_have_count(2)
            dialog = page.locator(".module-editor-dialog")

            # The second instance's own r1 rate.
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            kappa = parameter_value(dialog, "kappa_Rx_r1_c")
            kappa.fill("3")
            kappa.press("Enter")
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()

            # The first's, then r1 moves to cyt: the value goes with the new name before the save, and after it.
            instances.first.dblclick()
            wait_for_diagram(page)
            kappa = parameter_value(dialog, "kappa_Rx_r1_c")
            kappa.fill("2")
            kappa.press("Enter")
            set_element_field(dialog, REACTION_R1, "Location", "cyt")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt", timeout=DIAGRAM_TIMEOUT)
            expect(parameter_value(dialog, "kappa_Rx_r1_cyt")).to_have_value("2")
            dialog.get_by_role("button", name="Save").click()
            accept_overwrite(page)
            expect(dialog).to_be_hidden()

            instances.first.dblclick()
            wait_for_diagram(page)
            expect(parameter_value(dialog, "kappa_Rx_r1_cyt")).to_have_value("2")
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            expect(parameter_value(dialog, "kappa_Rx_r1_cyt")).to_have_value("3")
            # ----------- END ------------

            browser.close()

    def test_saves_a_renamed_component_as_a_new_module_for_this_instance_and_overwrites_after_asking(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE, x=600, y=350)
            card = page.locator(".mlc__card--draggable").filter(has_text=ENZYME_MODULE).first
            card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": 900, "y": 600})
            instances = page.locator(".vue-flow__node").filter(has_text=ENZYME_MODULE)
            expect(instances).to_have_count(2)
            dialog = page.locator(".module-editor-dialog")

            # The second instance's own r1 rate.
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            name, file = component_of(dialog)
            math_ref = f"{file}:{name}"
            kappa = parameter_value(dialog, "kappa_Rx_r1_c")
            kappa.fill("3")
            kappa.press("Enter")
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()

            # The first's own rate, and r2 moved to cyt under the same name: the save asks before overwriting the
            # module, whose math both instances then share, each keeping its own values.
            instances.first.dblclick()
            wait_for_diagram(page)
            expect(dialog.locator(".apply-all-checkbox")).to_contain_text("Apply math changes to all 2 instances")
            kappa = parameter_value(dialog, "kappa_Rx_r1_c")
            kappa.fill("2")
            kappa.press("Enter")
            set_element_field(dialog, REACTION_R2, "Location", "cyt")
            expect(element_row(dialog, REACTION_R2).locator(".element-names")).to_contain_text("kappa_Rx_r2_cyt", timeout=DIAGRAM_TIMEOUT)
            dialog.get_by_role("button", name="Save").click()
            accept_overwrite(page)
            expect(dialog).to_be_hidden()
            shared = stored_document(page, math_ref)

            instances.nth(1).dblclick()
            wait_for_diagram(page)
            expect(element_row(dialog, REACTION_R2).locator(".element-names")).to_contain_text("kappa_Rx_r2_cyt")
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_value("3")
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()

            # Renamed, the first's diagram edit is a new module for it alone, with its own copy of the diagram: no
            # prompt, and the second stays on the old module and diagram.
            instances.first.dblclick()
            wait_for_diagram(page)
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_value("2")
            component = dialog.locator(".header-group--secondary input")
            component.fill("enzyme_fast")
            component.press("Tab")
            set_element_field(dialog, REACTION_R1, "Location", "cyt")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt", timeout=DIAGRAM_TIMEOUT)
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            expect(page.locator(".confirm-container").filter(has_text="Overwrite Math?")).to_have_count(0)
            self.assertEqual(stored_document(page, math_ref), shared)
            self.assertIsNotNone(stored_document(page, "User_Modules.celldl:enzyme_fast"))

            instances.first.dblclick()
            wait_for_diagram(page)
            self.assertEqual(component_of(dialog), ("enzyme_fast", "User_Modules.celldl"))
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt")
            expect(parameter_value(dialog, "kappa_Rx_r1_cyt")).to_have_value("2")
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()

            instances.nth(1).dblclick()
            wait_for_diagram(page)
            self.assertEqual(component_of(dialog), (name, file))
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_c")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).not_to_contain_text("kappa_Rx_r1_cyt")
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_value("3")
            expect(dialog.locator(".apply-all-checkbox")).to_have_count(0)
            # ----------- END ------------

            browser.close()

    def test_saves_a_diagram_edit_as_a_new_component_for_this_instance_instead_of_overwriting(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE, x=600, y=350)
            card = page.locator(".mlc__card--draggable").filter(has_text=ENZYME_MODULE).first
            card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": 900, "y": 600})
            instances = page.locator(".vue-flow__node").filter(has_text=ENZYME_MODULE)
            expect(instances).to_have_count(2)
            dialog = page.locator(".module-editor-dialog")

            # Not overwriting, the first's edit is saved as a new component under an unused name, with its own copy of
            # the diagram; the second stays on the shared module and diagram.
            instances.first.dblclick()
            wait_for_diagram(page)
            name, file = component_of(dialog)
            math_ref = f"{file}:{name}"
            shared = stored_document(page, math_ref)
            set_element_field(dialog, REACTION_R1, "Location", "cyt")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt", timeout=DIAGRAM_TIMEOUT)
            dialog.get_by_role("button", name="Save").click()
            answer_overwrite(page, "Save as new component")
            save_as_new(
                page,
                [
                    (name, f'A component named "{name}" already exists.'),
                    ("new_module", '"new_module" is a template and can\'t be overwritten.'),
                ],
                "enzyme_mine",
            )
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            self.assertEqual(stored_document(page, math_ref), shared)
            self.assertIsNotNone(stored_document(page, "User_Modules.celldl:enzyme_mine"))

            # Undo removes the new component and its diagram, leaving the shared one; redo puts them back.
            expect(page.locator("button:has(.pi-undo)")).to_be_enabled()
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_function(
                """() => !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                    .get('library').availableMath.has('User_Modules.celldl:enzyme_mine')"""
            )
            self.assertEqual(stored_document(page, math_ref), shared)
            page.keyboard.press("ControlOrMeta+Shift+z")
            page.wait_for_function(
                """() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                    .get('library').availableMath.has('User_Modules.celldl:enzyme_mine')"""
            )
            self.assertEqual(stored_document(page, math_ref), shared)

            instances.first.dblclick()
            wait_for_diagram(page)
            self.assertEqual(component_of(dialog), ("enzyme_mine", "User_Modules.celldl"))
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt")
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()

            instances.nth(1).dblclick()
            wait_for_diagram(page)
            self.assertEqual(component_of(dialog), (name, file))
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).not_to_contain_text("kappa_Rx_r1_cyt")
            # ----------- END ------------

            browser.close()

    def test_asks_before_a_rename_onto_another_diagrams_component(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE, x=600, y=350)
            card = page.locator(".mlc__card--draggable").filter(has_text=ENZYME_MODULE).first
            card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": 900, "y": 600})
            instances = page.locator(".vue-flow__node").filter(has_text=ENZYME_MODULE)
            expect(instances).to_have_count(2)
            dialog = page.locator(".module-editor-dialog")
            prompt = page.locator(".confirm-container").filter(has_text="Overwrite Math?")

            # The first's edit, renamed, is a new component "enzyme_other" for it alone.
            instances.first.dblclick()
            wait_for_diagram(page)
            component = dialog.locator(".header-group--secondary input")
            component.fill("enzyme_other")
            component.press("Tab")
            set_element_field(dialog, REACTION_R1, "Location", "cyt")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt", timeout=DIAGRAM_TIMEOUT)
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            other = stored_document(page, "User_Modules.celldl:enzyme_other")
            self.assertIsNotNone(other)

            # Renamed onto it, the second's edit asks, naming the instances it affects; saved as new, it leaves it alone.
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            component.fill("enzyme_other")
            component.press("Tab")
            set_element_field(dialog, REACTION_R2, "Location", "cyt")
            expect(element_row(dialog, REACTION_R2).locator(".element-names")).to_contain_text("kappa_Rx_r2_cyt", timeout=DIAGRAM_TIMEOUT)
            dialog.get_by_role("button", name="Save").click()
            expect(prompt).to_contain_text('"enzyme_other" already exists. This will affect 1 other instance.', timeout=DIAGRAM_TIMEOUT)
            answer_overwrite(page, "Save as new component")
            save_as_new(
                page,
                [
                    ("enzyme_other", 'A component named "enzyme_other" already exists.'),
                    ("new_module", '"new_module" is a template and can\'t be overwritten.'),
                ],
                "enzyme_third",
            )
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            self.assertEqual(stored_document(page, "User_Modules.celldl:enzyme_other"), other)
            self.assertIsNotNone(stored_document(page, "User_Modules.celldl:enzyme_third"))

            # Renamed onto it again, Overwrite replaces its diagram with the second's, which moves to it.
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            self.assertEqual(component_of(dialog), ("enzyme_third", "User_Modules.celldl"))
            component.fill("enzyme_other")
            component.press("Tab")
            dialog.get_by_role("button", name="Save").click()
            answer_overwrite(page, "Overwrite")
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            overwritten = stored_document(page, "User_Modules.celldl:enzyme_other")
            self.assertNotEqual(overwritten, other)

            # Both instances now share it, the first with the second's diagram.
            instances.first.dblclick()
            wait_for_diagram(page)
            self.assertEqual(component_of(dialog), ("enzyme_other", "User_Modules.celldl"))
            expect(element_row(dialog, REACTION_R2).locator(".element-names")).to_contain_text("kappa_Rx_r2_cyt")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).not_to_contain_text("kappa_Rx_r1_cyt")
            expect(dialog.locator(".apply-all-checkbox")).to_contain_text("Apply math changes to all 2 instances")
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()

            # Undo puts its diagram back, and the second on its own component.
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_function(
                """(diagram) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                    .get('library').getMathSource('User_Modules.celldl:enzyme_other')?.document === diagram""",
                arg=other,
            )
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            self.assertEqual(component_of(dialog), ("enzyme_third", "User_Modules.celldl"))
            # ----------- END ------------

            browser.close()

    def test_saves_a_cellml_edit_as_a_new_component_instead_of_overwriting(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            # The template always saves as a new component, here "mine", in User_Modules.cellml.
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            content = cellml_text(dialog)
            content.click()
            page.keyboard.press("ControlOrMeta+End")
            page.keyboard.type("\na = b+c;")
            dialog.get_by_role("button", name="Save").click()
            expect(page.locator(".confirm-container").filter(has_text="Overwrite Math?")).to_have_count(0)
            save_as_new(page, [], "mine")
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            self.assertTrue(has_math(page, "User_Modules.cellml:mine"))

            # Saving "mine" again offers to save it as a new component instead, under a name neither used nor the
            # template's; "mine" is left as it was.
            page.locator(".vue-flow__node").first.dblclick()
            dialog.wait_for()
            content = cellml_text(dialog)
            content.click()
            page.keyboard.press("ControlOrMeta+End")
            page.keyboard.type("\nd = b;")
            # The prompt focuses Save as new component, never Overwrite: Escape cancels the save, and Enter saves as new.
            prompt = page.locator(".confirm-container").filter(has_text="Overwrite Math?")
            dialog.get_by_role("button", name="Save").click()
            expect(prompt.get_by_role("button", name="Save as new component")).to_be_focused(timeout=DIAGRAM_TIMEOUT)
            page.keyboard.press("Escape")
            expect(prompt).to_have_count(0)
            expect(dialog).to_be_visible()
            expect(page.get_by_role("dialog", name="Save As New Component")).to_have_count(0)
            dialog.get_by_role("button", name="Save").click()
            expect(prompt.get_by_role("button", name="Save as new component")).to_be_focused(timeout=DIAGRAM_TIMEOUT)
            page.keyboard.press("Enter")
            save_as_new(
                page,
                [
                    ("mine", 'A component named "mine" already exists.'),
                    ("Mine", 'A component named "Mine" already exists.'),
                    ("new_module", '"new_module" is a template and can\'t be overwritten.'),
                    (" New Module ", '"New_Module" is a template and can\'t be overwritten.'),
                ],
                "mine_too",
            )
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            self.assertTrue(has_math(page, "User_Modules.cellml:mine_too"))

            # Undo removes the new component, and redo puts it back.
            expect(page.locator("button:has(.pi-undo)")).to_be_enabled()
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_function(
                """() => !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                    .get('library').availableMath.has('User_Modules.cellml:mine_too')"""
            )
            page.keyboard.press("ControlOrMeta+Shift+z")
            page.wait_for_function(
                """() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                    .get('library').availableMath.has('User_Modules.cellml:mine_too')"""
            )
            self.assertTrue(saved_math_has(page, '<ci>d</ci>'))
            self.assertFalse(
                page.evaluate(
                    """() => String(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                        .get('library').availableMath.get('User_Modules.cellml:mine')).includes('<ci>d</ci>')"""
                )
            )
            # ----------- END ------------

            browser.close()


    def test_keeps_a_bonded_store_where_it_was_after_editing_it_from_its_parameters_tab(self):
        # Safari measured an element before its new picture loaded, and lost its transform attribute, so a store
        # edited from the table jumped away, couldn't be clicked or dragged, and its bonds broke. WebKit runs where
        # it's installed, and always in CI, which installs it.
        for engine in ("chromium", "webkit"):
            with self.subTest(engine=engine), sync_playwright() as playwright:
                # Only a missing browser skips, and never in CI: one that fails to open the app fails the test.
                if engine != "chromium" and not os.path.exists(getattr(playwright, engine).executable_path):
                    if os.environ.get("CI"):
                        self.fail(f"{engine} isn't installed")
                    self.skipTest(f"{engine} isn't installed")
                browser, page = open_app(playwright, engine)
                skip_unless_dev_server(self, page)

                # ---------- START -----------
                import_diagram(page, REACTIONS_PANEL)
                expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
                place(page, CELLDL_GROUP, REACTIONS_MODULE)
                dialog = open_editor(page, REACTIONS_MODULE)
                wait_for_diagram(page)
                glyph = page.locator(f'{DIAGRAM_SVG} [id="{STORE_A}"]')
                transform = glyph.get_attribute("transform")
                (_, from_y), reaction_end = path_points(page, BOND_A)

                # Its species, location and type there and back, from its row.
                set_element_field(dialog, STORE_A, "Species", "m")
                expect(element_row(dialog, STORE_A).locator(".element-names")).to_contain_text("q_m_c", timeout=DIAGRAM_TIMEOUT)
                set_element_field(dialog, STORE_A, "Location", "i")
                expect(element_row(dialog, STORE_A).locator(".element-names")).to_contain_text("q_m_i", timeout=DIAGRAM_TIMEOUT)
                # The type, cleared in the diagram, then chosen again from the row, the only type its bonds allow.
                set_element_type(page, STORE_A, ZERO_STORAGE_NODE)
                expect(element_row(dialog, STORE_A).locator(".p-select")).to_contain_text("Zero storage node")
                choose_element_type(page, dialog, STORE_A, "Chemical storage with Zero Node")

                # It stays put, and its bond stays level, from the store's new right-hand edge to the same point on
                # r1's edge, once the editor has redrawn it; if it never settles, the checks below say how it's off.
                # Not the saved route itself: glyphs measure differently between platforms (Linux's WebKit draws them
                # taller and wider), and a redraw routes the bond between the glyphs as they're drawn there.
                try:
                    wait_for_level_bond(page, BOND_A, reaction_end[0])
                except PlaywrightTimeoutError:
                    pass
                self.assertIsNotNone(glyph.get_attribute("transform"))
                matrix = [float(v) for v in glyph.get_attribute("transform")[len("matrix("):-1].split(",")]
                saved = [float(v) for v in transform[len("matrix("):-1].split(",")]
                self.assertAlmostEqual(matrix[4], saved[4], delta=2)
                self.assertAlmostEqual(matrix[5], saved[5], delta=2)
                width, height = glyph.locator("image").evaluate("i => { const b = i.getBBox(); return [b.width, b.height] }")
                points = path_points(page, BOND_A)
                self.assertEqual(len(points), 2)
                self.assertAlmostEqual(points[1][0], reaction_end[0], delta=0.5)
                self.assertAlmostEqual(points[0][1], points[1][1], delta=0.5)
                self.assertAlmostEqual(points[0][1], matrix[5] + height / 2, delta=1.5)
                self.assertAlmostEqual(points[0][0], matrix[4] + width, delta=1.5)

                # It can be clicked, and dragged with its bond.
                click_element(page, STORE_A)
                expect(glyph.locator("rect.selection-element")).to_have_class(re.compile(r"\bselected\b"))
                box = glyph.bounding_box()
                x, y = element_centre(page, STORE_A)
                page.mouse.down()
                page.mouse.move(x + 60, y + 40, steps=8)
                page.mouse.up()
                moved = glyph.bounding_box()
                self.assertAlmostEqual(moved["x"] - box["x"], 60, delta=12)
                self.assertAlmostEqual(moved["y"] - box["y"], 40, delta=12)
                # Its end at r1 slides round r1's edge as the bond turns.
                dragged = path_points(page, BOND_A)
                self.assertEqual(len(dragged), 2)
                self.assertAlmostEqual(dragged[1][0], reaction_end[0], delta=0.5)
                self.assertGreater(dragged[0][1], from_y + 20)
                # ----------- END ------------

                browser.close()

    def test_draws_bonds_with_the_chosen_arrowheads_and_shows_the_reactions_panel(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            skip_unless_dev_server(self, page)

            # ---------- START -----------
            import_diagram(page, REACTIONS_PANEL)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, REACTIONS_MODULE)
            dialog = open_editor(page, REACTIONS_MODULE)
            wait_for_diagram(page)

            # Bonds end in a classic closed arrowhead by default.
            page.wait_for_function(f"({BOND_MARKER})()?.includes('celldl-display-arrow-classic')")

            # The Reactions panel shows each reaction's equation, with B's bondCount as its coefficient; the
            # editor's Annotations panel is offered, its Variables panel isn't.
            host = page.locator(".celldl-pane .celldl-host")
            expect(host.locator("#variables-panel")).to_have_count(0)
            expect(host.locator("#annotations-panel")).to_have_count(1)
            host.locator("#reactions-panel").click()
            expect(host.get_by_label("Equation of r1")).to_have_value("A[c] + 2 B[c] + ATP[c] ⇌ C[c]")
            expect(host.get_by_label("Equation of r2")).to_have_value("C[c] + ATP[c] ⇌ D[c]")

            # Chosen in Settings, bond-graph half arrows replace them.
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()
            page.get_by_role("button", name="Settings", exact=True).click()
            settings = page.get_by_role("dialog", name="Settings")
            settings.get_by_label("Bond arrowheads").click()
            page.get_by_role("option", name=re.compile("^Bond graph")).click()
            settings.get_by_role("button", name="Save Changes").click()
            expect(settings).to_be_hidden()
            dialog = open_editor(page, REACTIONS_MODULE)
            wait_for_diagram(page)
            page.wait_for_function(f"({BOND_MARKER})()?.includes('celldl-display-arrow-bond')")

            # A change applies to an open diagram straight away.
            page.evaluate(
                """async () => {
                    const { useAppSettings } = await import('/src/composables/useAppSettings.js')
                    useAppSettings().saveAppSettings({ arrowStyle: 'classic' })
                }"""
            )
            page.wait_for_function(f"({BOND_MARKER})()?.includes('celldl-display-arrow-classic')")
            # ----------- END ------------

            browser.close()


    def test_keeps_a_species_annotation_from_the_annotations_panel_in_the_saved_diagram(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            skip_unless_dev_server(self, page)

            # ---------- START -----------
            import_diagram(page, REACTIONS_PANEL)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, REACTIONS_MODULE)
            dialog = open_editor(page, REACTIONS_MODULE)
            wait_for_diagram(page)
            name, file = component_of(dialog)
            math_ref = f"{file}:{name}"
            self.assertNotIn("4167", stored_document(page, math_ref))

            # A ChEBI ID entered on species A and applied is kept in the diagram.
            host = page.locator(".celldl-pane .celldl-host")
            host.locator("#annotations-panel").click()
            # The panel rereads the diagram as it opens, dropping an entry made first, so it's entered again until kept.
            chebi = host.get_by_label(re.compile(r"^ChEBI ID of A\b"))
            apply = host.get_by_role("button", name="Apply", exact=True)
            for _ in range(5):
                chebi.fill("4167")
                chebi.press("Tab")
                try:
                    expect(apply).to_be_enabled(timeout=1000)
                    break
                except AssertionError:
                    pass
            apply.click()
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden(timeout=DIAGRAM_TIMEOUT)
            self.assertIn("4167", stored_document(page, math_ref))

            # Reopened, the panel shows it again.
            dialog = open_editor(page, REACTIONS_MODULE)
            wait_for_diagram(page)
            host.locator("#annotations-panel").click()
            expect(host.get_by_label(re.compile(r"^ChEBI ID of A\b"))).to_have_value(re.compile("4167"))
            # ----------- END ------------

            browser.close()

    def test_switches_location_shading_from_the_status_bar_and_remembers_it(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, REACTIONS_PANEL)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, REACTIONS_MODULE)
            dialog = open_editor(page, REACTIONS_MODULE)
            wait_for_diagram(page)

            # On by default: the editor shades the region its elements' location marks out.
            shading = dialog.locator(".celldl-live").get_by_label("Location shading")
            expect(shading).to_be_checked()
            page.wait_for_function(f"document.querySelector('{DIAGRAM_SVG} #{REGION_LAYER}')?.childElementCount > 0")

            # Switched off, the shading goes from the open diagram.
            shading.click()
            expect(shading).not_to_be_checked()
            page.wait_for_function(f"!document.querySelector('{DIAGRAM_SVG} #{REGION_LAYER}')")

            # It's remembered: off when the diagram is next opened, until switched back on.
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()
            dialog = open_editor(page, REACTIONS_MODULE)
            wait_for_diagram(page)
            shading = dialog.locator(".celldl-live").get_by_label("Location shading")
            expect(shading).not_to_be_checked()
            self.assertFalse(page.evaluate("JSON.parse(localStorage.getItem('phlynx-settings')).celldlLocationShading"))
            expect(page.locator(f"{DIAGRAM_SVG} #{REGION_LAYER}")).to_have_count(0)

            shading.click()
            expect(shading).to_be_checked()
            page.wait_for_function(f"document.querySelector('{DIAGRAM_SVG} #{REGION_LAYER}')?.childElementCount > 0")
            # ----------- END ------------

            browser.close()

    def test_offers_no_grouping_in_the_context_menu(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_and_open(page)
            menu = page.locator(".p-contextmenu")

            # Groups mean nothing to the model, so neither an element's menu nor the canvas's offers them.
            element = page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component").first
            x, y = element_centre(page, element.get_attribute("id"))
            page.mouse.click(x, y, button="right")
            expect(menu.get_by_text("Delete", exact=True)).to_be_visible()
            for label in ("Group", "Edit group", "Ungroup"):
                expect(menu.get_by_text(label, exact=True)).to_have_count(0)
            page.keyboard.press("Escape")
            expect(menu).to_be_hidden()

            box = page.locator(DIAGRAM_SVG).bounding_box()
            page.mouse.click(box["x"] + 30, box["y"] + box["height"] - 30, button="right")
            expect(menu.get_by_text("Add element…", exact=True)).to_be_visible()
            for label in ("Group", "Edit group", "Ungroup"):
                expect(menu.get_by_text(label, exact=True)).to_have_count(0)
            # ----------- END ------------

            browser.close()

    def test_reorganises_from_the_status_line_in_the_chosen_mode_and_undoes_it(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            before = page.evaluate(COMPONENT_CENTRES)

            # The Reactions panel has no Reorganise controls: the status line has them, before the Shading switch.
            host = page.locator(".celldl-pane .celldl-host")
            host.locator("#reactions-panel").click()
            expect(host.get_by_role("button", name=re.compile("Reorganise"))).to_have_count(0)
            line = dialog.locator(".celldl-live")
            button = line.get_by_role("button", name="Reorganise", exact=True)
            expect(button).to_be_enabled(timeout=DIAGRAM_TIMEOUT)

            # A mode is picked from the editor's list, and remembered for this viewer.
            line.get_by_label("Reorganise mode").click()
            page.get_by_role("option", name="Short bonds").click()
            expect(line.get_by_label("Reorganise mode")).to_have_text("Short bonds")
            self.assertEqual(page.evaluate("localStorage.getItem('phlynx.celldl.reorganiseMode')"), "compact")

            # Reorganised, the diagram's elements move, and the status line says how.
            button.click()
            expect(line.locator(".celldl-reorganise-note")).to_contain_text(re.compile("Complexity|No simpler layout"), timeout=SIMULATION_TIMEOUT)
            expect(button).to_be_enabled()
            if "No simpler layout" in line.locator(".celldl-reorganise-note").inner_text():
                self.skipTest("The editor found no simpler layout for this diagram.")
            page.wait_for_function(f"JSON.stringify(({COMPONENT_CENTRES})()) !== {json.dumps(json.dumps(before, separators=(",", ":")))}")

            # Undo, straight after the button, puts every element back.
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_function(f"JSON.stringify(({COMPONENT_CENTRES})()) === {json.dumps(json.dumps(before, separators=(",", ":")))}")
            # ----------- END ------------

            browser.close()

    def test_values_a_term_added_in_the_reactions_panel_and_a_chemostat_from_the_parameters_tab(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, REACTIONS_PANEL)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, REACTIONS_MODULE)
            dialog = open_editor(page, REACTIONS_MODULE)
            wait_for_diagram(page)

            # A new species in r1's equation gets a new store, with the palette's defaults: K of 1 and an initial
            # value of 0, so the diagram still converts and the store's values are named and editable.
            host = page.locator(".celldl-pane .celldl-host")
            host.locator("#reactions-panel").click()
            equation = host.get_by_label("Equation of r1")
            equation.fill("A[c] + 2 B[c] + ATP[c] + X[c] ⇌ C[c]")
            equation.press("Enter")
            initial = parameter_value(dialog, "q_X_c_init")
            expect(initial).to_be_enabled(timeout=DIAGRAM_TIMEOUT)
            expect(initial).to_have_attribute("placeholder", "0")
            K = parameter_value(dialog, "K_q_X_c")
            expect(K).to_be_enabled()
            expect(K).to_have_attribute("placeholder", "1")

            # This instance's values, set before the store is saved, and a chemostat's fixed potential.
            initial.fill("5")
            initial.press("Enter")
            potential = parameter_value(dialog, "u_S_ATP_c")
            expect(potential).to_be_enabled()
            expect(potential).to_have_attribute("placeholder", "1")
            potential.fill("2")
            potential.press("Enter")

            # An unnamed new reaction is R1, with a store for its new species and a copy of the chemostat, each
            # valued as the palette's would be (the copy keeps its chemostat's potential).
            new_equation = host.get_by_label("New reaction's equation")
            new_equation.fill("D[c] + ATP[c] <=> Y[c]")
            new_equation.press("Enter")
            for name, default in [("kappa_Rx_R1_c", "1"), ("q_Y_c_init", "0"), ("K_q_Y_c", "1"), ("u_S_ATP_c_3", "1")]:
                cell = parameter_value(dialog, name)
                expect(cell).to_be_enabled(timeout=DIAGRAM_TIMEOUT)
                expect(cell).to_have_attribute("placeholder", default)
            dialog.get_by_role("button", name="Apply").click()
            accept_overwrite(page)
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            wait_for_diagram(page)
            self.assertTrue(saved_math_has(page, "q_X_c"))
            self.assertTrue(saved_math_has(page, "kappa_Rx_R1_c"))
            expect(parameter_value(dialog, "q_X_c_init")).to_have_value("5")
            expect(parameter_value(dialog, "K_q_X_c")).to_have_value("")
            expect(parameter_value(dialog, "u_S_ATP_c")).to_have_value("2")
            # ----------- END ------------

            browser.close()

    def test_shows_a_value_a_connection_supplies_as_set_by_it_and_runs_with_it(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE, x=450)
            import_cellml(page, INITIAL_AMOUNT)
            place(page, "initial amount", INITIAL_AMOUNT_MODULE, x=950)

            # A port on each instance, one carrying the computed amount, the other the store S's initial value.
            dialog = open_editor(page, INITIAL_AMOUNT_MODULE)
            add_port(page, dialog, "initial", "X")
            dialog.get_by_role("button", name="Save", exact=True).click()
            expect(dialog).to_have_count(0)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            add_port(page, dialog, "initial", "q_S_c_init")

            # Until an edge connects the ports, the value is the diagram's, editable.
            expect(parameter_value(dialog, "q_S_c_init")).to_be_enabled()
            dialog.get_by_role("button", name="Save", exact=True).click()
            expect(dialog).to_have_count(0)
            connect(page, ENZYME_MODULE, INITIAL_AMOUNT_MODULE)

            # Connected, the store's initial value is set by the other instance's X: read-only, and not to set.
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            initial = parameter_value(dialog, "q_S_c_init")
            expect(initial).to_be_disabled()
            cell = dialog.locator('.celldl-parameters [data-variable="q_S_c_init"]')
            expect(cell.locator(".supplied-hint")).to_have_text(re.compile(r"Set by initial_amount\w*\.X"))
            expect(cell.locator("xpath=ancestor::tr[1]")).not_to_have_class(re.compile(r"element-row--unset"))

            # A run starts S at the supplied 2 X0 = 1.5, not the diagram's 1.
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").check()
            dialog.get_by_role("button", name="Simulate the whole model").click()
            expect(dialog.get_by_text("Simulated the whole model")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            self.assertAlmostEqual(first_value(page, "q_S_c"), 1.5)
            # ----------- END ------------

            browser.close()

    def test_drives_a_store_from_a_connection_after_asking_and_restores_it_when_the_edge_goes(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE, x=950)
            import_cellml(page, DRIVEN_AMOUNT)
            place(page, "driven amount", DRIVEN_AMOUNT_MODULE, x=450)

            # A port on each instance, one carrying the computed amount X, the other the store S's amount.
            dialog = open_editor(page, DRIVEN_AMOUNT_MODULE)
            add_port(page, dialog, "amount", "X")
            dialog.get_by_role("button", name="Save", exact=True).click()
            expect(dialog).to_have_count(0)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            add_port(page, dialog, "amount", "q_S_c")
            dialog.get_by_role("button", name="Save", exact=True).click()
            expect(dialog).to_have_count(0)

            # Both compute their variable, so the connection asks before it sets the store; cancelled, it isn't made.
            prompt = page.locator(".confirm-container").filter(has_text="Set a store from a connection")
            drag_edge(page, DRIVEN_AMOUNT_MODULE, ENZYME_MODULE)
            expect(prompt).to_contain_text(re.compile(r"Set q_S_c of enzyme\w* from driven_amount\w*\.X\?"))
            prompt.get_by_role("button", name="Cancel", exact=True).click()
            expect(prompt).to_have_count(0)
            expect(page.locator(".vue-flow__edge")).to_have_count(0)

            drag_edge(page, DRIVEN_AMOUNT_MODULE, ENZYME_MODULE)
            prompt.get_by_role("button", name="Set from connection", exact=True).click()
            expect(page.locator(".vue-flow__edge")).to_have_count(1)

            # The store's initial value is set by the connection, so it is read-only and not to set.
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            expect(parameter_value(dialog, "q_S_c_init")).to_be_disabled()
            cell = dialog.locator('.celldl-parameters [data-variable="q_S_c_init"]')
            expect(cell.locator(".supplied-hint")).to_have_text(re.compile(r"Set by driven_amount\w*\.X"))
            expect(cell.locator("xpath=ancestor::tr[1]")).not_to_have_class(re.compile(r"element-row--unset"))

            # A whole-model run has S follow X = 0.5 (1 + sin t), from 0.5 rather than the diagram's 1.
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").check()
            dialog.get_by_role("button", name="Simulate the whole model").click()
            expect(dialog.get_by_text("Simulated the whole model")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            self.assertAlmostEqual(first_value(page, "X"), 0.5, places=5)
            self.assertAlmostEqual(final_value(page, "X"), 0.5 * (1 + math.sin(1)), places=4)
            # The store's potential rises with it, where on its own S would fall as the enzyme binds it.
            self.assertGreater(final_value(page, "u_q_S_c"), first_value(page, "u_q_S_c"))
            page.keyboard.press("Escape")
            expect(dialog).to_have_count(0)

            # With the edge gone, S runs on its own dynamics again, from 1.
            page.locator(".vue-flow__edge").first.click(force=True)
            page.keyboard.press("Delete")
            expect(page.locator(".vue-flow__edge")).to_have_count(0)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            expect(parameter_value(dialog, "q_S_c_init")).to_be_enabled()
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").check()
            dialog.get_by_role("button", name="Simulate the whole model").click()
            expect(dialog.get_by_text("Simulated the whole model")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            self.assertAlmostEqual(first_value(page, "q_S_c"), 1, places=5)
            self.assertLess(final_value(page, "q_S_c"), 1)
            # ----------- END ------------

            browser.close()

    def test_builds_a_new_module_in_cellular_units_and_rescales_its_values_when_switched_to_si(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            # A new module's diagram is Cellular, the default: a reaction drawn in it values its stores in fmol.
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            show_diagram_tab(page, dialog)
            host = page.locator(".celldl-pane .celldl-host")
            host.locator("#reactions-panel").click()
            equation = host.get_by_label("New reaction's equation")
            equation.fill("A[c] <=> B[c]")
            equation.press("Enter")
            initial = parameter_value(dialog, "q_A_c_init")
            expect(initial).to_be_enabled(timeout=DIAGRAM_TIMEOUT)
            expect(dialog.locator(".celldl-parameters .unit-system")).to_contain_text("Cellular (fmol, pL)")
            expect(dialog.locator('.celldl-parameters [data-variable="q_A_c_init"] .value-units')).to_have_text("fmol")

            # 5 and 1 mol, in fmol, so the same model in SI has values near 1.
            initial.fill("5e15")
            initial.press("Enter")
            other = parameter_value(dialog, "q_B_c_init")
            other.fill("1e15")
            other.press("Enter")
            dialog.get_by_role("button", name="Apply").click()
            save_as = page.locator(".p-dialog").filter(has_text="Save As New Component")
            save_as.locator("input").fill("ab_cellular")
            save_as.get_by_role("button", name="Save").click()
            # It converts with no issues, units ones included, so the save asks nothing more.
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            expect(page.locator(".confirm-container")).to_have_count(0)
            wait_for_diagram(page)
            for name, units in [("q_A_c_init", "fmol"), ("K_q_A_c", "per_fmol"), ("kappa_Rx_R1_c", "fmol_per_s")]:
                expect(dialog.locator(f'.celldl-parameters [data-variable="{name}"] .value-units')).to_have_text(units)
            self.assertTrue(saved_math_has(page, 'units="fmol"'))

            run_this_instance(page, dialog)
            cellular = final_value(page, "q_B_c")
            self.assertIsNotNone(cellular)

            # Switched to SI and saved, its values are rescaled to mol, keeping the quantities, so the run is the same.
            dialog.get_by_role("tab", name=re.compile(r"Parameters \(")).click()
            dialog.locator(".celldl-parameters .unit-system .p-select").click()
            page.locator(".p-select-option").filter(has_text="SI (mol, L)").click()
            expect(dialog.locator(".celldl-parameters .unit-system")).to_contain_text("SI (mol, L)")
            dialog.get_by_role("button", name="Apply").click()
            accept_overwrite(page)
            prompt = page.locator(".confirm-container").filter(has_text="Units Changed")
            expect(prompt).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            expect(prompt).to_contain_text("q_A_c_init")
            expect(prompt).to_contain_text("fmol → mole, ×10⁻¹⁵")
            prompt.get_by_role("button", name="Rescale and Save").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            wait_for_diagram(page)
            expect(parameter_value(dialog, "q_A_c_init")).to_have_value("5")
            expect(parameter_value(dialog, "q_B_c_init")).to_have_value("1")
            expect(dialog.locator('.celldl-parameters [data-variable="q_A_c_init"] .value-units')).to_have_text("mole")

            run_this_instance(page, dialog)
            page.wait_for_function(
                """([name, before]) => {
                    const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                        .get('simulationResults').results
                    const entry = [...(results?.variables ?? [])].find(([key]) => key === name || key.endsWith('/' + name))
                    return entry && entry[1].values[entry[1].values.length - 1] !== before
                }""",
                arg=["q_B_c", cellular],
                timeout=SIMULATION_TIMEOUT,
            )
            self.assertAlmostEqual(final_value(page, "q_B_c") / (cellular * 1e-15), 1, places=5)
            # ----------- END ------------

            browser.close()

    def test_keeps_an_imported_diagram_without_a_unit_system_in_si(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ENZYME_MODULE)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            parameter_value(dialog, "kappa_Rx_r1_c")
            expect(dialog.locator(".celldl-parameters .unit-system")).to_contain_text("SI (mol, L)")
            expect(dialog.locator('.celldl-parameters [data-variable="kappa_Rx_r1_c"] .value-units')).to_have_text("mol_per_s")
            with open(ENZYME) as f:
                imported = f.read()
            self.assertNotIn("unitSystem", imported)
            self.assertEqual(stored_document(page, f"User_Modules.celldl:{ENZYME_MODULE}"), imported)
            # ----------- END ------------

            browser.close()


    def assert_sections(self, content, simple):
        """Checks the CellML Text has the one-reaction sections in order, each after a blank line (but the first in
        Simple Mode), with the ODEs last."""
        expect(content).to_contain_text(SECTION_HEADINGS[-1])
        lines = [line.strip() for line in text_lines(content)]
        self.assertEqual([line for line in lines if line.startswith("//")], SECTION_HEADINGS)
        for heading in SECTION_HEADINGS[1:] if simple else SECTION_HEADINGS:
            self.assertEqual(lines[lines.index(heading) - 1], "")
        last = [line for line in lines[lines.index(SECTION_HEADINGS[-1]) + 1:] if line and line != "enddef;"]
        self.assertEqual(len(last), 2)
        self.assertTrue(all(line.startswith("ode(") for line in last))

    def test_heads_each_section_of_a_diagrams_cellml_text_with_a_comment(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            import_diagram(page, ONE_REACTION)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, CELLDL_GROUP, ONE_REACTION_MODULE)
            dialog = open_editor(page, ONE_REACTION_MODULE)
            wait_for_diagram(page)
            content = cellml_text(dialog)
            switch = dialog.locator(".mode-switch input")
            for simple in (True, False):
                if switch.is_checked() != simple:
                    switch.click()
                self.assert_sections(content, simple)

            # The headings are PhLynx's layout, not an edit: the dialog closes without asking, and the CellML has no
            # comments.
            dialog.get_by_role("button", name="Cancel", exact=True).click()
            expect(dialog).to_be_hidden()
            math = page.evaluate(
                """(ref) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                    .get('library').availableMath.get(ref)""",
                f"User_Modules.celldl:{ONE_REACTION_MODULE}",
            )
            self.assertIn("v_Rx_R1_c", math)
            self.assertNotIn("<!--", math)

            # A diagram edit keeps them, live and once saved.
            dialog = open_editor(page, ONE_REACTION_MODULE)
            wait_for_diagram(page)
            set_element_field(dialog, "ID-00000009", "Species", "P")
            content = cellml_text(dialog)
            expect(content).to_contain_text("q_P_c", timeout=DIAGRAM_TIMEOUT)
            self.assert_sections(content, switch.is_checked())
            dialog.get_by_role("button", name="Apply").click()
            accept_overwrite(page)
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            content = cellml_text(dialog)
            expect(content).to_contain_text("q_P_c")
            self.assert_sections(content, switch.is_checked())
            # ----------- END ------------

            browser.close()

if __name__ == '__main__':
    unittest.main()
