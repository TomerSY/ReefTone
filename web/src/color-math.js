export const LEVEL_CHANNELS = Object.freeze(["rgb", "red", "green", "blue"]);
export const LEVEL_POINTS = Object.freeze(["black", "shadows", "midtone", "highlights", "white"]);
export const LEVEL_DEFAULTS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

const levelSettings = Object.fromEntries(
  LEVEL_CHANNELS.flatMap(channel => (
    LEVEL_POINTS.map((point, index) => [`levels_${channel}_${point}`, LEVEL_DEFAULTS[index]])
  )),
);

export const DEFAULT_SETTINGS = Object.freeze({
  master: 1,
  auto_restore: 0.90,
  red_recovery: 0.95,
  green_correction: 0,
  blue_balance: 0.24,
  dehaze: 0.38,
  temperature: 0.04,
  tint: 0.01,
  exposure: 0,
  contrast: 0.22,
  black_point: 0.08,
  white_point: 0.04,
  highlights: -0.14,
  shadows: 0.10,
  saturation: 0.05,
  vibrance: 0.22,
  clarity: 0.16,
  denoise: 0.03,
  sharpen_amount: 0,
  sharpen_radius: 1,
  sharpen_threshold: 0.02,
  sample_red: 0,
  sample_green: 0,
  sample_blue: 0,
  sample_strength: 0,
  ...levelSettings,
});

export function normalizeSettings(settings = {}) {
  return {...DEFAULT_SETTINGS, ...settings};
}

const preset = overrides => Object.freeze({...DEFAULT_SETTINGS, ...overrides});

export const PRESETS = Object.freeze({
  natural: preset({}),
  vivid: preset({
    auto_restore: 0.96, red_recovery: 1.05, blue_balance: 0.05, dehaze: 0.58,
    temperature: 0.06, exposure: 0.08, contrast: 0.30, black_point: 0.13,
    white_point: 0.06, highlights: -0.18, shadows: 0.14, saturation: 0.28,
    vibrance: 0.55, clarity: 0.25,
  }),
  deep: preset({
    auto_restore: 1, red_recovery: 1.30, blue_balance: 0.58, dehaze: 0.68,
    temperature: 0.12, tint: 0.05, exposure: 0.10, contrast: 0.34,
    black_point: 0.14, white_point: 0.08, highlights: -0.24, shadows: 0.22,
    saturation: 0.08, vibrance: 0.30, clarity: 0.30, denoise: 0.08,
  }),
  gentle: preset({
    master: 0.62, auto_restore: 0.58, red_recovery: 0.48, blue_balance: 0.08,
    dehaze: 0.10, temperature: 0.02, contrast: 0.06, black_point: 0.01,
    white_point: 0, highlights: -0.05, shadows: 0.06, saturation: 0,
    vibrance: 0.07, clarity: 0.03, denoise: 0.06,
  }),
  dramatic: preset({
    auto_restore: 1, red_recovery: 1.15, blue_balance: 0.05, dehaze: 0.82,
    temperature: 0.16, tint: 0.07, exposure: -0.12, contrast: 0.48,
    black_point: 0.18, white_point: 0.10, highlights: -0.42, shadows: 0.02,
    saturation: -0.02, vibrance: 0.34, clarity: 0.42, denoise: 0.03,
  }),
});

const clamp = value => Math.max(0, Math.min(1, value));

export function levelPoints(settings, channel) {
  if (!LEVEL_CHANNELS.includes(channel)) {
    throw new RangeError(`Unsupported levels channel: ${channel}`);
  }
  let previous = 0;
  return LEVEL_POINTS.map((point, index) => {
    const raw = Number(settings[`levels_${channel}_${point}`] ?? LEVEL_DEFAULTS[index]);
    const value = Math.max(previous, clamp(Number.isFinite(raw) ? raw : LEVEL_DEFAULTS[index]));
    previous = value;
    return value;
  });
}

