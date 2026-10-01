const api = window.cheatykitty;
const $ = (id) => document.getElementById(id);
const recorderPolicy = window.CheatyKittyShortcutRecorderPolicy;
let recordedShortcut = "CommandOrControl+Shift+Space";
let savedShortcut = recordedShortcut;
let recorderState = "idle";
let recordingArmedAt = 0;

function selectedModel() { return document.querySelector('input[name="modelMode"]:checked').value; }
function selectedReasoningEffort() { return "medium"; }
function selectedInteractionMode() { return document.querySelector('input[name="interactionMode"]:checked').value; }
function selectedResultLayout() { return document.querySelector('input[name="resultLayout"]:checked').value; }
function setOpacityReadout() { $("opacityValue").textContent = `${$("overlayOpacity").value}%`; }
function setAutoIntervalReadout() { $("autoIntervalValue").textContent = `${$("autoInterval").value} s`; }
function shortcutLabel(value) {
  const labels = { CommandOrControl: "⌘", Command: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧", Space: "Space", Enter: "↩", Up: "↑", Down: "↓", Left: "←", Right: "→" };
  return value.split("+").map((token) => labels[token] || token).join("");
}
function showShortcut(value) { recordedShortcut = value; $("shortcutRecorder").textContent = shortcutLabel(value); }
function announceRecorder(state, message, alert = false) {
  recorderState = state;
  $("shortcutRecorder").dataset.state = state;
  $("shortcutRecorder").classList.toggle("recording", state === "recording" || state === "validating");
  $("shortcutRecorder").setAttribute("aria-pressed", String(state === "recording"));
  $("shortcutValidation").textContent = message;
  if (alert) $("shortcutValidation").setAttribute("role", "alert"); else $("shortcutValidation").removeAttribute("role");
}
function updateModeUi() {
  const manual = selectedInteractionMode() === "manual";
  $("shortcutField").classList.toggle("inactive", !manual);
  $("shortcutRecorder").disabled = !manual;
  $("retryShortcut").disabled = !manual;
  $("autoIntervalField").classList.toggle("inactive", manual);
  $("autoIntervalField").setAttribute("aria-disabled", String(manual));
  $("autoInterval").disabled = manual;
  if (!manual && ["arming", "recording", "validating"].includes(recorderState)) void stopRecording("Auto mode selected; the saved manual shortcut is restored but inactive.");
}
async function startRecording() {
  if (selectedInteractionMode() !== "manual" || ["arming", "recording", "validating"].includes(recorderState)) return;
  $("shortcutRecorder").focus();
  announceRecorder("arming", "Preparing recorder…");
  try {
    const result = await api.startShortcutRecording();
    if (!result.ok) { announceRecorder("error", result.message, true); showShortcut(recordedShortcut); return; }
    recordingArmedAt = performance.now() + 180;
    announceRecorder("recording", `Listening. Press a modifier plus a key. ${shortcutLabel(savedShortcut)} is temporarily paused.`);
    $("shortcutRecorder").textContent = "Press shortcut…";
  } catch (error) {
    try { await api.stopShortcutRecording("recording-start-failed"); } catch { /* main window lifecycle also restores */ }
    announceRecorder("error", error.message || String(error), true); showShortcut(recordedShortcut);
  }
}

async function stopRecording(message = "Recording cancelled; saved shortcut restored.") {
  if (!["arming", "recording", "validating"].includes(recorderState)) return;
  try {
    const result = await api.stopShortcutRecording("renderer-cancel");
    showShortcut(recordedShortcut);
    announceRecorder(result.ok ? "restored" : "degraded", result.ok ? message : result.message, !result.ok);
  } catch (error) { showShortcut(recordedShortcut); announceRecorder("degraded", error.message || String(error), true); }
}

async function refreshDiagnostic(clearOverride = false) {
  if (clearOverride) $("codexPath").value = "";
  const card = $("codexDiagnostic"); card.dataset.status = "loading";
  $("activePath").textContent = "Detecting local executable…"; $("sourceStatus").textContent = "Checking"; $("cliVersion").textContent = "—"; $("authStatus").textContent = "—"; $("modelStatus").textContent = "Not tested"; $("connectionStatus").textContent = "Checking";
  try {
    const result = await api.inspectCodex($("codexPath").value.trim());
    card.dataset.status = result.status; $("activePath").textContent = result.resolvedPath || "No executable found"; $("sourceStatus").textContent = `${result.source} · ${result.status === "ready" ? "Ready" : "Unavailable"}`; $("cliVersion").textContent = result.version; $("authStatus").textContent = result.authStatus === "authenticated" ? "Authenticated" : result.authStatus === "not-authenticated" ? "Not signed in" : "Unknown"; $("modelStatus").textContent = result.modelStatus; $("connectionStatus").textContent = result.connectionStatus; $("diagnosticMessage").textContent = result.message;
  } catch (error) { card.dataset.status = "error"; $("activePath").textContent = "Diagnostic failed"; $("diagnosticMessage").textContent = error.message || String(error); }
}

async function load() {
  const settings = await api.getSettings();
  $("codexPath").value = settings.codexPath; $("timeout").value = settings.timeoutSeconds; $("captureMode").value = settings.captureMode; $("overlayOpacity").value = Math.round(settings.overlayOpacity * 100); $("autoInterval").value = settings.autoIntervalSeconds;
  document.querySelector(`input[name="interactionMode"][value="${settings.interactionMode}"]`).checked = true;
  document.querySelector(`input[name="resultLayout"][value="${settings.resultLayout || "question-answer"}"]`).checked = true;
  savedShortcut = settings.manualShortcut; showShortcut(settings.manualShortcut);
  document.querySelector(`input[name="modelMode"][value="${settings.model}"]`).checked = true;
  setOpacityReadout(); setAutoIntervalReadout(); updateModeUi(); announceRecorder("idle", `${shortcutLabel(savedShortcut)} is active.`); await refreshDiagnostic(false);
}

document.querySelectorAll('input[name="interactionMode"]').forEach((input) => input.addEventListener("change", updateModeUi));
$("autoInterval").addEventListener("input", setAutoIntervalReadout);
$("shortcutRecorder").addEventListener("click", startRecording);
$("retryShortcut").addEventListener("click", async () => { try { const result = await api.retryShortcut(); announceRecorder(result.ok ? "active" : "degraded", result.message, !result.ok); } catch (error) { announceRecorder("degraded", error.message || String(error), true); } });
$("overlayOpacity").addEventListener("input", () => { setOpacityReadout(); api.previewOpacity(Number($("overlayOpacity").value) / 100); });
$("detectButton").addEventListener("click", () => refreshDiagnostic(true));
$("browseButton").addEventListener("click", async () => { const selected = await api.chooseCodex(); if (selected) { $("codexPath").value = selected; await refreshDiagnostic(false); } });
$("testButton").addEventListener("click", async () => {
  const button = $("testButton");
  button.disabled = true; $("saveDiagnostic").textContent = "Testing executable, authentication, and selected model…";
  try { const result = await api.testCodex($("codexPath").value.trim(), selectedModel(), selectedReasoningEffort()); $("modelStatus").textContent = result.modelStatus; $("connectionStatus").textContent = result.connectionStatus.replaceAll("-", " "); $("saveDiagnostic").textContent = result.message; }
  catch (error) { $("saveDiagnostic").textContent = error.message || String(error); } finally { button.disabled = false; }
});
$("saveButton").addEventListener("click", async () => {
  if (["arming", "recording", "validating"].includes(recorderState)) await stopRecording();
  const button = $("saveButton"); button.disabled = true; announceRecorder("registering", `Registering ${shortcutLabel(recordedShortcut)} and saving settings…`); $("saveDiagnostic").textContent = "Saving settings…";
  const result = await window.CheatyKittySettingsActions.persistSettings(api, { codexPath: $("codexPath").value, timeoutSeconds: Number($("timeout").value), captureMode: $("captureMode").value, model: selectedModel(), reasoningEffort: selectedReasoningEffort(), autoIntervalSeconds: Number($("autoInterval").value), overlayOpacity: Number($("overlayOpacity").value) / 100, interactionMode: selectedInteractionMode(), manualShortcut: recordedShortcut, resultLayout: selectedResultLayout() });
  if (result.ok) { savedShortcut = result.settings.manualShortcut; showShortcut(savedShortcut); announceRecorder("saved", selectedInteractionMode() === "manual" ? `${shortcutLabel(savedShortcut)} saved and active.` : `${shortcutLabel(savedShortcut)} saved; manual shortcut is inactive in Auto mode.`); $("saveDiagnostic").textContent = "Settings saved."; }
  else { const degraded = /inactive; use Retry/i.test(result.message); recordedShortcut = savedShortcut; showShortcut(savedShortcut); announceRecorder(degraded ? "degraded" : "error", `${result.message} The previous shortcut remains saved; use Retry if its active registration could not be confirmed.`, true); $("saveDiagnostic").textContent = result.message; $("saveDiagnostic").setAttribute("role", "alert"); }
  button.disabled = false;
});
$("closeSettings").addEventListener("click", async () => { await stopRecording(); api.closeSettings(); });

window.addEventListener("keydown", async (event) => {
  if (["arming", "recording", "validating"].includes(recorderState)) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    if (event.repeat || recorderState === "validating" || performance.now() < recordingArmedAt) return;
    if (event.key === "Escape") { await stopRecording(); return; }
    const candidate = recorderPolicy.acceleratorFromEvent(event);
    if (!candidate) { announceRecorder("recording", "Keep holding a modifier and press one supported non-modifier key.", true); $("shortcutRecorder").textContent = "Modifier + key…"; return; }
    announceRecorder("validating", `Validating ${shortcutLabel(candidate)}…`);
    let validation;
    let restored;
    try {
      validation = await api.checkShortcutCandidate(candidate);
    } catch (error) {
      validation = { ok: false, message: error.message || String(error) };
    } finally {
      try { restored = await api.stopShortcutRecording("candidate-checked"); }
      catch (error) { restored = { ok: false, message: error.message || String(error) }; }
    }
    try {
      if (validation.ok && restored.ok) { showShortcut(validation.accelerator); announceRecorder("ready", `${shortcutLabel(validation.accelerator)} is available. Save settings to activate it.`); }
      else { recordedShortcut = savedShortcut; showShortcut(savedShortcut); announceRecorder(restored.ok ? "error" : "degraded", `${validation.message || restored.message} ${restored.ok ? "The saved shortcut was restored." : ""}`, true); }
    } catch (error) { recordedShortcut = savedShortcut; showShortcut(savedShortcut); announceRecorder("degraded", error.message || String(error), true); }
    return;
  }
  if (event.key === "Escape") { api.closeSettings(); return; }
  if (event.key === "Tab") {
    const focusable = [...document.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled])')].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}, true);
window.addEventListener("blur", () => { void stopRecording("Settings lost focus; saved shortcut restored."); });
window.addEventListener("beforeunload", () => { void api.stopShortcutRecording("renderer-unload").catch(() => undefined); });
load();
