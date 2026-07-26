const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  session: null,
  settings: {},
  presets: {},
  history: [],
  future: [],
  compare: 50,
  compareVisible: true,
  previewController: null,
  previewTimer: null,
  previewUrl: null,
  originalUrl: null,
  dragDepth: 0,
};

const elements = {
  fileInput: $("#fileInput"),
  emptyState: $("#emptyState"),
  editorStage: $("#editorStage"),
  canvasToolbar: $("#canvasToolbar"),
  imageShell: $("#imageShell"),
  original: $("#originalImage"),
  corrected: $("#correctedImage"),
  correctedLayer: $("#correctedLayer"),
  compareLine: $("#compareLine"),
  processing: $("#processingOverlay"),
  dropOverlay: $("#dropOverlay"),
  inspector: $("#inspector"),
  exportButton: $("#exportButton"),
  resetButton: $("#resetButton"),
  undoButton: $("#undoButton"),
  redoButton: $("#redoButton"),
  analysisLabel: $("#analysisLabel"),
  analysisText: $("#analysisText"),
  confidenceBadge: $("#confidenceBadge"),
  documentTitle: $(".document-name"),
  saveState: $(".save-state"),
  imageMeta: $("#imageMeta"),
  exportDialog: $("#exportDialog"),
  downloadButton: $("#downloadButton"),
};

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function toast(message, error = false) {
  const item = document.createElement("div");
  item.className = `toast${error ? " error" : ""}`;
  item.textContent = message;
  $("#toastRegion").append(item);
  setTimeout(() => item.remove(), 4200);
}

function scrollToTop() {
  window.scrollTo({top: 0});
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch (_) { /* response is not JSON */ }
    throw new Error(message);
  }
  return response;
}

async function loadInitialData() {
  try {
    const [presetResponse, libraryResponse] = await Promise.all([
      api("/api/presets"),
      api("/api/library"),
    ]);
    state.presets = (await presetResponse.json()).presets;
    state.settings = structuredClone(state.presets.natural);
    syncControls();
    renderLibrary((await libraryResponse.json()).images);
  } catch (error) {
    toast(`Could not start ReefTone: ${error.message}`, true);
  }
}

function renderLibrary(images) {
  const section = $("#librarySection");
  const grid = $("#libraryGrid");
  if (!images.length) return;
  section.hidden = false;
  $("#libraryCount").textContent = `${images.length} available`;
  grid.innerHTML = images.slice(0, 8).map(image => `
    <button class="library-item" type="button" data-name="${escapeHtml(image.name)}">
      <strong>${escapeHtml(image.name)}</strong>
      <small>${escapeHtml(image.kind)} · ${formatBytes(image.size)}</small>
    </button>
  `).join("");
  $$(".library-item", grid).forEach(button => {
    button.addEventListener("click", () => openLibraryImage(button.dataset.name));
  });
}

async function openLibraryImage(name) {
  setLoadingDocument(`Opening ${name}…`);
  try {
    const response = await api("/api/library/open", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name}),
    });
    await activateSession(await response.json());
  } catch (error) {
    toast(error.message, true);
    setLoadingDocument("Ready");
  }
}

async function uploadFile(file) {
  if (!file) return;
  const valid = /\.(heic|heif|jpe?g|png|tiff?)$/i.test(file.name);
  if (!valid) {
    toast("Choose a HEIC, JPEG, PNG, or TIFF image.", true);
    return;
  }
  setLoadingDocument(`Reading ${file.name}…`);
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await api("/api/upload", {method: "POST", body: form});
    await activateSession(await response.json());
  } catch (error) {
    toast(error.message, true);
    setLoadingDocument("Ready");
  } finally {
    elements.fileInput.value = "";
  }
}

async function activateSession(session) {
  state.session = session;
  state.history = [];
  state.future = [];
  applyPreset("natural", false);
  elements.emptyState.hidden = true;
  elements.editorStage.hidden = false;
  elements.canvasToolbar.hidden = false;
  elements.exportButton.disabled = false;
  elements.resetButton.disabled = false;
  elements.documentTitle.textContent = session.name;
  elements.saveState.textContent = "Non-destructive edit";
  elements.analysisLabel.textContent = session.analysis.label;
  elements.analysisText.textContent = `${Math.round(session.analysis.red_loss * 100)}% red attenuation · ${Math.round(session.analysis.haze * 100)}% haze`;
  elements.confidenceBadge.textContent = `${Math.round(session.analysis.confidence * 100)}%`;
  elements.imageMeta.textContent = `${session.width} × ${session.height} · ${session.source_bits}-bit source · ${session.profile} · float32 processing`;

  revokeImageUrls();
  state.originalUrl = `/api/session/${session.id}/original`;
  elements.original.src = state.originalUrl;
  elements.corrected.src = state.originalUrl;
  await elements.original.decode();
  scrollToTop();
  alignImageLayers();
  setCompare(50);
  updateHistoryButtons();
  schedulePreview(0);
}

