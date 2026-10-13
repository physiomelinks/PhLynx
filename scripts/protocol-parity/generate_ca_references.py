"""
Writes tests/resources/protocols/parity/ca-references.json: each parity case (cases.json there) run by circulatory
autogen as CUFLynx runs it, libcuflynx's ProtocolRunner with CVODE_myokit, for tests/playwright/test_protocol_parity.py
to compare PhLynx's runs against. Run by hand, not in CI, with a Python that has libcuflynx and myokit:

    python scripts/protocol-parity/generate_ca_references.py
"""
import copy
import importlib.metadata
import json
import os
import tempfile

import numpy as np
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
    protocol_info = copy.deepcopy(case["protocol_info"])
    # As CUFLynx binds a protocol (apps/api/engine.py bind_protocol), then runs it by sub-experiment.
    runner.sim_helper.set_protocol_info(protocol_info)
    names = runner.sim_helper.get_all_variable_names()
    ok, by_sub, _, t_by_exp = runner._executor.run_protocol(protocol_info, result_variables=None, extra_result_variables=["time"])
    if not ok:
        raise RuntimeError(f"CA couldn't run {case['name']}")
    indices = {variable: names.index(variable.replace("/", ".")) for variable in case["variables"]}
    experiments = []
    for e in range(len(protocol_info["sim_times"])):
        subs = sorted((s, result) for (exp, s), result in by_sub.items() if exp == e)
        values = {variable: [] for variable in case["variables"]}
        for position, (_, result) in enumerate(subs):
            for variable, index in indices.items():
                series = np.ravel(result[index]).tolist()
                # Joined as CA joins sub-experiments: a later one's first point is the last one before it.
                values[variable].extend(series if position == 0 else series[1:])
        experiments.append({"t": np.ravel(t_by_exp[e]).tolist(), "values": values})
    return experiments


def main():
    with open(os.path.join(PARITY, "cases.json")) as f:
        spec = json.load(f)
    references = {
        "source": {"libcuflynx": importlib.metadata.version("libcuflynx"), "myokit": importlib.metadata.version("myokit"), "solver": "CVODE_myokit"},
        "cases": {case["name"]: run_case(case, spec["solver"]["tolerance"]) for case in spec["cases"]},
    }
    with open(os.path.join(PARITY, "ca-references.json"), "w") as f:
        json.dump(references, f)
        f.write("\n")
    print(f"Wrote references for {len(references['cases'])} cases from libcuflynx {references['source']['libcuflynx']}.")


if __name__ == "__main__":
    main()
