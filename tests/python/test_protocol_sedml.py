"""
Checks run_sedml.py, the script a protocol's SED-ML export carries: it always compiles and imports only what its
requirements.txt (src/services/export/templates/requirements.txt, which the export ships) lists; with libsedml and
Myokit at hand it runs tests/python/fixtures/decay (two experiments of two sub-experiments after a warm-up, a one-point
segment and feature plots) and checks its results against the model's exact solution. The fixture's protocol.sedml is
written by PhLynx's builder: tests/vitest/services/export/protocolSedml.test.js checks it still is (and rewrites it
with `-u`).

Run with a Python that has the script's requirements (PHLYNX_SEDML_PYTHON picks the one that runs the script):

    PHLYNX_SEDML_PYTHON=.venv/bin/python .venv/bin/python -m unittest discover -s tests/python -v

PHLYNX_SEDML_BUNDLES=<dir> also runs each exported bundle in <dir> (one folder per parity case, holding
protocol.sedml, model.cellml and expected.json) and compares its report with circulatory autogen's references in
tests/resources/protocols/parity. expected.json holds {"case": "<name in cases.json>"}, and optionally "report" (the
report's id, "report" by default) and "experiments": [{"time": "<dataset id>", "variables": {"<c/v>": "<dataset id>"}}]
(by default experiment e's time is ds_dg_e{e}_time and its j-th case variable ds_dg_e{e}_tr{j}).
"""
import ast
import csv
import json
import math
import os
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(ROOT, "src", "services", "export", "templates", "run_sedml.py")
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
PARITY = os.path.join(ROOT, "tests", "resources", "protocols", "parity")
PYTHON = os.environ.get("PHLYNX_SEDML_PYTHON", sys.executable)
BUNDLES = os.environ.get("PHLYNX_SEDML_BUNDLES")
REQUIREMENTS_TXT = os.path.join(os.path.dirname(SCRIPT), "requirements.txt")
# The module a package of requirements.txt is imported as, where the two names differ.
MODULES = {"python-libsedml": "libsedml"}
FIGURES = ["figure_traces", "plot_fp0", "plot_fp1"]

_has_requirements = None


def has_requirements():
    """Whether PYTHON can import libsedml and Myokit."""
    global _has_requirements
    if _has_requirements is None:
        check = subprocess.run([PYTHON, "-c", "import libsedml, myokit"], capture_output=True)
        _has_requirements = check.returncode == 0
    return _has_requirements


def read_requirements():
    """The modules requirements.txt's packages are imported as."""
    with open(REQUIREMENTS_TXT) as f:
        packages = [re.split(r"[<>=!~;\[ ]", line.strip(), maxsplit=1)[0] for line in f if line.strip() and not line.startswith("#")]
    return {MODULES.get(package.lower(), package.lower()) for package in packages}


def run_script(sedml, out, *extra):
    """Runs run_sedml.py on a document, without showing its figures."""
    return subprocess.run([PYTHON, SCRIPT, sedml, "--out", out, "--no-show", *extra],
                          capture_output=True, text=True, timeout=600)


def read_report(path):
    """Reads a report CSV into its columns, leaving out the empty cells of shorter ones."""
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    return {name: [float(row[name]) for row in rows if row[name] != ""] for name in rows[0]}


def decay_exactly(experiment, t):
    """The fixture's x at experiment time t, solved by hand: dx/dt = -k x + u, with the protocol's k, u and x."""
    if experiment == 0:  # x = 1 from the model, k = 0.5 through the 1 s warm-up and sub-experiment 1, then k = 2.
        return math.exp(-0.5 * (1 + t)) if t <= 1 else math.exp(-1) * math.exp(-2 * (t - 1))
    if t <= 1:  # x = 1 from the model, k = 1 through the warm-up and sub-experiment 1.
        return math.exp(-(1 + t))
    before = math.exp(-2) * math.exp(-0.25 * (min(t, 2.9) - 1))  # k = 0.25 in sub-experiment 2...
    return before if t <= 2.9 else 2 + (before - 2) * math.exp(-0.25 * (t - 2.9))  # ...and u = 0.5 for its last 0.1 s.


