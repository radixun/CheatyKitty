const api = window.cheatykitty;
const $ = (id) => document.getElementById(id);

function setState(state) {
  const view = window.CheatyKittyViewModel.toViewModel(state);
  document.body.dataset.state = state.kind;
  document.body.dataset.layout = view.layout;
  $("modelReadout").textContent = view.model;
  $("modeReadout").textContent = view.mode;
  $("questionStatus").textContent = view.question.status;
  $("questionText").textContent = view.question.text;
  $("questionProgress").classList.toggle("hidden", !view.question.busy);
  $("questionProgress").classList.toggle("retained-progress", view.question.busy && view.question.retained);
  $("questionProgressText").textContent = view.question.progress;
  $("answerStatus").textContent = view.answer.status;
  $("answerText").textContent = view.answer.text;
  $("answerProgress").classList.toggle("hidden", !view.answer.busy);
  $("answerProgress").classList.toggle("retained-progress", view.answer.busy && view.answer.retained);
  $("answerProgressText").textContent = view.answer.progress;
  const answerOnly = view.layout === "answer-only";
  $("questionColumn").hidden = answerOnly;
  $("questionColumn").setAttribute("aria-hidden", String(answerOnly));
  $("shortcutHint").textContent = view.shortcut;
  const busy = view.question.busy || view.answer.busy;
  $("resultColumns").setAttribute("aria-busy", String(busy));
  $("runStatus").textContent = view.announcement;
  requestAnimationFrame(() => api.resizeMain(document.querySelector(".main-panel").scrollHeight));
}

const settingsButton = $("settingsButton");
function reportHitRegions() {
  const rect = (element) => { const bounds = element.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; };
  try { api.setHitRegions({ drag: rect($("dragRegion")), settings: rect(settingsButton), quit: rect($("quitButton")) }); }
  catch { api.clearHitRegions(); }
}
settingsButton.addEventListener("click", () => api.openSettings());
$("quitButton").addEventListener("click", () => api.quit());
window.addEventListener("error", () => api.clearHitRegions());
window.addEventListener("unhandledrejection", () => api.clearHitRegions());
document.addEventListener("visibilitychange", () => { if (document.hidden) api.clearHitRegions(); else reportHitRegions(); });
new ResizeObserver(reportHitRegions).observe(document.querySelector(".titlebar"));
requestAnimationFrame(reportHitRegions);
api.onState(setState);
