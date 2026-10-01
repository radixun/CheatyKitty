const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");

app.whenReady().then(async () => {
  let window;
  try {
    const outputPath = process.argv[2];
    const variant = process.argv[3] === "numeric" ? "numeric" : "letter";
    if (!outputPath) throw new Error("Synthetic PNG output path is required");
    const question = variant === "numeric" ? "What is 3 + 4?" : "What is 2 + 2?";
    const options = variant === "numeric" ? "1. 6<br>2. 7<br>3. 8" : "A. 3<br>B. 4<br>C. 5";
    const html = `<!doctype html><html><body style="margin:0;background:white;color:black;font-family:Arial;padding:70px">
      <div style="font-size:42px">Authorized staging LMS QA test</div>
      <h1 style="font-size:54px;margin:55px 0">${question}</h1>
      <div style="font-size:44px;line-height:2">${options}</div>
    </body></html>`;
    window = new BrowserWindow({ width: 1200, height: 700, show: false, webPreferences: { offscreen: true } });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const image = await window.webContents.capturePage();
    if (image.isEmpty()) throw new Error("Synthetic QA image could not be rendered");
    await writeFile(outputPath, image.toPNG(), { mode: 0o600 });
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    app.exit(1);
  }
});
