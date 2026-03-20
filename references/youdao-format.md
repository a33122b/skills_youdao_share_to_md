# Youdao Share Export Format

## Goal

Convert a `share.note.youdao.com` share page into a Markdown document that keeps the note's structure readable and keeps assets usable.

## Extraction priority

1. Embedded state in the page shell
2. JSON responses observed during navigation
3. Visible DOM content

Use the first source that provides a complete and internally consistent representation. If a higher-priority source is partial, merge missing pieces from the next source instead of replacing the whole document.

## Markdown mapping

- Headings -> `#`, `##`, `###`
- Paragraphs -> plain Markdown paragraphs
- Ordered and unordered lists -> `1.` / `-`
- Tasks -> `- [ ]` / `- [x]`
- Quotes -> `>`
- Code blocks -> fenced code blocks
- Tables -> Markdown tables when row/column structure is simple
- Images -> download locally and rewrite to relative paths
- Attachments -> link to the downloaded file when possible
- Unknown blocks -> keep as raw text or wrapped HTML to avoid data loss

## Asset rules

- Deduplicate by original URL.
- Prefer filenames derived from the source URL or visible label.
- Keep images and attachments in a sibling `assets/` directory next to the output Markdown file.
- If a download fails, preserve the original remote URL in the Markdown rather than dropping the reference.

## Common recovery paths

- No content found: retry with a longer wait or a logged-in storage state.
- Hidden or virtualized DOM: fall back to page-level text plus the best matching content root.
- Complex tables: preserve as HTML if a faithful Markdown table would lose structure.
- Unknown custom block: emit a raw HTML block or a quoted fallback with the original text.
