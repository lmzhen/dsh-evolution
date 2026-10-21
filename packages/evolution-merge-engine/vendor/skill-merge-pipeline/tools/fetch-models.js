#!/usr/bin/env node
"use strict";
// G7.1：fetch-models 兼容薄包装，实际走 models ensure。
import { runModelsCommand } from "../src/models/ensure-cli.js";
import { formatError, exitCodeOf } from "../src/errors.js";

(async () => {
  try {
    const r = await runModelsCommand(["ensure"].concat(process.argv.slice(2)));
    for (const line of r.lines) console.log(line);
    process.exit(r.exitCode);
  } catch (err) { console.error(formatError(err)); process.exit(exitCodeOf(err)); }
})();