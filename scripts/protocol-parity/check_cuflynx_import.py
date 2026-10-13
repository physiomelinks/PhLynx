"""
Checks that CUFLynx finds a protocol in an OMEX archive PhLynx exported: it unpacks the archive with CUFLynx's own
omex_import, as CUFLynx imports one, and reports the obs_data it picked and the protocol in it. Run by hand, not in
CI:

    python3 scripts/protocol-parity/check_cuflynx_import.py export.omex [path/to/CUFLynx]

Needs nothing beyond Python. Exits 1 when CUFLynx would find no protocol.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CUFLYNX = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "..", "..", "CUFLynx"))


def load_importer():
    path = os.path.join(CUFLYNX, "apps", "api", "omex_import.py")
    spec = importlib.util.spec_from_file_location("omex_import", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    with open(sys.argv[1], "rb") as f:
        unpacked = load_importer().unpack(f.read())
    if not unpacked.get("obs"):
        print(f"CUFLynx found no obs_data. Passed over: {unpacked.get('obs_skipped')}")
        sys.exit(1)
    name, payload = unpacked["obs"]
    protocol = json.loads(payload).get("protocol_info")
    if not protocol:
        print(f"CUFLynx picked {name}, which has no protocol_info.")
        sys.exit(1)
    experiments = len(protocol["sim_times"])
    print(f"CUFLynx picked {name}: {experiments} experiment(s), setting {', '.join(protocol.get('params_to_change', {})) or 'nothing'}.")


if __name__ == "__main__":
    main()
