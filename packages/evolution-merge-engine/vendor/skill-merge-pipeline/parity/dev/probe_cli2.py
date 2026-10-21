import subprocess, sys
py = sys.executable
def run(extra):
    cmd = [py, "D:/dsh/skill-merge/pipeline/run.py", "--corpus", "C:/Users/limengzhen/.dsh/skills", "--out", "D:/dsh/skill-merge/out/_tmp_cli_py", "--seed-mode", "fixed", "--embed-backend", "local", "--rank", "vec", "--judge", "stub"] + extra
    r = subprocess.run(cmd, capture_output=True, text=True)
    tail = ((r.stderr.strip().splitlines() or [""])[-1])[:110]
    print("  " + " ".join(extra) + " => exit=" + str(r.returncode) + " | " + tail)
run(["--judge", "bogus"])
run(["--rounds", "abc"])
run(["--out=D:/dsh/skill-merge/out/_tmp_cli_py2"])