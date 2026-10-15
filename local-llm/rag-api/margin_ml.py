"""Make the repo's ml/ package importable.

MARGIN_ML_ROOT is the directory that contains ml/; in Docker the compose file
mounts it read-only at /margin. Locally it is the repository root.
"""

import os
import sys
from pathlib import Path

ML_ROOT = Path(os.getenv("MARGIN_ML_ROOT", Path(__file__).resolve().parents[2]))
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))
