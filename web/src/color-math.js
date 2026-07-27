export const DEFAULT_SETTINGS = Object.freeze({
  exposure: 0,
  contrast: 0.18,
  redRecovery: 0.55,
  temperature: 0.08,
  tint: 0,
  saturation: 0.08,
});

const clamp = value => Math.max(0, Math.min(1, value));

export function adjustPixel(red, green, blue, settings) {
  const redGap = Math.max(0, green - red);
  red += redGap
    * settings.redRecovery
    * 0.72
    * (1 - red)
    * (0.35 + green);

  const warmth = settings.temperature * 0.28;
  const tint = settings.tint * 0.22;
  red *= 1 + warmth + tint * 0.48;
  green *= 1 - tint;
  blue *= 1 - warmth + tint * 0.34;

  const exposure = 2 ** settings.exposure;
  red *= exposure;
  green *= exposure;
  blue *= exposure;

  const contrast = 1 + settings.contrast;
  red = (red - 0.5) * contrast + 0.5;
  green = (green - 0.5) * contrast + 0.5;
  blue = (blue - 0.5) * contrast + 0.5;

  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const saturation = 1 + settings.saturation;
  red = luminance + (red - luminance) * saturation;
  green = luminance + (green - luminance) * saturation;
  blue = luminance + (blue - luminance) * saturation;

  return [clamp(red), clamp(green), clamp(blue)];
}

export function processImageData(imageData, settings, onProgress = null) {
  const data = imageData.data;
  const totalPixels = data.length / 4;
  for (let offset = 0; offset < data.length; offset += 4) {
    const [red, green, blue] = adjustPixel(
      data[offset] / 255,
      data[offset + 1] / 255,
      data[offset + 2] / 255,
      settings,
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
