# Youdao Regression Sample

This skill includes a small smoke sample to keep the exporter stable while the formatting heuristics evolve.

## Sample coverage

- Title-like paragraph becomes a Markdown heading
- Inline bold survives XML parsing
- Nested list levels keep indentation
- Image blocks produce downloadable asset placeholders
- Consecutive images stay separated cleanly

## Smoke check

Run the sample parser with:

```bash
node dist/youdao_export_smoke.js
```

Expected output characteristics:

- Contains `## AI行情遇到了一个尴尬期 20260308`
- Contains `- **第一段正**文`
- Contains `![]([[YOUDAO_ASSET_0]])`
- Contains `- **二级条目**`
- Contains two distinct image placeholders in the nested sample
