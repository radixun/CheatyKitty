const { app, BrowserWindow, screen } = require("electron");
const { writeFile } = require("node:fs/promises");

app.whenReady().then(async () => {
  const readyPath = process.env.CHEATYKITTY_RUNTIME_BACKGROUND_READY;
  const requestedVariant = process.argv[2] || "letter";
  const variant = ["numeric", "singleline", "it-output", "it-promises", "it-snapshot", "it-rust", "it-typescript", "it-sql", "it-network"].includes(requestedVariant) ? requestedVariant : "letter";
  if (!readyPath) throw new Error("CHEATYKITTY_RUNTIME_BACKGROUND_READY is required");
  const bounds = screen.getPrimaryDisplay().bounds;
  const question = variant === "numeric" ? "What is 3 + 4?" : "What is 2 + 2?";
  const options = variant === "numeric" ? ["1. 6", "2. 7", "3. 8"] : ["A. 3", "B. 4", "C. 5"];
  const complex = {
    "it-output": {
      question: "What does this JavaScript print: const x = []; x.push(x); console.log(JSON.stringify(x));",
      options: ["It prints an empty array.", "It prints a nested array containing null.", "It throws a TypeError because the value contains a circular reference.", "It prints the string undefined."]
    },
    "it-promises": {
      question: "Which statement about Promise.all is guaranteed when input promises fulfill at different times?",
      options: ["Each callback runs on a dedicated operating-system thread.", "Fulfillment values are emitted immediately in settlement order.", "The resulting array preserves the iterable's input order regardless of fulfillment order.", "Rejections are ignored when a later promise fulfills."]
    },
    "it-snapshot": {
      question: "Which anomaly can still occur under snapshot isolation without serializable conflict checks?",
      options: ["Dirty reads of uncommitted rows.", "Write skew between transactions that update different rows after reading the same invariant.", "Reading two versions inside one transaction snapshot.", "A committed row becoming uncommitted."]
    },
    "it-rust": {
      question: "Why can holding std::sync::MutexGuard across .await make a Rust async future non-Send?",
      options: ["The executor always converts mutexes into channels.", "The compiler moves protected data into static storage.", "Await automatically clones the mutex guard.", "The guard remains live across a suspension point and may not implement Send."]
    },
    "it-typescript": {
      question: "When TypeScript checks a call to an overloaded function, which signatures are callable by consumers?",
      options: ["Only the implementation signature.", "Only the first declared overload.", "The compatible overload signatures; the implementation signature is not directly callable.", "Every union of parameter types synthesized at the call site."]
    },
    "it-sql": {
      question: "A PostgreSQL query filters WHERE lower(email) = 'admin@example.com'. Which index can directly support that predicate?",
      options: ["A regular B-tree index on email alone always supports it without an expression match.", "A BRIN index on the physical row address.", "A partial index that omits the lower(email) expression.", "An expression index on lower(email)."]
    },
    "it-network": {
      question: "A TCP receiver advertises a zero window while the sender still has queued data. What mechanism prevents a lost window update from stalling the connection forever?",
      options: ["The persist timer sends window probes.", "The TIME_WAIT timer retransmits application data.", "Path MTU discovery doubles the receive window.", "SYN cookies reopen the established connection."]
    }
  }[variant];
  const content = variant === "singleline"
    ? `<h1 style="font-size:54px;margin:180px 0">What is 2 + 2? A. 3 B. 4 C. 5</h1>`
    : complex
      ? `<header style="position:fixed;z-index:5;inset:0 0 auto;height:74px;background:#172033;color:white;display:flex;align-items:center;padding:0 30px;gap:30px;box-shadow:0 2px 14px #0004">
          <strong style="font-size:24px">DevSkills Academy</strong><span>Courses</span><span>Playground</span><span>Team analytics</span><span style="margin-left:auto">3 unread</span><span style="background:#52627c;padding:10px 14px;border-radius:50%">QA</span>
        </header>
        <aside style="position:fixed;z-index:2;left:0;top:74px;bottom:0;width:220px;background:#eef1f6;padding:30px 22px;color:#3d4658;box-sizing:border-box">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px">Advanced track</div><h3>Backend systems</h3><p>Module 7 of 12</p><hr><p>✓ Runtime basics</p><p>✓ Data structures</p><p style="font-weight:bold;color:#315cb5">● Applied reasoning</p><p>○ Architecture</p><div style="position:absolute;bottom:28px;font-size:14px">Build 2026.07<br>Region eu-2</div>
        </aside>
        <aside style="position:fixed;z-index:2;right:18px;top:96px;width:238px;background:white;border:1px solid #d7dce5;border-radius:12px;padding:18px;box-shadow:0 8px 28px #25324a26;box-sizing:border-box">
          <b>Assessment status</b><p style="font-size:28px;margin:16px 0">18:42</p><div style="height:8px;background:#e7eaf0;border-radius:9px"><div style="width:58%;height:100%;background:#4b73d1;border-radius:9px"></div></div><p>Question 14 of 24</p><hr><small>Autosaved 11 seconds ago</small>
        </aside>
        <div style="position:fixed;right:22px;bottom:30px;z-index:4;width:230px;background:#2c3548;color:white;border-radius:10px;padding:14px 18px;box-shadow:0 8px 24px #0005"><b>CI notification</b><br><small>Pipeline #1842 passed · 6m 31s</small></div>
        <main style="position:relative;margin:0 270px 0 230px;padding:108px 28px 70px;min-height:100vh;box-sizing:border-box">
          <div style="display:flex;gap:10px;color:#657086;font-size:15px"><span style="border:1px solid #ccd2dc;border-radius:14px;padding:5px 10px">Programming</span><span style="border:1px solid #ccd2dc;border-radius:14px;padding:5px 10px">Single choice</span><span>Difficulty: expert</span></div>
          <p style="font-size:18px;color:#687286;margin:24px 0 8px">Select the best answer. Your progress is saved automatically.</p>
          <h1 style="font-size:38px;line-height:1.18;margin:12px 0 26px;max-width:1100px">${complex.question}</h1>
          <div style="display:grid;gap:14px;font-size:25px;line-height:1.23;max-width:1100px">${complex.options.map((option) => `<div style="padding:14px 18px;background:#fff;border:2px solid #c6ccd7;border-radius:10px;box-shadow:0 2px 5px #26324710">${option}</div>`).join("")}</div>
          <p style="margin-top:25px;color:#778196">Keyboard hint: choose one option, then press Continue.</p>
          <div aria-hidden="true" style="position:absolute;z-index:-1;right:10%;top:40%;font-size:110px;font-weight:bold;color:#2f5aa70b;transform:rotate(-18deg)">STAGING</div>
        </main>`
      : `<p style="font-size:34px">Authorized staging LMS QA test</p><h1 style="font-size:64px;margin:70px 0">${question}</h1><div style="font-size:54px;line-height:1.8">${options.join("<br>")}</div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8f9fb;color:#111;font-family:Arial;${complex ? "" : "padding:120px"}">
    ${content}
  </body></html>`;
  const window = new BrowserWindow({ ...bounds, frame: false, show: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, webPreferences: { sandbox: true } });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setAlwaysOnTop(true, "screen-saver");
  window.show();
  window.focus();
  window.moveTop();
  await new Promise((resolve) => setTimeout(resolve, 800));
  await writeFile(readyPath, JSON.stringify({ pid: process.pid, bounds, variant, question, options }));
});
