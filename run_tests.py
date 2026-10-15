"""Run the tests: python run_tests.py [pytest arguments].

On Windows, Home Assistant's test plugin imports two POSIX-only modules
(fcntl, resource); tests/win_shims has stand-ins and is put on PYTHONPATH.
Elsewhere this is plain "python -m pytest".
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

env = dict(os.environ)
if sys.platform == "win32":
    shims = os.path.join(HERE, "tests", "win_shims")
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [shims, env.get("PYTHONPATH")]))
sys.exit(subprocess.call([sys.executable, "-m", "pytest", *sys.argv[1:]], cwd=HERE, env=env))
