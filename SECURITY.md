# Security policy

## Supported versions

The latest 1.0.x source release and the latest revision on the default branch are supported.

## Reporting a vulnerability

Use the repository's private GitHub security-advisory reporting channel when it is enabled. Do not put credentials, private assessment content, screenshots, or exploit details in a regular issue.

Include the affected revision, macOS version and architecture, impact, reproduction steps using synthetic data, and any proposed mitigation. Maintainers will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

## Security boundaries

CheatyKitty delegates authentication and model access to the local Codex CLI. It must not request, copy, persist, or log API keys, cookies, or ChatGPT/Codex session material. Screen capture content is sensitive; reports and fixtures must use synthetic content.

The current build is unsigned and not notarized. Verify a release checksum before bypassing Gatekeeper. Content protection is best effort and is not a guarantee against third-party recording.
