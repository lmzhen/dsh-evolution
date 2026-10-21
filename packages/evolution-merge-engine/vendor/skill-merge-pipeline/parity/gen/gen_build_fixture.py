"""生成 G2.3 构建的小样本期望（Python oracle，字节级对照）。"""
import json, os, struct
import numpy as np

OUT = "D:/dsh/skill-merge/node/parity/fixtures/build"
ROWS, COLS, DIMS = 7, 4, 2
os.makedirs(OUT, exist_ok=True)

def write_st(dtype, arr, path):
    b = arr.tobytes()
    hdr = json.dumps({"embeddings": {"dtype": dtype, "shape": list(arr.shape), "data_offsets": [0, len(b)]}}, separators=(",", ":")).encode()
    pad = (8 - ((8 + len(hdr)) % 8)) % 8
    hdr = hdr + b" " * pad
    with open(path, "wb") as f:
        f.write(struct.pack("<Q", len(hdr)))
        f.write(hdr)
        f.write(b)

base_cfg = {"model_type": "model2vec", "architectures": ["StaticModel"], "tokenizer_name": "test/tok",
            "apply_pca": None, "apply_zipf": None, "sif_coefficient": None, "hidden_dim": COLS,
            "seq_length": 1000000, "normalize": True}
# FP32 基座（含负数/零/半值边界）
base_f32 = np.array([
    [0.1, -0.25, 1.5, 0.0],
    [3.75, -2.5, 0.5, 1.0 ],
    [0.33333334, -0.33333334, 7.0, -0.5],
    [65504.0, -65504.0, 0.0000001, 1024.0],
    [0.0, 0.0, 0.0, 0.0],
    [12.345, -12.345, 0.001953125, 0.5],
    [1e-8, -1e-8, 2.0, -2.0],
], dtype=np.float32)
base_f16 = base_f32.astype(np.float16)
proj = np.array([[1.0, 0.0], [0.0, 1.0], [0.5, -0.5], [-0.25, 0.75]], dtype=np.float32)

def quant(x_f32):
    mx = np.abs(x_f32).max(axis=1)
    sc = (mx / 127.0).astype(np.float32)
    sc[sc == 0] = 1e-8
    q = np.clip(np.round(x_f32 / sc[:, None]), -127, 127).astype(np.int8)
    return q, sc

int8_q, int8_sc = quant(base_f16.astype(np.float32))
pca_rows = base_f16.astype(np.float32) @ proj
pca_q, pca_sc = quant(pca_rows)

os.makedirs(OUT + "/base", exist_ok=True)
os.makedirs(OUT + "/expected", exist_ok=True)
with open(OUT + "/base/config.json", "w", encoding="utf-8") as f: json.dump(base_cfg, f, ensure_ascii=False, indent=2)
with open(OUT + "/base/tokenizer.json", "w", encoding="utf-8") as f: json.dump({"version": "1.0", "model": {}}, f, ensure_ascii=False, indent=2)
write_st("F32", base_f32, OUT + "/base/model.safetensors")
np.asarray(proj, dtype=np.float32).tofile(OUT + "/base/proj.f32")
# fp16-cast 期望
f16_cfg = dict(base_cfg); f16_cfg["embedding_dtype"] = "float16"
with open(OUT + "/expected/f16_config.json", "w", encoding="utf-8") as f: json.dump(f16_cfg, f, ensure_ascii=False, indent=2)
write_st("F16", base_f16, OUT + "/expected/f16_model.safetensors")
# int8 期望
int8_cfg = dict(f16_cfg)
int8_cfg.update({"embedding_dtype": "int8", "quantization": "per_row_symmetric", "scales_file": "scales.f32", "source_model": "potion-multilingual-128M-F16"})
with open(OUT + "/expected/int8_config.json", "w", encoding="utf-8") as f: json.dump(int8_cfg, f, ensure_ascii=False, indent=2)
write_st("I8", int8_q, OUT + "/expected/int8_model.safetensors")
np.asarray(int8_sc, dtype=np.float32).tofile(OUT + "/expected/int8_scales.f32")
# pca 期望
pca_cfg = dict(f16_cfg)
pca_cfg.update({"hidden_dim": DIMS, "embedding_dtype": "int8", "quantization": "per_row_symmetric", "scales_file": "scales.f32", "pca_proj_file": "pca_proj.f32", "pca_dims": DIMS, "orig_hidden_dim": COLS, "source_model": "potion-multilingual-128M-F16", "pca_fit": "fixture"})
with open(OUT + "/expected/pca_config.json", "w", encoding="utf-8") as f: json.dump(pca_cfg, f, ensure_ascii=False, indent=2)
write_st("I8", pca_q, OUT + "/expected/pca_model.safetensors")
np.asarray(pca_sc, dtype=np.float32).tofile(OUT + "/expected/pca_scales.f32")
meta = {"rows": ROWS, "cols": COLS, "dims": DIMS,
        "base_model_sha": None, "int8": int8_q.tolist(), "int8_scales": int8_sc.tolist(),
        "pca": pca_q.tolist(), "pca_scales": pca_sc.tolist(), "pca_rows": pca_rows.tolist()}
with open(OUT + "/expected/meta.json", "w", encoding="utf-8") as f: json.dump(meta, f, ensure_ascii=False, indent=1)
print("fixtures written:", sorted(os.listdir(OUT + "/expected")))