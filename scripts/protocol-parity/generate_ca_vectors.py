"""
Writes tests/resources/protocols/ca-vectors.json: what circulatory_autogen's own code makes of protocol shapes and
protocol_info, for PhLynx's port (src/services/protocol) to be checked against. Run by hand, not in CI:

    python3 scripts/protocol-parity/generate_ca_vectors.py [path/to/circulatory_autogen]

It needs no packages: protocol_shapes.py is plain Python, and validate_params_to_change is lifted out of
PrimitiveParsers.py without importing the rest of that module.
"""
import ast
import copy
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RESOURCES = os.path.join(ROOT, "tests", "resources", "protocols")
CA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "circulatory_autogen"))
LIBCUFLYNX = os.path.join(CA, "src", "libcuflynx")


def load_protocol_shapes():
    spec = importlib.util.spec_from_file_location("protocol_shapes", os.path.join(LIBCUFLYNX, "utilities", "protocol_shapes.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_validate_params_to_change():
    path = os.path.join(LIBCUFLYNX, "parsers", "PrimitiveParsers.py")
    with open(path) as f:
        tree = ast.parse(f.read())
    [function] = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "validate_params_to_change"]
    namespace = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), path, "exec"), namespace)
    return namespace["validate_params_to_change"]


shapes = load_protocol_shapes()
validate_params_to_change = load_validate_params_to_change()


def outcome(run):
    try:
        return {"result": run()}
    except ValueError as error:
        return {"error": str(error)}


def expand(shape, duration, name="s"):
    return shapes.expand_shape(shapes.normalise_shape(shape, name=name), duration, name=name)


def read_protocol(protocol_info):
    protocol_info = copy.deepcopy(protocol_info)
    validate_params_to_change(protocol_info)
    shapes.materialise_shapes(protocol_info)
    shapes.validate_trace_references(protocol_info)
    return protocol_info.get("protocol_traces", {})


def event(**fields):
    return {"level": 1.0, "length": 1.0, **fields}


