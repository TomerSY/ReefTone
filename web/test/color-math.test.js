import assert from "node:assert/strict";
import test from "node:test";

import {DEFAULT_SETTINGS, adjustPixel, processImageData} from "../src/color-math.js";

test("default correction remains inside display range", () => {
  const result = adjustPixel(0.12, 0.48, 0.64, DEFAULT_SETTINGS);
  assert.equal(result.length, 3);
  result.forEach(value => assert.ok(value >= 0 && value <= 1));
  assert.ok(result[0] > 0.12);
});

test("zero settings preserve a mid-gray pixel", () => {
  const settings = {
    exposure: 0,
    contrast: 0,
    redRecovery: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
  };
  const result = adjustPixel(0.5, 0.5, 0.5, settings);
  result.forEach(value => assert.ok(Math.abs(value - 0.5) < 1e-8));
});

test("image processing preserves alpha", () => {
  const source = {data: new Uint8ClampedArray([30, 120, 180, 91])};
  processImageData(source, DEFAULT_SETTINGS);
  assert.equal(source.data[3], 91);
});
