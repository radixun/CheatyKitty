(function expose(root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.CheatyKittyShortcutRecorderPolicy = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function create() {
  function acceleratorFromEvent(event) {
    const modifiers = [];
    if (event.metaKey) modifiers.push("Command");
    if (event.ctrlKey) modifiers.push("Control");
    if (event.altKey) modifiers.push("Alt");
    if (event.shiftKey) modifiers.push("Shift");
    let key = "";
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
    else key = { Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" }[event.code] || "";
    return key ? [...modifiers, key].join("+") : "";
  }
  function isRecorderActive(state) { return ["arming", "recording", "validating"].includes(state); }
  function shouldConsumeKey(state, repeat, now, armedAt) { return isRecorderActive(state) && !repeat && state !== "validating" && now >= armedAt; }
  return { acceleratorFromEvent, isRecorderActive, shouldConsumeKey };
});