SHAPE_CASES = [
    ("single pulse", {"events": [event(start=2, length=3)]}, 10),
    ("step to the end", {"baseline": -1, "events": [event(level=4, start=5, length=5)]}, 10),
    ("step past the end", {"events": [event(start=5, length=50)]}, 10),
    ("pulse at the start", {"events": [event(start=0, length=1)]}, 10),
    ("1 Hz pacing", {"events": [{"level": 1.0, "start": 100.0, "length": 2.0, "period": 1000.0, "multiplier": 0}]}, 2000),
    ("counted pacing", {"events": [event(start=0.5, length=0.1, period=1, multiplier=3)]}, 10),
    ("pacing to the end", {"events": [event(start=0, length=0.25, period=0.5)]}, 3),
    ("fast pacing with float drift", {"events": [event(start=0, length=0.01, period=0.1)]}, 1),
    ("two events", {"baseline": 0.5, "events": [event(level=2, start=1, length=1), event(level=-2, start=4, length=2)]}, 8),
    ("abutting events", {"events": [event(level=1, start=1, length=1), event(level=2, start=2, length=1)]}, 5),
    ("duration key", {"events": [{"level": 3, "start": 1, "duration": 2}]}, 5),
    ("bare list", [event(start=1, length=1)], 4),
    ("integers", {"events": [{"level": 5, "start": 1, "length": 1, "period": 3, "multiplier": 2}]}, 10),
    ("tiny pulse in a long run", {"events": [event(start=100, length=0.002)]}, 1000),
    ("ramp", {"type": "ramp", "from": -2, "to": 6}, 4),
    ("explicit pacing type", {"type": "pacing", "events": [event(start=1)]}, 3),
    ("overlap", {"events": [event(start=1, length=3), event(start=2, length=1)]}, 10),
    ("fires nothing", {"events": [event(start=20)]}, 10),
    ("zero length", {"events": [event(length=0)]}, 10),
    ("negative length", {"events": [event(length=-1.5)]}, 10),
    ("no level", {"events": [{"start": 1, "length": 1}]}, 10),
    ("no length", {"events": [{"level": 1, "start": 1}]}, 10),
    ("both lengths", {"events": [{"level": 1, "length": 1, "duration": 1}]}, 10),
    ("negative start", {"events": [event(start=-1)]}, 10),
    ("negative period", {"events": [event(period=-2)]}, 10),
    ("fractional multiplier", {"events": [event(period=2, multiplier=1.5)]}, 10),
    ("repeats without a period", {"events": [event(multiplier=3)]}, 10),
    ("boolean level", {"events": [{"level": True, "length": 1}]}, 10),
    ("string level", {"events": [{"level": "1", "length": 1}]}, 10),
    ("unknown shape key", {"events": [event()], "colour": "r"}, 10),
    ("unknown event key", {"events": [{**event(), "offset": 1}]}, 10),
    ("unknown type", {"type": "sine", "events": [event()]}, 10),
    ("no events", {"events": []}, 10),
    ("event not a mapping", {"events": [3]}, 10),
    ("shape not a mapping", "pulse", 10),
    ("ramp without to", {"type": "ramp", "from": 1}, 10),
    ("ramp with baseline", {"type": "ramp", "from": 1, "to": 2, "baseline": 0}, 10),
    ("negative shape duration", {"events": [event()], "duration": -1}, 10),
    ("zero sub-experiment", {"events": [event()]}, 0),
    ("small numbers", {"events": [event(start=1e-5, length=2e-6)]}, 1e-4),
    ("large numbers", {"events": [event(start=2.5e6, length=1e5)]}, 1e7),
    ("null start", {"events": [event(start=None)]}, 10),
    ("null period", {"events": [event(period=None)]}, 10),
    ("null multiplier", {"events": [event(multiplier=None)]}, 10),
    ("null baseline", {"baseline": None, "events": [event()]}, 10),
    ("null type", {"type": None, "events": [event()]}, 10),
    ("tie in a length", {"events": [event(start=20000)]}, 12345.25),
    ("tie in a large length", {"events": [event(start=2e6)]}, 1234565),
    ("tie in an overlap", {"events": [event(start=1000.125, length=5000), event(start=2000)]}, 10000),
    ("escaped string level", {"events": [{"level": "a\nb\\c'", "length": 1}]}, 10),
]

