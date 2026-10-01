const MODIFIERS = new Map([
  ["commandorcontrol", "CommandOrControl"], ["cmdorctrl", "CommandOrControl"],
  ["command", "Command"], ["cmd", "Command"], ["control", "Control"], ["ctrl", "Control"],
  ["option", "Alt"], ["alt", "Alt"], ["shift", "Shift"], ["super", "Super"]
]);
const KEYS = new Map([
  ["space", "Space"], ["enter", "Enter"], ["return", "Enter"], ["tab", "Tab"],
  ["backspace", "Backspace"], ["delete", "Delete"], ["insert", "Insert"],
  ["home", "Home"], ["end", "End"], ["pageup", "PageUp"], ["pagedown", "PageDown"],
  ["up", "Up"], ["down", "Down"], ["left", "Left"], ["right", "Right"]
]);

export type HotkeyValidation = { ok: true; accelerator: string } | { ok: false; message: string };

export function validateHotkey(value: unknown): HotkeyValidation {
  if (typeof value !== "string" || !value.trim()) return { ok: false, message: "Record a shortcut first." };
  const tokens = value.split("+").map((token) => token.trim()).filter(Boolean);
  const modifiers: string[] = [];
  let key = "";
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const modifier = MODIFIERS.get(lower);
    if (modifier) { if (!modifiers.includes(modifier)) modifiers.push(modifier); continue; }
    if (key) return { ok: false, message: "Use exactly one non-modifier key." };
    if (/^[a-z0-9]$/i.test(token)) key = token.toUpperCase();
    else if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(token)) key = token.toUpperCase();
    else key = KEYS.get(lower) ?? "";
    if (!key) return { ok: false, message: `Unsupported shortcut key: ${token}.` };
  }
  if (!key) return { ok: false, message: "Add a non-modifier key." };
  if (modifiers.length === 0) return { ok: false, message: "Add Command, Control, Option, or Shift." };
  if (key === "Tab" && modifiers.length === 1 && modifiers[0] === "Shift") return { ok: false, message: "Shift+Tab is reserved for keyboard navigation." };
  const order = ["CommandOrControl", "Command", "Control", "Alt", "Shift", "Super"];
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const accelerator = [...modifiers, key].join("+");
  const macModifiers = modifiers.map((modifier) => modifier === "CommandOrControl" ? "Command" : modifier);
  const reserved = new Set([
    "Command+Space", "Command+Tab", "Command+Q", "Command+H", "Command+M", "Command+W",
    "Command+Alt+Escape", "Command+Control+Q"
  ]);
  if (reserved.has([...macModifiers, key].join("+"))) return { ok: false, message: `${shortcutLabel(accelerator)} is reserved by macOS or application navigation. Choose another shortcut.` };
  return { ok: true, accelerator };
}

export function shortcutLabel(accelerator: string): string {
  const labels: Record<string, string> = { CommandOrControl: "⌘", Command: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧", Space: "Space", Enter: "↩", Up: "↑", Down: "↓", Left: "←", Right: "→" };
  return accelerator.split("+").map((token) => labels[token] ?? token).join("");
}

export interface ShortcutRegistry { register(accelerator: string, callback: () => void): boolean; unregister(accelerator: string): void; }
export type ShortcutRollback = { ok: true } | { ok: false; message: string };

export function stageShortcutRegistration(
  registry: ShortcutRegistry,
  previous: { mode: "manual" | "auto"; accelerator: string; registered: boolean },
  next: { mode: "manual" | "auto"; accelerator: string },
  callback: () => void
): { activate(): void; rollback(): ShortcutRollback } {
  const needsCandidate = next.mode === "manual" && (!previous.registered || next.accelerator !== previous.accelerator);
  if (needsCandidate && !registry.register(next.accelerator, callback)) throw new Error(`Could not register ${shortcutLabel(next.accelerator)}. Another app may already use it.`);
  let previousRemoved = false;
  return {
    activate() {
      if (previous.registered && (next.mode !== "manual" || next.accelerator !== previous.accelerator)) {
        registry.unregister(previous.accelerator);
        previousRemoved = true;
      }
    },
    rollback() {
      try {
        if (needsCandidate) registry.unregister(next.accelerator);
        if (previousRemoved && !registry.register(previous.accelerator, callback)) {
          return { ok: false, message: `Settings were not saved, and ${shortcutLabel(previous.accelerator)} could not be restored. The saved shortcut is inactive; use Retry.` };
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, message: `Settings were not saved, and ${shortcutLabel(previous.accelerator)} could not be restored: ${error instanceof Error ? error.message : String(error)}. The saved shortcut is inactive; use Retry.` };
      }
    }
  };
}

export async function transactShortcutRegistration<T>(
  registry: ShortcutRegistry,
  previous: { mode: "manual" | "auto"; accelerator: string; registered: boolean },
  next: { mode: "manual" | "auto"; accelerator: string },
  callback: () => void,
  persist: () => Promise<T>
): Promise<{ ok: true; saved: T } | { ok: false; error: unknown; rollback: ShortcutRollback }> {
  const staged = stageShortcutRegistration(registry, previous, next, callback);
  staged.activate();
  try {
    return { ok: true, saved: await persist() };
  } catch (error) {
    return { ok: false, error, rollback: staged.rollback() };
  }
}