class TestRunSedmlScript(unittest.TestCase):

    def test_compiles(self):
        with tempfile.TemporaryDirectory() as folder:  # Not beside the script, which is in the app's source.
            py_compile.compile(SCRIPT, cfile=os.path.join(folder, "run_sedml.pyc"), doraise=True)

    def test_imports_only_the_standard_library_and_its_requirements(self):
        with open(SCRIPT) as f:
            tree = ast.parse(f.read())
        imported = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        imported |= {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
        requirements = read_requirements()
        self.assertIn("libsedml", requirements)
        others = {name for name in imported if name.split(".")[0] not in requirements | set(sys.stdlib_module_names)}
        self.assertEqual(others, set())

    def test_says_what_to_install_when_a_requirement_is_missing(self):
        # A Python with none of the requirements: the interpreter running these tests, isolated from site-packages.
        run = subprocess.run([sys.executable, "-I", "-S", SCRIPT, "--help"], capture_output=True, text=True, timeout=60)
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertIn("pip install -r requirements.txt", run.stderr)
        self.assertNotIn("Traceback", run.stderr)


@unittest.skipUnless(has_requirements(), f"{PYTHON} can't import libsedml and myokit (set PHLYNX_SEDML_PYTHON).")
class TestRunSedmlOnTheDecayFixture(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp(prefix="run_sedml_")
        cls.out = os.path.join(cls.folder, "results")
        cls.process = run_script(os.path.join(FIXTURES, "decay", "protocol.sedml"), cls.out, "--format", "png,svg")
        cls.report = read_report(os.path.join(cls.out, "report.csv")) if cls.process.returncode == 0 else {}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder, ignore_errors=True)

    def setUp(self):
        self.assertEqual(self.process.returncode, 0, self.process.stderr)

    def test_writes_each_figure_report_and_summary(self):
        for name in FIGURES:
            for fmt in ("png", "svg"):
                self.assertTrue(os.path.isfile(os.path.join(self.out, f"{name}.{fmt}")), f"{name}.{fmt}")
        self.assertFalse(os.path.exists(os.path.join(self.out, "plot_g0_e0.png")), "a figure's plots go in the figure")
        with open(os.path.join(self.out, "run_info.json")) as f:
            info = json.load(f)
        self.assertLessEqual({"python", "libsedml", "myokit", "numpy"}, set(info["versions"]))
        self.assertIn("simulate", info["timings_s"])
        with open(os.path.join(self.out, "traces.csv"), newline="") as f:
            traces = list(csv.DictReader(f))
        self.assertEqual(len([row for row in traces if row["output"] == "plot_fp0"]), 2)

    def test_logs_each_segment_at_its_points_dropping_first_points_and_keeping_one_point(self):
        sub2 = [round(1.1 + 0.1 * i, 10) for i in range(20)]
        expected = [[0.1 * i for i in range(11)] + sub2, [0.1 * i for i in range(11)] + sub2[:-1] + [3.0]]
        for e, times in enumerate(expected):
            ours = self.report[f"ds_dg_e{e}_time"]
            self.assertEqual(len(ours), 31, f"experiment {e + 1}")
            self.assertLess(max(abs(a - b) for a, b in zip(ours, times)), 1e-9, f"experiment {e + 1}")

    def test_carries_states_from_segment_to_segment(self):
        for e in range(2):
            for t, x in zip(self.report[f"ds_dg_e{e}_time"], self.report[f"ds_dg_e{e}_tr0"]):
                self.assertAlmostEqual(x / decay_exactly(e, t), 1, delta=1e-6, msg=f"experiment {e + 1} at {t}")

    def test_reports_a_constant_as_it_is_at_each_point(self):
        self.assertEqual(set(self.report["ds_dg_e0_tr1"]), {0.0})
        self.assertEqual(self.report["ds_dg_e1_tr1"][-1], 0.5)
        self.assertEqual(set(self.report["ds_dg_e1_tr1"][:-1]), {0.0})

    def test_features_reduce_their_sub_experiment(self):
        import numpy as np

        for e, k in enumerate((2.0, 0.25)):
            t, x = np.array(self.report[f"ds_dg_e{e}_time"]), np.array(self.report[f"ds_dg_e{e}_tr0"])
            first, second = x[t <= 1 + 1e-9], x[t > 1 + 1e-9]
            self.assertAlmostEqual(self.report[f"ds_dg_e{e}_f0"][0], np.mean(second), places=12)
            self.assertAlmostEqual(self.report[f"ds_dg_e{e}_f1"][0], np.max(first) - np.min(first), places=12)
            self.assertEqual(self.report[f"ds_dg_e{e}_fp0_x"], [k])
            self.assertEqual(self.report[f"ds_dg_e{e}_fp1_x"], [e + 1.0])

    def test_a_target_the_model_lacks_stops_it_with_a_suggestion(self):
        folder = os.path.join(self.folder, "bad")
        shutil.copytree(os.path.join(FIXTURES, "decay"), folder)
        sedml = os.path.join(folder, "protocol.sedml")
        with open(sedml) as f:
            text = f.read()
        with open(sedml, "w") as f:
            f.write(text.replace("cellml:variable[@name='x']", "cellml:variable[@name='xx']"))
        run = run_script(sedml, os.path.join(folder, "results"))
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertIn("decay/xx", run.stderr)
        self.assertIn("Did you mean decay/x", run.stderr)
        self.assertNotIn("Traceback", run.stderr)

    def test_reads_a_functional_range_of_model_variables(self):
        folder = os.path.join(self.folder, "functional")
        shutil.copytree(os.path.join(FIXTURES, "decay"), folder)
        sedml = os.path.join(folder, "protocol.sedml")
        with open(sedml) as f:
            text = f.read()
        k = "/cellml:model/cellml:component[@name='instance_parameters']/cellml:variable[@name='k']"
        functional = (f'<functionalRange id="exp0_k" range="exp0_range"><listOfVariables><variable id="k" target="{k}" '
                      'modelReference="model"/></listOfVariables><math xmlns="http://www.w3.org/1998/Math/MathML">'
                      '<ci>k</ci></math></functionalRange>')
        anchor = '<vectorRange id="exp0_range">'
        self.assertIn(anchor, text)
        with open(sedml, "w") as f:
            f.write(text.replace(anchor, functional + anchor, 1))
        run = run_script(sedml, os.path.join(folder, "results"), "--format", "png")
        self.assertEqual(run.returncode, 0, run.stderr)

    def test_an_unknown_figure_format_stops_it_before_it_runs(self):
        run = run_script(os.path.join(FIXTURES, "decay", "protocol.sedml"), os.path.join(self.folder, "pngx"), "--format", "pngx")
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertIn("--format", run.stderr)
        self.assertNotIn("Traceback", run.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.folder, "pngx")))

    def test_a_missing_document_stops_it(self):
        run = run_script(os.path.join(self.folder, "nowhere.sedml"), os.path.join(self.folder, "none"))
        self.assertEqual(run.returncode, 2)
        self.assertIn("Can't find", run.stderr)


