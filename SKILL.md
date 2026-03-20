---
name: youdao-share-to-md
description: Auto-export full share.note.youdao.com links to Markdown, with assets saved next to the output.
---

# Youdao Share to Markdown

Use this skill when the user pastes a full `https://share.note.youdao.com/` link.

Export to Markdown. Default output goes to `~/Downloads/youdao`. Default names: `index.md`, `index.html`, `index.assets.json`. Use `--output-dir` for a folder or `--output` for an exact file path. Assets live next to the Markdown file and are reused when possible.
After success, write `whiteboard-input.json` with `youdao`, resource path, and static web path, then auto-run `scripts/auto_deploy_youdao.sh`.
Final replies should use a fixed summary format: `摘要`, `Web`, `文档`, `资源`, `白板`, `部署`, `本地访问`, `公网访问`, `状态`.
`部署` should report success or failure. `本地访问` and `公网访问` should be included when deployment succeeds.
Prefer Chinese; keep code, paths, URLs, product names, and untranslated terms in English.
Keep this skill terse; use scripts when possible.
