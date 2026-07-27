export const DEFAULT_SETTINGS = Object.freeze({
  master: 1,
  autoRestore: 0.90,
  redRecovery: 0.95,
  blueBalance: 0.24,
  dehaze: 0.38,
  temperature: 0.04,
  tint: 0.01,
  exposure: 0,
  contrast: 0.22,
  blackPoint: 0.08,
  whitePoint: 0.04,
  highlights: -0.14,
  shadows: 0.10,
  saturation: 0.05,
  vibrance: 0.22,
  clarity: 0.16,
  denoise: 0.03,
  sampleRed: 0,
  sampleGreen: 0,
  sampleBlue: 0,
  sampleStrength: 0,
});

const preset = overrides => Object.freeze({...DEFAULT_SETTINGS, ...overrides});

export const PRESETS = Object.freeze({
  natural: preset({}),
  vivid: preset({
    autoRestore: 0.96, redRecovery: 1.05, blueBalance: 0.05, dehaze: 0.58,
    temperature: 0.06, exposure: 0.08, contrast: 0.30, blackPoint: 0.13,
    whitePoint: 0.06, highlights: -0.18, shadows: 0.14, saturation: 0.28,
    vibrance: 0.55, clarity: 0.25,
  }),
  deep: preset({
    autoRestore: 1, redRecovery: 1.30, blueBalance: 0.58, dehaze: 0.68,
    temperature: 0.12, tint: 0.05, exposure: 0.10, contrast: 0.34,
    blackPoint: 0.14, whitePoint: 0.08, highlights: -0.24, shadows: 0.22,
    saturation: 0.08, vibrance: 0.30, clarity: 0.30, denoise: 0.08,
  }),
  gentle: preset({
    master: 0.62, autoRestore: 0.58, redRecovery: 0.48, blueBalance: 0.08,
    dehaze: 0.10, temperature: 0.02, contrast: 0.06, blackPoint: 0.01,
    whitePoint: 0, highlights: -0.05, shadows: 0.06, saturation: 0,
    vibrance: 0.07, clarity: 0.03, denoise: 0.06,
  }),
  dramatic: preset({
    autoRestore: 1, redRecovery: 1.15, blueBalance: 0.05, dehaze: 0.82,
    temperature: 0.16, tint: 0.07, exposure: -0.12, contrast: 0.48,
    blackPoint: 0.18, whitePoint: 0.10, highlights: -0.42, shadows: 0.02,
    saturation: -0.02, vibrance: 0.34, clarity: 0.42, denoise: 0.03,
  }),
});

const clamp = value => Math.max(0, Math.min(1, value));

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
  if (settings.sampleStrength <= 0.001) return [1, 1, 1];
  const sample = [
    Math.max(settings.sampleRed, 1e-4),
    Math.max(settings.sampleGreen, 1e-4),
    Math.max(settings.sampleBlue, 1e-4),
  ];
  const neutral = Math.cbrt(sample[0] * sample[1] * sample[2]);
  return sample.map(channel => (
    Math.max(0.32, Math.min(4, neutral / channel)) ** (settings.sampleStrength * 0.92)
  ));
}

export function adjustPixel(red, green, blue, settings, analysis = null) {
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
  const redAmount = settings.redRecovery * (0.42 + scene.redLoss * 0.80);
  red += redGap * redAmount * (1 - red) * green * redProtection;

  const blueGap = scene.green - scene.blue;
  blue += blueGap * settings.blueBalance * (1 - blue) * (0.35 + green);

  const redTarget = scene.green * (0.84 + 0.04 * scene.confidence);
  const redGain = Math.max(0.65, Math.min(2.8, redTarget / Math.max(scene.red, 1e-4)));
  const blueGain = Math.max(0.66, Math.min(1.45, scene.green / Math.max(scene.blue, 1e-4)));
  const autoPower = settings.autoRestore * (0.30 + 0.50 * scene.confidence);
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

  const low = settings.blackPoint * 0.28;
  const high = Math.max(low + 0.18, 1 - settings.whitePoint * 0.28);
  red = (red - low) / (high - low);
  green = (green - low) / (high - low);
  blue = (blue - low) / (high - low);

  const contrast = 2 ** (settings.contrast * 1.65);
  const fusionContrast = 1 + settings.dehaze * (0.28 + scene.haze * 0.28);
  red = (red - 0.5) * contrast * fusionContrast + 0.5;
  green = (green - 0.5) * contrast * fusionContrast + 0.5;
  blue = (blue - 0.5) * contrast * fusionContrast + 0.5;

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

  const master = settings.master;
  return [
    clamp(original[0] * (1 - master) + red * master),
    clamp(original[1] * (1 - master) + green * master),
    clamp(original[2] * (1 - master) + blue * master),
  ];
}

export function processImageData(imageData, settings, onProgress = null, analysis = null) {
  const data = imageData.data;
  const scene = analysis || analyzeImageData(imageData);
  const totalPixels = data.length / 4;
  for (let offset = 0; offset < data.length; offset += 4) {
    const [red, green, blue] = adjustPixel(
      data[offset] / 255,
      data[offset + 1] / 255,
      data[offset + 2] / 255,
      settings,
      scene,
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
