const { app, BrowserWindow, nativeImage } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.whenReady().then(async () => {
  let window;
  try {
    const preview = ["settings", "ready", "result", "busy", "demo-capturing", "demo-thinking", "demo-result", "answer-only", "answer-only-busy", "answer-only-thinking", "answer-only-error"].includes(process.argv[2]) ? process.argv[2] : "busy";
    const isSettings = preview === "settings";
    window = new BrowserWindow({ width: isSettings ? 520 : 640, height: isSettings ? 860 : 320, show: false, backgroundColor: "#101010", webPreferences: { offscreen: true, preload: path.join(__dirname, "preview-preload.cjs"), contextIsolation: true, additionalArguments: [`--cheatykitty-preview=${preview}`] } });
    const target = new URL(`file://${path.resolve(`dist/renderer/${isSettings ? "settings.html" : "index.html"}`)}`);
    target.searchParams.set("preview", preview);
    await window.loadURL(target.href);
    if (isSettings) await window.webContents.executeJavaScript("document.getElementById('closeSettings').focus(); document.getElementById('closeSettings').classList.add('focus-preview')");
    await window.webContents.executeJavaScript(`new Promise((resolve) => {
      window.scrollTo(0, 0);
      void document.body.offsetHeight;
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
        window.scrollTo(0, 0);
        void document.body.offsetHeight;
        resolve();
      }, 600)));
    })`);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 800);
      window.webContents.once("paint", () => { clearTimeout(timer); resolve(); });
      if (typeof window.webContents.invalidate === "function") window.webContents.invalidate();
    });
    const [targetWidth, targetHeight] = window.getSize();
    window.setSize(targetWidth + 1, targetHeight + 1, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.setSize(targetWidth, targetHeight, false);
    await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 600))))");
    const answerOnly = preview.startsWith("answer-only");
    const mainProgressIds = preview === "demo-capturing" ? ["questionProgress"] : ["busy", "demo-thinking"].includes(preview) ? ["questionProgress", "answerProgress"] : [];
    const requiredIds = isSettings ? ["closeSettings", "shortcutRecorder", "autoInterval", "autoIntervalValue", "saveButton"] : answerOnly ? ["brandLabel", "settingsButton", "quitButton", "answerLabel", ...(["answer-only-busy", "answer-only-thinking"].includes(preview) ? ["answerProgress"] : []), "shortcutHint"] : ["brandLabel", "settingsButton", "quitButton", "questionLabel", "answerLabel", ...mainProgressIds, "shortcutHint"];
    const geometry = await window.webContents.executeJavaScript(`(() => {
      window.scrollTo(0, 0);
      const ids = ${JSON.stringify(requiredIds)};
      const elements = Object.fromEntries(ids.map((id) => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return [id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }];
      }));
      const close = document.getElementById("closeSettings");
      const focusStyle = close ? { activeId: document.activeElement?.id, outlineStyle: getComputedStyle(close).outlineStyle, boxShadow: getComputedStyle(close).boxShadow } : null;
      const accessibility = Object.fromEntries(ids.map((id) => [id, { ariaLabel: document.getElementById(id).getAttribute("aria-label"), tagName: document.getElementById(id).tagName }]));
      return { scrollX, scrollY, innerWidth, innerHeight, readyState: document.readyState, elements, focusStyle, accessibility };
    })()`);
    const outside = Object.entries(geometry.elements).filter(([, rect]) => rect.x < 0 || rect.y < 0 || rect.right > geometry.innerWidth || rect.bottom > geometry.innerHeight);
    if (geometry.scrollY !== 0 || geometry.scrollX !== 0 || outside.length) {
      throw new Error(`Invalid ${preview} capture geometry: ${JSON.stringify({ geometry, outside })}`);
    }
    if (!isSettings && (geometry.elements.settingsButton.width !== 44 || geometry.elements.settingsButton.height !== 44)) {
      throw new Error(`Settings hotspot is not 44x44: ${JSON.stringify(geometry.elements.settingsButton)}`);
    }
    if (!isSettings && (geometry.elements.quitButton.width !== 44 || geometry.elements.quitButton.height !== 44)) throw new Error(`Quit hotspot is not 44x44: ${JSON.stringify(geometry.elements.quitButton)}`);
    if (!isSettings && geometry.accessibility.quitButton.ariaLabel !== "Quit CheatyKitty") throw new Error(`Quit is missing its accessible name: ${JSON.stringify(geometry.accessibility.quitButton)}`);
    if (isSettings) {
      const settingsControls = await window.webContents.executeJavaScript(`(() => {
        const group = document.getElementById('modelSelector');
        const groupLabel = document.getElementById(group.getAttribute('aria-labelledby'));
        const models = [...group.querySelectorAll('input[name="modelMode"]')].map((input) => ({ value: input.value, checked: input.checked, accessibleName: input.getAttribute('aria-label'), label: input.closest('label').innerText.replace(/\\s+/g, ' ').trim() }));
        const interval = document.getElementById('autoInterval');
        return { group: { tagName: group.tagName, role: group.getAttribute('role'), labelledBy: group.getAttribute('aria-labelledby'), accessibleName: groupLabel.textContent.trim() }, models, interval: { value: interval.value, min: interval.min, max: interval.max, step: interval.step, disabled: interval.disabled, ariaDisabled: document.getElementById('autoIntervalField').getAttribute('aria-disabled'), readout: document.getElementById('autoIntervalValue').textContent.trim() } };
      })()`);
      const expectedModels = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.3-codex-spark"];
      const expectedNames = ["Default — 5.6 Luna · Medium", "5.6 Sol · Medium", "5.3 Codex Spark · Medium"];
      if (settingsControls.group.tagName !== "FIELDSET" || settingsControls.group.role !== "radiogroup" || settingsControls.group.labelledBy !== "modelSelectorLegend" || settingsControls.group.accessibleName !== "Choose one model and reasoning profile" || JSON.stringify(settingsControls.models.map((option) => option.value)) !== JSON.stringify(expectedModels) || JSON.stringify(settingsControls.models.map((option) => option.accessibleName)) !== JSON.stringify(expectedNames) || settingsControls.models.filter((option) => option.checked).length !== 1) {
        throw new Error(`Settings model selector accessibility contract is invalid: ${JSON.stringify(settingsControls)}`);
      }
      const interval = settingsControls.interval;
      if (interval.value !== "7" || interval.min !== "3" || interval.max !== "15" || interval.step !== "1" || interval.disabled || interval.ariaDisabled !== "false" || interval.readout !== "7 s") {
        throw new Error(`Settings Auto interval semantics are invalid: ${JSON.stringify(interval)}`);
      }
      geometry.settingsControls = settingsControls;
    }
    if (answerOnly) {
      const hiddenQuestion = await window.webContents.executeJavaScript(`(() => { const element = document.getElementById("questionColumn"); const progress = document.getElementById("answerProgress"); return { hidden: element.hidden, ariaHidden: element.getAttribute("aria-hidden"), answerWidth: document.getElementById("answerColumn").getBoundingClientRect().width, progressVisible: !progress.classList.contains("hidden") }; })()`);
      if (!hiddenQuestion.hidden || hiddenQuestion.ariaHidden !== "true" || hiddenQuestion.answerWidth < geometry.innerWidth - 4) throw new Error(`Answer-only did not remove Question from layout/a11y or fill width: ${JSON.stringify(hiddenQuestion)}`);
      if (["answer-only-busy", "answer-only-thinking"].includes(preview)) {
        const phrase = "Solving new answer…";
        const phaseStatus = await window.webContents.executeJavaScript(`(() => {
          const candidates = [...document.querySelectorAll('#questionStatus, #answerStatus, #questionProgressText, #answerProgressText, #runStatus')];
          const visible = candidates.filter((element) => {
            const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); const text = element.textContent.trim();
            const clipped = style.clipPath !== 'none' || (style.clip && style.clip !== 'auto');
            return text && element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && !element.closest('[hidden]') && !clipped && rect.width > 1 && rect.height > 1;
          }).map((element) => ({ id: element.id, text: element.textContent.trim() }));
          return { expected: ${JSON.stringify("Solving new answer…")}, visible };
        })()`);
        if (!hiddenQuestion.progressVisible || JSON.stringify(phaseStatus.visible) !== JSON.stringify([{ id: "answerProgressText", text: phrase }])) throw new Error(`Answer-only busy phase must have exactly one visible status/progress node: ${JSON.stringify({ hiddenQuestion, phaseStatus })}`);
        geometry.answerOnlyPhaseStatus = phaseStatus;
      }
      if (preview === "answer-only-error") {
        const errorText = await window.webContents.executeJavaScript(`document.getElementById('answerText').textContent.trim()`);
        if (!errorText.includes("Spark needs readable local OCR") || errorText.includes("Could not solve this capture")) throw new Error(`Answer-only hid the actionable root cause: ${errorText}`);
        geometry.answerOnlyErrorText = errorText;
      }
    }
    if (["busy", "answer-only-busy", "answer-only-thinking"].includes(preview)) {
      const retainedStyles = await window.webContents.executeJavaScript(`(() => {
        const ids = ${JSON.stringify(preview === "busy" ? [["questionProgress", "questionText"], ["answerProgress", "answerText"]] : [["answerProgress", "answerText"]])};
        return ids.map(([progressId, textId]) => {
          const progress = document.getElementById(progressId); const text = document.getElementById(textId);
          const progressRect = progress.getBoundingClientRect(); const textRect = text.getBoundingClientRect();
          const progressStyle = getComputedStyle(progress); const textStyle = getComputedStyle(text);
          const intersects = !(progressRect.right <= textRect.left || progressRect.left >= textRect.right || progressRect.bottom <= textRect.top || progressRect.top >= textRect.bottom);
          return { progressId, textId, intersects, progressRect: { top: progressRect.top, bottom: progressRect.bottom }, textRect: { top: textRect.top, bottom: textRect.bottom }, progress: { backgroundColor: progressStyle.backgroundColor, backdropFilter: progressStyle.backdropFilter, filter: progressStyle.filter, opacity: progressStyle.opacity, pointerEvents: progressStyle.pointerEvents }, text: { filter: textStyle.filter, opacity: textStyle.opacity } };
        });
      })()`);
      const invalidRetained = retainedStyles.filter((item) => item.intersects || item.text.filter !== "none" || item.text.opacity !== "1" || item.progress.filter !== "none" || item.progress.opacity !== "1" || item.progress.pointerEvents !== "none" || !["none", ""].includes(item.progress.backdropFilter) || !["rgba(0, 0, 0, 0)", "transparent"].includes(item.progress.backgroundColor));
      if (invalidRetained.length) throw new Error(`Retained result is blurred/dimmed/covered for ${preview}: ${JSON.stringify({ retainedStyles, invalidRetained })}`);
      geometry.retainedStyles = retainedStyles;
    }
    if (isSettings && (geometry.focusStyle.activeId !== "closeSettings" || geometry.focusStyle.outlineStyle !== "none" || !geometry.focusStyle.boxShadow.includes("inset"))) throw new Error(`Settings focus-visible is not inset/design-safe: ${JSON.stringify(geometry.focusStyle)}`);
    const screenshot = await window.webContents.capturePage();
    const png = screenshot.toPNG();
    const frozenScreenshot = nativeImage.createFromBuffer(png);
    const imageSize = frozenScreenshot.getSize();
    const scaleX = imageSize.width / geometry.innerWidth;
    const scaleY = imageSize.height / geometry.innerHeight;
    const pixelEvidence = Object.fromEntries(Object.entries(geometry.elements).map(([id, rect]) => {
      const crop = frozenScreenshot.crop({ x: Math.floor(rect.x * scaleX), y: Math.floor(rect.y * scaleY), width: Math.max(1, Math.ceil(rect.width * scaleX)), height: Math.max(1, Math.ceil(rect.height * scaleY)) });
      const bitmap = crop.toBitmap();
      let lightPixels = 0;
      for (let offset = 0; offset < bitmap.length; offset += 4) {
        if (bitmap[offset] > 95 || bitmap[offset + 1] > 95 || bitmap[offset + 2] > 95) lightPixels += 1;
      }
      return [id, { lightPixels, width: crop.getSize().width, height: crop.getSize().height }];
    }));
    const unpainted = Object.entries(pixelEvidence).filter(([, evidence]) => evidence.lightPixels < 8);
    if (unpainted.length) throw new Error(`Required UI was not fully painted for ${preview}: ${JSON.stringify({ pixelEvidence, unpainted })}`);
    const output = path.resolve(`artifacts/cheatykitty-${preview}.png`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, png);
    const geometryOutput = path.resolve(`artifacts/cheatykitty-${preview}.geometry.json`);
    await writeFile(geometryOutput, `${JSON.stringify({ ...geometry, pixelEvidence }, null, 2)}\n`);
    console.log(`${output}\n${geometryOutput}\ngeometry: scroll=0; required elements inside ${geometry.innerWidth}x${geometry.innerHeight} and visibly painted`);
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    app.exit(1);
  }
});
