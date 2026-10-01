const FORBIDDEN_KEY_TOKENS = new Set(["text", "question", "answer", "prompt", "completion", "line", "lines", "option", "options", "screenshot"]);

function keyTokens(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function assertPrivacySafeObject(value, forbiddenRawValues = [], location = "$") {
  if (typeof value === "string") {
    if (value.length > 256) throw new Error(`${location}: persisted string exceeds 256 characters`);
    if (/^data:image\//i.test(value) || /^[A-Za-z0-9+/]{1024,}={0,2}$/.test(value)) throw new Error(`${location}: possible persisted image bytes`);
    for (const raw of forbiddenRawValues.filter((item) => typeof item === "string" && item.length >= 8)) {
      if (value.includes(raw)) throw new Error(`${location}: persisted raw runtime content`);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPrivacySafeObject(item, forbiddenRawValues, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const tokens = keyTokens(key);
    const boundedMetadata = /(?:Count|Sha256|Index|Ordinal)$/u.test(key);
    const forbidden = boundedMetadata ? undefined : tokens.find((token) => FORBIDDEN_KEY_TOKENS.has(token));
    if (forbidden) throw new Error(`${location}.${key}: forbidden persisted content key token '${forbidden}'`);
    assertPrivacySafeObject(child, forbiddenRawValues, `${location}.${key}`);
  }
}
