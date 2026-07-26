const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const APP_VERSION = "0.4.0";

const state = {
  session: null,
  settings: {},
  presets: {},
  bypassed: new Set(),
  history: [],
  future: [],
  compare: 50,
  swipeEnabled: true,
  fullBefore: false,
  zoomScale: 1,
  zoomMode: "fit",
  settingsClips: [],
  previewController: null,
  previewTimer: null,
  previewUrl: null,
  originalUrl: null,
  dragDepth: 0,
  sampling: false,
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
  copySettingsButton: $("#copySettingsButton"),
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
  eyedropperButton: $("#eyedropperButton"),
  sampleMarker: $("#sampleMarker"),
  colorCard: $("#colorCard"),
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
    const [healthResponse, presetResponse, libraryResponse] = await Promise.all([
      api("/api/health"),
      api("/api/presets"),
      api("/api/library"),
    ]);
    const health = await healthResponse.json();
    if (health.version !== APP_VERSION) {
      toast(`ReefTone ${APP_VERSION} is ready. Restart the local app to activate it.`, true);
    }
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
  setSampling(false);
  applyPreset("natural", false);
  elements.emptyState.hidden = true;
  elements.editorStage.hidden = false;
  elements.canvasToolbar.hidden = false;
  elements.exportButton.disabled = false;
  elements.resetButton.disabled = false;
  elements.copySettingsButton.disabled = false;
  elements.documentTitle.textContent = session.name;
  elements.saveState.textContent = "Non-destructive edit";
  elements.analysisLabel.textContent = session.analysis.label;
  elements.analysisText.textContent = `${Math.round(session.analysis.red_loss * 100)}% red attenuation · ${Math.round(session.analysis.haze * 100)}% haze`;
  elements.confidenceBadge.textContent = `${Math.round(session.analysis.confidence * 100)}%`;
  const color = session.color || {};
  elements.imageMeta.textContent = `${session.width} × ${session.height} · ${color.bit_depth || session.source_bits}-bit base · ${color.profile || session.profile} · ${color.dynamic_range || "SDR"} · float32 processing`;
  renderColorInfo(color);
  configureExportForSession(color);

  revokeImageUrls();
  state.originalUrl = `/api/session/${session.id}/original`;
  elements.original.src = state.originalUrl;
  elements.corrected.src = state.originalUrl;
  await elements.original.decode();
  scrollToTop();
  alignImageLayers();
  setSwipeEnabled(true);
  setZoomMode("fit");
  updateHistoryButtons();
  schedulePreview(0);
}

function setLoadingDocument(text) {
  elements.documentTitle.textContent = text;
  elements.saveState.textContent = "Working locally";
}

function renderColorInfo(color) {
  elements.colorCard.hidden = false;
  $("#colorProfile").textContent = color.profile || "Unprofiled RGB";
  const workingSuffix = color.working_profile && color.working_profile !== color.profile
    ? ` · working: ${color.working_profile}`
    : "";
  $("#colorTransfer").textContent = `${color.primaries || "Unknown primaries"} · ${color.transfer || "Unknown transfer"}${workingSuffix}`;
  const badges = [
    color.dynamic_range || "SDR",
    `${color.bit_depth || 8}-bit base`,
    color.format || "Image",
  ];
  $("#colorBadges").innerHTML = badges.map(value => `<span>${escapeHtml(value)}</span>`).join("");
  const auxiliaryCount = color.auxiliary_images?.length || 0;
  if (color.hdr_gain_map) {
    $("#colorSummary").textContent = `Apple gain-map HDR detected with ${auxiliaryCount} auxiliary image${auxiliaryCount === 1 ? "" : "s"}. Editing currently uses its color-managed SDR base; HEIC export retains P3/ICC, EXIF, and 10-bit precision but does not copy an unmodified HDR gain map.`;
  } else if (color.dynamic_range !== "SDR") {
    $("#colorSummary").textContent = `${color.dynamic_range} with ${color.transfer} detected. ReefTone safely tone-maps this to an sRGB SDR working copy before applying display-referred corrections; it does not retain HDR tags on the edited export.`;
  } else {
    $("#colorSummary").textContent = `Profile-aware ${color.dynamic_range || "SDR"} workflow. Embedded ICC, EXIF, and available XMP metadata are carried into compatible exports.`;
  }
}

