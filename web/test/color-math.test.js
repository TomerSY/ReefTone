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
  normalizeSettings,
  processImageData,
} from "../src/color-math.js";

function makeImage(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha = 255] = pixel(x, y);
      data.set([red, green, blue, alpha], offset);
    }
  }
  return {data, width, height};
}

function cloneImage(image) {
  return {data: new Uint8ClampedArray(image.data), width: image.width, height: image.height};
}

function identitySettings(overrides = {}) {
  const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(name => [name, 0]));
  settings.master = 1;
  settings.sharpen_radius = 1;
  settings.sharpen_threshold = 0.02;
  LEVEL_CHANNELS.forEach(channel => {
    ["black", "shadows", "midtone", "highlights", "white"].forEach((point, index) => {
      settings[`levels_${channel}_${point}`] = LEVEL_DEFAULTS[index];
    });
  });
  return {...settings, ...overrides};
}

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

test("all curated looks keep Green, Levels, and Sharpening neutral", () => {
  Object.values(PRESETS).forEach(settings => {
    assert.equal(settings.green_correction, 0);
    assert.equal(settings.sharpen_amount, 0);
    assert.equal(settings.sharpen_radius, 1);
    assert.equal(settings.sharpen_threshold, 0.02);
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

test("Sharpening Amount 0 preserves legacy browser output exactly", () => {
  const source = makeImage(9, 5, (x, y) => [
    25 + x * 17,
    70 + y * 21,
    180 - x * 9,
    120 + y,
  ]);
  const current = cloneImage(source);
  const legacy = cloneImage(source);
  const currentSettings = {...DEFAULT_SETTINGS, sharpen_amount: 0};
  const legacySettings = {...DEFAULT_SETTINGS};
  delete legacySettings.sharpen_amount;
  delete legacySettings.sharpen_radius;
  delete legacySettings.sharpen_threshold;
  processImageData(current, currentSettings);
  processImageData(legacy, legacySettings);
  assert.deepEqual(current.data, legacy.data);
  assert.deepEqual(
    [...current.data].filter((_, index) => index % 4 === 3),
    [...source.data].filter((_, index) => index % 4 === 3),
  );
});

test("Sharpening Radius changes the spatial edge response", () => {
  const source = makeImage(25, 7, x => {
    const value = x < 12 ? 72 : 184;
    return [value, value, value];
  });
  const narrow = cloneImage(source);
  const broad = cloneImage(source);
  processImageData(narrow, identitySettings({
    sharpen_amount: 1,
    sharpen_radius: 0.3,
    sharpen_threshold: 0,
  }));
  processImageData(broad, identitySettings({
    sharpen_amount: 1,
    sharpen_radius: 3,
    sharpen_threshold: 0,
  }));
  assert.notDeepEqual(narrow.data, broad.data);
  const sample = (image, x) => image.data[(3 * image.width + x) * 4];
  assert.notEqual(sample(narrow, 10), sample(broad, 10));
});

test("Sharpening Threshold suppresses small noisy detail", () => {
  const source = makeImage(19, 9, (x, y) => {
    const noise = ((x * 7 + y * 11) % 5) - 2;
    const value = 128 + noise;
    return [value, value, value];
  });
  const unguarded = cloneImage(source);
  const protectedNoise = cloneImage(source);
  processImageData(unguarded, identitySettings({
    sharpen_amount: 2,
    sharpen_radius: 1,
    sharpen_threshold: 0,
  }));
  processImageData(protectedNoise, identitySettings({
    sharpen_amount: 2,
    sharpen_radius: 1,
    sharpen_threshold: 0.08,
  }));
  const delta = image => image.data.reduce((total, value, index) => (
    index % 4 === 3 ? total : total + Math.abs(value - source.data[index])
  ), 0);
  assert.ok(delta(unguarded) > 0);
  assert.ok(delta(protectedNoise) < delta(unguarded) * 0.1);
});

test("Sharpening enhances an edge without black output, clipping errors, or NaNs", () => {
  const source = makeImage(31, 9, x => {
    const value = x < 15 ? 84 : 172;
    return [value, value, value];
  });
  const sharpened = cloneImage(source);
  processImageData(sharpened, identitySettings({
    sharpen_amount: 1.4,
    sharpen_radius: 1.6,
    sharpen_threshold: 0.01,
  }));
  const row = 4;
  const at = (image, x) => image.data[(row * image.width + x) * 4];
  const originalContrast = at(source, 15) - at(source, 14);
  const sharpenedContrast = at(sharpened, 15) - at(sharpened, 14);
  assert.ok(sharpenedContrast > originalContrast);
  assert.ok(sharpened.data.some((value, index) => index % 4 !== 3 && value > 0));
  sharpened.data.forEach(value => {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 255);
  });
});

test("legacy serialized settings receive neutral Sharpening defaults", () => {
  const legacy = {...DEFAULT_SETTINGS};
  delete legacy.sharpen_amount;
  delete legacy.sharpen_radius;
  delete legacy.sharpen_threshold;
  const restored = normalizeSettings(legacy);
  assert.equal(restored.sharpen_amount, 0);
  assert.equal(restored.sharpen_radius, 1);
  assert.equal(restored.sharpen_threshold, 0.02);
  assert.equal(restored.red_recovery, legacy.red_recovery);
  assert.equal(restored.green_correction, legacy.green_correction);
  assert.equal(restored.blue_balance, legacy.blue_balance);
});