function prepareMonotoneCurve(points) {
  const controls = points.map(point => Math.fround(clamp(point)));
  if (controls.every((point, index) => point === LEVEL_DEFAULTS[index])) {
    return clamp;
  }

  const delta = new Float32Array(4);
  const tangents = new Float32Array(5);
  for (let index = 0; index < 4; index += 1) {
    delta[index] = Math.fround((controls[index + 1] - controls[index]) * 4);
  }
  for (let index = 1; index < 4; index += 1) {
    const before = delta[index - 1];
    const after = delta[index];
    if (before > 0 && after > 0) {
      tangents[index] = Math.fround((2 * before * after) / (before + after));
    }
  }

  let first = Math.fround((3 * delta[0] - delta[1]) * 0.5);
  if (first * delta[0] <= 0) first = 0;
  else if (Math.abs(first) > 3 * Math.abs(delta[0])) first = Math.fround(3 * delta[0]);
  tangents[0] = first;

  let last = Math.fround((3 * delta[3] - delta[2]) * 0.5);
  if (last * delta[3] <= 0) last = 0;
  else if (Math.abs(last) > 3 * Math.abs(delta[3])) last = Math.fround(3 * delta[3]);
  tangents[4] = last;

  return value => {
    const scaled = Math.fround(clamp(value) * 4);
    const segment = Math.min(Math.trunc(scaled), 3);
    const position = Math.fround(scaled - segment);
    const position2 = Math.fround(position * position);
    const position3 = Math.fround(position2 * position);
    const h00 = Math.fround(2 * position3 - 3 * position2 + 1);
    const h10 = Math.fround(position3 - 2 * position2 + position);
    const h01 = Math.fround(-2 * position3 + 3 * position2);
    const h11 = Math.fround(position3 - position2);
    return clamp(Math.fround(
      h00 * controls[segment]
      + h10 * tangents[segment] * 0.25
      + h01 * controls[segment + 1]
      + h11 * tangents[segment + 1] * 0.25,
    ));
  };
}

export function monotoneCurve(value, points) {
  return prepareMonotoneCurve(points)(value);
}

function prepareLevels(settings) {
  return Object.fromEntries(
    LEVEL_CHANNELS.map(channel => [channel, prepareMonotoneCurve(levelPoints(settings, channel))]),
  );
}

export function applyLevels(red, green, blue, settings) {
  const curves = prepareLevels(settings);
  red = curves.rgb(red);
  green = curves.rgb(green);
  blue = curves.rgb(blue);
  return [
    curves.red(red),
    curves.green(green),
    curves.blue(blue),
  ];
}

export function analyzeImageData(imageData) {
  const data = imageData.data;
  const pixelCount = data.length / 4;
  const stride = Math.max(1, Math.floor(pixelCount / 50_000));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  const lumas = [];

  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (luma > 0.025 && luma < 0.975) {
      red += r;
      green += g;
      blue += b;
      count += 1;
    }
    lumas.push(luma);
  }

  count = Math.max(1, count);
  red /= count;
  green /= count;
  blue /= count;
  lumas.sort((a, b) => a - b);
  const p05 = lumas[Math.floor(lumas.length * 0.05)] ?? 0;
  const p95 = lumas[Math.floor(lumas.length * 0.95)] ?? 1;
  const redLoss = clamp((green - red) / Math.max(green, 0.08));
  const cyanCast = clamp(((green + blue) * 0.5 - red) / Math.max(green + blue, 0.12));
  const haze = clamp((0.58 - (p95 - p05)) / 0.48);
  const lowLight = clamp((0.40 - (red + green + blue) / 3) / 0.34);
  const confidence = clamp(0.15 + redLoss * 0.62 + cyanCast * 0.34);
  const label = confidence > 0.72
    ? "Strong underwater cast"
    : confidence > 0.42
      ? "Moderate underwater cast"
      : haze > 0.55
        ? "Low-contrast water"
        : "Light correction suggested";
  return {red, green, blue, redLoss, cyanCast, haze, lowLight, confidence, label};
}

function sampleGains(settings) {
  if (settings.sample_strength <= 0.001) return [1, 1, 1];
  const sample = [
    Math.max(settings.sample_red, 1e-4),
    Math.max(settings.sample_green, 1e-4),
    Math.max(settings.sample_blue, 1e-4),
  ];
  const neutral = Math.cbrt(sample[0] * sample[1] * sample[2]);
  return sample.map(channel => (
    Math.max(0.32, Math.min(4, neutral / channel)) ** (settings.sample_strength * 0.92)
  ));
}

