import json, sys, dataclasses
sys.path.insert(0, "D:/dsh/skill-merge/pipeline"); sys.path.insert(0, "D:/dsh/skill-merge/.pylibs")
from config import Config
print("PY:" + json.dumps(sorted(f.name for f in dataclasses.fields(Config))))