"use strict";
// 兼容层：现有模块统一从 "./config" 取值；DEFAULTS/makeConfig 由 schema 派生（C1 单一真相源）。
import { CONFIG_FIELDS, CLI_OPTIONS, DEFAULTS, FIELD_BY_KEY, CLI_BY_FLAG } from "./config/schema.js";
import { ConfigError } from "./errors.js";

function makeConfig(overrides) {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (!FIELD_BY_KEY.has(key)) throw new ConfigError("未知配置字段: " + key + "（只允许 CONFIG_FIELDS 中声明的字段）", { where: "config" });
    }
    Object.assign(cfg, overrides);
  }
  return cfg;
}

export { DEFAULTS, makeConfig, CONFIG_FIELDS, CLI_OPTIONS, FIELD_BY_KEY, CLI_BY_FLAG };