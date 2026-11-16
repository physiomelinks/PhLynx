import os
import subprocess
import sys
import unittest

from concurrent.futures import ThreadPoolExecutor, as_completed


here = os.path.abspath(os.path.dirname(__file__))
playwright_tests = os.path.join(here, "playwright")


def test_ids(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from test_ids(item)
        else:
            yield item.id()


def run(test_id):
    proc = subprocess.run([sys.executable, "-m", "unittest", test_id],
                          cwd=playwright_tests, capture_output=True, text=True)
    return test_id, proc.returncode, proc.stdout + proc.stderr


if __name__ == "__main__":
    ids = list(test_ids(unittest.TestLoader().discover(playwright_tests)))
    workers = int(os.environ.get("PLAYWRIGHT_WORKERS", max(1, (os.cpu_count() or 2) // 2)))
    failed = []
    with ThreadPoolExecutor(workers) as pool:
        for fut in as_completed(pool.submit(run, i) for i in ids):
            test_id, code, output = fut.result()
            print(("ok    " if code == 0 else "FAIL  ") + test_id, flush=True)
            if code != 0:
                failed.append((test_id, output))
    for test_id, output in failed:
        print(f"\n===== {test_id} =====\n{output}")
    sys.exit(1 if failed else 0)
