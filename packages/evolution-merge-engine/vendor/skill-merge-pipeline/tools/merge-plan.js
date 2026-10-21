#!/usr/bin/env node
"use strict";
// G7.1：源仓库薄包装；解析/执行在 src/cli/plan.js。
import { runPlanCommand } from "../src/cli/plan.js";
import { formatError, exitCodeOf } from "../src/errors.js";

(async () => {
  try {
    const r = await runPlanCommand(process.argv.slice(2));
    for (const line of r.lines) console.log(line);
    process.exit(r.exitCode);
  } catch (err) { console.error(formatError(err)); process.exit(exitCodeOf(err)); }
})();