import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  LEVEL_CHANNELS,
  LEVEL_DEFAULTS,
  PRESETS,
  adjustPixel,
  applyLevels,
  levelPoints,
  monotoneCurve,
  processImageData,
} from "../src/color-math.js";

test("default correction remains inside display range", () => {
  const result = adjustPixel(0.12, 0.48, 0.64, DEFAULT_SETTINGS);
  assert.equal(result.length, 3);
  result.forEach(value => assert.ok(value >= 0 && value <= 1));
  assert.ok(result[0] > 0.12);
});

test("zero settings preserve a mid-gray pixel", () => {
  const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(name => [name, 0]));
  settings.master = 1;
  LEVEL_CHANNELS.forEach(channel => {
    ["black", "shadows", "midtone", "highlights", "white"].forEach((point, index) => {
      settings[`levels_${channel}_${point}`] = LEVEL_DEFAULTS[index];
    });
  });
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

test("Green correction uses the desktop key and reduces a green-heavy cast", () => {
  const neutral = {...DEFAULT_SETTINGS, master: 1, green_correction: 0};
  const corrected = {...neutral, green_correction: 1};
  const before = adjustPixel(0.22, 0.78, 0.35, neutral);
  const after = adjustPixel(0.22, 0.78, 0.35, corrected);
  assert.ok(after[1] < before[1]);
});

test("all curated looks keep Green and Levels neutral", () => {
  Object.values(PRESETS).forEach(settings => {
    assert.equal(settings.green_correction, 0);
    LEVEL_CHANNELS.forEach(channel => {
      assert.deepEqual(levelPoints(settings, channel), LEVEL_DEFAULTS);
    });
  });
});

test("neutral five-point Levels are identity", () => {
  for (let index = 0; index <= 100; index += 1) {
    const value = index / 100;
    assert.ok(Math.abs(monotoneCurve(value, LEVEL_DEFAULTS) - value) < 1e-7);
  }
});

test("Levels curve is monotonic and cannot overshoot its control points", () => {
  const points = [0.03, 0.18, 0.58, 0.86, 0.98];
  const outputs = Array.from({length: 1001}, (_, index) => monotoneCurve(index / 1000, points));
  outputs.forEach(value => assert.ok(value >= points[0] - 1e-6 && value <= points[4] + 1e-6));
  for (let index = 1; index < outputs.length; index += 1) {
    assert.ok(outputs[index] + 1e-7 >= outputs[index - 1]);
  }
});

test("per-channel Levels affect only the selected channel after RGB", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    levels_red_black: 0.08,
    levels_red_shadows: 0.34,
    levels_red_midtone: 0.62,
    levels_red_highlights: 0.82,
    levels_red_white: 1,
  };
  const source = [0.2, 0.4, 0.7];
  const result = applyLevels(...source, settings);
  assert.notEqual(result[0], source[0]);
  assert.equal(result[1], source[1]);
  assert.equal(result[2], source[2]);
});

test("levelPoints enforces non-decreasing serialized values", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    levels_green_black: 0.6,
    levels_green_shadows: 0.2,
    levels_green_midtone: 0.4,
    levels_green_highlights: 0.8,
    levels_green_white: 0.7,
  };
  assert.deepEqual(levelPoints(settings, "green"), [0.6, 0.6, 0.6, 0.8, 0.8]);
});
