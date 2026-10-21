"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { roundHalfEven } from "../src/numeric.js";

test("roundHalfEven：Python 银行家舍入（整数位）", () => {
  assert.equal(roundHalfEven(0.5), 0);
  assert.equal(roundHalfEven(1.5), 2);
  assert.equal(roundHalfEven(2.5), 2);
  assert.equal(roundHalfEven(3.5), 4);
  assert.equal(roundHalfEven(-0.5), 0);
  assert.equal(roundHalfEven(-2.5), -2);
  assert.equal(roundHalfEven(-3.5), -4);
});

test("roundHalfEven：小数位定标与普通值", () => {
  assert.equal(roundHalfEven(0.125, 2), 0.12);
  assert.equal(roundHalfEven(0.375, 2), 0.38);
  assert.equal(roundHalfEven(0.1234, 4), 0.1234);
  assert.equal(roundHalfEven(0.12346, 4), 0.1235);
  assert.equal(roundHalfEven(6.5777, 2), 6.58);
});