PROTOCOL_CASES = [
    ("shape sized by its sub-experiment", {"pre_times": [0], "sim_times": [[2, 4]], "params_to_change": {"a/b": [[0, "s"]]}, "protocol_shapes": {"s": {"events": [event(start=1)]}}}),
    ("shape with its own duration", {"pre_times": [0, 0], "sim_times": [[2], [4]], "params_to_change": {"a/b": [["s"], ["s"]]}, "protocol_shapes": {"s": {"events": [event(start=1)], "duration": 3}}}),
    ("shape used over two lengths", {"pre_times": [0, 0], "sim_times": [[2], [4]], "params_to_change": {"a/b": [["s"], ["s"]], "a/c": [[1], ["s"]]}, "protocol_shapes": {"s": {"events": [event(start=1)]}}}),
    ("unused shape", {"pre_times": [0], "sim_times": [[2]], "params_to_change": {}, "protocol_shapes": {"s": {"events": [event()]}}}),
    ("shape agreeing with a trace", {"pre_times": [0], "sim_times": [[1]], "params_to_change": {"a/b": [["s"]]}, "protocol_shapes": {"s": {"type": "ramp", "from": 0, "to": 1}}, "protocol_traces": {"s": {"t": [0, 1], "values": [0, 1]}}}),
    ("shape disagreeing with a trace", {"pre_times": [0], "sim_times": [[1]], "params_to_change": {"a/b": [["s"]]}, "protocol_shapes": {"s": {"type": "ramp", "from": 0, "to": 1}}, "protocol_traces": {"s": {"t": [0, 1], "values": [0, 2]}}}),
    ("unknown trace", {"pre_times": [0], "sim_times": [[1, 1]], "params_to_change": {"a/b": [["nope", "s"]], "c/d": [[0, "other"]]}, "protocol_shapes": {"s": {"type": "ramp", "from": 0, "to": 1}}}),
    ("wrong number of experiments", {"pre_times": [0], "sim_times": [[1]], "params_to_change": {"z/z": [[1], [2]], "a/b": [[1, 2]]}}),
    ("pre_times length", {"pre_times": [0, 1], "sim_times": [[1]], "params_to_change": {"a/b": [[1]]}}),
    ("row not a list", {"pre_times": [0], "sim_times": [[1]], "params_to_change": {"a/b": [3]}}),
    ("rows not a list", {"pre_times": [0], "sim_times": [[1]], "params_to_change": {"a/b": "x"}}),
    ("shapes named like JavaScript's own", {"pre_times": [0], "sim_times": [[1, 2]], "params_to_change": {"a/b": [["constructor", "__proto__"]]}, "protocol_shapes": {"constructor": {"type": "ramp", "from": 0, "to": 1}, "__proto__": {"events": [event()]}}}),
    ("trace equal to a shape by Python's rules", {"pre_times": [0], "sim_times": [[1]], "params_to_change": {"a/b": [["s"]]}, "protocol_shapes": {"s": {"type": "ramp", "from": 0, "to": 1}}, "protocol_traces": {"s": {"t": [False, True], "values": [0, 1]}}}),
    ("sim_times row as a string", {"pre_times": [0], "sim_times": ["10"], "params_to_change": {"a/b": [["s"]]}, "protocol_shapes": {"s": {"events": [event()]}}}),
    ("sim_times entries as strings", {"pre_times": [0, 0, 0], "sim_times": [["2"], ["1_0"], ["nan"]], "params_to_change": {"a/b": [["s"], ["t"], ["u"]]}, "protocol_shapes": {"s": {"events": [event()]}, "t": {"events": [event()]}, "u": {"events": [event()]}}}),
    ("sim_times entry Python can't read", {"pre_times": [0], "sim_times": [["0x10"]], "params_to_change": {"a/b": [["s"]]}, "protocol_shapes": {"s": {"events": [event()]}}}),
    ("shape in a missing sub-experiment", {"pre_times": [0], "sim_times": [[1]], "params_to_change": {"a/b": [[1, "s"]]}, "protocol_shapes": {"s": {"type": "ramp", "from": 0, "to": 1}}}),
]


def main():
    fixtures = {}
    for name in sorted(os.listdir(RESOURCES)):
        if name.endswith("_obs_data.json"):
            with open(os.path.join(RESOURCES, name)) as f:
                document = json.load(f)
            # A bare list of data items has no protocol.
            protocol_info = document.get("protocol_info") if isinstance(document, dict) else None
            fixtures[name] = outcome(lambda: read_protocol(protocol_info)) if protocol_info is not None else {"result": None}
    vectors = {
        "source": {"repository": "circulatory_autogen", "commit": subprocess.run(["git", "-C", CA, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()},
        "shapes": [{"name": name, "shape": shape, "duration": duration, **outcome(lambda: expand(shape, duration))} for name, shape, duration in SHAPE_CASES],
        "protocols": [{"name": name, "protocol_info": info, **outcome(lambda: read_protocol(info))} for name, info in PROTOCOL_CASES],
        "fixtures": fixtures,
    }
    with open(os.path.join(RESOURCES, "ca-vectors.json"), "w") as f:
        json.dump(vectors, f, indent=1)
        f.write("\n")
    print(f"Wrote {len(SHAPE_CASES)} shape, {len(PROTOCOL_CASES)} protocol and {len(fixtures)} fixture vectors from CA {vectors['source']['commit']}.")


if __name__ == "__main__":
    main()
