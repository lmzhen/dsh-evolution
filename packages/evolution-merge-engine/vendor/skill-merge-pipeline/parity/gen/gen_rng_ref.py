import json, random
cases = []
for seed in (1, 8, 42, 123456):
    r = random.Random(seed)
    bits = [r.getrandbits(32) for _ in range(6)]
    r2 = random.Random(seed)
    below = [r2._randbelow(7) for _ in range(6)] + [r2._randbelow(296) for _ in range(4)]
    r3 = random.Random(seed)
    samp = [r3.sample(list(range(7)), 1), r3.sample(list(range(7)), 3), r3.sample(list(range(296)), 30)]
    r4 = random.Random(seed)
    uni = [round(r4.uniform(-0.02, 0.02), 6) for _ in range(4)]
    r5 = random.Random(seed)
    rint = [r5.randint(1, 1000000) for _ in range(4)]
    cases.append({"seed": seed, "bits": bits, "below": below, "samples": samp, "uniform": uni, "randint": rint})
json.dump(cases, open("D:/dsh/skill-merge/node/parity/golden/ref_rng.json", "w"), indent=1)
print("rng ref ok")