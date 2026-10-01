# Changelog

CheatyKitty follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Clip animated progress to its own column while a previous answer remains visible.
- Render overlay opacity on a transparent surface, avoiding native window-opacity artifacts.
- Load model and reasoning suggestions from Codex CLI; allow manual IDs and new effort levels.
- Add an independent FAST switch and pass the selected configuration to both answer and connection-test requests.
- Route catalog-discovered text-only models through local OCR.

## [1.0.0] - 2026-10-01

First source release for Apple Silicon Macs running macOS 14 or newer.

- Desktop overlay with Question + Answer and Answer-only layouts, configurable opacity, and click-through outside its controls.
- Manual global shortcut and non-overlapping Auto capture at intervals of 3–15 seconds.
- Native ScreenCaptureKit capture and local Apple Vision OCR.
- Exact Codex CLI model selection with medium reasoning, diagnostic checks, and no silent model fallback.
- Temporary capture data, bounded process diagnostics, and authentication owned by Codex CLI.
- Reproducible macOS builds, automated tests, repository hygiene, packaging verification tools, and synthetic documentation media.

This release distributes source code only. Locally built installers are unsigned and not notarized. Real capture permissions, authenticated model answers, global shortcuts, multi-display behavior, VoiceOver, Gatekeeper, and packaged-app acceptance require separate manual validation.
