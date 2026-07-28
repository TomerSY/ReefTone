import "../../src/reeftone/static/styles.css";
import "./web-style.css";
import {
  DEFAULT_SETTINGS,
  LEVEL_CHANNELS,
  LEVEL_DEFAULTS,
  LEVEL_POINTS,
  PRESETS,
  analyzeImageData,
  monotoneCurve,
  normalizeSettings,
  processImageData,
} from "./color-math.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const VERSION = "0.6.0-alpha.6";
const LEVEL_VIEW = Object.freeze({width: 288, height: 128, padding: 12});
const CONTROL_DEFAULTS = Object.freeze({
  sharpen_amount: 0,
  sharpen_radius: 1,
  sharpen_threshold: 0.02,
});
const CONTROL_BYPASS_VALUES = Object.freeze({
  sharpen_radius: 1,
  sharpen_threshold: 0,
});

const state = {
  file: null,
  objectUrl: null,
  previewBitmap: null,
  cpuSource: null,
  analysis: null,
  settings: {...DEFAULT_SETTINGS},
  bypassed: new Set(),
  history: [],
  future: [],
  settingsClips: [],
  renderQueued: false,
  swipeEnabled: false,
  fullBefore: false,
  comparisonHeld: false,
  compare: 50,
  sampling: false,
  zoomTool: false,
  zoomScale: 1,
  zoomMode: "fit",
  panX: 0,
  panY: 0,
  panning: false,
  panStart: null,
  suppressClick: false,
  levelsChannel: "rgb",
};

function toast(message, isError = false) {
  const item = document.createElement("div");
  item.className = `toast${isError ? " error" : ""}`;
  item.textContent = message;
  $("#toastRegion").append(item);
  setTimeout(() => item.remove(), 4200);
}

function displayValue(name, value) {
  if (name === "exposure") {
    return value === 0 ? "0.00" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  }
  if (name === "sharpen_amount") return `${Math.round(value * 100)}%`;
  if (name === "sharpen_radius") return `${value.toFixed(1)} px`;
  if (name === "sharpen_threshold") return `${Math.round(value * 100)}%`;
  if (["master", "auto_restore", "red_recovery", "dehaze", "denoise"].includes(name)) {
    return String(Math.round(value * 100));
  }
  return value === 0 ? "0" : `${value > 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))}`;
}

function snapshot() {
  return {
    settings: {...state.settings},
    bypassed: [...state.bypassed],
  };
}

function restoreSnapshot(saved) {
  state.settings = normalizeSettings(saved.settings);
  state.bypassed = new Set(saved.bypassed || []);
  syncControls();
  selectMatchingPreset();
  schedulePreview();
}

function pushHistory(previous) {
  state.history.push(previous);
  if (state.history.length > 50) state.history.shift();
  state.future = [];
  updateHistoryButtons();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restoreSnapshot(state.history.pop());
  updateHistoryButtons();
}

function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restoreSnapshot(state.future.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $("#undoButton").disabled = !state.history.length;
  $("#redoButton").disabled = !state.future.length;
}

function effectiveSettings() {
  const settings = {...state.settings};
  state.bypassed.forEach(name => {
    if (name in settings) settings[name] = CONTROL_BYPASS_VALUES[name] ?? 0;
  });
  if (state.bypassed.has("sharpening")) settings.sharpen_amount = 0;
  LEVEL_CHANNELS.forEach(channel => {
    if (!state.bypassed.has(`levels_${channel}`)) return;
    LEVEL_POINTS.forEach((point, index) => {
      settings[`levels_${channel}_${point}`] = LEVEL_DEFAULTS[index];
    });
  });
  return settings;
}

