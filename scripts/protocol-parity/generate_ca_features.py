"""
Writes tests/resources/protocols/parity/ca-features.json: the features of each case in features.json there (prediction
items with an operation), as circulatory autogen computes them when CUFLynx runs the protocol: libcuflynx's
ProtocolRunner with CVODE_myokit records each item's operands over its sub-experiment, its first sample included, and
features_from_segments reduces them. tests/playwright/test_protocol_parity.py compares PhLynx's features against these.
Run by hand, not in CI, with a Python that has libcuflynx from circulatory_autogen #536 and myokit:

    python scripts/protocol-parity/generate_ca_features.py
"""
import copy
import importlib.metadata
import json
import os
import tempfile

from libcuflynx.param_id import prediction_features as pf
from libcuflynx.param_id.operation_funcs import get_operation_funcs_dict_for_mode
from libcuflynx.parsers.PrimitiveParsers import ObsAndParamDataParser
from libcuflynx.protocol_runners import ProtocolRunner

HERE = os.path.dirname(os.path.abspath(__file__))
PARITY = os.path.abspath(os.path.join(HERE, "..", "..", "tests", "resources", "protocols", "parity"))


def run_case(case, tolerance):
    path = os.path.join(tempfile.mkdtemp(), case["model"])
    with open(os.path.join(PARITY, case["model"])) as source, open(path, "w") as copied:
        copied.write(source.read())
    solver_info = {"MaximumStep": case["maximumStep"], "MaximumNumberOfSteps": 50000, "rtol": tolerance, "atol": tolerance}
    runner = ProtocolRunner(path, inp_data_dict={"dt": case["pointInterval"], "solver_info": solver_info, "model_type": "cellml_only"},
                            solver="CVODE_myokit", model_type="cellml_only")
    parsed = ObsAndParamDataParser().parse_obs_data_json(obs_data_dict=copy.deepcopy(case["obs_data"]))
    protocol, items = parsed["protocol_info"], parsed["prediction_info"]
    # As CUFLynx binds a protocol (apps/api/engine.py bind_protocol), then runs it by sub-experiment.
    runner.sim_helper.set_protocol_info(protocol)
    funcs = get_operation_funcs_dict_for_mode("numpy", None)
    indices = pf.prediction_feature_indices(items, funcs)
    ok, by_sub, _, _ = runner._executor.run_protocol(protocol, result_variables=pf.result_variables(items, indices))
    if not ok:
        raise RuntimeError(f"CA couldn't run {case['name']}")
    values = pf.features_from_segments(items, indices, funcs, protocol, by_sub)
    return dict(zip(pf.prediction_feature_names(items, indices), values))


def main():
    with open(os.path.join(PARITY, "features.json")) as f:
        spec = json.load(f)
    references = {
        "source": {"libcuflynx": importlib.metadata.version("libcuflynx"), "myokit": importlib.metadata.version("myokit"), "solver": "CVODE_myokit"},
        "cases": {case["name"]: run_case(case, spec["solver"]["tolerance"]) for case in spec["cases"]},
    }
    with open(os.path.join(PARITY, "ca-features.json"), "w") as f:
        json.dump(references, f, indent=1)
        f.write("\n")
    print(f"Wrote the features of {len(references['cases'])} cases from libcuflynx {references['source']['libcuflynx']}.")


if __name__ == "__main__":
    main()
