import "./style.css";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  analyzeImageData,
  processImageData,
} from "./color-math.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const VERSION = "0.5.0-alpha.2";

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
  swipeEnabled: true,
  fullBefore: false,
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
  if (["master", "autoRestore", "redRecovery", "dehaze", "denoise"].includes(name)) {
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
  state.settings = {...saved.settings};
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
    if (name in settings) settings[name] = 0;
  });
  return settings;
}

function syncControls() {
  $$("[data-setting]").forEach(input => {
    const name = input.dataset.setting;
    input.value = state.settings[name];
    $(`[data-output="${name}"]`).value = displayValue(name, Number(input.value));
    const control = input.closest(".slider-control");
    const bypassed = state.bypassed.has(name);
    control?.classList.toggle("bypassed", bypassed);
    const button = control?.querySelector(".bypass-control");
    button?.setAttribute("aria-pressed", String(!bypassed));
  });
  $("#autoToggle").checked = state.settings.autoRestore > 0 && !state.bypassed.has("autoRestore");
}

function addPerControlActions() {
  $$("[data-setting]").forEach(input => {
    const label = input.closest(".slider-control");
    const name = input.dataset.setting;
    const readable = label.querySelector(":scope > span").textContent;
    const actions = document.createElement("span");
    actions.className = "control-actions";
    actions.innerHTML = `
      <button class="mini-control reset-control" type="button" title="Reset ${readable} to zero" aria-label="Reset ${readable} to zero">↺</button>
      <button class="mini-control bypass-control" type="button" title="Temporarily bypass ${readable}" aria-label="Toggle ${readable}" aria-pressed="true">◉</button>
    `;
    label.append(actions);
    actions.querySelector(".reset-control").addEventListener("click", event => {
      event.preventDefault();
      const previous = snapshot();
      state.settings[name] = 0;
      state.bypassed.delete(name);
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

function setControlsEnabled(enabled) {
  $$("[data-setting], #resetButton, #copySettingsButton, #exportJpeg, #exportJpegSide, #exportPng").forEach(control => {
    control.disabled = !enabled;
  });
}

function capabilityRows() {
  const checks = [
    ["Reliable Canvas", true],
    ["WebGPU detected", Boolean(navigator.gpu)],
    ["Display P3 panel", matchMedia("(color-gamut: p3)").matches],
    ["HDR display", matchMedia("(dynamic-range: high)").matches],
    ["Local worker export", typeof OffscreenCanvas !== "undefined"],
  ];
  $("#capabilitySummary").textContent = `${checks.filter(([, supported]) => supported).length}/${checks.length} available`;
  $("#capabilityGrid").innerHTML = checks.map(([label, supported]) => `
    <span class="${supported ? "supported" : "missing"}"><i></i>${label}<small>${supported ? "Ready" : "Later"}</small></span>
  `).join("");
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
  requestAnimationFrame(() => {
    const started = performance.now();
    try {
      renderCpuPreview();
      $("#processingTime").textContent = `Local canvas · ${Math.max(1, Math.round(performance.now() - started))} ms`;
    } catch (error) {
      toast(`Preview failed: ${error.message}`, true);
    } finally {
      state.renderQueued = false;
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
    <strong>Browser working preview</strong>
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
    $("#documentName").textContent = file.name;
    $("#documentMeta").textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · local only`;
    $("#imageDimensions").textContent = `${$("#originalImage").naturalWidth} × ${$("#originalImage").naturalHeight} · preview ${state.previewBitmap.width} × ${state.previewBitmap.height}`;
    setControlsEnabled(true);
    renderAnalysis();
    renderSourceInfo();
    syncControls();
    selectMatchingPreset();
    updateHistoryButtons();
    setSwipeEnabled(true);
    setCompare(50);
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
  const bounds = canvas.getBoundingClientRect();
  original.style.width = `${bounds.width / state.zoomScale}px`;
  original.style.height = `${bounds.height / state.zoomScale}px`;
}

function setCompare(value) {
  if (!state.swipeEnabled) return;
  state.compare = Math.max(0, Math.min(100, Number(value)));
  $("#compareInput").value = state.compare;
  $("#originalLayer").style.width = `${state.compare}%`;
  $("#compareLine").style.left = `${state.compare}%`;
  $("#compareLine").hidden = state.compare === 0 || state.compare === 100;
}

function setSwipeEnabled(enabled) {
  state.swipeEnabled = enabled;
  state.fullBefore = false;
  $("#swipeToggle").classList.toggle("active", enabled);
  $("#swipeToggle").setAttribute("aria-pressed", String(enabled));
  $("#beforeAfterButton").disabled = enabled || !state.file;
  $("#beforeAfterButton").classList.remove("active");
  $("#beforeAfterButton").textContent = "Before";
  $("#compareControl").hidden = !enabled;
  if (enabled) setCompare(state.compare);
  else {
    $("#originalLayer").style.width = "0%";
    $("#compareLine").hidden = true;
  }
}

function toggleFullBefore() {
  if (state.swipeEnabled || !state.file) return;
  state.fullBefore = !state.fullBefore;
  $("#originalLayer").style.width = state.fullBefore ? "100%" : "0%";
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
  toast("Adjustments reset to Natural");
}

function copyCurrentSettings() {
  if (!state.file) return;
  const id = crypto.randomUUID();
  const active = $(".presets button.active")?.textContent || "Custom";
  state.settingsClips.unshift({
    id,
    name: `${active} · ${new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`,
    settings: {...state.settings},
    bypassed: [...state.bypassed],
  });
  state.settingsClips = state.settingsClips.slice(0, 4);
  renderSettingsShelf();
  toast("Settings copied temporarily");
}

function renderSettingsShelf() {
  $("#settingsShelf").hidden = !state.settingsClips.length;
  $("#settingsShelfItems").innerHTML = state.settingsClips.map(clip => `
    <button type="button" data-clip="${clip.id}">
      <span>${clip.name}</span><small>Apply</small>
    </button>
  `).join("");
  $$("[data-clip]").forEach(button => button.addEventListener("click", () => {
    const clip = state.settingsClips.find(item => item.id === button.dataset.clip);
    if (!clip) return;
    pushHistory(snapshot());
    state.settings = {...clip.settings};
    state.bypassed = new Set(clip.bypassed);
    syncControls();
    selectMatchingPreset();
    schedulePreview();
  }));
}

function clearSample() {
  pushHistory(snapshot());
  state.settings.sampleRed = 0;
  state.settings.sampleGreen = 0;
  state.settings.sampleBlue = 0;
  state.settings.sampleStrength = 0;
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
  $("#eyedropperButton").textContent = state.sampling ? "Click a neutral spot" : "⌁ Sample neutral";
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
  state.settings.sampleRed = red / count / 255;
  state.settings.sampleGreen = green / count / 255;
  state.settings.sampleBlue = blue / count / 255;
  state.settings.sampleStrength = 1;
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
  const next = Math.max(0.25, Math.min(4, scale));
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

async function exportImage(outputType) {
  if (!state.file || typeof OffscreenCanvas === "undefined") {
    toast("Full-resolution export is unavailable in this browser.", true);
    return;
  }
  $("#workingOverlay").hidden = false;
  const buttons = ["#exportJpeg", "#exportJpegSide", "#exportPng"].map(selector => $(selector));
  buttons.forEach(button => { button.disabled = true; });
  const worker = new Worker(new URL("./export-worker.js", import.meta.url), {type: "module"});

  function cleanup() {
    worker.terminate();
    $("#workingOverlay").hidden = true;
    buttons.forEach(button => { button.disabled = false; });
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
    quality: outputType === "image/jpeg" ? 0.95 : undefined,
  }, [buffer]);
}

function bindEvents() {
  $("#chooseButton").addEventListener("click", () => $("#fileInput").click());
  $("#openButton").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", event => openFile(event.target.files[0]));
  $("#resetButton").addEventListener("click", resetSettings);
  $("#copySettingsButton").addEventListener("click", copyCurrentSettings);
  $("#undoButton").addEventListener("click", undo);
  $("#redoButton").addEventListener("click", redo);
  $("#compareInput").addEventListener("input", event => setCompare(event.target.value));
  $("#swipeToggle").addEventListener("click", () => setSwipeEnabled(!state.swipeEnabled));
  $("#beforeAfterButton").addEventListener("click", toggleFullBefore);
  $("#exportJpeg").addEventListener("click", () => exportImage("image/jpeg"));
  $("#exportJpegSide").addEventListener("click", () => exportImage("image/jpeg"));
  $("#exportPng").addEventListener("click", () => exportImage("image/png"));
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
      $(`[data-output="${name}"]`).value = displayValue(name, state.settings[name]);
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
  });

  $("#autoToggle").addEventListener("change", event => {
    pushHistory(snapshot());
    state.settings.autoRestore = event.target.checked ? PRESETS.natural.autoRestore : 0;
    state.bypassed.delete("autoRestore");
    clearPresetSelection();
    syncControls();
    schedulePreview();
  });

  const viewport = $("#viewport");
  viewport.addEventListener("click", event => {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    if (sampleNeutralPoint(event)) return;
    if (state.zoomTool) setZoomScale(state.zoomScale + 0.1, "manual", event);
  });
  viewport.addEventListener("contextmenu", event => {
    if (!state.zoomTool) return;
    event.preventDefault();
    setZoomScale(state.zoomScale - 0.1, "manual", event);
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
    if (event.key === "\\" && state.file && !state.swipeEnabled) {
      $("#originalLayer").style.width = "100%";
    }
  });
  window.addEventListener("keyup", event => {
    if (event.key === "\\" && state.file && !state.swipeEnabled) {
      $("#originalLayer").style.width = state.fullBefore ? "100%" : "0%";
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