function setLoadingDocument(text) {
  elements.documentTitle.textContent = text;
  elements.saveState.textContent = "Working locally";
}

function settingsSnapshot() {
  return JSON.stringify(state.settings);
}

function pushHistory(previous) {
  if (!state.session || previous === settingsSnapshot()) return;
  state.history.push(previous);
  if (state.history.length > 40) state.history.shift();
  state.future = [];
  updateHistoryButtons();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(settingsSnapshot());
  state.settings = JSON.parse(state.history.pop());
  syncControls();
  selectMatchingPreset();
  updateHistoryButtons();
  schedulePreview(0);
}

function redo() {
  if (!state.future.length) return;
  state.history.push(settingsSnapshot());
  state.settings = JSON.parse(state.future.pop());
  syncControls();
  selectMatchingPreset();
  updateHistoryButtons();
  schedulePreview(0);
}

function updateHistoryButtons() {
  elements.undoButton.disabled = !state.history.length;
  elements.redoButton.disabled = !state.future.length;
}

function displayValue(name, value) {
  if (name === "exposure") return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  const number = Math.round(value * 100);
  if (["master", "auto_restore", "red_recovery", "dehaze", "denoise"].includes(name)) return String(number);
  return `${number > 0 ? "+" : number < 0 ? "−" : ""}${Math.abs(number)}`;
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
    const output = $(`[data-output="${name}"]`);
    if (output) output.value = displayValue(name, Number(input.value));
  });
  $("#autoToggle").checked = state.settings.auto_restore > 0;
}

function applyPreset(name, record = true) {
  if (!state.presets[name]) return;
  const previous = settingsSnapshot();
  state.settings = structuredClone(state.presets[name]);
  if (record) pushHistory(previous);
  syncControls();
  $$(".presets button").forEach(button => button.classList.toggle("active", button.dataset.preset === name));
  if (state.session && record) schedulePreview(0);
}

function clearPresetSelection() {
  $$(".presets button").forEach(button => button.classList.remove("active"));
}

function selectMatchingPreset() {
  const match = Object.entries(state.presets).find(([, settings]) =>
    Object.keys(state.settings).every(key => state.settings[key] === settings[key])
  );
  $$(".presets button").forEach(button => {
    button.classList.toggle("active", Boolean(match) && button.dataset.preset === match[0]);
  });
}

function schedulePreview(delay = 140) {
  if (!state.session) return;
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(renderPreview, delay);
}

async function renderPreview() {
  if (!state.session) return;
  if (state.previewController) state.previewController.abort();
  const controller = new AbortController();
  state.previewController = controller;
  elements.processing.classList.add("visible");
  elements.saveState.textContent = "Updating preview…";
  try {
    const response = await api(`/api/session/${state.session.id}/preview`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(state.settings),
      signal: controller.signal,
    });
    const blob = await response.blob();
    if (controller.signal.aborted) return;
    const url = URL.createObjectURL(blob);
    const oldUrl = state.previewUrl;
    elements.corrected.src = url;
    await elements.corrected.decode();
    state.previewUrl = url;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    alignImageLayers();
    elements.saveState.textContent = "Non-destructive edit";
  } catch (error) {
    if (error.name !== "AbortError") {
      toast(error.message, true);
      elements.saveState.textContent = "Preview error";
    }
  } finally {
    if (state.previewController === controller) {
      elements.processing.classList.remove("visible");
      state.previewController = null;
    }
  }
}

function alignImageLayers() {
  const width = elements.original.getBoundingClientRect().width;
  if (width) elements.imageShell.style.setProperty("--image-width", `${width}px`);
}

function setCompare(value) {
  state.compare = Math.max(0, Math.min(100, value));
  elements.correctedLayer.style.width = `${state.compare}%`;
  elements.compareLine.style.left = `${state.compare}%`;
  elements.compareLine.setAttribute("aria-valuenow", Math.round(state.compare));
}

function pointerToCompare(event) {
  const rect = elements.imageShell.getBoundingClientRect();
  setCompare(((event.clientX - rect.left) / rect.width) * 100);
}

function toggleCompare() {
  state.compareVisible = !state.compareVisible;
  $("#compareButton").classList.toggle("active", state.compareVisible);
  $("#compareButton").setAttribute("aria-pressed", state.compareVisible);
  elements.compareLine.hidden = !state.compareVisible;
  $(".before-label").hidden = !state.compareVisible;
  $(".after-label").hidden = !state.compareVisible;
  setCompare(state.compareVisible ? 50 : 100);
}

function resetSettings() {
  if (!state.session) return;
  applyPreset("natural");
  toast("Adjustments reset to Natural");
}