export function adjustPixel(
  red,
  green,
  blue,
  settings,
  analysis = null,
  preparedLevels = null,
  applyMaster = true,
) {
  const original = [red, green, blue];
  const fallbackRedLoss = clamp((green - red) / Math.max(green, 0.08));
  const fallbackCyan = clamp(((green + blue) * 0.5 - red) / Math.max(green + blue, 0.12));
  const scene = analysis || {
    red,
    green,
    blue,
    redLoss: fallbackRedLoss,
    haze: 0.4,
    confidence: clamp(0.15 + fallbackRedLoss * 0.62 + fallbackCyan * 0.34),
  };

  const redGap = Math.max(0, scene.green - scene.red);
  const blueWater = clamp((blue - green) * 4);
  const redProtection = 1 - blueWater * 0.72;
  const redAmount = settings.red_recovery * (0.42 + scene.redLoss * 0.80);
  red += redGap * redAmount * (1 - red) * green * redProtection;

  const blueGap = scene.green - scene.blue;
  blue += blueGap * settings.blue_balance * (1 - blue) * (0.35 + green);

  const greenTarget = (scene.red + scene.blue) * 0.5;
  const greenGap = greenTarget - scene.green;
  green += greenGap * settings.green_correction * (1 - green) * (0.35 + blue);

  const redTarget = scene.green * (0.84 + 0.04 * scene.confidence);
  const redGain = Math.max(0.65, Math.min(2.8, redTarget / Math.max(scene.red, 1e-4)));
  const blueGain = Math.max(0.66, Math.min(1.45, scene.green / Math.max(scene.blue, 1e-4)));
  const autoPower = settings.auto_restore * (0.30 + 0.50 * scene.confidence);
  red *= 1 + (redGain ** autoPower - 1) * redProtection;
  blue *= blueGain ** autoPower;

  const warmth = settings.temperature * 0.28;
  const tint = settings.tint * 0.22;
  red *= 1 + warmth + tint * 0.48;
  green *= 1 - tint;
  blue *= 1 - warmth + tint * 0.34;

  const gains = sampleGains(settings);
  red *= gains[0];
  green *= gains[1];
  blue *= gains[2];

  const exposure = 2 ** settings.exposure;
  red *= exposure;
  green *= exposure;
  blue *= exposure;
  let luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;

  const shadowLift = ((1 - luma) ** 2) * settings.shadows * 0.42;
  const highlightShift = (luma ** 2) * settings.highlights * 0.34;
  red += shadowLift + highlightShift;
  green += shadowLift + highlightShift;
  blue += shadowLift + highlightShift;

  const low = settings.black_point * 0.28;
  const high = Math.max(low + 0.18, 1 - settings.white_point * 0.28);
  red = (red - low) / (high - low);
  green = (green - low) / (high - low);
  blue = (blue - low) / (high - low);

  const contrast = 2 ** (settings.contrast * 1.65);
  const fusionContrast = 1 + settings.dehaze * (0.28 + scene.haze * 0.28);
  red = (red - 0.5) * contrast * fusionContrast + 0.5;
  green = (green - 0.5) * contrast * fusionContrast + 0.5;
  blue = (blue - 0.5) * contrast * fusionContrast + 0.5;

  const curves = preparedLevels || prepareLevels(settings);
  red = curves.red(curves.rgb(red));
  green = curves.green(curves.rgb(green));
  blue = curves.blue(curves.rgb(blue));

  luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  const vibranceMask = clamp(1 - chroma * 1.8);
  const colorFactor = 1 + settings.saturation + settings.vibrance * vibranceMask;
  red = luma + (red - luma) * colorFactor;
  green = luma + (green - luma) * colorFactor;
  blue = luma + (blue - luma) * colorFactor;

  const clarityFactor = 1 + settings.clarity * 0.30;
  red = (red - luma) * clarityFactor + luma;
  green = (green - luma) * clarityFactor + luma;
  blue = (blue - luma) * clarityFactor + luma;

  // A restrained chroma-noise reduction for the browser renderer. Spatial
  // denoising remains part of the higher-quality Python pipeline.
  const denoiseBlend = settings.denoise * 0.12;
  red = red * (1 - denoiseBlend) + luma * denoiseBlend;
  green = green * (1 - denoiseBlend) + luma * denoiseBlend;
  blue = blue * (1 - denoiseBlend) + luma * denoiseBlend;

  if (!applyMaster) return [clamp(red), clamp(green), clamp(blue)];
  const master = settings.master;
  return [
    clamp(original[0] * (1 - master) + red * master),
    clamp(original[1] * (1 - master) + green * master),
    clamp(original[2] * (1 - master) + blue * master),
  ];
}

function adjustPixelBeforeMaster(red, green, blue, settings, analysis, preparedLevels) {
  return adjustPixel(
    red,
    green,
    blue,
    settings,
    analysis,
    preparedLevels,
    false,
  );
}

function reflect101(index, size) {
  if (size <= 1) return 0;
  let reflected = index;
  while (reflected < 0 || reflected >= size) {
    reflected = reflected < 0 ? -reflected : size * 2 - reflected - 2;
  }
  return reflected;
}

function gaussianKernel(radius) {
  const sigma = Math.max(0.3, Number(radius) || 1);
  const extent = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(extent * 2 + 1);
  let total = 0;
  for (let offset = -extent; offset <= extent; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + extent] = Math.fround(weight);
    total += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) {
    kernel[index] = Math.fround(kernel[index] / total);
  }
  return kernel;
}

function horizontalBlur(source, target, width, height, kernel, stride = 1, channel = 0) {
  const extent = (kernel.length - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -extent; offset <= extent; offset += 1) {
        const sampleX = reflect101(x + offset, width);
        sum += source[(row + sampleX) * stride + channel] * kernel[offset + extent];
      }
      target[row + x] = Math.fround(sum);
    }
  }
}

