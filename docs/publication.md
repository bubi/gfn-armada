# Preparing a public research repository

Suggested GitHub description:

> AI-generated, unmaintained PoC: original GeForce NOW web client on ArmadaOS ARM64, experimental Qualcomm Iris decoding and Steam integration.

Publish source, attribution, patches and sanitized evidence. Label any eventual binary release **experimental**: current AppImage has container validation and a limited Odin KDE/Wayland gameplay test, not full Gaming Mode acceptance. Source is published at [bubi/gfn-armada](https://github.com/bubi/gfn-armada); no binary release has been uploaded.

Before publication:

- Choose the original-code license; none selected yet. Third-party licenses remain applicable.
- Review redistribution obligations: Electron notices, embedded AppImage runtime, Iris modified-source/license delivery. [Provenance](../THIRD_PARTY_NOTICES.md) separates incorporated and researched code.
- Review/commit pending native bridge changes separately; match release evidence to an exact source commit. Current worktree has changes beyond the last built AppImage.
- Keep `.artifacts/`, `node_modules/`, `dist/` and raw logs out of source commits. Exclude SSH keys, known_hosts, Chromium profiles, cookies, tokens, personal library exports, Steam userdata and raw account responses. `.gitignore` does not remove existing history.
- Inspect intended Git history and release contents for credentials/personal data before pushing, including Git author metadata. This preparation is not a complete history/security/license audit.
- Keep AI-generated/unmaintained status visible in README and releases; no implied upstream endorsement or ongoing support.

Research fixtures prove limited experiments, not production readiness or security certification. Local upstream reports are drafts unless marked submitted with a public link.