function revokeImageUrls() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

async function exportImage(event) {
  event.preventDefault();
  if (!state.session || elements.downloadButton.classList.contains("loading")) return;
  const format = new FormData($("#exportForm")).get("format");
  const quality = Number($("#qualityInput").value);
  elements.downloadButton.classList.add("loading");
  try {
    const response = await api(`/api/session/${state.session.id}/export`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({...state.settings, format, quality}),
    });
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `${state.session.name.replace(/\.[^.]+$/, "")}_reeftone.${format}`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    elements.exportDialog.close();
    toast(`Exported ${filename}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.downloadButton.classList.remove("loading");
  }
}

function showEmptyState() {
  elements.emptyState.hidden = false;
  elements.editorStage.hidden = true;
  elements.canvasToolbar.hidden = true;
  scrollToTop();
}

function bindEvents() {
  $("#chooseButton").addEventListener("click", () => elements.fileInput.click());
  $("#newPhotoButton").addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", event => uploadFile(event.target.files[0]));
  $("#homeButton").addEventListener("click", showEmptyState);
  elements.exportButton.addEventListener("click", () => elements.exportDialog.showModal());
  $$(".close-dialog, .cancel-dialog").forEach(button => {
    button.addEventListener("click", () => elements.exportDialog.close());
  });
  elements.resetButton.addEventListener("click", resetSettings);
  elements.undoButton.addEventListener("click", undo);
  elements.redoButton.addEventListener("click", redo);
  $("#compareButton").addEventListener("click", toggleCompare);
  $("#fitButton").addEventListener("click", () => {
    elements.imageShell.animate([{transform: "scale(.985)"}, {transform: "scale(1)"}], {duration: 220});
    alignImageLayers();
  });

  $$(".presets button").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  $$(".section-toggle").forEach(button => button.addEventListener("click", () => {
    button.setAttribute("aria-expanded", button.getAttribute("aria-expanded") !== "true");
  }));

  $$("[data-setting]").forEach(input => {
    let start = null;
    input.addEventListener("pointerdown", () => { start = settingsSnapshot(); });
    input.addEventListener("keydown", () => { if (start === null) start = settingsSnapshot(); });
    input.addEventListener("input", () => {
      const name = input.dataset.setting;
      state.settings[name] = Number(input.value);
      updateRangeStyle(input);
      $(`[data-output="${name}"]`).value = displayValue(name, Number(input.value));
      clearPresetSelection();
      schedulePreview();
    });
    input.addEventListener("change", () => {
      if (start !== null) pushHistory(start);
      start = null;
    });
    input.addEventListener("blur", () => { start = null; });
  });

  $("#autoToggle").addEventListener("change", event => {
    const previous = settingsSnapshot();
    state.settings.auto_restore = event.target.checked ? 0.82 : 0;
    pushHistory(previous);
    syncControls();
    clearPresetSelection();
    schedulePreview(0);
  });

  let comparing = false;
  elements.compareLine.addEventListener("pointerdown", event => {
    comparing = true;
    elements.compareLine.setPointerCapture(event.pointerId);
    pointerToCompare(event);
  });
  elements.compareLine.addEventListener("pointermove", event => { if (comparing) pointerToCompare(event); });
  elements.compareLine.addEventListener("pointerup", () => { comparing = false; });
  elements.compareLine.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setCompare(state.compare + (event.key === "ArrowRight" ? 2 : -2));
    }
  });

  window.addEventListener("resize", alignImageLayers);
  window.addEventListener("keydown", event => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
    if (event.key === "\\" && state.session) {
      event.preventDefault();
      setCompare(event.type === "keydown" ? 0 : 50);
    }
  });
  window.addEventListener("keyup", event => {
    if (event.key === "\\" && state.session && state.compareVisible) setCompare(50);
  });

  ["dragenter", "dragover"].forEach(type => window.addEventListener(type, event => {
    event.preventDefault();
    state.dragDepth += type === "dragenter" ? 1 : 0;
    elements.dropOverlay.classList.add("visible");
  }));
  window.addEventListener("dragleave", event => {
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) elements.dropOverlay.classList.remove("visible");
  });
  window.addEventListener("drop", event => {
    event.preventDefault();
    state.dragDepth = 0;
    elements.dropOverlay.classList.remove("visible");
    uploadFile(event.dataTransfer.files[0]);
  });

  $$(".format-options input").forEach(input => input.addEventListener("change", () => {
    $("#qualityRow").hidden = input.checked && input.value !== "jpeg";
  }));
  $("#qualityInput").addEventListener("input", event => { $("#qualityOutput").value = `${event.target.value}%`; });
  $("#exportForm").addEventListener("submit", exportImage);
}

bindEvents();
loadInitialData();
