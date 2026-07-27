import assert from "node:assert/strict";
import test from "node:test";

import {DEFAULT_SETTINGS, PRESETS, adjustPixel, processImageData} from "../src/color-math.js";

test("default correction remains inside display range", () => {
  const result = adjustPixel(0.12, 0.48, 0.64, DEFAULT_SETTINGS);
  assert.equal(result.length, 3);
  result.forEach(value => assert.ok(value >= 0 && value <= 1));
  assert.ok(result[0] > 0.12);
});

test("zero settings preserve a mid-gray pixel", () => {
  const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(name => [name, 0]));
  settings.master = 1;
  const result = adjustPixel(0.5, 0.5, 0.5, settings);
  result.forEach(value => assert.ok(Math.abs(value - 0.5) < 1e-8));
});

test("image processing preserves alpha", () => {
  const source = {data: new Uint8ClampedArray([30, 120, 180, 91])};
  processImageData(source, DEFAULT_SETTINGS);
  assert.equal(source.data[3], 91);
});

test("all curated looks remain meaningfully distinct", () => {
  const pixel = [0.12, 0.48, 0.64];
  const signatures = Object.values(PRESETS).map(settings => (
    adjustPixel(...pixel, settings).map(value => value.toFixed(4)).join(",")
  ));
  assert.equal(new Set(signatures).size, Object.keys(PRESETS).length);
});

test("corrected underwater pixels never collapse to a black frame", () => {
  const result = adjustPixel(0.08, 0.42, 0.62, PRESETS.natural);
  assert.ok(result.some(value => value > 0.1));
});
