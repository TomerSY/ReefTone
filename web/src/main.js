import "./style.css";
import {DEFAULT_SETTINGS, processImageData} from "./color-math.js";
import {WebGpuRenderer} from "./gpu-renderer.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const VERSION = "0.5.0-alpha.1";

const state = {
  file: null,
  objectUrl: null,
  previewBitmap: null,
  renderer: null,
  rendererKind: "Preparing",
  settings: {...DEFAULT_SETTINGS},
  cpuSource: null,
  renderQueued: false,
};

function toast(message, isError = false) {
  const item = document.createElement("div");
  item.className = `toast${isError ? " error" : ""}`;
  item.textContent = message;
  $("#toastRegion").append(item);
  setTimeout(() => item.remove(), 4200);
}

function displayValue(name, value) {
  if (name === "exposure") return value === 0 ? "0.00" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  if (name === "redRecovery") return String(Math.round(value * 100));
  return value === 0 ? "0" : `${value > 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))}`;
}

function syncControls() {
  $$("[data-setting]").forEach(input => {
    input.value = state.settings[input.dataset.setting];
    $(`[data-output="${input.dataset.setting}"]`).value = displayValue(
      input.dataset.setting,
      Number(input.value),
    );
  });
}

function setControlsEnabled(enabled) {
  $$("[data-setting], #resetButton, #exportJpeg, #exportPng").forEach(control => {
    control.disabled = !enabled;
  });
}

function capabilityRows() {
  const checks = [
    ["WebGPU", Boolean(navigator.gpu)],
    ["Display P3", matchMedia("(color-gamut: p3)").matches],
    ["HDR display", matchMedia("(dynamic-range: high)").matches],
    ["Offscreen export", typeof OffscreenCanvas !== "undefined"],
    ["WebAssembly", typeof WebAssembly !== "undefined"],
  ];
  $("#capabilitySummary").textContent = `${checks.filter(([, supported]) => supported).length}/${checks.length} available`;
  $("#capabilityGrid").innerHTML = checks.map(([label, supported]) => `
    <span class="${supported ? "supported" : "missing"}"><i></i>${label}<small>${supported ? "Ready" : "Fallback"}</small></span>
  `).join("");
}

async function prepareRenderer() {
  try {
    state.renderer = await WebGpuRenderer.create($("#previewCanvas"));
    state.rendererKind = state.renderer.describe().name;
    $("#engineDot").className = "ready";
    $("#engineLabel").textContent = state.renderer.describe().detail;
  } catch (_) {
    state.renderer = null;
    state.rendererKind = "CPU fallback";
    $("#engineDot").className = "fallback";
    $("#engineLabel").textContent = "CPU preview fallback";
  }
}

function previewSize(width, height, maxSide = 1800) {
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
  const context = canvas.getContext("2d", {willReadFrequently: true});
  context.drawImage(bitmap, 0, 0);
  state.cpuSource = context.getImageData(0, 0, canvas.width, canvas.height);
}

function replacePreviewCanvas() {
  const current = $("#previewCanvas");
  const replacement = current.cloneNode(false);
  current.replaceWith(replacement);
  return replacement;
}

function syncComparisonGeometry() {
  if (!state.file) return;
  const canvas = $("#previewCanvas");
  const original = $("#originalImage");
  const bounds = canvas.getBoundingClientRect();
  original.style.width = `${bounds.width}px`;
  original.style.height = `${bounds.height}px`;
}

function renderCpuPreview() {
  const canvas = $("#previewCanvas");
  const context = canvas.getContext("2d", {willReadFrequently: true});
  const copy = new ImageData(
    new Uint8ClampedArray(state.cpuSource.data),
    state.cpuSource.width,
    state.cpuSource.height,
  );
  processImageData(copy, state.settings);
  context.putImageData(copy, 0, 0);
}

function renderPreview() {
  if (!state.file || state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    const started = performance.now();
    if (state.renderer) state.renderer.render(state.settings);
    else if (state.cpuSource) renderCpuPreview();
    $("#processingTime").textContent = `${state.rendererKind} · ${Math.max(1, Math.round(performance.now() - started))} ms update`;
    state.renderQueued = false;
  });
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

    if (state.renderer) {
      try {
        await state.renderer.setImage(state.previewBitmap);
      } catch (error) {
        console.warn("WebGPU image setup failed; using CPU preview.", error);
        state.renderer = null;
        state.rendererKind = "CPU fallback";
        replacePreviewCanvas();
        setCpuSource(state.previewBitmap);
        $("#engineDot").className = "fallback";
        $("#engineLabel").textContent = "CPU preview fallback";
      }
    } else {
      setCpuSource(state.previewBitmap);
    }

    $("#emptyState").hidden = true;
    $("#editorStage").hidden = false;
    $("#documentName").textContent = file.name;
    $("#documentMeta").textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · local only`;
    $("#imageDimensions").textContent = `${$("#originalImage").naturalWidth} × ${$("#originalImage").naturalHeight} · preview ${state.previewBitmap.width} × ${state.previewBitmap.height}`;
    setControlsEnabled(true);
    updateComparison(0);
    renderPreview();
    requestAnimationFrame(syncComparisonGeometry);
  } catch (error) {
    toast(`Could not open this photo: ${error.message}`, true);
  } finally {
    $("#workingOverlay").hidden = true;
    $("#fileInput").value = "";
  }
}

function updateComparison(value) {
  const percent = Math.max(0, Math.min(100, Number(value)));
  $("#originalLayer").style.width = `${percent}%`;
  $("#compareLine").hidden = percent === 0 || percent === 100;
  $("#compareLine").style.left = `${percent}%`;
}

function resetSettings() {
  state.settings = {...DEFAULT_SETTINGS};
  syncControls();
  renderPreview();
  toast("Preview settings reset");
}

async function exportImage(outputType) {
  if (!state.file || typeof OffscreenCanvas === "undefined") {
    toast("Full-resolution export is unavailable in this browser.", true);
    return;
  }
  $("#workingOverlay").hidden = false;
  const buttons = ["#exportJpeg", "#exportPng"].map(selector => $(selector));
  buttons.forEach(button => { button.disabled = true; });

  const worker = new Worker(new URL("./export-worker.js", import.meta.url), {type: "module"});
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

  function cleanup() {
    worker.terminate();
    $("#workingOverlay").hidden = true;
    buttons.forEach(button => { button.disabled = false; });
    renderPreview();
  }

  const buffer = await state.file.arrayBuffer();
  worker.postMessage({
    buffer,
    type: state.file.type,
    settings: state.settings,
    outputType,
    quality: outputType === "image/jpeg" ? 0.94 : undefined,
  }, [buffer]);
}

function bindEvents() {
  $("#chooseButton").addEventListener("click", () => $("#fileInput").click());
  $("#openButton").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", event => openFile(event.target.files[0]));
  $("#resetButton").addEventListener("click", resetSettings);
  $("#compareInput").addEventListener("input", event => updateComparison(event.target.value));
  $("#exportJpeg").addEventListener("click", () => exportImage("image/jpeg"));
  $("#exportPng").addEventListener("click", () => exportImage("image/png"));

  $$("[data-setting]").forEach(input => {
    input.addEventListener("input", () => {
      const name = input.dataset.setting;
      state.settings[name] = Number(input.value);
      $(`[data-output="${name}"]`).value = displayValue(name, state.settings[name]);
      renderPreview();
    });
  });

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
}

async function start() {
  capabilityRows();
  bindEvents();
  syncControls();
  await prepareRenderer();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  console.info(`ReefTone Web ${VERSION}`);
}

start();
