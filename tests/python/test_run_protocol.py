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

    def test_plots_a_feature_against_another_and_an_input_with_units(self):
        features = self.features(
            [("I_e0", "I_peak", 0, 1, "min", "nA", -1.0), ("I_e1", "I_peak", 1, 1, "min", "nA", -2.0),
             ("V_e0", "V_mean", 0, 1, "mean", "mV", -20.0), ("V_e1", "V_mean", 1, 1, "mean", "mV", 0.0)]
        )
        protocol_info = {"params_to_change": {"m/Vc": [[-80, -20], [-80, 0]]}}
        plot = {"title": None, "x": "V_mean", "y": "I_peak", "series": None}
        self.assertTrue(self.script.is_plottable(plot, features))
        ax = self.script.feature_plot(plot, features, protocol_info).axes[0]
        self.assertEqual((ax.get_xlabel(), ax.get_ylabel()), ("V_mean (mV)", "I_peak (nA)"))
        self.assertEqual(list(ax.lines[0].get_xdata()), [-20.0, 0.0])
        plot = {"title": "I-V", "x": {"input": "m/Vc", "subexperiment_idx": 1}, "y": "I_peak", "series": None}
        ax = self.script.feature_plot(plot, features, protocol_info).axes[0]
        self.assertEqual(ax.get_xlabel(), "m/Vc (sub-experiment 2)")
        self.assertEqual(list(ax.lines[0].get_ydata()), [-1.0, -2.0])

    def test_skips_a_pairing_of_a_feature_not_computed_or_recorded_twice_in_an_experiment(self):
        features = self.features(
            [("V_max", "membrane/V", 0, 0, "max", "mV", -21.1), ("V_min", "membrane/V", 0, 0, "min", "mV", -80.0)]
        )
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            self.assertFalse(self.script.is_plottable({"x": "experiment", "y": "I_peak"}, features))
            self.assertFalse(self.script.is_plottable({"x": "experiment", "y": "membrane/V"}, features))
        self.assertIn("no I_peak was computed", str(caught[0].message))
        self.assertIn("more than one item in an experiment (V_max, V_min)", str(caught[1].message))
        # features.png draws them apart, as a line each.
        ax = self.script.features_figure(features, ["Experiment 1"], ["r"]).axes[0]
        self.assertEqual([text.get_text() for text in ax.get_legend().get_texts()], ["max, sub-experiment 1", "min, sub-experiment 1"])


if __name__ == "__main__":
    unittest.main()
