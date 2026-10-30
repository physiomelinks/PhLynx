import os
import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


# The screen point a fraction of the way along the first edge's path.
POINT_ALONG = """(fraction) => {
    const path = document.querySelector('.vue-flow__edge-path')
    const point = path.getPointAtLength(path.getTotalLength() * fraction)
    const m = path.getScreenCTM()
    return { x: point.x * m.a + m.e, y: point.y * m.d + m.f }
}"""

# How many points along the edges, away from their ends, lie inside a module.
CROSSINGS = """() => {
    const rects = [...document.querySelectorAll('.vue-flow__node')].map((n) => n.getBoundingClientRect())
    let hits = 0
    document.querySelectorAll('.vue-flow__edge-path').forEach((path) => {
        const m = path.getScreenCTM()
        const length = path.getTotalLength()
        for (let t = 30; t < length - 30; t += 4) {
            const p = path.getPointAtLength(t)
            const x = p.x * m.a + m.e
            const y = p.y * m.d + m.f
            if (rects.some((r) => x > r.left + 2 && x < r.right - 2 && y > r.top + 2 && y < r.bottom - 2)) hits++
        }
    })
    return hits
}"""


class TestEdgeRouting(unittest.TestCase):

    def test_drag_a_segment_then_undo_redo_and_reset(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            page = browser.new_page(viewport={"width": 1400, "height": 900})

            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}")

            edge_path = page.locator(".vue-flow__edge-path").first
            expect(edge_path).to_be_visible(timeout=60000)
            page.wait_for_timeout(1500)
            original = edge_path.get_attribute("d")

            # Selecting the edge shows a handle on each segment.
            point = page.evaluate(POINT_ALONG, 0.5)
            page.mouse.click(point["x"], point["y"])
            handles = page.locator(".edge-route-handle")
            expect(handles.first).to_be_visible()

            # Drag the middle handle across its segment.
            handle = handles.nth(handles.count() // 2)
            box = handle.bounding_box()
            moves_sideways = "edge-route-handle--x" in handle.get_attribute("class")
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + (80 if moves_sideways else 0), y + (0 if moves_sideways else 80), steps=8)
            page.mouse.up()
            expect(edge_path).not_to_have_attribute("d", original)
            routed = edge_path.get_attribute("d")

            # Let the history store commit its batch first.
            page.wait_for_timeout(300)
            page.keyboard.press("ControlOrMeta+z")
            expect(edge_path).to_have_attribute("d", original)
            page.keyboard.press("ControlOrMeta+Shift+z")
            expect(edge_path).to_have_attribute("d", routed)

            # Reset Route, from the edge's menu, puts the smoothstep route back.
            point = page.evaluate(POINT_ALONG, 0.65)
            page.mouse.click(point["x"], point["y"], button="right")
            page.locator(".context-menu__item", has_text="Reset Route").click()
            expect(edge_path).to_have_attribute("d", original)

            # The segment leaving the source splits off its stub on the first move and keeps following.
            point = page.evaluate(POINT_ALONG, 0.5)
            page.mouse.click(point["x"], point["y"])
            first = page.locator(".edge-route-handle").first
            box = first.bounding_box()
            moves_sideways = "edge-route-handle--x" in first.get_attribute("class")
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + (20 if moves_sideways else 0), y + (0 if moves_sideways else 20), steps=2)
            part_way = edge_path.get_attribute("d")
            page.mouse.move(x + (90 if moves_sideways else 0), y + (0 if moves_sideways else 90), steps=6)
            expect(edge_path).not_to_have_attribute("d", part_way)
            page.mouse.up()
            expect(page.locator(".edge-route-handle").first).to_be_visible()

            browser.close()

    def test_route_edges_around_a_module_in_the_way(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            page = browser.new_page(viewport={"width": 1400, "height": 900})

            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}")
            expect(page.locator(".vue-flow__edge-path").first).to_be_visible(timeout=60000)
            page.wait_for_timeout(1500)

            # Drag var_SN over the edges, so they run beneath it.
            box = page.locator(".vue-flow__node", has_text="var_SN").bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 10)
            page.mouse.down()
            page.mouse.move(610, 540, steps=10)
            page.mouse.up()
            page.wait_for_timeout(500)
            self.assertGreater(page.evaluate(CROSSINGS), 0)

            page.mouse.click(1100, 250)
            page.mouse.click(1100, 250, button="right")
            page.locator(".context-menu__item", has_text="Route Edges Around Modules").click()
            page.wait_for_timeout(300)
            self.assertEqual(page.evaluate(CROSSINGS), 0)

            browser.close()


if __name__ == "__main__":
    unittest.main()
