import subprocess, sys
base = [sys.executable, "D:/dsh/skill-merge/pipeline/run.py", "--corpus", "C:/Users/limengzhen/.dsh/skills", "--out", "D:/dsh/skill-merge/out/_tmp_cli", "--seed-mode", "fixed", "--embed-backend", "local", "--rank", "vec", "--judge", "stub"]
for extra in (["--judge", "bogus"], ["--rounds", "abc"], ["--out=D:/dsh/skill-merge/out/_tmp_cli2"]):
    cmd = base + extra if not extra[0].startswith("--out=") else base[:-1] + [extra[0]]
    r = subprocess.run(cmd, capture_output=True, text=True)
    tail = (r.stderr.strip().splitlines() or [""])[-1][:100]
    print("  " + " ".join(extra) + " => exit=" + str(r.returncode) + " | " + tail)