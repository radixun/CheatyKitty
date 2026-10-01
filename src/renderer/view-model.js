(function expose(root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.CheatyKittyViewModel = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function create() {
  function column(status, text, busy, retained = false, progress = "") { return { status, text, busy, retained, progress }; }
  function compactMessage(value, maximumLength = 420) {
    const text = String(value || "Unknown error").replace(/\s+/g, " ").trim();
    if (text.length <= maximumLength) return text;
    const marker = " … [details omitted] … "; const available = maximumLength - marker.length;
    return `${text.slice(0, Math.ceil(available * .58))}${marker}${text.slice(-Math.floor(available * .42))}`;
  }
  function displayAnswer(answer) {
    const label = String(answer.label || "").trim(); const rawText = String(answer.text || "").trim();
    const duplicate = rawText.match(/^(.+?)\s+[—–-]\s+(.+)$/); const text = duplicate && duplicate[1].trim().toLocaleLowerCase() === duplicate[2].trim().toLocaleLowerCase() ? duplicate[1].trim() : rawText;
    return label && label.toLocaleLowerCase() !== text.toLocaleLowerCase() ? `${label} — ${text || "No answer returned."}` : (text || "No answer returned.");
  }
  function answerColumns(answer, questionStatus = "Recognized", answerStatus) {
    const selected = displayAnswer(answer);
    return {
      question: column(questionStatus, answer.questionText || "Question text was not returned.", false),
      answer: column(answerStatus !== undefined ? answerStatus : (answer.confidence == null ? "Selected" : `Selected · ${Math.round(answer.confidence * 100)}%`), selected || "No answer returned.", false)
    };
  }
  function toViewModel(state) {
    const model = state.model || "Default — 5.6 Luna · Medium"; const manual = state.mode !== "auto"; const shortcut = state.shortcut || "shortcut"; const interval = Number.isFinite(state.autoIntervalSeconds) ? state.autoIntervalSeconds : 5;
    const mode = manual ? "Manual" : state.autoActive ? "Auto · active" : "Auto · paused";
    const action = (manualAction, autoAction) => manual ? `${shortcut} · ${manualAction}` : `Auto · ${autoAction}`;
    const layout = state.resultLayout || "question-answer";
    if (state.kind === "capturing") {
      if (state.retainedAnswer) { const retained = answerColumns(state.retainedAnswer, "Recognizing new…", "Previous answer"); retained.question.busy = true; retained.question.progress = "Capturing new question…"; retained.question.retained = true; retained.answer.retained = true; if (layout === "answer-only") { retained.answer.status = ""; retained.answer.busy = true; retained.answer.progress = "Solving new answer…"; } return { model, ...retained, layout, mode, shortcut: action("cancel", "capture in progress"), announcement: "Capturing screen for a new answer." }; }
      return { model, question: column("Capturing screen…", "Preparing the new capture…", true, false, "Capturing new question…"), answer: column(layout === "answer-only" ? "" : "Waiting", "Solving starts after capture completes.", layout === "answer-only", false, layout === "answer-only" ? "Solving new answer…" : "Capturing new question…"), layout, mode, shortcut: action("cancel", "capture in progress"), announcement: "Capturing screen for a new answer." };
    }
    if (state.kind === "thinking") {
      if (state.retainedAnswer) { const retained = answerColumns(state.retainedAnswer, "Recognizing new…", layout === "answer-only" ? "" : "Solving new…"); retained.question.busy = true; retained.question.progress = "Recognizing new question…"; retained.answer.busy = true; retained.answer.progress = "Solving new answer…"; retained.question.retained = true; retained.answer.retained = true; return { model, ...retained, layout, mode, shortcut: action("cancel", "capture in progress"), announcement: "Recognizing the question and solving a new answer." }; }
      return { model, question: column("Recognizing question…", "Reading the new capture…", true, false, "Recognizing new question…"), answer: column(layout === "answer-only" ? "" : "Solving…", "Selecting the best visible answer…", true, false, "Solving new answer…"), layout, mode, shortcut: action("cancel", "capture in progress"), announcement: "Recognizing the question and solving a new answer." };
    }
    if (state.kind === "answer") return { model, ...answerColumns(state.answer), layout, mode, shortcut: action("capture again", `next capture in ${interval} s`), announcement: `New answer selected: ${compactMessage(`${state.answer.label || ""}${state.answer.label && state.answer.text ? ", " : ""}${state.answer.text || ""}`, 180)}` };
    if (state.retainedAnswer && (state.kind === "cancelled" || state.kind === "error" || state.kind === "ready")) {
      const retained = answerColumns(state.retainedAnswer, state.kind === "error" ? "Previous · new run failed" : state.kind === "cancelled" ? "Previous · new run cancelled" : "Recognized", state.kind === "error" && layout === "answer-only" ? `New run failed · ${compactMessage(state.message, 150)}` : "Previous answer");
      retained.question.retained = true; retained.answer.retained = true;
      return { model, ...retained, layout, mode, shortcut: state.kind === "error" ? action("retry", "paused after error") : state.kind === "cancelled" ? action("retry", state.autoActive ? `next capture in ${interval} s` : "paused") : action("capture", state.autoActive ? `next capture in ${interval} s` : "paused"), announcement: state.kind === "error" ? `New run failed. ${compactMessage(state.message, 180)}` : state.kind === "cancelled" ? "New run cancelled. Previous answer kept." : "Ready." };
    }
    if (state.kind === "cancelled") return { model, question: column("Cancelled", "Capture cancelled.", false), answer: column("Cancelled", "No answer requested.", false), layout, mode, shortcut: action("retry", state.autoActive ? `next capture in ${interval} s` : "paused"), announcement: "Capture cancelled." };
    if (state.kind === "error") return { model, question: column("Error", compactMessage(state.message), false), answer: column("Error", layout === "answer-only" ? compactMessage(state.message) : "Could not solve this capture.", false), layout, mode, shortcut: action("retry", "paused after error"), announcement: `Capture failed. ${compactMessage(state.message, 180)}` };
    return { model, question: column("Ready", state.detail || (manual ? `Press ${shortcut} to capture.` : `Auto capture runs every ${interval} seconds.`), false), answer: column("Waiting", "The selected answer will appear here.", false), layout, mode, shortcut: action("capture", state.autoActive ? `next capture in ${interval} s` : "paused"), announcement: "Ready." };
  }
  return { toViewModel, compactMessage, displayAnswer };
});