function updateRangeStyle(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const fill = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${fill}%`);
}

function syncControls() {
  $$("[data-setting]").forEach(input => {
    const name = input.dataset.setting;
    input.value = state.settings[name];
    updateRangeStyle(input);
    $(`[data-output="${name}"]`).value = displayValue(name, Number(input.value));
    const control = input.closest(".slider-control");
    const bypassed = state.bypassed.has(name);
    control?.classList.toggle("bypassed", bypassed);
    const button = control?.querySelector(".bypass-control");
    if (button) {
      const readable = input.dataset.label || name.replaceAll("_", " ");
      button.setAttribute("aria-pressed", String(!bypassed));
      button.title = bypassed ? `Enable ${readable}` : `Temporarily disable ${readable}`;
    }
  });
  $("#autoToggle").checked = state.settings.auto_restore > 0 && !state.bypassed.has("auto_restore");
  renderLevelsControl();
  syncSharpeningControl();
}

function addPerControlActions() {
  $$("[data-setting]").forEach(input => {
    const label = input.closest(".slider-control");
    const name = input.dataset.setting;
    const readable = input.dataset.label || label.querySelector(":scope > span").textContent;
    const defaultValue = CONTROL_DEFAULTS[name] ?? 0;
    const actions = document.createElement("span");
    actions.className = "control-actions";
    actions.innerHTML = `
      <button class="mini-control reset-control" type="button" title="Reset ${readable} to default" aria-label="Reset ${readable} to default">
        <svg viewBox="0 0 24 24"><path d="M5 8v5h5"/><path d="M6.4 16a7 7 0 1 0 .2-8.2L5 10"/></svg>
      </button>
      <button class="mini-control bypass-control" type="button" title="Temporarily disable ${readable}" aria-label="Toggle ${readable}" aria-pressed="true">
        <svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>
      </button>
    `;
    label.append(actions);
    actions.querySelector(".reset-control").addEventListener("click", event => {
      event.preventDefault();
      const previous = snapshot();
      state.settings[name] = defaultValue;
      state.bypassed.delete(name);
      if (name.startsWith("sharpen_")) state.bypassed.delete("sharpening");
      pushHistory(previous);
      clearPresetSelection();
      syncControls();
      schedulePreview();
    });
    actions.querySelector(".bypass-control").addEventListener("click", event => {
      event.preventDefault();
      const previous = snapshot();
      if (state.bypassed.has(name)) state.bypassed.delete(name);
      else state.bypassed.add(name);
      pushHistory(previous);
      clearPresetSelection();
      syncControls();
      schedulePreview();
    });
  });
}

function syncSharpeningControl() {
  const bypassed = state.bypassed.has("sharpening");
  $("#sharpeningTool")?.classList.toggle("bypassed", bypassed);
  const button = $("#sharpenBypass");
  if (!button) return;
  button.setAttribute("aria-pressed", String(!bypassed));
  button.title = bypassed ? "Enable sharpening" : "Temporarily disable sharpening";
}

function resetSharpening() {
  const previous = snapshot();
  Object.entries(CONTROL_DEFAULTS).forEach(([name, value]) => {
    state.settings[name] = value;
    state.bypassed.delete(name);
  });
  state.bypassed.delete("sharpening");
  pushHistory(previous);
  syncControls();
  clearPresetSelection();
  schedulePreview();
}

function toggleSharpeningBypass() {
  const previous = snapshot();
  if (state.bypassed.has("sharpening")) state.bypassed.delete("sharpening");
  else state.bypassed.add("sharpening");
  pushHistory(previous);
  syncSharpeningControl();
  clearPresetSelection();
  schedulePreview();
}

function setControlsEnabled(enabled) {
  $$("[data-setting], .slider-control .mini-control, #eyedropperButton, #levelsChannel, #levelsReset, #levelsBypass, #sharpenReset, #sharpenBypass, #resetButton, #copySettingsButton").forEach(control => {
    control.disabled = !enabled;
  });
  $("#exportButton").disabled = !enabled || typeof OffscreenCanvas === "undefined";
  $("#exportButton").title = typeof OffscreenCanvas === "undefined"
    ? "Full-resolution worker export is unavailable in this browser"
    : "Export JPEG or PNG";
  $("#levelsControl").classList.toggle("disabled", !enabled);
}

function capabilityRows() {
  const checks = [
    ["Canvas preview", true, "Ready"],
    ["JPEG / PNG", true, "Ready"],
    ["Worker export", typeof OffscreenCanvas !== "undefined", typeof OffscreenCanvas !== "undefined" ? "Ready" : "Unavailable"],
    ["HEIC / TIFF", false, "Later"],
    ["ICC / P3 output", false, "Later"],
    ["HDR / gain maps", false, "Later"],
  ];
  $("#capabilitySummary").textContent = `${checks.filter(([, supported]) => supported).length} local capabilities ready`;
  $("#capabilityGrid").innerHTML = checks.map(([label, supported, status]) => `
    <span class="${supported ? "supported" : "missing"}"><i></i>${label}<small>${status}</small></span>
  `).join("");
}

function levelsKey(channel, point) {
  return `levels_${channel}_${point}`;
}

function levelsValues(channel = state.levelsChannel) {
  let previous = 0;
  return LEVEL_POINTS.map((point, index) => {
    const value = Math.max(
      previous,
      Math.max(0, Math.min(1, Number(state.settings[levelsKey(channel, point)] ?? LEVEL_DEFAULTS[index]))),
    );
    previous = value;
    return value;
  });
}

function levelCoordinates(index, value) {
  const {width, height, padding} = LEVEL_VIEW;
  return {
    x: padding + index * (width - padding * 2) / 4,
    y: padding + (1 - value) * (height - padding * 2),
  };
}

function renderLevelsControl() {
  const channel = state.levelsChannel;
  const values = levelsValues(channel);
  $("#levelsChannel").value = channel;
  $("#levelsControl").dataset.channel = channel;
  const channelLabel = channel === "rgb" ? "RGB" : channel[0].toUpperCase() + channel.slice(1);
  $("#levelsEditor").setAttribute("aria-label", `${channelLabel} five-point levels curve`);
  const bypassed = state.bypassed.has(`levels_${channel}`);
  $("#levelsControl").classList.toggle("bypassed", bypassed);
  $("#levelsBypass").setAttribute("aria-pressed", String(!bypassed));
  $("#levelsBypass").title = bypassed
    ? `Enable ${channelLabel} levels`
    : `Temporarily disable ${channelLabel} levels`;

  const samples = Array.from({length: 97}, (_, index) => {
    const input = index / 96;
    const {x, y} = levelCoordinates(input * 4, monotoneCurve(input, values));
    return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  $("#levelsCurve").setAttribute("d", samples.join(" "));
  $("#levelsMarkers").innerHTML = values.map((value, index) => {
    const {x, y} = levelCoordinates(index, value);
    const point = LEVEL_POINTS[index];
    const label = point[0].toUpperCase() + point.slice(1);
    return `<circle class="levels-marker" data-level-index="${index}" cx="${x}" cy="${y}" r="6" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value * 100)}"></circle>`;
  }).join("");
}

