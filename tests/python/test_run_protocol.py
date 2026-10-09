"""
Checks run_protocol.py, the script a protocol's export carries: it always compiles; with pandas, matplotlib and seaborn
at hand, its tables and plots work on made-up results, libcuflynx stood in for, as it isn't needed for them. Running it
for real needs libcuflynx: tests/playwright/test_simulation_tab.py does, with PHLYNX_CUFLYNX_PYTHON set.

    python -m unittest discover -s tests/python -v
"""
import importlib.util
import os
import py_compile
import sys
import tempfile
import types
import unittest
import warnings

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(ROOT, "src", "services", "export", "templates", "run_protocol.py")
LIBCUFLYNX = [
    "libcuflynx",
    "libcuflynx.param_id",
    "libcuflynx.param_id.prediction_features",
    "libcuflynx.param_id.operation_funcs",
    "libcuflynx.parsers",
    "libcuflynx.parsers.PrimitiveParsers",
    "libcuflynx.protocol_runners",
]
COLUMNS = ["item", "feature", "experiment", "subexperiment", "operation", "unit", "value"]


def has_plotting():
    return all(importlib.util.find_spec(name) for name in ("numpy", "pandas", "matplotlib", "seaborn"))


def load_script():
    """Imports the script, libcuflynx stood in for by empty modules, leaving no bytecode beside it."""
    sys.dont_write_bytecode = True
    for name in LIBCUFLYNX:
        module = sys.modules.setdefault(name, types.ModuleType(name))
        for attribute in ("get_operation_funcs_dict_for_mode", "ObsAndParamDataParser", "ProtocolExecutor", "ProtocolRunner"):
            setattr(module, attribute, None)
    import matplotlib

    matplotlib.use("Agg")
    spec = importlib.util.spec_from_file_location("run_protocol", SCRIPT)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    return script


class CompileTest(unittest.TestCase):
    def test_compiles(self):
        with tempfile.TemporaryDirectory() as folder:
            py_compile.compile(SCRIPT, cfile=os.path.join(folder, "run_protocol.pyc"), doraise=True)


