"""Shared waits and the synthetic workspaces the end-to-end tests load."""
import base64
import gzip
import os

from playwright.sync_api import expect

try:
    from .config import BASE_URL, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, RESOURCE_PATH


# How long the app may take to mount and load its built-in library. Long, since a CI runner shares its CPUs
# between several tests at once; every wait for the app to be ready uses it.
APP_READY_TIMEOUT = 60000
# The default for every other wait. Playwright's own 5 s is too short under the same load.
DEFAULT_TIMEOUT = 15000

SYNTHETIC_PATH = os.path.join(RESOURCE_PATH, "synthetic")
# Three instances, source -> relay -> sink, made by the app from synthetic/chain.cellml
# (see build_synthetic_fixtures.py). Each relaxes towards the one before it, so at t = 1:
# source/x = e^-2, relay/y = e^-1 - e^-2 and sink/z = e^-1 - relay/y.
CHAIN_WORKSPACE = "chain-workspace.json"
CHAIN_NODES = ("source", "relay", "sink")


def read_synthetic(name):
    """Reads a file from tests/resources/synthetic."""
    with open(os.path.join(SYNTHETIC_PATH, name), "rb") as f:
        return f.read()


def workspace_payload(name=CHAIN_WORKSPACE):
    """Encodes a synthetic workspace as ?open=workspace_json takes it: gzipped, then base64."""
    return base64.b64encode(gzip.compress(read_synthetic(name))).decode()


def workspace_url(name=CHAIN_WORKSPACE):
    """The URL that opens a synthetic workspace."""
    return BASE_URL + "?open=workspace_json#" + workspace_payload(name)


def use_default_timeouts(page_or_context):
    """Gives a page or context's waits and actions the suite's default timeout."""
    page_or_context.set_default_timeout(DEFAULT_TIMEOUT)
    page_or_context.set_default_navigation_timeout(APP_READY_TIMEOUT)


def wait_for_library(page):
    """Waits until the built-in library has loaded, after which loads and drops go ahead at once."""
    expect(page.locator("html[data-library-ready]")).to_be_attached(timeout=APP_READY_TIMEOUT)


# Whether everything the canvases draw has held its place for several frames: a fit, drag or layout is done.
# Counted in frames rather than time, so a busy runner, which draws fewer of them, waits longer.
STILL_JS = """(selector) => {
    const now = [...document.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect()
        return [r.x, r.y, r.width, r.height].map((v) => v.toFixed(1)).join()
    }).join('|')
    const last = window.__stillWatch
    window.__stillWatch = { now, frames: last && last.now === now ? last.frames + 1 : 0 }
    return window.__stillWatch.frames >= 10
}"""
CANVAS_PARTS = ".vue-flow__transformationpane, .vue-flow__node, [data-testid^=bio-], [data-species]"


def wait_until_still(page, selector=CANVAS_PARTS):
    """Waits for the canvases to stop moving, in place of a fixed pause before measuring them."""
    page.evaluate("delete window.__stillWatch")
    page.wait_for_function(STILL_JS, arg=selector, polling="raf")


def node(page, name):
    """The canvas node of the instance called name."""
    return page.locator(".vue-flow__node").filter(has=page.get_by_text(name, exact=True))


def open_chain(page):
    """Opens the chain workspace and waits for its three nodes and two edges."""
    page.goto(workspace_url())
    wait_for_library(page)
    expect(page.locator(".vue-flow__node")).to_have_count(len(CHAIN_NODES), timeout=APP_READY_TIMEOUT)
    expect(page.locator(".vue-flow__edge")).to_have_count(2)