function configureExportForSession(color) {
  const preferHeic = ["HEIC", "HEIF"].includes(color.format);
  const radio = $(`.format-options input[value="${preferHeic ? "heic" : "jpeg"}"]`);
  if (radio) radio.checked = true;
  updateExportColorNote();
}

function updateExportColorNote() {
  if (!state.session) return;
  const format = new FormData($("#exportForm")).get("format");
  const color = state.session.color || {};
  const note = $("#colorExportNote");
  if (format === "heic") {
    const hdrSource = color.dynamic_range !== "SDR";
    note.className = `color-export-note${hdrSource ? " warning" : ""}`;
    note.textContent = color.hdr_gain_map
      ? "10-bit HEIC will preserve the source P3/ICC profile, EXIF and XMP. The Apple HDR gain map cannot be reused after pixel edits, so this export is wide-color SDR—not falsely tagged HDR."
      : hdrSource
      ? "This HDR source is exported as a safely tone-mapped 10-bit sRGB HEIC. HDR transfer tags are deliberately removed until ReefTone has an unclamped native HDR editor."
      : "10-bit HEIC preserves the working color profile and compatible camera metadata.";
  } else if (format === "tiff") {
    note.className = "color-export-note";
    note.textContent = "16-bit TIFF preserves the embedded ICC profile and is the safest lossless editing master.";
  } else if (format === "png") {
    note.className = "color-export-note";
    note.textContent = "PNG is lossless but this delivery export is 8-bit. The embedded ICC profile is retained.";
  } else {
    note.className = "color-export-note";
    note.textContent = "JPEG retains the embedded ICC and EXIF metadata, but remains an 8-bit SDR delivery format.";
  }
  $("#qualityRow").hidden = !["jpeg", "heic"].includes(format);
}

function copyCurrentSettings() {
  if (!state.session) return;
  const settings = structuredClone(state.settings);
  ["sample_red", "sample_green", "sample_blue", "sample_strength"].forEach(name => {
    settings[name] = 0;
  });
  const activePreset = $(".presets button.active")?.textContent.trim() || "Custom";
  state.settingsClips.unshift({
    id: crypto.randomUUID(),
    name: state.session.name,
    look: activePreset,
    settings,
    bypassed: [...state.bypassed].filter(name => !name.startsWith("sample_")),
  });
  state.settingsClips = state.settingsClips.slice(0, 4);
  renderSettingsShelf();
  toast("Settings copied for another photo");
}

function renderSettingsShelf() {
  const shelf = $("#settingsShelf");
  const container = $("#settingsShelfItems");
  shelf.hidden = !state.settingsClips.length;
  container.innerHTML = state.settingsClips.map(clip => `
    <div class="settings-clip" data-clip="${escapeHtml(clip.id)}">
      <span><strong>${escapeHtml(clip.look)}</strong><small>${escapeHtml(clip.name)}</small></span>
      <button type="button" data-apply-clip="${escapeHtml(clip.id)}">Apply</button>
      <button type="button" class="remove-clip" data-remove-clip="${escapeHtml(clip.id)}" aria-label="Remove copied settings">×</button>
    </div>
  `).join("");
  $$("[data-apply-clip]", container).forEach(button => {
    button.addEventListener("click", () => applySettingsClip(button.dataset.applyClip));
  });
  $$("[data-remove-clip]", container).forEach(button => {
    button.addEventListener("click", () => {
      state.settingsClips = state.settingsClips.filter(clip => clip.id !== button.dataset.removeClip);
      renderSettingsShelf();
    });
  });
}

function applySettingsClip(id) {
  const clip = state.settingsClips.find(item => item.id === id);
  if (!clip || !state.session) return;
  const previous = settingsSnapshot();
  state.settings = structuredClone(clip.settings);
  state.bypassed = new Set(clip.bypassed);
  pushHistory(previous);
  syncControls();
  selectMatchingPreset();
  schedulePreview(0);
  toast(`Applied ${clip.look} settings from ${clip.name}`);
}

function settingsSnapshot() {
  return JSON.stringify({
    settings: state.settings,
    bypassed: [...state.bypassed].sort(),
  });
}

