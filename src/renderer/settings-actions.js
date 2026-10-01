(function expose(root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.CheatyKittySettingsActions = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function create() {
  async function persistSettings(api, settings) {
    try {
      const saved = await api.saveSettings(settings);
      return { ok: true, message: "", settings: saved };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `Could not save settings. ${detail}` };
    }
  }
  return { persistSettings };
});
