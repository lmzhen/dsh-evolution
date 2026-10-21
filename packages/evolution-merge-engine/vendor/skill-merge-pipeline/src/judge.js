"use strict";
// ⑤ 聚合入口（G5.4：级联逻辑在 src/judge/cascade.js；本文件保持兼容导出）。
import { judgeCascade, resolveJudge, parseVerdict, ROUTE } from "./judge/cascade.js";
import { PROMPT_VERSION, SYSTEM, SCHEMA, buildPrompt, promptDigest } from "./judge/prompt.js";
import { STUB_VERSION, STUB2_VERSION, V1, DEFAULT_STUB2_FLOORS, stubVerdict, stubVerdictV2 } from "./judge/stub.js";
import { USAGE, EFFORT_WIRE, callDeepseek } from "./judge/deepseek.js";

export { judgeCascade, resolveJudge, parseVerdict, ROUTE, PROMPT_VERSION, SYSTEM, SCHEMA, buildPrompt, promptDigest, STUB_VERSION, STUB2_VERSION, V1, DEFAULT_STUB2_FLOORS, stubVerdict, stubVerdictV2, USAGE, EFFORT_WIRE, callDeepseek };