function restoreSnapshot(snapshot) {
  const parsed = JSON.parse(snapshot);
  if (parsed.settings) {
    state.settings = parsed.settings;
    state.bypassed = new Set(parsed.bypassed || []);
  } else {
    state.settings = parsed;
    state.bypassed = new Set();
  }
}

function effectiveSettings() {
  const effective = structuredClone(state.settings);
  state.bypassed.forEach(name => {
    if (Object.hasOwn(effective, name)) effective[name] = 0;
  });
  return effective;
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
  restoreSnapshot(state.history.pop());
  syncControls();
  selectMatchingPreset();
  updateHistoryButtons();
  schedulePreview(0);
}

function redo() {
  if (!state.future.length) return;
  state.history.push(settingsSnapshot());
  restoreSnapshot(state.future.pop());
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
    if (state.settings[name] !== undefined) input.value = state.settings[name];
    updateRangeStyle(input);
    const output = $(`[data-output="${name}"]`);
    if (output) output.value = displayValue(name, Number(input.value));
    const control = input.closest(".slider-control");
    const bypassed = state.bypassed.has(name);
    control?.classList.toggle("bypassed", bypassed);
    const bypassButton = control?.querySelector(".bypass-control");
    if (bypassButton) {
      bypassButton.setAttribute("aria-pressed", String(!bypassed));
      bypassButton.title = bypassed ? `Enable ${name.replaceAll("_", " ")}` : `Temporarily disable ${name.replaceAll("_", " ")}`;
    }
  });
  $("#autoToggle").checked = state.settings.auto_restore > 0;
  syncSampleStatus();
}

function applyPreset(name, record = true) {
  if (!state.presets[name]) {
    toast(`The ${name} look needs the latest ReefTone server. Restart the app.`, true);
    return;
  }
  const previous = settingsSnapshot();
  state.settings = structuredClone(state.presets[name]);
  state.bypassed.clear();
  if (record) pushHistory(previous);
  syncControls();
  $$(".presets button").forEach(button => button.classList.toggle("active", button.dataset.preset === name));
  if (state.session && record) schedulePreview(0);
}

function clearPresetSelection() {
  $$(".presets button").forEach(button => button.classList.remove("active"));
}

function selectMatchingPreset() {
  const match = state.bypassed.size ? null : Object.entries(state.presets).find(([, settings]) =>
    Object.keys(state.settings).every(key => state.settings[key] === settings[key])
  );
  $$(".presets button").forEach(button => {
    button.classList.toggle("active", Boolean(match) && button.dataset.preset === match[0]);
  });
}

function addPerControlActions() {
  $$("[data-setting]").forEach(input => {
    const control = input.closest(".slider-control");
    if (!control || control.querySelector(".control-actions")) return;
    const name = input.dataset.setting;
    const readable = name.replaceAll("_", " ");
    const actions = document.createElement("span");
    actions.className = "control-actions";
    actions.innerHTML = `
      <button class="mini-control reset-control" type="button" title="Reset ${readable} to zero" aria-label="Reset ${readable} to zero">
        <svg viewBox="0 0 24 24"><path d="M5 8v5h5"/><path d="M6.4 16a7 7 0 1 0 .2-8.2L5 10"/></svg>
      </button>
      <button class="mini-control bypass-control" type="button" title="Temporarily disable ${readable}" aria-label="Toggle ${readable}" aria-pressed="true">
        <svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>
      </button>`;
    control.insertBefore(actions, input);

    $(".reset-control", actions).addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const previous = settingsSnapshot();
      state.settings[name] = 0;
      state.bypassed.delete(name);
      pushHistory(previous);
      syncControls();
      clearPresetSelection();
      schedulePreview(0);
    });
    $(".bypass-control", actions).addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const previous = settingsSnapshot();
      if (state.bypassed.has(name)) state.bypassed.delete(name);
      else state.bypassed.add(name);
      pushHistory(previous);
      syncControls();
      clearPresetSelection();
      schedulePreview(0);
    });
  });
}

function syncSampleStatus() {
  const active = Number(state.settings.sample_strength || 0) > 0;
  $("#sampleStatus").hidden = !active;
  elements.sampleMarker.hidden = !active;
  if (!active) return;
  const rgb = ["sample_red", "sample_green", "sample_blue"].map(name =>
    Math.round(Number(state.settings[name] || 0) * 255)
  );
  $("#sampleSwatch").style.backgroundColor = `rgb(${rgb.join(",")})`;
}

