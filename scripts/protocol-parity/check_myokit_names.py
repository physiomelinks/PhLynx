"""
Checks that CUFLynx can run a protocol on a model PhLynx exported: it loads the CellML into Myokit as circulatory
autogen does, then resolves each parameter the protocol sets with CA's own VariableNameResolver, and with the
aliases for PhLynx's parameter components that protocol-kit's protocolNames.js adds. It also checks
Myokit's limits on inputs that change over time. Run by hand, not in CI:

    python3 scripts/protocol-parity/check_myokit_names.py model.cellml model_obs_data.json [path/to/circulatory_autogen]

Needs myokit. Exits 1 when a parameter can't be set the way CA would set it.
"""
import importlib.util
import json
import os
import sys

import myokit.formats.cellml as cellml

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CA = os.path.abspath(sys.argv[3] if len(sys.argv) > 3 else os.path.join(ROOT, "..", "circulatory_autogen"))
PHLYNX_ALIASES = ("instance_parameters/{component}_{variable}", "instance_parameters/{variable}", "global_parameters/{variable}")


def load_resolver():
    path = os.path.join(CA, "src", "libcuflynx", "solver_wrappers", "name_resolver.py")
    spec = importlib.util.spec_from_file_location("name_resolver", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.VariableNameResolver


def string_leaves(rows):
    return [(e, s) for e, row in enumerate(rows) for s, leaf in enumerate(row) if isinstance(leaf, str)]


def main():
    cellml_path, obs_data_path = sys.argv[1], sys.argv[2]
    resolver = load_resolver()
    model = cellml.CellMLImporter().model(cellml_path)
    variables = {v.qname(): v for v in model.variables(deep=True)}
    states = {v.qname(): i for i, v in enumerate(model.states())}
    keyed = [("state", states), ("var", variables)]
    with open(obs_data_path) as f:
        protocol = json.load(f)["protocol_info"]

    problems = 0
    for name, rows in protocol.get("params_to_change", {}).items():
        kind, qname = resolver.resolve_key(name, keyed, separator=".")
        how = "CA"
        if qname is None:
            component, variable = name.split("/", 1)
            for alias in PHLYNX_ALIASES:
                candidate = alias.format(component=component, variable=variable).replace("/", ".")
                kind, qname = resolver.resolve_key(candidate, keyed, separator=".")
                if qname:
                    how = "PhLynx alias"
                    break
        traced = string_leaves(rows)
        notes = []
        if qname is None:
            notes.append("not found")
        elif traced and kind == "state":
            notes.append("a state, which Myokit can't pace")
        elif kind == "var" and not traced and not variables[qname].is_literal():
            notes.append("not a literal constant, so set_constant fails")
        if qname and how != "CA":
            notes.append("needs the PhLynx aliases in CA's resolver")
        problems += any(note != "needs the PhLynx aliases in CA's resolver" for note in notes) or qname is None
        print(f"{name:40} -> {qname or '-':45} {kind or '':6} {'; '.join(notes) or 'ok'}")

    # Myokit paces one variable per sub-experiment.
    traced_by_segment = {}
    for name, rows in protocol.get("params_to_change", {}).items():
        for segment in string_leaves(rows):
            traced_by_segment.setdefault(segment, []).append(name)
    for (e, s), names in sorted(traced_by_segment.items()):
        if len(names) > 1:
            problems += 1
            print(f"Experiment {e + 1}, sub-experiment {s + 1}: {', '.join(names)} all change over time; Myokit paces only one.")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