function drawLevelsHistogram() {
  const canvas = $("#levelsHistogram");
  const context = canvas.getContext("2d");
  const {width, height, padding} = LEVEL_VIEW;
  context.clearRect(0, 0, width, height);
  if (!state.cpuSource) return;

  const bins = new Uint32Array(64);
  const data = state.cpuSource.data;
  const pixelCount = data.length / 4;
  const stride = Math.max(1, Math.floor(pixelCount / 65_536));
  const channelIndex = {red: 0, green: 1, blue: 2}[state.levelsChannel];
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    const value = channelIndex === undefined
      ? data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722
      : data[offset + channelIndex];
    bins[Math.min(63, Math.floor(value / 4))] += 1;
  }
  const peak = Math.max(...bins, 1);
  const color = {
    rgb: "rgba(108,224,196,.48)",
    red: "rgba(255,143,131,.48)",
    green: "rgba(121,229,155,.48)",
    blue: "rgba(118,183,255,.48)",
  }[state.levelsChannel];
  context.beginPath();
  context.moveTo(padding, height - padding);
  bins.forEach((count, index) => {
    const x = padding + index / (bins.length - 1) * (width - padding * 2);
    const y = height - padding - Math.sqrt(count / peak) * (height - padding * 2);
    context.lineTo(x, y);
  });
  context.lineTo(width - padding, height - padding);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function setLevelValue(index, value, record = false) {
  const channel = state.levelsChannel;
  const values = levelsValues(channel);
  const minimum = index === 0 ? 0 : values[index - 1];
  const maximum = index === 4 ? 1 : values[index + 1];
  const next = Math.max(minimum, Math.min(maximum, value));
  const previous = record ? snapshot() : null;
  state.settings[levelsKey(channel, LEVEL_POINTS[index])] = Number(next.toFixed(4));
  state.bypassed.delete(`levels_${channel}`);
  if (previous) pushHistory(previous);
  renderLevelsControl();
  clearPresetSelection();
  schedulePreview();
}

function resetLevelsChannel() {
  const previous = snapshot();
  LEVEL_POINTS.forEach((point, index) => {
    state.settings[levelsKey(state.levelsChannel, point)] = LEVEL_DEFAULTS[index];
  });
  state.bypassed.delete(`levels_${state.levelsChannel}`);
  pushHistory(previous);
  renderLevelsControl();
  clearPresetSelection();
  schedulePreview();
}

function toggleLevelsBypass() {
  const previous = snapshot();
  const name = `levels_${state.levelsChannel}`;
  if (state.bypassed.has(name)) state.bypassed.delete(name);
  else state.bypassed.add(name);
  pushHistory(previous);
  renderLevelsControl();
  clearPresetSelection();
  schedulePreview();
}

function previewSize(width, height, maxSide = 1400) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function createPreviewBitmap(file) {
  const source = await createImageBitmap(file);
  const size = previewSize(source.width, source.height);
  if (size.width === source.width && size.height === source.height) return source;
  source.close();
  return createImageBitmap(file, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: "high",
  });
}

function setCpuSource(bitmap) {
  const canvas = $("#previewCanvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", {willReadFrequently: true, colorSpace: "srgb"});
  if (!context) throw new Error("Canvas preview is unavailable");
  context.drawImage(bitmap, 0, 0);
  state.cpuSource = context.getImageData(0, 0, canvas.width, canvas.height);
  state.analysis = analyzeImageData(state.cpuSource);
}