function setSampling(enabled) {
  state.sampling = enabled;
  elements.imageShell.classList.toggle("sampling", enabled);
  elements.eyedropperButton.classList.toggle("active", enabled);
  elements.eyedropperButton.setAttribute("aria-pressed", String(enabled));
  elements.eyedropperButton.textContent = enabled ? "Click a neutral spot" : "";
  if (!enabled) {
    elements.eyedropperButton.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="m19 3 2 2-8.5 8.5-3-3L18 2a1.4 1.4 0 0 1 2 0Z"/><path d="m8.5 11.5-5 5v4h4l5-5"/><path d="M4 20h4"/></svg>
      Sample neutral`;
  }
}

function sampleNeutralPoint(event) {
  if (!state.sampling || !state.session) return;
  event.preventDefault();
  const rect = elements.original.getBoundingClientRect();
  if (
    event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom
  ) return;

  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = (event.clientY - rect.top) / rect.height;
  const sourceX = xRatio * elements.original.naturalWidth;
  const sourceY = yRatio * elements.original.naturalHeight;
  const radius = Math.max(2, Math.round(Math.min(
    elements.original.naturalWidth / rect.width,
    elements.original.naturalHeight / rect.height,
  ) * 4));
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", {willReadFrequently: true});
  context.drawImage(
    elements.original,
    sourceX - radius,
    sourceY - radius,
    radius * 2 + 1,
    radius * 2 + 1,
    0,
    0,
    1,
    1,
  );
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  const previous = settingsSnapshot();
  state.settings.sample_red = red / 255;
  state.settings.sample_green = green / 255;
  state.settings.sample_blue = blue / 255;
  state.settings.sample_strength = 1;
  pushHistory(previous);
  elements.sampleMarker.style.left = `${xRatio * 100}%`;
  elements.sampleMarker.style.top = `${yRatio * 100}%`;
  syncSampleStatus();
  setSampling(false);
  clearPresetSelection();
  schedulePreview(0);
  toast("Neutral point sampled");
}

function clearSample() {
  const previous = settingsSnapshot();
  state.settings.sample_red = 0;
  state.settings.sample_green = 0;
  state.settings.sample_blue = 0;
  state.settings.sample_strength = 0;
  pushHistory(previous);
  syncSampleStatus();
  setSampling(false);
  schedulePreview(0);
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
      body: JSON.stringify(effectiveSettings()),
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
  const width = elements.original.offsetWidth;
  if (width) elements.imageShell.style.setProperty("--image-width", `${width}px`);
}

function setCompare(value) {
  state.compare = Math.max(0, Math.min(100, value));
  if (!state.swipeEnabled) return;
  elements.correctedLayer.style.width = `${state.compare}%`;
  elements.compareLine.style.left = `${state.compare}%`;
  elements.compareLine.setAttribute("aria-valuenow", Math.round(state.compare));
}

function pointerToCompare(event) {
  const rect = elements.imageShell.getBoundingClientRect();
  setCompare(((event.clientX - rect.left) / rect.width) * 100);
}

function setSwipeEnabled(enabled) {
  state.swipeEnabled = enabled;
  state.fullBefore = false;
  $("#swipeToggle").classList.toggle("active", enabled);
  $("#swipeToggle").setAttribute("aria-pressed", String(enabled));
  $("#beforeAfterButton").disabled = enabled;
  $("#beforeAfterButton").classList.remove("active");
  $("#beforeAfterButton").setAttribute("aria-pressed", "false");
  $("#beforeAfterButton").textContent = "Before";
  elements.compareLine.hidden = !enabled;
  $(".before-label").hidden = !enabled;
  $(".after-label").hidden = !enabled;
  elements.correctedLayer.style.width = enabled ? `${state.compare}%` : "100%";
}

function toggleFullBefore() {
  if (state.swipeEnabled) return;
  state.fullBefore = !state.fullBefore;
  elements.correctedLayer.style.width = state.fullBefore ? "0%" : "100%";
  $("#beforeAfterButton").classList.toggle("active", state.fullBefore);
  $("#beforeAfterButton").setAttribute("aria-pressed", String(state.fullBefore));
  $("#beforeAfterButton").textContent = state.fullBefore ? "After" : "Before";
}

function setZoomScale(scale, mode = "manual") {
  state.zoomScale = Math.max(0.1, Math.min(16, scale));
  state.zoomMode = mode;
  elements.imageShell.style.transform = `scale(${state.zoomScale})`;
  $("#zoomStepButton").textContent = `${Math.round(state.zoomScale * 100)}%`;
  $$("[data-zoom], #fitButton").forEach(button => {
    const buttonMode = button.id === "fitButton" ? "fit" : button.dataset.zoom;
    button.classList.toggle("active", buttonMode === mode);
  });
  alignImageLayers();
}

function setZoomMode(mode) {
  const baseWidth = elements.original.offsetWidth || 1;
  const baseHeight = elements.original.offsetHeight || 1;
  if (mode === "fit") {
    setZoomScale(1, mode);
    return;
  }
  if (mode === "fill") {
    const stageStyle = getComputedStyle(elements.editorStage);
    const availableWidth = elements.editorStage.clientWidth
      - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
    const availableHeight = elements.editorStage.clientHeight
      - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom);
    setZoomScale(Math.max(availableWidth / baseWidth, availableHeight / baseHeight), mode);
    return;
  }
  const pixelRatio = Number(mode);
  setZoomScale((elements.original.naturalWidth / baseWidth) * pixelRatio, mode);
}

function stepZoom(direction) {
  setZoomScale(state.zoomScale + direction * 0.1);
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
      body: JSON.stringify({...effectiveSettings(), format, quality}),
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
  elements.exportButton.addEventListener("click", () => {
    updateExportColorNote();
    elements.exportDialog.showModal();
  });
  $$(".close-dialog, .cancel-dialog").forEach(button => {
    button.addEventListener("click", () => elements.exportDialog.close());
  });
  elements.resetButton.addEventListener("click", resetSettings);
  elements.copySettingsButton.addEventListener("click", copyCurrentSettings);
  elements.undoButton.addEventListener("click", undo);
  elements.redoButton.addEventListener("click", redo);
  $("#swipeToggle").addEventListener("click", () => setSwipeEnabled(!state.swipeEnabled));
  $("#beforeAfterButton").addEventListener("click", toggleFullBefore);
  $("#fitButton").addEventListener("click", () => setZoomMode("fit"));
  $$("[data-zoom]").forEach(button => {
    button.addEventListener("click", () => setZoomMode(button.dataset.zoom));
  });
  $("#zoomStepButton").addEventListener("click", () => stepZoom(1));
  $("#zoomStepButton").addEventListener("contextmenu", event => {
    event.preventDefault();
    stepZoom(-1);
  });

  $$(".presets button").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  elements.eyedropperButton.addEventListener("click", () => {
    if (!state.session) return;
    setSampling(!state.sampling);
    if (state.sampling) toast("Click a gray, white, or neutral area in the photo");
  });
  $("#clearSampleButton").addEventListener("click", clearSample);
  elements.imageShell.addEventListener("click", sampleNeutralPoint);
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
      state.bypassed.delete(name);
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
    state.settings.auto_restore = event.target.checked ? state.presets.natural.auto_restore : 0;
    state.bypassed.delete("auto_restore");
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

  window.addEventListener("resize", () => {
    alignImageLayers();
    if (state.session && state.zoomMode !== "manual") setZoomMode(state.zoomMode);
  });
  window.addEventListener("keydown", event => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
    if (event.key === "\\" && state.session) {
      event.preventDefault();
      if (state.swipeEnabled) setCompare(0);
      else if (!state.fullBefore) toggleFullBefore();
    }
  });
  window.addEventListener("keyup", event => {
    if (event.key === "\\" && state.session) {
      if (state.swipeEnabled) setCompare(50);
      else if (state.fullBefore) toggleFullBefore();
    }
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

  $$(".format-options input").forEach(input => input.addEventListener("change", updateExportColorNote));
  $("#qualityInput").addEventListener("input", event => { $("#qualityOutput").value = `${event.target.value}%`; });
  $("#exportForm").addEventListener("submit", exportImage);
}

addPerControlActions();
bindEvents();
loadInitialData();