@unittest.skipUnless(has_plotting(), "needs numpy, pandas, matplotlib and seaborn")
class PlotsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = load_script()
        import pandas

        cls.pd = pandas

    def features(self, rows):
        return self.pd.DataFrame([dict(zip(COLUMNS, row)) for row in rows], columns=COLUMNS)

    def test_renames_the_parameters_an_output_records_keeping_its_name(self):
        self.script.PARAMETER_NAMES = {"clamp/Vc": "membrane/V_clamp"}
        try:
            item = {"data_item_name": "Vc_mean", "operands": ["clamp/Vc"], "unit": "mV", "operation": "mean"}
            self.script.rename_operands(item)
            self.assertEqual(item["operands"], ["membrane/V_clamp"])
            self.assertEqual(item["trace_name_for_plotting"], "clamp/Vc")
            legacy = {"variable": "clamp/Vc", "unit": "mV", "operation": "mean"}
            self.script.rename_operands(legacy)
            self.assertEqual(legacy["operands"], ["membrane/V_clamp"])
            other = {"data_item_name": "V", "operands": ["membrane/V"], "unit": "mV"}
            self.script.rename_operands(other)
            self.assertEqual(other, {"data_item_name": "V", "operands": ["membrane/V"], "unit": "mV"})
        finally:
            self.script.PARAMETER_NAMES = {}

    def test_sub_slices_share_the_point_between_sub_experiments(self):
        import numpy

        slices = self.script.sub_slices(numpy.linspace(0, 3, 31), [1, 2])
        self.assertEqual([(s.start, s.stop) for s in slices], [(0, 11), (10, 31)])

    def items(self, rows):
        """Prediction items as libcuflynx parses them: (name, group, experiment, operation)."""
        return {
            "data_item_names": [row[0] for row in rows],
            "item_names_for_plotting": [row[1] for row in rows],
            "experiment_idxs": [row[2] for row in rows],
            "operations": [row[3] for row in rows],
            "data_types": [None for _ in rows],
        }

    def test_plots_a_feature_against_another_an_input_and_the_experiment(self):
        features = self.features(
            [("I_e0", "I_peak", 0, 1, "min", "nA", -1.0), ("I_e1", "I_peak", 1, 1, "min", "nA", -2.0),
             ("V_e0", "V_mean", 0, 1, "mean", "mV", 0.0), ("V_e1", "V_mean", 1, 1, "mean", "mV", -20.0)]
        )
        groups = self.script.feature_groups(self.items([("I_e0", "I_peak", 0, "min"), ("I_e1", "I_peak", 1, "min"),
                                                        ("V_e0", "V_mean", 0, "mean"), ("V_e1", "V_mean", 1, "mean")]))
        protocol_info = {"params_to_change": {"m/Vc": [[-80, -20], [-80, 0]], "m/T": [[10, 10], [20, 20]]}}
        labels, colours = ["Control", "Blocked"], ["r", "b"]
        plot = {"name": "I-V", "kind": "feature_vs_feature", "x": "V_mean", "y": "I_peak", "series": None}
        self.assertEqual(self.script.plot_problems(plot, groups, protocol_info, ["I-V"]), [])
        ax = self.script.prediction_plot(plot, features, protocol_info, groups, labels, colours).axes[0]
        self.assertEqual((ax.get_title(), ax.get_xlabel(), ax.get_ylabel()), ("I-V", "V_mean (mV)", "I_peak (nA)"))
        # Sorted by x, a line of no colour of its own through a point per experiment, in its colour.
        self.assertEqual(list(ax.lines[0].get_xdata()), [-20.0, 0.0])
        self.assertEqual([text.get_text() for text in ax.get_legend().get_texts()], ["Blocked", "Control"])
        plot = {"name": "I-V", "kind": "feature_vs_input", "x": {"params_to_change": "m/Vc", "subexperiment_idx": 1}, "y": "I_peak",
                "series": {"params_to_change": "m/T", "subexperiment_idx": 0}}
        ax = self.script.prediction_plot(plot, features, protocol_info, groups, labels, colours).axes[0]
        self.assertEqual(ax.get_xlabel(), "m/Vc (sub-experiment 2)")
        self.assertEqual([list(line.get_ydata()) for line in ax.lines], [[-1.0], [-2.0]])
        self.assertEqual([text.get_text() for text in ax.get_legend().get_texts()], ["m/T (sub-experiment 1) = 10", "m/T (sub-experiment 1) = 20"])
        plot = {"name": "Peaks", "kind": "feature_vs_experiment", "x": None, "y": "I_peak", "series": None}
        ax = self.script.prediction_plot(plot, features, protocol_info, groups, labels, colours).axes[0]
        self.assertEqual([tick.get_text() for tick in ax.get_xticklabels()], ["Control", "Blocked"])

    def test_skips_a_prediction_plot_phlynx_would_not_draw_and_a_point_not_computed(self):
        groups = self.script.feature_groups(self.items([("V_max", "membrane/V", 0, "max"), ("V_min", "membrane/V", 0, "min"),
                                                        ("V", "trace", 0, None), ("I_e0", "I_peak", 0, "min")]))
        protocol_info = {"params_to_change": {"m/Vc": [["step"]]}}
        problems = lambda plot: self.script.plot_problems(plot, groups, protocol_info, [plot.get("name")])
        self.assertEqual(problems({"name": "a", "kind": "feature_vs_experiment", "x": None, "y": "membrane/V", "series": None}),
                         ["y names 'membrane/V', which has more than one item in an experiment; a plot takes one"])
        self.assertEqual(problems({"name": "a", "kind": "feature_vs_feature", "x": "trace", "y": "nope", "colour": "r"}), [
            "it has keys it does not take: colour",
            "y names no group of prediction items: 'nope'",
            "x names 'trace', which has items that are not features",
        ])
        self.assertEqual(problems({"name": "a", "kind": "feature_vs_input", "x": {"params_to_change": "m/Vc", "subexperiment_idx": 0}, "y": "I_peak"}),
                         ["x reads m/Vc (sub-experiment 1) in experiment 1, which is 'step', not a number"])
        self.assertEqual(self.script.plot_problems({"name": "a", "kind": "feature_vs_experiment", "x": None, "y": "I_peak"}, groups, protocol_info, ["a", "a"]),
                         ["another plot has its name"])
        features = self.features([("V_max", "membrane/V", 0, 0, "max", "mV", -21.1), ("V_min", "membrane/V", 0, 0, "min", "mV", -80.0)])
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            plot = {"name": "Peaks", "kind": "feature_vs_experiment", "x": None, "y": "I_peak", "series": None}
            self.assertIsNone(self.script.prediction_plot(plot, features, protocol_info, groups, ["E1"], ["r"]))
        self.assertIn("The feature plot Peaks leaves out experiment 1", str(caught[0].message))
        # features.png draws a group with more than one item in an experiment apart, as a line each.
        ax = self.script.features_figure(features, ["Experiment 1"], ["r"]).axes[0]
        self.assertEqual([text.get_text() for text in ax.get_legend().get_texts()], ["max, sub-experiment 1", "min, sub-experiment 1"])

    def test_names_a_figure_after_its_plot_once(self):
        self.assertEqual(self.script.figure_name("I–V curve (peak)", {"traces"}), "I_V_curve_peak")
        self.assertEqual(self.script.figure_name("features", {"traces": 1, "features": 1}), "features_2")
        self.assertEqual(self.script.figure_name("//", {}), "feature_plot")

if __name__ == "__main__":
    unittest.main()