function renderCpuPreview() {
  const canvas = $("#previewCanvas");
  const context = canvas.getContext("2d", {willReadFrequently: true, colorSpace: "srgb"});
  const copy = new ImageData(
    new Uint8ClampedArray(state.cpuSource.data),
    state.cpuSource.width,
    state.cpuSource.height,
  );
  processImageData(copy, effectiveSettings(), null, state.analysis);
  context.putImageData(copy, 0, 0);
}

function schedulePreview() {
  if (!state.file || state.renderQueued) return;
  state.renderQueued = true;
  $("#workingOverlay").hidden = false;
  requestAnimationFrame(() => {
    const started = performance.now();
    try {
      renderCpuPreview();
      $("#processingTime").textContent = `Local canvas · ${Math.max(1, Math.round(performance.now() - started))} ms`;
    } catch (error) {
      toast(`Preview failed: ${error.message}`, true);
    } finally {
      state.renderQueued = false;
      $("#workingOverlay").hidden = true;
    }
  });
}

function renderAnalysis() {
  const analysis = state.analysis;
  $("#analysisLabel").textContent = analysis.label;
  $("#analysisText").textContent = `Red loss ${Math.round(analysis.redLoss * 100)}% · haze ${Math.round(analysis.haze * 100)}%`;
  $("#confidenceBadge").textContent = `${Math.round(analysis.confidence * 100)}%`;
}

function renderSourceInfo() {
  const image = $("#originalImage");
  const display = [
    matchMedia("(color-gamut: p3)").matches ? "P3-capable display" : "sRGB-class display",
    matchMedia("(dynamic-range: high)").matches ? "HDR-capable panel" : "SDR panel",
  ].join(" · ");
  $("#sourceSummary").textContent = `${state.file.type.replace("image/", "").toUpperCase()} · ${image.naturalWidth} × ${image.naturalHeight}`;
  $("#sourceDetails").innerHTML = `
    <p>${display}. This alpha decodes to an SDR sRGB canvas and does not claim to preserve embedded ICC, EXIF, gain maps, or HDR metadata yet.</p>
  `;
}