function verticalSample(source, x, y, width, height, kernel) {
  const extent = (kernel.length - 1) / 2;
  let sum = 0;
  for (let offset = -extent; offset <= extent; offset += 1) {
    const sampleY = reflect101(y + offset, height);
    sum += source[sampleY * width + x] * kernel[offset + extent];
  }
  return Math.fround(sum);
}

export function applySharpening(
  corrected,
  originalBytes,
  width,
  height,
  settings,
  outputBytes,
  onProgress = null,
) {
  const amount = Number(settings.sharpen_amount ?? 0);
  const master = Number(settings.master ?? 1);
  const pixelCount = width * height;

  if (amount <= 0.001) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const byteOffset = pixel * 4;
      const floatOffset = pixel * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const original = originalBytes[byteOffset + channel] / 255;
        outputBytes[byteOffset + channel] = Math.round(
          clamp(original * (1 - master) + corrected[floatOffset + channel] * master) * 255,
        );
      }
    }
    return outputBytes;
  }

  const kernel = gaussianKernel(settings.sharpen_radius);
  const threshold = Math.max(0, Number(settings.sharpen_threshold ?? 0.02));
  const feather = Math.max(threshold * 0.5, 1e-4);
  const gate = new Float32Array(pixelCount);
  const temporary = new Float32Array(pixelCount);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 3;
    gate[pixel] = Math.fround(
      corrected[offset] * 0.2126
      + corrected[offset + 1] * 0.7152
      + corrected[offset + 2] * 0.0722,
    );
  }
  horizontalBlur(gate, temporary, width, height, kernel);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 3;
      const originalLuma = Math.fround(
        corrected[offset] * 0.2126
        + corrected[offset + 1] * 0.7152
        + corrected[offset + 2] * 0.0722,
      );
      const magnitude = Math.abs(originalLuma - verticalSample(
        temporary,
        x,
        y,
        width,
        height,
        kernel,
      ));
      gate[pixel] = threshold > 0
        ? Math.fround(clamp((magnitude - threshold) / feather))
        : 1;
    }
    if (onProgress && y % 32 === 0) onProgress(0.58 + (y / height) * 0.12);
  }

  for (let channel = 0; channel < 3; channel += 1) {
    horizontalBlur(corrected, temporary, width, height, kernel, 3, channel);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const floatOffset = pixel * 3 + channel;
        const byteOffset = pixel * 4 + channel;
        const base = corrected[floatOffset];
        const blurred = verticalSample(temporary, x, y, width, height, kernel);
        const sharpened = Math.fround(base + (base - blurred) * amount * gate[pixel]);
        const safe = Number.isFinite(sharpened) ? clamp(sharpened) : clamp(base);
        const original = originalBytes[byteOffset] / 255;
        outputBytes[byteOffset] = Math.round(clamp(
          original * (1 - master) + safe * master,
        ) * 255);
      }
      if (onProgress && y % 32 === 0) {
        onProgress(0.70 + ((channel * height + y) / (height * 3)) * 0.29);
      }
    }
  }
  return outputBytes;
}

export function processImageData(imageData, settings, onProgress = null, analysis = null) {
  const data = imageData.data;
  const normalized = normalizeSettings(settings);
  const scene = analysis || analyzeImageData(imageData);
  const curves = prepareLevels(normalized);
  const totalPixels = data.length / 4;

  if (normalized.sharpen_amount <= 0.001) {
    for (let offset = 0; offset < data.length; offset += 4) {
      const [red, green, blue] = adjustPixel(
        data[offset] / 255,
        data[offset + 1] / 255,
        data[offset + 2] / 255,
        normalized,
        scene,
        curves,
      );
      data[offset] = Math.round(red * 255);
      data[offset + 1] = Math.round(green * 255);
      data[offset + 2] = Math.round(blue * 255);
      if (onProgress && offset % 1_000_000 === 0) {
        onProgress((offset / 4) / totalPixels);
      }
    }
    onProgress?.(1);
    return imageData;
  }

  const originalBytes = new Uint8ClampedArray(data);
  const corrected = new Float32Array(totalPixels * 3);
  for (let offset = 0; offset < data.length; offset += 4) {
    const [red, green, blue] = adjustPixelBeforeMaster(
      data[offset] / 255,
      data[offset + 1] / 255,
      data[offset + 2] / 255,
      normalized,
      scene,
      curves,
    );
    const floatOffset = (offset / 4) * 3;
    corrected[floatOffset] = Math.fround(red);
    corrected[floatOffset + 1] = Math.fround(green);
    corrected[floatOffset + 2] = Math.fround(blue);
    if (onProgress && offset % 1_000_000 === 0) {
      onProgress(((offset / 4) / totalPixels) * 0.58);
    }
  }
  applySharpening(
    corrected,
    originalBytes,
    imageData.width,
    imageData.height,
    normalized,
    data,
    onProgress,
  );
  onProgress?.(1);
  return imageData;
}
