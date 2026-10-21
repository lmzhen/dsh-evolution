"use strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { downloadFile, endpointOf } from "../../src/models/provision.js";
const sha = "595e4cab2093732efd5dbe084fd5c1826b5eea693b73b4c1fd971672867d2e54";
const endpoint = endpointOf({});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-real-dl-"));
const dest = path.join(dir, "config.json");
(async () => {
  const r = await downloadFile({ url: endpoint + "/minishlab/potion-multilingual-128M/resolve/main/config.json", dest, sha256: sha, bytes: 271,
    opts: { endpoint }, id: "potion-base-f32", file: "config.json" });
  console.log("REAL_DL_OK endpoint=" + endpoint + " downloaded=" + r.downloaded + " sha_ok=" + (crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex") === sha));
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.log("REAL_DL_FAIL " + String(e && e.message ? e.message : e).slice(0, 300)); process.exit(1); });