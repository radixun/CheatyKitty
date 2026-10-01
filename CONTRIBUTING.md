# Contributing to CheatyKitty

CheatyKitty welcomes focused improvements to its on-screen Codex bridge, accessibility, privacy, portability, and reliability. Do not add features framed around cheating, concealment, bypassing proctoring, or evading monitoring.

## Development setup

Use an Apple Silicon Mac with macOS 14+, Node.js 22.12 or newer, npm, and Xcode Command Line Tools.

```bash
npm ci
npm test
npm run typecheck
npm run verify:hygiene
npm run build
npm run smoke
```

Keep test questions synthetic. Do not commit real assessment content, screenshots, OCR output, prompts, answers, user settings, crash reports, credentials, or release evidence.

Application tests and smoke launches run locally on a supported Mac. Hosted CI performs static TypeScript and repository hygiene checks only.

## Pull requests

- Keep one coherent change per pull request.
- Add regression coverage for behavior changes.
- Preserve chosen model IDs, reasoning efforts, and FAST; do not add silent model fallback.
- Keep Codex execution shell-free, ephemeral, read-only, timeout-bound, and cleanup-safe.
- Update README or CHANGELOG when behavior, requirements, or limitations change.
- Run `npm run verify:hygiene` before opening the pull request.

Packaging changes also require an arm64 clean package, source/ASAR parity, packaged smoke, and an isolated fresh-machine simulation. Authenticated model, ScreenCaptureKit, Gatekeeper, global-shortcut, display, and VoiceOver checks are manual release gates and should not be represented as automated CI success.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
