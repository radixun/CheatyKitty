const { app, BrowserWindow, screen } = require("electron");
const { writeFile } = require("node:fs/promises");

app.whenReady().then(async () => {
  const bounds = screen.getPrimaryDisplay().bounds;
  const window = new BrowserWindow({ ...bounds, frame: false, show: false, resizable: false, skipTaskbar: true, webPreferences: { sandbox: true } });
  await window.loadURL(`data:text/html,${encodeURIComponent(`<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:repeating-linear-gradient(135deg,#173b62 0 19px,#d47b32 19px 38px,#4e9a68 38px 57px,#6d3b82 57px 76px)}body:after{content:'CONTROLLED SCREEN PIXELS';position:absolute;right:24px;top:24px;padding:18px;background:#f4e8c1;color:#101010;font:700 22px monospace;border:7px solid #101010}</style>`)}`);
  window.show();
  window.focus();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await writeFile(process.env.CHEATYKITTY_PROOF_BACKGROUND_READY, JSON.stringify({ pid: process.pid, bounds }));
});
