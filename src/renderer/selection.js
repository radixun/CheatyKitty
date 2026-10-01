const api = window.cheatykitty;
const image = document.getElementById("capture");
const selection = document.getElementById("selection");
let start = null;

api.onSelectionImage(({ dataUrl }) => { image.src = dataUrl; });
document.addEventListener("mousedown", (event) => {
  start = { x: event.clientX, y: event.clientY };
  selection.style.display = "block";
});
document.addEventListener("mousemove", (event) => {
  if (!start) return;
  const x = Math.min(start.x, event.clientX);
  const y = Math.min(start.y, event.clientY);
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${Math.abs(event.clientX - start.x)}px`;
  selection.style.height = `${Math.abs(event.clientY - start.y)}px`;
});
document.addEventListener("mouseup", (event) => {
  if (!start) return;
  const rect = { x: Math.min(start.x, event.clientX), y: Math.min(start.y, event.clientY), width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) };
  start = null;
  api.selectArea(rect);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") api.cancelSelection(); });