async function openFile(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    toast("This alpha currently accepts JPEG and PNG files.", true);
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    toast("Choose an image smaller than 100 MB for this alpha.", true);
    return;
  }

  $("#workingOverlay").hidden = false;
  try {
    state.previewBitmap?.close();
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.file = file;
    state.objectUrl = URL.createObjectURL(file);
    $("#originalImage").src = state.objectUrl;
    await $("#originalImage").decode();
    state.previewBitmap = await createPreviewBitmap(file);
    setCpuSource(state.previewBitmap);
    state.settings = {...PRESETS.natural};
    state.bypassed.clear();
    state.history = [];
    state.future = [];
    state.zoomScale = 1;
    state.panX = 0;
    state.panY = 0;

    $("#emptyState").hidden = true;
    $("#editorStage").hidden = false;
    $("#canvasToolbar").hidden = false;
    $("#app").classList.add("has-photo");
    $("#documentName").textContent = file.name;
    $("#documentMeta").textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · local only`;
    $("#imageDimensions").textContent = `${$("#originalImage").naturalWidth} × ${$("#originalImage").naturalHeight} · preview ${state.previewBitmap.width} × ${state.previewBitmap.height}`;
    setControlsEnabled(true);
    renderAnalysis();
    renderSourceInfo();
    drawLevelsHistogram();
    syncControls();
    selectMatchingPreset();
    updateHistoryButtons();
    setSwipeEnabled(false);
    renderViewport();
    schedulePreview();
    requestAnimationFrame(syncComparisonGeometry);
  } catch (error) {
    toast(`Could not open this photo: ${error.message}`, true);
  } finally {
    $("#workingOverlay").hidden = true;
    $("#fileInput").value = "";
  }
}

function syncComparisonGeometry() {
  if (!state.file) return;
  const canvas = $("#previewCanvas");
  const original = $("#originalImage");
  const width = original.clientWidth;
  const height = original.clientHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  $("#correctedLayer").style.setProperty("--image-width", `${width}px`);
}

function setCompare(value) {
  if (!state.swipeEnabled) return;
  state.compare = Math.max(0, Math.min(100, Number(value)));
  $("#correctedLayer").style.width = `${state.compare}%`;
  $("#compareLine").style.left = `${state.compare}%`;
  $("#compareLine").setAttribute("aria-valuenow", String(Math.round(state.compare)));
  $("#compareLine").hidden = state.compare === 0 || state.compare === 100;
}

function setSwipeEnabled(enabled) {
  state.swipeEnabled = enabled;
  state.fullBefore = false;
  $("#swipeToggle").classList.toggle("active", enabled);
  $("#swipeToggle").setAttribute("aria-pressed", String(enabled));
  $("#beforeAfterButton").disabled = enabled || !state.file;
  $("#beforeAfterButton").classList.remove("active");
  $("#beforeAfterButton").setAttribute("aria-pressed", "false");
  $("#beforeAfterButton").textContent = "Before";
  $$(".before-label, .after-label").forEach(label => {
    label.hidden = !enabled;
  });
  if (enabled) {
    setCompare(state.compare);
  }
  else {
    $("#correctedLayer").style.width = "100%";
    $("#compareLine").hidden = true;
  }
}

function toggleFullBefore() {
  if (state.swipeEnabled || !state.file) return;
  state.fullBefore = !state.fullBefore;
  $("#correctedLayer").style.width = state.fullBefore ? "0%" : "100%";
  $("#beforeAfterButton").classList.toggle("active", state.fullBefore);
  $("#beforeAfterButton").setAttribute("aria-pressed", String(state.fullBefore));
  $("#beforeAfterButton").textContent = state.fullBefore ? "After" : "Before";
}

function applyPreset(name, record = true) {
  if (!PRESETS[name]) return;
  const previous = snapshot();
  state.settings = {...PRESETS[name]};
  state.bypassed.clear();
  if (record) pushHistory(previous);
  syncControls();
  $$(".presets button").forEach(button => button.classList.toggle("active", button.dataset.preset === name));
  schedulePreview();
}

function clearPresetSelection() {
  $$(".presets button").forEach(button => button.classList.remove("active"));
}

function selectMatchingPreset() {
  const match = state.bypassed.size ? null : Object.entries(PRESETS).find(([, settings]) => (
    Object.keys(DEFAULT_SETTINGS).every(name => Math.abs(settings[name] - state.settings[name]) < 0.0001)
  ));
  $$(".presets button").forEach(button => {
    button.classList.toggle("active", Boolean(match) && button.dataset.preset === match[0]);
  });
}

function resetSettings() {
  applyPreset("natural");
  setSwipeEnabled(false);
  toast("Adjustments reset to Natural");
}

function copyCurrentSettings() {
  if (!state.file) return;
  const id = crypto.randomUUID();
  const active = $(".presets button.active")?.textContent || "Custom";
  const settings = {...state.settings};
  ["sample_red", "sample_green", "sample_blue", "sample_strength"].forEach(name => {
    settings[name] = 0;
  });
  state.settingsClips.unshift({
    id,
    name: `${active} · ${new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`,
    settings,
    bypassed: [...state.bypassed].filter(name => !name.startsWith("sample_")),
  });
  state.settingsClips = state.settingsClips.slice(0, 4);
  renderSettingsShelf();
  toast("Settings copied temporarily");
}

function renderSettingsShelf() {
  $("#settingsShelf").hidden = !state.settingsClips.length;
  $("#settingsShelfItems").innerHTML = state.settingsClips.map(clip => `
    <div class="settings-clip apply-only">
      <span><strong>${clip.name.split(" · ")[0]}</strong><small>${clip.name}</small></span>
      <button type="button" data-clip="${clip.id}">Apply</button>
    </div>
  `).join("");
  $$("[data-clip]").forEach(button => button.addEventListener("click", () => {
    const clip = state.settingsClips.find(item => item.id === button.dataset.clip);
    if (!clip) return;
    pushHistory(snapshot());
    state.settings = normalizeSettings(clip.settings);
    state.bypassed = new Set(clip.bypassed);
    syncControls();
    selectMatchingPreset();
    schedulePreview();
  }));
}

function clearSample() {
  pushHistory(snapshot());
  state.settings.sample_red = 0;
  state.settings.sample_green = 0;
  state.settings.sample_blue = 0;
  state.settings.sample_strength = 0;
  $("#sampleStatus").hidden = true;
  $("#sampleMarker").hidden = true;
  setSampling(false);
  clearPresetSelection();
  schedulePreview();
}

function setSampling(enabled) {
  state.sampling = enabled && Boolean(state.file);
  if (state.sampling) setZoomTool(false);
  $("#eyedropperButton").classList.toggle("active", state.sampling);
  $("#eyedropperButton").setAttribute("aria-pressed", String(state.sampling));
  $("#eyedropperButton").innerHTML = state.sampling
    ? '<svg viewBox="0 0 24 24"><path d="m19 3 2 2-8.5 8.5-3-3L18 2a1.4 1.4 0 0 1 2 0Z"/><path d="m8.5 11.5-5 5v4h4l5-5"/><path d="M4 20h4"/></svg>Click a neutral spot'
    : '<svg viewBox="0 0 24 24"><path d="m19 3 2 2-8.5 8.5-3-3L18 2a1.4 1.4 0 0 1 2 0Z"/><path d="m8.5 11.5-5 5v4h4l5-5"/><path d="M4 20h4"/></svg>Sample neutral';
  $("#viewport").classList.toggle("sampling", state.sampling);
}

function sampleNeutralPoint(event) {
  if (!state.sampling || !state.cpuSource) return false;
  const canvas = $("#previewCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(state.cpuSource.width - 1, Math.round((event.clientX - rect.left) / rect.width * state.cpuSource.width)));
  const y = Math.max(0, Math.min(state.cpuSource.height - 1, Math.round((event.clientY - rect.top) / rect.height * state.cpuSource.height)));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let py = Math.max(0, y - 2); py <= Math.min(state.cpuSource.height - 1, y + 2); py += 1) {
    for (let px = Math.max(0, x - 2); px <= Math.min(state.cpuSource.width - 1, x + 2); px += 1) {
      const offset = (py * state.cpuSource.width + px) * 4;
      red += state.cpuSource.data[offset];
      green += state.cpuSource.data[offset + 1];
      blue += state.cpuSource.data[offset + 2];
      count += 1;
    }
  }
  pushHistory(snapshot());
  state.settings.sample_red = red / count / 255;
  state.settings.sample_green = green / count / 255;
  state.settings.sample_blue = blue / count / 255;
  state.settings.sample_strength = 1;
  $("#sampleSwatch").style.background = `rgb(${red / count} ${green / count} ${blue / count})`;
  $("#sampleStatus").hidden = false;
  const marker = $("#sampleMarker");
  marker.hidden = false;
  marker.style.left = `${(x / state.cpuSource.width) * 100}%`;
  marker.style.top = `${(y / state.cpuSource.height) * 100}%`;
  setSampling(false);
  clearPresetSelection();
  schedulePreview();
  return true;
}

function renderViewport() {
  $("#imageFrame").style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoomScale})`;
  $("#zoomPercent").textContent = `${Math.round(state.zoomScale * 100)}%`;
  $("#viewport").classList.toggle("can-pan", state.zoomScale > 1 && !state.zoomTool && !state.sampling);
  $("#viewport").classList.toggle("zoom-tool", state.zoomTool && !state.sampling);
  $$("[data-zoom]").forEach(button => button.classList.toggle("active", button.dataset.zoom === state.zoomMode));
  requestAnimationFrame(syncComparisonGeometry);
}

function setZoomScale(scale, mode = "manual", event = null) {
  const previous = state.zoomScale;
  const next = Math.max(0.1, Math.min(16, scale));
  if (event) {
    const viewport = $("#viewport").getBoundingClientRect();
    const dx = event.clientX - (viewport.left + viewport.width / 2);
    const dy = event.clientY - (viewport.top + viewport.height / 2);
    const ratio = next / previous;
    state.panX = (state.panX - dx) * ratio + dx;
    state.panY = (state.panY - dy) * ratio + dy;
  }
  state.zoomScale = next;
  state.zoomMode = mode;
  if (next <= 1) {
    state.panX = 0;
    state.panY = 0;
  }
  renderViewport();
}

function setZoomMode(mode) {
  if (!state.file) return;
  setZoomTool(false);
  if (mode === "fit") {
    state.panX = 0;
    state.panY = 0;
    setZoomScale(1, mode);
    return;
  }
  if (mode === "fill") {
    setZoomScale(1.35, mode);
    return;
  }
  setZoomScale(Number(mode), mode);
}

function setZoomTool(enabled) {
  state.zoomTool = enabled && Boolean(state.file);
  if (state.zoomTool) setSampling(false);
  $("#zoomToolButton").classList.toggle("active", state.zoomTool);
  $("#zoomToolButton").setAttribute("aria-pressed", String(state.zoomTool));
  renderViewport();
}

async function exportImage(outputType, quality = 0.95) {
  if (!state.file || typeof OffscreenCanvas === "undefined") {
    toast("Full-resolution export is unavailable in this browser.", true);
    return;
  }
  $("#workingOverlay").hidden = false;
  const button = $("#downloadButton");
  button.classList.add("loading");
  button.disabled = true;
  const worker = new Worker(new URL("./export-worker.js", import.meta.url), {type: "module"});

  function cleanup() {
    worker.terminate();
    $("#workingOverlay").hidden = true;
    button.classList.remove("loading");
    button.disabled = false;
  }

  worker.addEventListener("message", event => {
    if (event.data.kind === "progress") {
      $("#processingTime").textContent = `Local export · ${Math.round(event.data.progress * 100)}%`;
    } else if (event.data.kind === "complete") {
      const extension = outputType === "image/png" ? "png" : "jpg";
      const stem = state.file.name.replace(/\.[^.]+$/, "");
      const url = URL.createObjectURL(event.data.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${stem}_reeftone_web.${extension}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Export created on this device");
      $("#exportDialog").close();
      cleanup();
    } else if (event.data.kind === "error") {
      toast(event.data.message, true);
      cleanup();
    }
  });
  worker.addEventListener("error", event => {
    toast(event.message || "Export failed", true);
    cleanup();
  });
  const buffer = await state.file.arrayBuffer();
  worker.postMessage({
    buffer,
    type: state.file.type,
    settings: effectiveSettings(),
    outputType,
    quality: outputType === "image/jpeg" ? quality : undefined,
  }, [buffer]);
}

function bindEvents() {
  $("#chooseButton").addEventListener("click", () => $("#fileInput").click());
  $("#newPhotoButton").addEventListener("click", () => $("#fileInput").click());
  $("#homeButton").addEventListener("click", () => {
    if (!state.file) return;
    $("#fileInput").click();
  });
  $("#fileInput").addEventListener("change", event => openFile(event.target.files[0]));
  $("#resetButton").addEventListener("click", resetSettings);
  $("#copySettingsButton").addEventListener("click", copyCurrentSettings);
  $("#undoButton").addEventListener("click", undo);
  $("#redoButton").addEventListener("click", redo);
  $("#colorCardToggle").addEventListener("click", event => {
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    $("#colorCardContent").hidden = expanded;
  });
  $("#swipeToggle").addEventListener("click", () => setSwipeEnabled(!state.swipeEnabled));
  $("#beforeAfterButton").addEventListener("click", toggleFullBefore);
  $("#exportButton").addEventListener("click", () => $("#exportDialog").showModal());
  $$(".close-dialog, .cancel-dialog").forEach(button => {
    button.addEventListener("click", () => $("#exportDialog").close());
  });
  $("#qualityInput").addEventListener("input", event => {
    $("#qualityOutput").value = `${event.target.value}%`;
  });
  $$('input[name="format"]').forEach(input => {
    input.addEventListener("change", event => {
      $("#qualityRow").hidden = event.target.value !== "jpeg";
    });
  });
  $("#exportForm").addEventListener("submit", event => {
    event.preventDefault();
    const format = new FormData(event.currentTarget).get("format");
    if (!["jpeg", "png"].includes(format)) {
      toast("That export format is coming later.", true);
      return;
    }
    exportImage(`image/${format}`, Number($("#qualityInput").value) / 100);
  });
  $("#eyedropperButton").addEventListener("click", () => setSampling(!state.sampling));
  $("#clearSampleButton").addEventListener("click", clearSample);
  $("#zoomToolButton").addEventListener("click", () => setZoomTool(!state.zoomTool));
  $$("[data-zoom]").forEach(button => button.addEventListener("click", () => setZoomMode(button.dataset.zoom)));
  $$(".presets button").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  $$(".section-toggle").forEach(button => button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    button.nextElementSibling.hidden = expanded;
  }));

  $$("[data-setting]").forEach(input => {
    input.addEventListener("input", () => {
      const name = input.dataset.setting;
      state.settings[name] = Number(input.value);
      state.bypassed.delete(name);
      if (name.startsWith("sharpen_")) {
        state.bypassed.delete("sharpening");
        syncSharpeningControl();
      }
      $(`[data-output="${name}"]`).value = displayValue(name, state.settings[name]);
      updateRangeStyle(input);
      input.closest(".slider-control")?.classList.remove("bypassed");
      clearPresetSelection();
      schedulePreview();
    });
    input.addEventListener("change", event => {
      const previousValue = Number(event.target.dataset.previousValue ?? state.settings[event.target.dataset.setting]);
      const current = Number(event.target.value);
      if (previousValue !== current) {
        const previous = snapshot();
        previous.settings[event.target.dataset.setting] = previousValue;
        pushHistory(previous);
      }
      event.target.dataset.previousValue = String(current);
    });
    input.addEventListener("pointerdown", event => {
      event.currentTarget.dataset.previousValue = String(state.settings[event.currentTarget.dataset.setting]);
    });
    input.addEventListener("focus", event => {
      event.currentTarget.dataset.previousValue ??= String(
        state.settings[event.currentTarget.dataset.setting],
      );
    });
  });

  $("#autoToggle").addEventListener("change", event => {
    pushHistory(snapshot());
    state.settings.auto_restore = event.target.checked ? PRESETS.natural.auto_restore : 0;
    state.bypassed.delete("auto_restore");
    clearPresetSelection();
    syncControls();
    schedulePreview();
  });

  $("#levelsChannel").addEventListener("change", event => {
    state.levelsChannel = event.target.value;
    renderLevelsControl();
    drawLevelsHistogram();
  });
  $("#levelsReset").addEventListener("click", resetLevelsChannel);
  $("#levelsBypass").addEventListener("click", toggleLevelsBypass);
  $("#sharpenReset").addEventListener("click", resetSharpening);
  $("#sharpenBypass").addEventListener("click", toggleSharpeningBypass);

  let levelsDrag = null;
  $("#levelsEditor").addEventListener("pointerdown", event => {
    const marker = event.target.closest(".levels-marker");
    if (!marker || !state.file) return;
    levelsDrag = {
      pointerId: event.pointerId,
      index: Number(marker.dataset.levelIndex),
      previous: snapshot(),
    };
    $("#levelsEditor").setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  $("#levelsEditor").addEventListener("pointermove", event => {
    if (!levelsDrag || levelsDrag.pointerId !== event.pointerId) return;
    const rect = $("#levelsEditor").getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height * LEVEL_VIEW.height;
    const value = 1 - (y - LEVEL_VIEW.padding) / (LEVEL_VIEW.height - LEVEL_VIEW.padding * 2);
    setLevelValue(levelsDrag.index, value);
  });
  const finishLevelsDrag = event => {
    if (!levelsDrag || levelsDrag.pointerId !== event.pointerId) return;
    const previous = levelsDrag.previous;
    levelsDrag = null;
    pushHistory(previous);
    schedulePreview();
  };
  $("#levelsEditor").addEventListener("pointerup", finishLevelsDrag);
  $("#levelsEditor").addEventListener("pointercancel", finishLevelsDrag);
  $("#levelsEditor").addEventListener("keydown", event => {
    const marker = event.target.closest(".levels-marker");
    const supported = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"];
    if (!marker || !supported.includes(event.key) || !state.file) return;
    event.preventDefault();
    const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1;
    const index = Number(marker.dataset.levelIndex);
    setLevelValue(index, levelsValues()[index] + direction * (event.shiftKey ? 0.05 : 0.01), true);
  });

  let comparePointer = null;
  const updateCompareFromPointer = event => {
    const rect = $("#imageFrame").getBoundingClientRect();
    setCompare((event.clientX - rect.left) / rect.width * 100);
  };
  $("#compareLine").addEventListener("pointerdown", event => {
    if (!state.swipeEnabled) return;
    comparePointer = event.pointerId;
    $("#compareLine").setPointerCapture(event.pointerId);
    updateCompareFromPointer(event);
    event.preventDefault();
  });
  $("#compareLine").addEventListener("pointermove", event => {
    if (comparePointer !== event.pointerId) return;
    updateCompareFromPointer(event);
  });
  const finishCompare = event => {
    if (comparePointer === event.pointerId) comparePointer = null;
  };
  $("#compareLine").addEventListener("pointerup", finishCompare);
  $("#compareLine").addEventListener("pointercancel", finishCompare);
  $("#compareLine").addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    setCompare(state.compare + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1));
  });

  const viewport = $("#viewport");
  viewport.addEventListener("click", event => {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    if (sampleNeutralPoint(event)) return;
    if (state.zoomTool) setZoomScale(state.zoomScale + 0.25, "manual", event);
  });
  viewport.addEventListener("contextmenu", event => {
    if (!state.zoomTool) return;
    event.preventDefault();
    setZoomScale(state.zoomScale - 0.25, "manual", event);
  });
  viewport.addEventListener("pointerdown", event => {
    if (state.zoomScale <= 1 || state.zoomTool || state.sampling) return;
    state.panning = true;
    state.panStart = {x: event.clientX - state.panX, y: event.clientY - state.panY};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", event => {
    if (!state.panning) return;
    state.panX = event.clientX - state.panStart.x;
    state.panY = event.clientY - state.panStart.y;
    state.suppressClick = true;
    renderViewport();
  });
  viewport.addEventListener("pointerup", () => { state.panning = false; });
  viewport.addEventListener("pointercancel", () => { state.panning = false; });

  ["dragenter", "dragover"].forEach(type => window.addEventListener(type, event => {
    event.preventDefault();
    $("#dropOverlay").classList.add("visible");
  }));
  window.addEventListener("dragleave", event => {
    if (!event.relatedTarget) $("#dropOverlay").classList.remove("visible");
  });
  window.addEventListener("drop", event => {
    event.preventDefault();
    $("#dropOverlay").classList.remove("visible");
    openFile(event.dataTransfer.files[0]);
  });
  window.addEventListener("resize", syncComparisonGeometry);
  window.addEventListener("keydown", event => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if (event.key === "\\" && state.file && !state.comparisonHeld) {
      state.comparisonHeld = true;
      $("#correctedLayer").style.width = "0%";
      $("#compareLine").hidden = true;
      $$(".before-label, .after-label").forEach(label => {
        label.hidden = true;
      });
    }
  });
  window.addEventListener("keyup", event => {
    if (event.key === "\\" && state.file && state.comparisonHeld) {
      state.comparisonHeld = false;
      if (state.swipeEnabled) {
        setCompare(state.compare);
        $$(".before-label, .after-label").forEach(label => {
          label.hidden = false;
        });
      } else {
        $("#correctedLayer").style.width = state.fullBefore ? "0%" : "100%";
      }
    }
  });
}

function start() {
  capabilityRows();
  bindEvents();
  addPerControlActions();
  syncControls();
  setControlsEnabled(false);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  console.info(`ReefTone Web ${VERSION} · reliable Canvas renderer`);
}

start();
