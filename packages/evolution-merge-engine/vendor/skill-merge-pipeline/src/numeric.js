"use strict";
// 数值单点：Python round() 语义（四舍六入五成双，负数对称）。
function roundHalfEven(x, digits) {
  const d = digits === undefined ? 0 : digits;
  const f = Math.pow(10, d);
  const sign = x < 0 ? -1 : 1;
  const y = Math.abs(x) * f;
  const lower = Math.floor(y);
  const diff = y - lower;
  let r;
  if (Math.abs(diff - 0.5) < 1e-9) r = (lower % 2 === 0) ? lower : lower + 1;
  else r = Math.round(y);
  if (r === 0) return 0;
  return sign * r / f;
}
export { roundHalfEven };