@unittest.skipUnless(BUNDLES, "Set PHLYNX_SEDML_BUNDLES to a folder of exported parity bundles to run them.")
@unittest.skipUnless(has_requirements(), f"{PYTHON} can't import libsedml and myokit (set PHLYNX_SEDML_PYTHON).")
class TestRunSedmlOnParityBundles(unittest.TestCase):

    def test_bundles_run_as_circulatory_autogen_runs_them(self):
        with open(os.path.join(PARITY, "cases.json")) as f:
            cases = {case["name"]: case for case in json.load(f)["cases"]}
        with open(os.path.join(PARITY, "ca-references.json")) as f:
            references = json.load(f)["cases"]
        folders = sorted(d for d in os.listdir(BUNDLES) if os.path.isfile(os.path.join(BUNDLES, d, "protocol.sedml")))
        self.assertTrue(folders, f"No bundles in {BUNDLES}.")
        with tempfile.TemporaryDirectory(prefix="run_sedml_bundles_") as scratch:
            for folder in folders:
                with self.subTest(bundle=folder):
                    with open(os.path.join(BUNDLES, folder, "expected.json")) as f:
                        expected = json.load(f)
                    case, theirs_all = cases[expected["case"]], references[expected["case"]]
                    out = os.path.join(scratch, folder)
                    run = run_script(os.path.join(BUNDLES, folder, "protocol.sedml"), out, "--format", "png")
                    self.assertEqual(run.returncode, 0, run.stderr)
                    report = read_report(os.path.join(out, f"{expected.get('report', 'report')}.csv"))
                    named = expected.get("experiments") or [
                        {"time": f"ds_dg_e{e}_time", "variables": {n: f"ds_dg_e{e}_tr{j}" for j, n in enumerate(case["variables"])}}
                        for e in range(len(theirs_all))]
                    self.assertEqual(len(named), len(theirs_all))
                    for e, (names, theirs) in enumerate(zip(named, theirs_all)):
                        ours_t = report[names["time"]]
                        self.assertEqual(len(ours_t), len(theirs["t"]), f"experiment {e + 1}")
                        self.assertLess(max(abs(a - b) for a, b in zip(ours_t, theirs["t"])), 1e-9, f"experiment {e + 1}")
                        for name in case["variables"]:
                            ours = report[names["variables"][name]]
                            scale = max(1.0, max(abs(value) for value in theirs["values"][name]))
                            gap = max(abs(a - b) for a, b in zip(ours, theirs["values"][name])) / scale
                            print(f"\n[{folder}] experiment {e + 1}, {name}: largest difference {gap:.2e} (allowed {case['tolerance']})")
                            self.assertLess(gap, case["tolerance"], f"{name}, experiment {e + 1}")


if __name__ == "__main__":
    unittest.main()
