import sys, json
sys.path.insert(0, r"D:/dsh/skill-merge/.pylibs_torch")
from datasketch.lsh import _optimal_param
P = json.load(open(r"D:/dsh/skill-merge/node/src/data/minhash_params.json", encoding="utf-8"))
np = P["num_perm"]
grid = {}
t = 0.005
while t <= 0.995 + 1e-12:
    key = ("%.3f" % t).rstrip("0").rstrip(".")
    b, r = _optimal_param(t, np, 0.5, 0.5)
    if b * r > 0:
        grid[key] = [int(b), int(r)]
    t = round(t + 0.005, 6)
# 校验与现有稀疏网格一致
bad = []
for k, v in P["params"].items():
    if grid.get(k) != [int(v[0]), int(v[1])]: bad.append([k, v, grid.get(k)])
print("grid_entries=%d mismatch=%s" % (len(grid), json.dumps(bad, ensure_ascii=False)))
print("samples=" + json.dumps({k: grid[k] for k in ["0.04","0.1","0.2","0.3","0.095"]}, ensure_ascii=False))
P["params"] = grid
json.dump(P, open(r"D:/dsh/skill-merge/node/src/data/minhash_params.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("written")