import assert from "node:assert/strict";
import { resizeGraphicFrame, rotateGraphicFrame, cropGraphicFrame } from "../js/graphic-object-geometry.js";
const f = { x: 50, y: 80, width: 200, height: 160, rotation: 37 };
const corner = (f2, sx, sy) => {
  const a = f2.rotation * Math.PI / 180;
  return [f2.x + f2.width / 2 + sx * f2.width / 2 * Math.cos(a) - sy * f2.height / 2 * Math.sin(a), f2.y + f2.height / 2 + sx * f2.width / 2 * Math.sin(a) + sy * f2.height / 2 * Math.cos(a)];
};
for (const k of ["nw", "ne", "sw", "se"]) {
  const next = resizeGraphicFrame(f, k, 18, -13);
  const sx = k.includes("w") ? 1 : -1, sy = k.includes("n") ? 1 : -1;
  const a = corner(f, sx, sy), b = corner(next, sx, sy);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8);
}
assert.equal(rotateGraphicFrame({ ...f, rotation: 170 }, 0, Math.PI / 4, true).rotation, -150);
for (const flipX of [false, true]) for (const flipY of [false, true]) {
  const cropped = cropGraphicFrame(f, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, flipX, flipY);
  assert.equal(cropped.width, 100);
  assert.equal(cropped.height, 80);
  assert.ok(Math.abs(cropped.x + 50 - f.x - 100) < 1e-8);
}
console.log("Rotated opposite-corner anchors, angle normalization and crop geometry passed");
