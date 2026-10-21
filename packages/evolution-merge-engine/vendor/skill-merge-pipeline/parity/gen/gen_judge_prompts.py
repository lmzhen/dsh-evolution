"""G5.2：Python oracle 生成 27 个 ⑤ prompt goldens（Windows 文本模式 ⇒ CRLF）。

输入：parity/dev/dump_prompt_inputs.js 产出的 JSON（含 17 对 evidence 与 cfg）。
输出：<outdir>/*.md（命名与 Node judge 一致）。
"""
import json
import os
import sys
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PIPE = os.path.join(ROOT, "pipeline")
sys.path.insert(0, PIPE)
import corpus  # noqa: E402
import judge  # noqa: E402


def main():
    inp = sys.argv[1]
    outdir = sys.argv[2]
    data = json.load(open(inp, encoding="utf-8"))
    c = data["cfg"]
    cfg = SimpleNamespace(
        boilerplate_min_docs=c["boilerplate_min_docs"],
        boilerplate_min_ratio=c["boilerplate_min_ratio"],
        l0_caution=c["l0_caution"],
        judge_max_chars_per_skill=c["judge_max_chars_per_skill"],
    )
    skills, _ = corpus.load_corpus([data["corpusRoot"]])
    corpus.strip_boilerplate(skills, cfg)
    by_name = {}
    for s in skills:
        by_name[s.name] = s
    os.makedirs(outdir, exist_ok=True)
    n = 0
    for p in data["pairs"]:
        a = by_name[p["a_name"]]
        b = by_name[p["b_name"]]
        idx = p["i"] + 1
        evidence = dict(p["evidence"])
        base = "%03d_%s__%s" % (idx, a.name, b.name)
        for level in ("L0", "L1", "L2"):
            prompt = judge.build_prompt(level, a, b, evidence, cfg)
            pf = os.path.join(outdir, base + "_" + level + ".md")
            open(pf, "w", encoding="utf-8").write(prompt)
            n += 1
            verdict = judge.stub_verdict(level, evidence, a, b)["verdict"]
            if level == "L0" and verdict not in judge.ROUTE["l0_forward"]:
                break
            if level == "L1" and verdict not in judge.ROUTE["l1_forward"]:
                break
    print("prompts=" + str(n))


if __name__ == "__main__":
    main()