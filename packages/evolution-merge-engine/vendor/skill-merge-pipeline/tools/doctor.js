"use strict";
// G3.4：源仓库 doctor 薄包装；解析/渲染/退出码在 src/models/doctor-cli.js。
import { runDoctorCommand } from "../src/models/doctor-cli.js";
import { formatError, exitCodeOf } from "../src/errors.js";

(async () => {
  try {
    const r = await runDoctorCommand(process.argv.slice(2));
    for (const line of r.lines) console.log(line);
    process.exit(r.exitCode);
  } catch (err) { console.error(formatError(err)); process.exit(exitCodeOf(err)); }
})();