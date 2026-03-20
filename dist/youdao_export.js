#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const PLACEHOLDER_PREFIX = "[[YOUDAO_ASSET_";
const PLACEHOLDER_SUFFIX = "]]";
const DEFAULT_TIMEOUT_MS = 45e3;
const DEFAULT_BUNDLE_BASENAME = "index";
const AUTO_DEPLOY_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "auto_deploy_youdao.sh"
);
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = /* @__PURE__ */ new Date();
  const bundlePaths = resolveExportBundlePaths(options, options.url);
  await fs.mkdir(bundlePaths.rootDir, { recursive: true });
  await fs.mkdir(bundlePaths.assetsDir, { recursive: true });
  let status = "FAILED";
  let summary = "";
  let markdownBody = "";
  let outputMarkdown = "";
  let errorMessage;
  let deployment = null;
  try {
    let extraction = await extractYoudaoApiDocument(options.url, options.timeoutMs, options.userAgent);
    if (!extraction) {
      extraction = await extractYoudaoBrowserDocument(options);
    }
    if (!extraction) {
      throw new Error(
        "Could not export this note. The API path and browser fallback both failed."
      );
    }
    const assetMap = await downloadAssets(
      extraction.assets,
      bundlePaths.assetsDir,
      bundlePaths.rootDir,
      options.timeoutMs
    );
    const markdown = rewriteAssetPlaceholders(extraction.markdown, extraction.assets, assetMap);
    outputMarkdown = buildMarkdownDocument(extraction.title, options.url, markdown, extraction.notes);
    summary = buildDocumentSummary(extraction.title, markdown);
    markdownBody = markdown;
    status = "SUCCESS";
    const endedAt = /* @__PURE__ */ new Date();
    const meta = {
      title: extraction.title,
      sourceUrl: extraction.sourceUrl,
      status,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      summary,
      markdownBody,
      markdownPath: bundlePaths.markdownPath,
      htmlPath: bundlePaths.htmlPath,
      assetsDir: bundlePaths.assetsDir
    };
    await writeExportBundle(bundlePaths, extraction.assets, assetMap, outputMarkdown, meta);
    await writeWhiteboardHandoff(bundlePaths, meta);
    deployment = await deployStaticSite(bundlePaths);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    const endedAt = /* @__PURE__ */ new Date();
    status = "FAILED";
    summary = truncateText(`\u5BFC\u51FA\u5931\u8D25\uFF1A${errorMessage}`, 80);
    markdownBody = buildFailureMarkdown(options.url, errorMessage);
    outputMarkdown = markdownBody;
    const meta = {
      title: "Youdao Note",
      sourceUrl: options.url,
      status,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      summary,
      markdownBody,
      markdownPath: bundlePaths.markdownPath,
      htmlPath: bundlePaths.htmlPath,
      assetsDir: bundlePaths.assetsDir,
      errorMessage
    };
    await writeExportBundle(bundlePaths, [], /* @__PURE__ */ new Map(), outputMarkdown, meta);
  } finally {
  }
  process.stdout.write(
    [
      `\u6458\u8981: ${summary}`,
      `Web: [${path.basename(bundlePaths.htmlPath)}](${bundlePaths.htmlPath})`,
      `\u6587\u6863: [${path.basename(bundlePaths.markdownPath)}](${bundlePaths.markdownPath})`,
      `\u8D44\u6E90: [${path.basename(bundlePaths.assetsDir)}](${bundlePaths.assetsDir})`,
      `\u767D\u677F: [whiteboard-input.json](${path.join(bundlePaths.rootDir, "whiteboard-input.json")})`,
      deployment ? `\u90E8\u7F72: \u6210\u529F` : status === "SUCCESS" ? "\u90E8\u7F72: \u5931\u8D25" : "\u90E8\u7F72: \u8DF3\u8FC7",
      deployment ? `\u672C\u5730\u8BBF\u95EE: ${deployment.localUrl}` : void 0,
      deployment ? `\u516C\u7F51\u8BBF\u95EE: ${deployment.publicUrl}` : void 0,
      `\u72B6\u6001: ${status === "SUCCESS" ? "\u6210\u529F" : "\u5931\u8D25"}`,
      ""
    ].filter((line) => Boolean(line)).join("\n")
  );
}
function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    printUsageAndExit();
  }
  const positionals = [];
  const flags = /* @__PURE__ */ new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const [flag, inlineValue] = value.split("=", 2);
    if (inlineValue !== void 0) {
      flags.set(flag, inlineValue);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(flag, next);
      i += 1;
    } else {
      flags.set(flag, true);
    }
  }
  const url = positionals[0];
  if (!url) {
    printUsageAndExit();
  }
  const parsedUrl = validateShareUrl(url);
  return {
    url: parsedUrl.toString(),
    output: getStringFlag(flags, "--output"),
    outputDir: getStringFlag(flags, "--output-dir"),
    assetsDir: getStringFlag(flags, "--assets-dir"),
    storageState: getStringFlag(flags, "--storage-state"),
    timeoutMs: getNumberFlag(flags, "--timeout", DEFAULT_TIMEOUT_MS),
    headless: getBooleanFlag(flags, "--headless", true),
    includeAttachments: getBooleanFlag(flags, "--include-attachments", true),
    userAgent: getStringFlag(flags, "--user-agent"),
    viewportWidth: getNumberFlag(flags, "--viewport-width", 1440),
    viewportHeight: getNumberFlag(flags, "--viewport-height", 2200)
  };
}
function printUsageAndExit() {
  process.stderr.write(
    [
      "Usage:",
      "  youdao_export.js <url> [--output out.md] [--output-dir Downloads/]",
      "                    [--assets-dir assets/] [--timeout 45000]",
      '                    [--include-attachments true|false] [--user-agent "..."]',
      "",
      "Example:",
      '  node dist/youdao_export.js "https://share.note.youdao.com/..." --output note.md',
      ""
    ].join("\n")
  );
  process.exit(1);
}
function validateShareUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Only http/https URLs are supported: ${raw}`);
  }
  const host = url.hostname.toLowerCase();
  if (host !== "share.note.youdao.com" && !host.endsWith(".share.note.youdao.com")) {
    throw new Error(`Expected a share.note.youdao.com URL, got: ${raw}`);
  }
  return url;
}
function getStringFlag(flags, name) {
  const value = flags.get(name);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return void 0;
}
function getBooleanFlag(flags, name, defaultValue) {
  const value = flags.get(name);
  if (value === void 0) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return !["false", "0", "no", "off"].includes(value.toLowerCase());
}
function getNumberFlag(flags, name, defaultValue) {
  const raw = getStringFlag(flags, name);
  if (!raw) {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric value for ${name}: ${raw}`);
  }
  return value;
}
function resolveExportBundlePaths(options, rawUrl) {
  const bundleName = buildBundleName(rawUrl);
  if (options.output) {
    const markdownPath = path.resolve(options.output);
    const rootDir2 = path.dirname(markdownPath);
    const markdownBaseName = path.basename(markdownPath, path.extname(markdownPath)) || bundleName;
    return {
      rootDir: rootDir2,
      markdownPath,
      htmlPath: path.join(rootDir2, `${markdownBaseName}.html`),
      assetsDir: options.assetsDir ? path.resolve(options.assetsDir) : path.join(rootDir2, "assets"),
      assetsJsonPath: path.join(rootDir2, `${markdownBaseName}.assets.json`),
      bundleName: markdownBaseName
    };
  }
  const rootBaseDir = options.outputDir ? path.resolve(options.outputDir) : resolveDownloadsDir();
  const rootDir = path.join(rootBaseDir, bundleName);
  return {
    rootDir,
    markdownPath: path.join(rootDir, `${DEFAULT_BUNDLE_BASENAME}.md`),
    htmlPath: path.join(rootDir, `${DEFAULT_BUNDLE_BASENAME}.html`),
    assetsDir: options.assetsDir ? path.resolve(options.assetsDir) : path.join(rootDir, "assets"),
    assetsJsonPath: path.join(rootDir, `${DEFAULT_BUNDLE_BASENAME}.assets.json`),
    bundleName
  };
}
function buildBundleName(rawUrl) {
  const url = new URL(rawUrl);
  const shareKey = url.searchParams.get("id");
  if (shareKey) {
    return sanitizeFilename(shareKey);
  }
  const guessedName = sanitizeFilename(path.basename(url.pathname).replace(/\.html?$/i, "") || url.hostname);
  return guessedName;
}
function resolveDownloadsDir() {
  return path.join(os.homedir(), "Downloads", "youdao");
}
async function settlePage(page, timeoutMs) {
  try {
    await page.waitForLoadState("networkidle", { timeout: timeoutMs });
  } catch {
  }
  try {
    await page.waitForTimeout(1200);
  } catch {
  }
}
async function extractYoudaoApiDocument(sourceUrl, timeoutMs, userAgent) {
  const parsed = new URL(sourceUrl);
  const shareKey = parsed.searchParams.get("id");
  if (!shareKey) {
    return null;
  }
  const unloginId = `codex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const metaUrl = new URL(
    `/yws/api/personal/share?method=get&shareKey=${encodeURIComponent(shareKey)}&unloginId=${encodeURIComponent(unloginId)}`,
    parsed.origin
  ).toString();
  const headers = {};
  if (userAgent) {
    headers["user-agent"] = userAgent;
  }
  const metaText = await fetchTextWithFallback(metaUrl, timeoutMs, headers);
  if (!metaText) {
    return null;
  }
  const meta = JSON.parse(metaText);
  const titleFromMeta = readString(meta, "fileMeta.title") || readString(meta, "entry.name") || readString(meta, "name") || parsed.searchParams.get("title") || "Youdao Note";
  const contentUrl = new URL(
    `/yws/api/note/${encodeURIComponent(shareKey)}?sev=j1&editorType=1&unloginId=${encodeURIComponent(unloginId)}`,
    parsed.origin
  ).toString();
  const contentText = await fetchTextWithFallback(contentUrl, timeoutMs, headers);
  if (!contentText) {
    return null;
  }
  const payload = JSON.parse(contentText);
  const xml = typeof payload.content === "string" ? payload.content : "";
  if (!xml.trim()) {
    return null;
  }
  const parsedDoc = parseYoudaoXmlNote(xml);
  if (!parsedDoc.markdown.trim()) {
    return null;
  }
  return {
    title: titleFromMeta,
    markdown: parsedDoc.markdown,
    assets: parsedDoc.assets,
    notes: parsedDoc.notes,
    sourceUrl
  };
}
async function extractYoudaoBrowserDocument(options) {
  let browser;
  let context;
  try {
    const playwright = await import("playwright");
    const chromium = playwright.chromium;
    browser = await chromium.launch({
      headless: options.headless
    });
    context = await browser.newContext({
      viewport: {
        width: options.viewportWidth,
        height: options.viewportHeight
      },
      userAgent: options.userAgent,
      storageState: options.storageState
    });
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await settlePage(page, options.timeoutMs);
    const extraction = await extractDocument(page, {
      sourceUrl: options.url,
      includeAttachments: options.includeAttachments,
      networkArtifacts: []
    });
    if (extraction.markdown.trim()) {
      return extraction;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (context) {
      await context.close().catch(() => {
      });
    }
    if (browser) {
      await browser.close().catch(() => {
      });
    }
  }
}
function parseYoudaoXmlNote(xml) {
  const notes = [];
  const assets = [];
  const assetByUrl = /* @__PURE__ */ new Map();
  const bodyMatch = xml.match(/<body>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) {
    return { markdown: "", assets, notes: ["Could not find <body> in Youdao XML content."] };
  }
  const body = bodyMatch[1];
  const blockPattern = /<(para|list-item|image)(\b[^>]*)?>([\s\S]*?)<\/\1>/gi;
  const blocks = [];
  let match;
  let firstMeaningfulBlockSeen = false;
  while (match = blockPattern.exec(body)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const inner = match[3] || "";
    if (tag === "para") {
      const paraText = extractXmlText(inner);
      const rendered = renderXmlParagraph(paraText, inner, !firstMeaningfulBlockSeen);
      if (normalizeXmlText(paraText).length === 0) {
        blocks.push({ kind: "text", text: "" });
      } else {
        blocks.push({ kind: "text", text: rendered });
        firstMeaningfulBlockSeen = true;
      }
      continue;
    }
    if (tag === "list-item") {
      const levelMatch = attrs.match(/\blevel="(\d+)"/i);
      const level = levelMatch ? Number(levelMatch[1]) : 1;
      const itemText = extractXmlText(inner);
      const rendered = applyInlineBold(itemText, inner);
      const indent = "  ".repeat(Math.max(0, level - 1));
      blocks.push({ kind: "list", text: `${indent}- ${rendered}` });
      firstMeaningfulBlockSeen = true;
      continue;
    }
    if (tag === "image") {
      const source = extractTagValue(inner, "source");
      if (!source) {
        continue;
      }
      const placeholder = registerXmlAsset(assetByUrl, assets, source, "image", `image-${assets.length + 1}`);
      blocks.push({ kind: "image", text: `![](${placeholder})` });
      firstMeaningfulBlockSeen = true;
    }
  }
  const markdown = joinXmlBlocks(blocks);
  if (!markdown) {
    notes.push("Parsed Youdao XML body but did not find renderable blocks.");
  }
  return { markdown, assets, notes };
}
function joinXmlBlocks(blocks) {
  const lines = [];
  let previousKind = null;
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) {
      continue;
    }
    const needsBlankLine = lines.length > 0 && (previousKind === "list" && block.kind !== "list" || previousKind !== "list" && block.kind === "list" || block.kind === "image" || previousKind === "image");
    if (needsBlankLine && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(text);
    previousKind = block.kind;
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function renderXmlParagraph(text, block, allowHeading) {
  const rendered = applyInlineBold(text, block);
  if (!allowHeading) {
    return rendered;
  }
  const normalized = normalizeXmlText(text);
  if (!normalized || normalized.length > 80) {
    return rendered;
  }
  const fontSize = getXmlFontSize(block);
  const hasBold = /<bold>[\s\S]*?<value>true<\/value>[\s\S]*?<\/bold>/i.test(block);
  const titleLike = fontSize >= 16 || hasBold;
  if (!titleLike) {
    return rendered;
  }
  const withSpacing = insertDateSpacing(normalized);
  return `## ${withSpacing}`;
}
function insertDateSpacing(value) {
  return value.replace(/([^\d\s])(\d{8})$/, "$1 $2");
}
function getXmlFontSize(block) {
  const sizeMatch = block.match(/<font-size>[\s\S]*?<value>(\d+)<\/value>[\s\S]*?<\/font-size>/i);
  if (!sizeMatch) {
    return 0;
  }
  const value = Number(sizeMatch[1]);
  return Number.isFinite(value) ? value : 0;
}
function registerXmlAsset(assetByUrl, assets, url, kind, suggestedName, alt) {
  const normalized = url.trim();
  const existing = assetByUrl.get(normalized);
  if (existing) {
    return existing.placeholder;
  }
  const placeholder = `${PLACEHOLDER_PREFIX}${assets.length}${PLACEHOLDER_SUFFIX}`;
  const asset = {
    placeholder,
    url: normalized,
    kind,
    suggestedName,
    alt
  };
  assets.push(asset);
  assetByUrl.set(normalized, asset);
  return placeholder;
}
function extractXmlText(block) {
  const value = extractTagValue(block, "text");
  return decodeXmlEntities(value).replace(/\u00a0/g, " ");
}
function extractTagValue(source, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? match[1] : "";
}
function decodeXmlEntities(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function normalizeXmlText(value) {
  return decodeXmlEntities(value).replace(/\u00a0/g, " ").trim();
}
function applyInlineBold(text, block) {
  const ranges = [];
  const boldPattern = /<bold>\s*<from>(\d+)<\/from>\s*<to>(\d+)<\/to>\s*<value>true<\/value>\s*<\/bold>/gi;
  let match;
  while (match = boldPattern.exec(block)) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      ranges.push({ from, to });
    }
  }
  const normalized = decodeXmlEntities(text).replace(/\u00a0/g, " ");
  if (!ranges.length || !normalized.length) {
    return normalized.trim();
  }
  const flags = new Array(normalized.length).fill(false);
  for (const range of ranges) {
    const start = Math.max(0, Math.min(normalized.length, range.from));
    const end = Math.max(start, Math.min(normalized.length, range.to));
    for (let i = start; i < end; i += 1) {
      flags[i] = true;
    }
  }
  let output = "";
  let bold = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const next = flags[i];
    if (next !== bold) {
      output += "**";
      bold = next;
    }
    output += normalized[i];
  }
  if (bold) {
    output += "**";
  }
  return output.trim();
}
function readString(source, pathSpec) {
  const parts = pathSpec.split(".");
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return "";
    }
    current = current[part];
  }
  return typeof current === "string" ? current : "";
}
async function extractDocument(page, options) {
  return page.evaluate(
    ({ sourceUrl, includeAttachments, networkArtifacts, placeholderPrefix, placeholderSuffix }) => {
      const assets = [];
      const assetByUrl = /* @__PURE__ */ new Map();
      const notes = [];
      const blockTags = /* @__PURE__ */ new Set([
        "ADDRESS",
        "ARTICLE",
        "ASIDE",
        "BLOCKQUOTE",
        "DIV",
        "DL",
        "DT",
        "DD",
        "FIGCAPTION",
        "FIGURE",
        "FOOTER",
        "FORM",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "HEADER",
        "HR",
        "LI",
        "MAIN",
        "NAV",
        "OL",
        "P",
        "PRE",
        "SECTION",
        "TABLE",
        "TBODY",
        "TD",
        "TH",
        "THEAD",
        "TR",
        "UL"
      ]);
      const attachmentExtensions = /* @__PURE__ */ new Set([
        "pdf",
        "doc",
        "docx",
        "ppt",
        "pptx",
        "xls",
        "xlsx",
        "txt",
        "md",
        "csv",
        "zip",
        "rar",
        "7z",
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "mp4",
        "mov",
        "m4v",
        "webm",
        "mp3",
        "wav"
      ]);
      function normalizeText2(value) {
        return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      }
      function escapeInlineText2(value) {
        return value.replace(/\\/g, "\\\\").replace(/([\\`*_{}\[\]()#+\-.!>])/g, "\\$1");
      }
      function isVisibleElement(element) {
        const style = window.getComputedStyle(element);
        if (!style || style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        if (style.opacity === "0") {
          return false;
        }
        return true;
      }
      function isProbablyContentNode(element) {
        const textLength = normalizeText2(element.textContent || "").length;
        const headings = element.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
        const listItems = element.querySelectorAll("li").length;
        const images = element.querySelectorAll("img").length;
        return textLength > 80 || headings > 0 || listItems > 2 || images > 0;
      }
      function pickRoot() {
        const selectors = [
          "article",
          "main",
          '[role="main"]',
          ".note-content",
          ".note-view",
          ".content",
          ".editor-content",
          ".web-editor",
          ".preview",
          "#app"
        ];
        const candidates = [];
        for (const selector of selectors) {
          candidates.push(...Array.from(document.querySelectorAll(selector)));
        }
        let best = document.body;
        let bestScore = -1;
        for (const candidate of candidates) {
          if (!isVisibleElement(candidate)) {
            continue;
          }
          const textLength = normalizeText2(candidate.textContent || "").length;
          const headingScore = candidate.querySelectorAll("h1, h2, h3, h4, h5, h6").length * 200;
          const listScore = candidate.querySelectorAll("li").length * 12;
          const imageScore = candidate.querySelectorAll("img").length * 40;
          const paragraphScore = candidate.querySelectorAll("p").length * 8;
          const score = textLength + headingScore + listScore + imageScore + paragraphScore;
          if (score > bestScore && isProbablyContentNode(candidate)) {
            bestScore = score;
            best = candidate;
          }
        }
        return best;
      }
      function isAttachmentHref(href, el) {
        if (!includeAttachments) {
          return false;
        }
        if (!href) {
          return false;
        }
        if (el.hasAttribute("download") || el.getAttribute("data-download") === "true") {
          return true;
        }
        try {
          const url = new URL(href, document.baseURI);
          const ext = url.pathname.split(".").pop()?.toLowerCase() || "";
          return attachmentExtensions.has(ext);
        } catch {
          return false;
        }
      }
      function absolutizeUrl(raw) {
        try {
          return new URL(raw, document.baseURI).toString();
        } catch {
          return raw;
        }
      }
      function safeName(value) {
        return normalizeText2(value).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "asset";
      }
      function collectEmbeddedState() {
        const candidates = [];
        const scripts = Array.from(document.querySelectorAll("script"));
        for (const script of scripts) {
          const rawText = (script.textContent || "").trim();
          if (!rawText) {
            continue;
          }
          const type = (script.getAttribute("type") || "").toLowerCase();
          const label = type || "script";
          if (type === "application/json" || /__NEXT_DATA__|__INITIAL_STATE__|__NUXT__|window\.__/i.test(rawText)) {
            candidates.push({ label, text: rawText });
          }
        }
        for (const script of scripts) {
          const rawText = (script.textContent || "").trim();
          if (!rawText) {
            continue;
          }
          if (/share\.note\.youdao\.com|note\.youdao\.com|content|blocks|markdown|article|note/i.test(rawText)) {
            candidates.push({ label: "heuristic-script", text: rawText });
          }
        }
        const unique = /* @__PURE__ */ new Map();
        for (const item of candidates) {
          const key = `${item.label}:${item.text.slice(0, 80)}`;
          if (!unique.has(key)) {
            unique.set(key, item);
          }
        }
        return Array.from(unique.values()).sort((a, b) => b.text.length - a.text.length);
      }
      function collectNetworkArtifacts() {
        return networkArtifacts.map((item) => ({
          label: "network-response",
          text: item.text.trim()
        })).filter((item) => item.text.length > 0).sort((a, b) => b.text.length - a.text.length);
      }
      function registerAsset(url, kind, suggestedName, alt) {
        const normalized = absolutizeUrl(url);
        const existing = assetByUrl.get(normalized);
        if (existing) {
          return existing.placeholder;
        }
        const placeholder = `${placeholderPrefix}${assets.length}${placeholderSuffix}`;
        const asset = {
          placeholder,
          url: normalized,
          kind,
          suggestedName: safeName(suggestedName || alt || `asset-${assets.length + 1}`),
          alt: alt || void 0
        };
        assets.push(asset);
        assetByUrl.set(normalized, asset);
        return placeholder;
      }
      function formatInlineChildren(node) {
        const parts = [];
        for (const child of Array.from(node.childNodes)) {
          const rendered = renderInline(child);
          if (rendered) {
            parts.push(rendered);
          }
        }
        return normalizeText2(parts.join(" "));
      }
      function formatBlockChildren(node) {
        const parts = [];
        for (const child of Array.from(node.childNodes)) {
          const rendered = renderBlock(child);
          if (rendered) {
            parts.push(rendered);
          }
        }
        return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      }
      function renderInline(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return escapeInlineText2(normalizeText2(node.textContent || ""));
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return "";
        }
        const el = node;
        if (!isVisibleElement(el)) {
          return "";
        }
        const tag = el.tagName;
        switch (tag) {
          case "BR":
            return "\n";
          case "STRONG":
          case "B": {
            const text = formatInlineChildren(el);
            return text ? `**${text}**` : "";
          }
          case "EM":
          case "I": {
            const text = formatInlineChildren(el);
            return text ? `*${text}*` : "";
          }
          case "CODE": {
            const text = normalizeText2(el.textContent || "");
            return text ? `\`${text.replace(/`/g, "\\`")}\`` : "";
          }
          case "A": {
            const href = el.getAttribute("href") || "";
            const text = formatInlineChildren(el) || normalizeText2(el.textContent || href);
            if (!href) {
              return text;
            }
            if (isAttachmentHref(href, el)) {
              const placeholder = registerAsset(href, "attachment", text || href, text || void 0);
              return `[${text || placeholder}](${placeholder})`;
            }
            return `[${text || href}](${absolutizeUrl(href)})`;
          }
          case "IMG": {
            const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
            if (!src) {
              return "";
            }
            const alt = el.getAttribute("alt") || el.getAttribute("title") || "";
            const placeholder = registerAsset(src, "image", alt || "image", alt || void 0);
            return `![${escapeInlineText2(normalizeText2(alt))}](${placeholder})`;
          }
          case "SPAN":
          case "SMALL":
          case "MARK":
          case "SUP":
          case "SUB":
          case "U":
            return formatInlineChildren(el);
          default:
            if (!blockTags.has(tag)) {
              return formatInlineChildren(el);
            }
            return formatBlockChildren(el);
        }
      }
      function prefixLines(text, prefix) {
        return text.split("\n").map((line) => line.trim().length ? `${prefix}${line}` : prefix.trimEnd()).join("\n");
      }
      function renderList(node, ordered, depth) {
        const items = Array.from(node.children).filter((child) => child.tagName === "LI");
        const rendered = items.map((item, index) => renderListItem(item, ordered, index, depth)).filter(Boolean).join("\n");
        return rendered ? `
${rendered}
` : "";
      }
      function renderListItem(item, ordered, index, depth) {
        const indent = "  ".repeat(depth);
        const marker = ordered ? `${index + 1}. ` : "- ";
        const directParts = [];
        const nestedLists = [];
        for (const child of Array.from(item.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child;
            if (el.tagName === "UL" || el.tagName === "OL") {
              nestedLists.push(renderList(el, el.tagName === "OL", depth + 1).trimEnd());
              continue;
            }
          }
          const rendered = renderBlock(child) || renderInline(child);
          if (rendered) {
            directParts.push(rendered);
          }
        }
        const body = directParts.join(" ").replace(/\n{3,}/g, "\n\n").trim();
        const lines = body ? body.split("\n") : [""];
        const firstLine = lines[0] || "";
        const rest = lines.slice(1);
        let output = `${indent}${marker}${firstLine}`.trimEnd();
        if (rest.length > 0) {
          output += "\n" + rest.map((line) => `${indent}  ${line}`).join("\n");
        }
        if (nestedLists.length > 0) {
          output += "\n" + nestedLists.join("\n");
        }
        return output;
      }
      function renderTable(node) {
        const rows = Array.from(node.querySelectorAll("tr"));
        if (!rows.length) {
          return "";
        }
        const matrix = rows.map(
          (row) => Array.from(row.querySelectorAll("th, td")).map((cell) => normalizeText2(formatInlineChildren(cell) || cell.textContent || ""))
        );
        if (!matrix.length || !matrix[0].length) {
          return "";
        }
        const header = matrix[0];
        const body = matrix.slice(1);
        const separator = header.map(() => "---");
        const lines = [
          `| ${header.join(" | ")} |`,
          `| ${separator.join(" | ")} |`,
          ...body.map((row) => `| ${row.join(" | ")} |`)
        ];
        return `
${lines.join("\n")}
`;
      }
      function renderPre(node) {
        const code = node.querySelector("code");
        const raw = (code ? code.textContent : node.textContent) || "";
        const text = raw.replace(/^\n+/, "").replace(/\n+$/, "");
        const fence = text.includes("```") ? "~~~~" : "```";
        return `
${fence}
${text}
${fence}
`;
      }
      function renderBlock(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = normalizeText2(node.textContent || "");
          return text ? escapeInlineText2(text) : "";
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return "";
        }
        const el = node;
        if (!isVisibleElement(el)) {
          return "";
        }
        const tag = el.tagName;
        switch (tag) {
          case "SCRIPT":
          case "STYLE":
          case "NOSCRIPT":
          case "SVG":
            return "";
          case "BR":
            return "\n";
          case "H1":
          case "H2":
          case "H3":
          case "H4":
          case "H5":
          case "H6": {
            const level = Number(tag.slice(1));
            const text = formatInlineChildren(el);
            return text ? `
${"#".repeat(level)} ${text}
` : "";
          }
          case "P": {
            const text = formatInlineChildren(el);
            return text ? `
${text}
` : "";
          }
          case "HR":
            return "\n---\n";
          case "BLOCKQUOTE": {
            const text = formatBlockChildren(el);
            return text ? `
${prefixLines(text, "> ")}
` : "";
          }
          case "UL":
            return renderList(el, false, 0);
          case "OL":
            return renderList(el, true, 0);
          case "LI":
            return renderListItem(el, false, 1, 0);
          case "PRE":
            return renderPre(el);
          case "TABLE":
            return renderTable(el);
          case "FIGURE": {
            const figureContent = formatBlockChildren(el);
            return figureContent ? `
${figureContent}
` : "";
          }
          case "FIGCAPTION": {
            const text = formatInlineChildren(el);
            return text ? `
*${text}*
` : "";
          }
          case "IMG": {
            const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
            if (!src) {
              return "";
            }
            const alt = el.getAttribute("alt") || el.getAttribute("title") || "";
            const placeholder = registerAsset(src, "image", alt || "image", alt || void 0);
            return `
![${escapeInlineText2(normalizeText2(alt))}](${placeholder})
`;
          }
          case "A":
            return renderInline(el);
          default: {
            if (blockTags.has(tag)) {
              const text2 = formatBlockChildren(el);
              return text2 ? `
${text2}
` : "";
            }
            const text = formatInlineChildren(el);
            return text;
          }
        }
      }
      function compressWhitespace(value) {
        return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
      }
      const root = pickRoot();
      const rawMarkdown = renderBlock(root);
      const embeddedState = collectEmbeddedState();
      const networkState = collectNetworkArtifacts();
      const fallbackText = embeddedState[0]?.text || networkState[0]?.text || "";
      const markdown = compressWhitespace(rawMarkdown || (fallbackText ? `\`\`\`
${fallbackText}
\`\`\`` : ""));
      const title = normalizeText2(document.title || "") || normalizeText2(root.querySelector("h1")?.textContent || "") || "Youdao Note";
      if (!markdown) {
        notes.push("Primary DOM extraction produced an empty document; the page may require login or a different content root.");
      } else if (!rawMarkdown && (embeddedState.length > 0 || networkState.length > 0)) {
        notes.push("Fell back to embedded page state or network response because the visible DOM was empty.");
      }
      return {
        title,
        markdown,
        assets,
        notes,
        sourceUrl
      };
    },
    {
      sourceUrl: options.sourceUrl,
      includeAttachments: options.includeAttachments,
      networkArtifacts: options.networkArtifacts,
      placeholderPrefix: PLACEHOLDER_PREFIX,
      placeholderSuffix: PLACEHOLDER_SUFFIX
    }
  );
}
async function downloadAssets(assets, assetsDir, outputDir, timeoutMs) {
  const map = /* @__PURE__ */ new Map();
  const cacheDir = resolveGlobalAssetCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const cachePath = path.join(cacheDir, buildCacheFilename(asset.url, asset.kind));
    try {
      const cachedBuffer = await readFileIfExists(cachePath);
      if (cachedBuffer) {
        const ext2 = inferAssetExtension(asset, cachedBuffer);
        const localName2 = buildAssetFilename(asset, index, ext2);
        const localPath2 = path.join(assetsDir, localName2);
        const relativePath2 = path.relative(outputDir, localPath2).replace(/\\/g, "/");
        if (await fileExists(localPath2)) {
          map.set(asset.placeholder, relativePath2);
          continue;
        }
        await fs.writeFile(localPath2, cachedBuffer);
        map.set(asset.placeholder, relativePath2);
        continue;
      }
      const fetched = await fetchBinaryWithFallback(asset.url, timeoutMs, {
        referer: asset.url
      });
      if (!fetched) {
        map.set(asset.placeholder, asset.url);
        continue;
      }
      const { buffer, contentType } = fetched;
      const ext = inferAssetExtension(asset, buffer, contentType);
      const localName = buildAssetFilename(asset, index, ext);
      const localPath = path.join(assetsDir, localName);
      const relativePath = path.relative(outputDir, localPath).replace(/\\/g, "/");
      if (await fileExists(localPath)) {
        map.set(asset.placeholder, relativePath);
        continue;
      }
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, buffer);
      await fs.writeFile(localPath, buffer);
      map.set(asset.placeholder, relativePath);
    } catch {
      map.set(asset.placeholder, asset.url);
    }
  }
  return map;
}
async function fetchTextWithFallback(url, timeoutMs, headers = {}) {
  try {
    if (typeof fetch === "function") {
      const response = await fetch(url, {
        headers,
        signal: createAbortSignal(timeoutMs)
      });
      if (!response.ok) {
        return fetchTextWithCurl(url, timeoutMs, headers);
      }
      return await response.text();
    }
  } catch {
    return fetchTextWithCurl(url, timeoutMs, headers);
  }
  return fetchTextWithCurl(url, timeoutMs, headers);
}
async function fetchBinaryWithFallback(url, timeoutMs, headers = {}) {
  try {
    if (typeof fetch === "function") {
      const response = await fetch(url, {
        headers,
        signal: createAbortSignal(timeoutMs)
      });
      if (!response.ok) {
        return fetchBinaryWithCurl(url, timeoutMs, headers);
      }
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? ""
      };
    }
  } catch {
    return fetchBinaryWithCurl(url, timeoutMs, headers);
  }
  return fetchBinaryWithCurl(url, timeoutMs, headers);
}
async function fetchTextWithCurl(url, timeoutMs, headers = {}) {
  try {
    const { stdout } = await execFileAsync("/bin/zsh", ["-lc", buildCurlTextCommand(url, timeoutMs, headers)], {
      maxBuffer: 50 * 1024 * 1024
    });
    return typeof stdout === "string" ? stdout : Buffer.from(stdout).toString("utf8");
  } catch {
    return null;
  }
}
async function fetchBinaryWithCurl(url, timeoutMs, headers = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youdao-fetch-"));
  const bodyPath = path.join(tempDir, "body.bin");
  const headerPath = path.join(tempDir, "headers.txt");
  try {
    await execFileAsync("/bin/zsh", ["-lc", buildCurlBinaryCommand(url, timeoutMs, headers, bodyPath, headerPath)], {
      maxBuffer: 50 * 1024 * 1024
    });
    const buffer = await fs.readFile(bodyPath);
    const headersText = await fs.readFile(headerPath, "utf8").catch(() => "");
    const contentType = matchCurlHeader(headersText, "content-type") || "";
    return { buffer, contentType };
  } catch {
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
    });
  }
}
function buildCurlArgs(url, timeoutMs, headers) {
  const args = ["--location", "--max-time", String(Math.max(1, Math.ceil(timeoutMs / 1e3)))];
  for (const [name, value] of Object.entries(headers)) {
    if (value) {
      args.push("--header", `${name}: ${value}`);
    }
  }
  args.push(url);
  return args;
}
function buildCurlTextCommand(url, timeoutMs, headers) {
  return `curl ${buildCurlArgs(url, timeoutMs, headers).map(shellQuote).join(" ")} --silent --show-error`;
}
function buildCurlBinaryCommand(url, timeoutMs, headers, bodyPath, headerPath) {
  return `curl ${buildCurlArgs(url, timeoutMs, headers).map(shellQuote).join(" ")} --silent --show-error --fail --output ${shellQuote(bodyPath)} --dump-header ${shellQuote(headerPath)}`;
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function createAbortSignal(timeoutMs) {
  const abortSignal = AbortSignal;
  if (typeof abortSignal.timeout === "function") {
    return abortSignal.timeout(timeoutMs);
  }
  return void 0;
}
function matchCurlHeader(headersText, headerName) {
  const pattern = new RegExp(`^${headerName}\\s*:\\s*(.+)$`, "im");
  const match = headersText.match(pattern);
  return match ? match[1].trim() : "";
}
function buildAssetFilename(asset, index, extHint) {
  const parsed = safePathFromUrl(asset.url);
  const originalExt = extHint || parsed.ext || guessExtension(asset.url);
  const baseName = sanitizeFilename(asset.suggestedName || parsed.base || `asset-${index + 1}`);
  const ext = baseName.toLowerCase().endsWith(originalExt.toLowerCase()) ? "" : originalExt;
  return `${String(index + 1).padStart(3, "0")}-${baseName}${ext}`;
}
function buildCacheFilename(url, kind) {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  const ext = guessExtension(url) || (kind === "image" ? ".bin" : ".dat");
  return `${hash}${ext}`;
}
function resolveGlobalAssetCacheDir() {
  const base = process.env.CODEX_HOME ? process.env.CODEX_HOME : path.join(os.homedir(), ".codex");
  return path.join(base, "cache", "youdao-share-to-md");
}
async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
function safePathFromUrl(url) {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname);
    return {
      base: sanitizeFilename(base.replace(/\.[^.]+$/, "")),
      ext: path.extname(base)
    };
  } catch {
    return { base: "asset", ext: "" };
  }
}
function guessExtension(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname);
    return ext || "";
  } catch {
    return "";
  }
}
async function readFileIfExists(filePath) {
  try {
    const data = await fs.readFile(filePath);
    return data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
function inferAssetExtension(asset, buffer, contentType = "") {
  const fromContentType = extensionFromContentType(contentType);
  if (fromContentType) {
    return fromContentType;
  }
  const fromMagic = extensionFromMagicBytes(buffer);
  if (fromMagic) {
    return fromMagic;
  }
  const fromUrl = guessExtension(asset.url);
  if (fromUrl) {
    return fromUrl;
  }
  return asset.kind === "image" ? ".png" : "";
}
function extensionFromContentType(contentType) {
  const normalized = contentType.split(";", 1)[0].trim().toLowerCase();
  switch (normalized) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/bmp":
      return ".bmp";
    case "image/svg+xml":
      return ".svg";
    case "image/avif":
      return ".avif";
    case "application/pdf":
      return ".pdf";
    case "application/zip":
      return ".zip";
    default:
      return "";
  }
}
function extensionFromMagicBytes(buffer) {
  if (buffer.length >= 8) {
    const pngSig = buffer.subarray(0, 8);
    if (pngSig.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return ".png";
    }
  }
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return ".jpg";
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") {
      return ".gif";
    }
  }
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return ".webp";
    }
  }
  if (buffer.length >= 4) {
    const pdf = buffer.subarray(0, 4).toString("ascii");
    if (pdf === "%PDF") {
      return ".pdf";
    }
  }
  return "";
}
function sanitizeFilename(value) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "asset";
}
function rewriteAssetPlaceholders(markdown, assets, assetMap) {
  let output = markdown;
  for (const asset of assets) {
    const mappedPath = assetMap.get(asset.placeholder) ?? asset.url;
    output = rewriteSingleAssetPlaceholder(output, asset, mappedPath);
  }
  return output;
}
function rewriteSingleAssetPlaceholder(markdown, asset, mappedPath) {
  const visiblePath = asset.url;
  const localPath = mappedPath && mappedPath !== asset.url ? mappedPath : "";
  const altText = escapeInlineText(normalizeText(asset.alt || ""));
  const labelText = altText || escapeInlineText(normalizeText(asset.suggestedName || "asset"));
  const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(asset.placeholder)}\\)`, "g");
  const linkPattern = new RegExp(`\\[([^\\]]*)\\]\\(${escapeRegExp(asset.placeholder)}\\)`, "g");
  const render = (kind, label) => {
    if (kind === "image") {
      if (localPath) {
        return `![${label}](${localPath})
<!-- remote: ${visiblePath} -->`;
      }
      return `![${label}](${visiblePath})`;
    }
    if (localPath) {
      return `[${label}](${localPath})
<!-- remote: ${visiblePath} -->`;
    }
    return `[${label}](${visiblePath})`;
  };
  let output = markdown.replace(imagePattern, (_match, capturedLabel) => {
    return render("image", normalizeLabel(capturedLabel) || labelText);
  });
  output = output.replace(linkPattern, (_match, capturedLabel) => {
    return render("attachment", normalizeLabel(capturedLabel) || labelText);
  });
  if (output.includes(asset.placeholder)) {
    output = output.split(asset.placeholder).join(localPath || visiblePath);
  }
  return output;
}
function normalizeLabel(value) {
  return escapeInlineText(normalizeText(String(value || "")));
}
function toFileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}
function normalizeText(value) {
  return String(value).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function escapeInlineText(value) {
  return value.replace(/\\/g, "\\\\").replace(/([\\`*_{}\[\]()#+\-.!>])/g, "\\$1");
}
function buildDocumentSummary(title, markdown, maxLength = 80) {
  const lines = markdown.split(/\r?\n/);
  const fragments = [];
  for (const rawLine of lines) {
    const line = normalizeText(rawLine);
    if (!line) {
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      continue;
    }
    if (line.startsWith("<!--")) {
      continue;
    }
    if (line.startsWith("Source:")) {
      continue;
    }
    if (line.startsWith("## Extraction Notes")) {
      break;
    }
    for (const fragment of splitSummaryFragments(line)) {
      const cleaned = stripMarkdownForSummary(fragment);
      const normalizedFragment = normalizeText(cleaned);
      if (!normalizedFragment || fragments.includes(normalizedFragment)) {
        continue;
      }
      fragments.push(truncateText(normalizedFragment, 32));
      if (fragments.length >= 2) {
        break;
      }
    }
    if (fragments.length >= 2) {
      break;
    }
  }
  const summaryBody = fragments.join("\uFF1B ").replace(/\s+/g, " ").trim();
  if (!summaryBody) {
    return title || "Youdao Note";
  }
  const combined = summaryBody || truncateTitleForSummary(title);
  return truncateText(combined, maxLength);
}
function stripMarkdownForSummary(value) {
  return value.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`>#-]+/g, " ").replace(/\s+/g, " ").trim();
}
function splitSummaryFragments(value) {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    return [];
  }
  if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
    const content = trimmed.replace(/^([-*+]\s+|\d+\.\s+)/, "");
    const sentence = (content.match(/[^。！？!?；;]+[。！？!?；;]?/) ?? [content])[0].trim();
    return sentence ? [sentence] : [];
  }
  const sentences = trimmed.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [trimmed];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).slice(0, 2);
}
function truncateText(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}\u2026`;
}
function truncateTitleForSummary(title) {
  const cleaned = normalizeText(title).replace(/\d{6,}/g, "").replace(/[@#].*$/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return truncateText(cleaned || title, 24);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildMarkdownDocument(title, sourceUrl, body, notes) {
  const sections = [
    `# ${title || "\u6709\u9053\u7B14\u8BB0"}`,
    "",
    `\u6765\u6E90\u94FE\u63A5\uFF1A${sourceUrl}`,
    "",
    body.trim()
  ];
  if (notes.length > 0) {
    sections.push("", "## \u63D0\u53D6\u8BF4\u660E", ...notes.map((note) => `- ${note}`));
  }
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
function buildFailureMarkdown(sourceUrl, errorMessage) {
  const safeMessage = errorMessage || "Unknown error";
  return [
    "# \u6709\u9053\u7B14\u8BB0",
    "",
    `\u6765\u6E90\u94FE\u63A5\uFF1A${sourceUrl}`,
    "",
    "## \u5BFC\u51FA\u5931\u8D25",
    "",
    `> ${safeMessage}`,
    "",
    "## \u5185\u5BB9\u5360\u4F4D",
    "",
    "- \u672C\u6B21\u5BFC\u51FA\u672A\u6210\u529F\u5B8C\u6210\u3002",
    "- \u8BF7\u91CD\u8BD5\u5206\u4EAB\u94FE\u63A5\u6216\u68C0\u67E5\u7F51\u7EDC\u8BBF\u95EE\u3002"
  ].join("\n").trim() + "\n";
}
async function writeExportBundle(bundlePaths, assets, assetMap, markdownText, meta) {
  await fs.writeFile(bundlePaths.markdownPath, markdownText, "utf8");
  await fs.writeFile(
    bundlePaths.assetsJsonPath,
    JSON.stringify(
      {
        sourceUrl: meta.sourceUrl,
        assets: assets.map((asset) => ({
          ...asset,
          localPath: assetMap.get(asset.placeholder) ?? null
        }))
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(bundlePaths.htmlPath, buildStaticWebDocument(meta), "utf8");
}
async function writeWhiteboardHandoff(bundlePaths, meta) {
  const handoffPath = path.join(bundlePaths.rootDir, "whiteboard-input.json");
  const handoff = {
    skill: "whiteboard",
    platform: "youdao",
    resourcePath: bundlePaths.assetsDir,
    staticWebPath: bundlePaths.htmlPath,
    markdownPath: bundlePaths.markdownPath,
    sourceUrl: meta.sourceUrl
  };
  await fs.writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}
`, "utf8");
}
async function deployStaticSite(bundlePaths) {
  try {
    const { stdout } = await execFileAsync(
      "/bin/bash",
      [AUTO_DEPLOY_SCRIPT, bundlePaths.rootDir],
      {
        maxBuffer: 10 * 1024 * 1024
      }
    );
    const output = typeof stdout === "string" ? stdout : Buffer.from(stdout).toString("utf8");
    const localMatch = output.match(/本地访问:\s*(\S+)/);
    const publicMatch = output.match(/公网访问:\s*(\S+)/);
    if (!localMatch || !publicMatch) {
      return null;
    }
    return {
      localUrl: localMatch[1],
      publicUrl: publicMatch[1],
      urlPath: localMatch[1].replace(/^https?:\/\/127\.0\.0\.1:9001\//, "")
    };
  } catch {
    return null;
  }
}
function buildStaticWebDocument(meta) {
  const markdownHtml = renderMarkdownToHtml(meta.markdownBody);
  const title = escapeHtml(meta.title || "\u6709\u9053\u7B14\u8BB0");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --panel-soft: #f0f4ff;
      --text: #162033;
      --muted: #64748b;
      --border: rgba(22, 32, 51, 0.12);
      --shadow: 0 20px 50px rgba(15, 23, 42, 0.10);
      --success: #0f766e;
      --failed: #b42318;
      --accent: #2563eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.10), transparent 28%),
        radial-gradient(circle at top right, rgba(15, 118, 110, 0.10), transparent 22%),
        var(--bg);
      color: var(--text);
      overflow-x: hidden;
    }
    .page {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    body.preview-mobile .page {
      max-width: var(--preview-page-width, 430px);
      padding: 20px 12px 36px;
    }
    .hero {
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(15, 118, 110, 0.06));
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 24px;
      margin-bottom: 20px;
      backdrop-filter: blur(8px);
    }
    .hero h1 {
      margin: 0 0 10px;
      font-size: clamp(24px, 3vw, 36px);
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    body.preview-mobile .hero,
    body.preview-mobile .content-shell {
      border-radius: 18px;
      padding: 18px;
    }
    body.preview-mobile .content-shell {
      padding: 16px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .meta-card {
      background: rgba(255, 255, 255, 0.75);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px 16px;
      min-height: 92px;
    }
    .meta-label {
      color: var(--muted);
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .meta-value {
      font-weight: 600;
      line-height: 1.5;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 13px;
      background: rgba(37, 99, 235, 0.10);
      color: var(--accent);
      margin-bottom: 12px;
    }
    .badge.success { background: rgba(15, 118, 110, 0.12); color: var(--success); }
    .badge.failed { background: rgba(180, 35, 24, 0.10); color: var(--failed); }
    .summary {
      margin-top: 10px;
      color: var(--text);
      font-size: 15px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
    .content-shell {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 28px;
      overflow-x: auto;
    }
    .content-shell.failed {
      outline: 1px dashed rgba(180, 35, 24, 0.25);
    }
    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
      margin: 1.2em 0 0.6em;
      line-height: 1.3;
    }
    .content h1 { font-size: 30px; }
    .content h2 { font-size: 24px; }
    .content h3 { font-size: 20px; }
    .content p, .content li, .content blockquote, .content pre, .content table {
      font-size: 16px;
      line-height: 1.8;
    }
    .content {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .content a {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .content p { margin: 0 0 1em; }
    .content ul, .content ol { margin: 0.25em 0 1em 1.5em; padding: 0; }
    .content li { margin: 0.2em 0; }
    .content li.nested { margin-left: var(--indent, 0); }
    .content blockquote {
      margin: 1em 0;
      padding: 0.8em 1em;
      border-left: 4px solid rgba(37, 99, 235, 0.24);
      background: #f8fbff;
      border-radius: 0 12px 12px 0;
      color: #334155;
    }
    .content pre {
      overflow: auto;
      max-width: 100%;
      padding: 16px;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 14px;
    }
    .content code {
      padding: 0.15em 0.35em;
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.06);
      font-size: 0.95em;
    }
    .content pre code {
      background: transparent;
      padding: 0;
      color: inherit;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .content img {
      display: block;
      max-width: 100%;
      height: auto;
      border-radius: 14px;
      border: 1px solid rgba(15, 23, 42, 0.10);
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.10);
      margin: 0.5em 0;
    }
    .content table {
      display: block;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
      margin: 1em 0;
    }
    .content th, .content td {
      border: 1px solid rgba(22, 32, 51, 0.12);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
      white-space: normal;
    }
    .placeholder {
      border: 1px dashed rgba(180, 35, 24, 0.24);
      background: rgba(180, 35, 24, 0.04);
      border-radius: 18px;
      padding: 20px;
      color: var(--failed);
      margin-bottom: 16px;
    }
    .placeholder h2 { margin-top: 0; }
    .footer {
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .footer-top {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      margin-bottom: 12px;
    }
    .preview-toggle {
      display: none;
      flex-wrap: wrap;
      gap: 10px;
    }
    body.debug-preview .preview-toggle {
      display: inline-flex;
    }
    .preview-toggle button {
      appearance: none;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.74);
      color: var(--text);
      font: inherit;
      font-weight: 600;
      padding: 10px 14px;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .preview-toggle button:hover {
      transform: translateY(-1px);
      border-color: rgba(37, 99, 235, 0.35);
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
    }
    .preview-toggle button.active {
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(15, 118, 110, 0.12));
      border-color: rgba(37, 99, 235, 0.40);
    }
    .preview-hint {
      display: none;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.6;
      padding-top: 4px;
    }
    body.debug-preview .preview-hint {
      display: block;
    }
    .footer-links {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .footer-link {
      display: block;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.64);
      border: 1px solid rgba(22, 32, 51, 0.08);
    }
    .footer-link-label {
      color: var(--muted);
      display: block;
      margin-bottom: 4px;
    }
    .footer-link-path {
      display: inline-block;
    }
    .footer-link-path a {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    body.preview-mobile .content p,
    body.preview-mobile .content li,
    body.preview-mobile .content blockquote,
    body.preview-mobile .content pre,
    body.preview-mobile .content table {
      font-size: 15px;
      line-height: 1.75;
    }
    body.preview-mobile .content h1 { font-size: 26px; }
    body.preview-mobile .content h2 { font-size: 22px; }
    body.preview-mobile .content h3 { font-size: 18px; }
    body.preview-mobile .meta-card { min-height: auto; }
    body.preview-mobile .hero h1 {
      font-size: 26px;
    }
    @media (max-width: 640px) {
      .page { padding: 20px 12px 36px; }
      .hero, .content-shell { border-radius: 18px; padding: 18px; }
      .content-shell { padding: 16px; }
      .content p, .content li, .content blockquote, .content pre, .content table {
        font-size: 15px;
        line-height: 1.75;
      }
      .content h1 { font-size: 26px; }
      .content h2 { font-size: 22px; }
      .content h3 { font-size: 18px; }
      .meta-card { min-height: auto; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <h1>${title}</h1>
      <div class="summary">${escapeHtml(meta.summary)}</div>
      <div class="meta-grid">
        <div class="meta-card">
          <div class="meta-label">\u6267\u884C\u65F6\u95F4</div>
          <div class="meta-value">${escapeHtml(formatExecutionWindow(meta.startedAt, meta.endedAt))}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">\u8017\u65F6</div>
          <div class="meta-value">${escapeHtml(formatDuration(meta.durationMs))}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">\u72B6\u6001</div>
          <div class="meta-value">${escapeHtml(meta.status === "SUCCESS" ? "\u6210\u529F" : "\u5931\u8D25")}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">\u6765\u6E90\u94FE\u63A5</div>
          <div class="meta-value"><a href="${escapeHtmlAttr(meta.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(meta.sourceUrl)}</a></div>
        </div>
      </div>
    </section>

    <section class="content-shell ${meta.status === "FAILED" ? "failed" : ""}">
      ${meta.status === "FAILED" && meta.errorMessage ? `<div class="placeholder"><h2>\u5185\u5BB9\u5360\u4F4D</h2><p>${escapeHtml(meta.errorMessage)}</p><p>\u672C\u6B21\u5BFC\u51FA\u672A\u6210\u529F\u5B8C\u6210\u3002</p></div>` : ""}
      <div class="content">
        ${markdownHtml || '<div class="placeholder"><h2>\u5185\u5BB9\u5360\u4F4D</h2><p>\u672C\u6B21\u5BFC\u51FA\u6682\u65E0\u53EF\u5C55\u793A\u5185\u5BB9\u3002</p></div>'}
      </div>
    </section>

    <div class="footer">
      <div class="footer-top">
        <div class="preview-toggle" role="tablist" aria-label="\u9884\u89C8\u6A21\u5F0F\u5207\u6362">
          <button type="button" class="preview-btn" data-preview-mode="desktop">\u7535\u8111\u9884\u89C8</button>
          <button type="button" class="preview-btn" data-preview-mode="mobile-390">iPhone 14</button>
          <button type="button" class="preview-btn" data-preview-mode="mobile-375">iPhone 12</button>
          <button type="button" class="preview-btn" data-preview-mode="mobile-414">Android</button>
          <button type="button" class="preview-btn" data-preview-mode="tablet-820">iPad 10</button>
        </div>
        <div class="preview-hint">\u53EF\u5207\u6362\u9884\u89C8\u6A21\u5F0F\uFF0C\u4FBF\u4E8E\u68C0\u67E5\u4E0D\u540C\u8BBE\u5907\u6548\u679C</div>
      </div>
      <div class="footer-links">
        <div class="footer-link"><span class="footer-link-label">Markdown \u6587\u4EF6\uFF1A</span><span class="footer-link-path"><a href="${escapeHtmlAttr(toFileUrl(meta.markdownPath))}">${escapeHtml(meta.markdownPath)}</a></span></div>
        <div class="footer-link"><span class="footer-link-label">\u8D44\u6E90\u76EE\u5F55\uFF1A</span><span class="footer-link-path"><a href="${escapeHtmlAttr(toFileUrl(meta.assetsDir))}">${escapeHtml(meta.assetsDir)}</a></span></div>
        <div class="footer-link"><span class="footer-link-label">HTML \u6587\u4EF6\uFF1A</span><span class="footer-link-path"><a href="${escapeHtmlAttr(toFileUrl(meta.htmlPath))}">${escapeHtml(meta.htmlPath)}</a></span></div>
      </div>
    </div>
  </main>
  <script>
    (function () {
      var storageKey = 'youdao-preview-mode';
      var body = document.body;
      var buttons = Array.prototype.slice.call(document.querySelectorAll('.preview-btn'));
      var previewWidths = {
        'mobile-375': '375px',
        'mobile-390': '390px',
        'mobile-414': '414px',
        'tablet-820': '820px',
      };

      function setMode(mode) {
        body.classList.remove('preview-mobile', 'preview-desktop');
        body.classList.add(mode === 'desktop' ? 'preview-desktop' : 'preview-mobile');
        if (mode === 'desktop') {
          body.style.removeProperty('--preview-page-width');
        } else {
          body.style.setProperty('--preview-page-width', previewWidths[mode] || '430px');
        }
        buttons.forEach(function (button) {
          button.classList.toggle('active', button.getAttribute('data-preview-mode') === mode);
          button.setAttribute('aria-pressed', String(button.getAttribute('data-preview-mode') === mode));
        });
        try {
          window.localStorage.setItem(storageKey, mode);
        } catch (_) {}
      }

      buttons.forEach(function (button) {
        button.addEventListener('click', function () {
          var mode = button.getAttribute('data-preview-mode') || 'desktop';
          setMode(mode);
        });
      });

      var initialMode = 'desktop';
      try {
        var stored = window.localStorage.getItem(storageKey);
        if (stored === 'mobile-375' || stored === 'mobile-390' || stored === 'mobile-414' || stored === 'tablet-820' || stored === 'desktop') {
          initialMode = stored;
        }
      } catch (_) {}
      setMode(initialMode);
    })();
  </script>
</body>
</html>`;
}
function renderMarkdownToHtml(markdown) {
  const source = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let i = 0;
  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      blocks.push(`<p>${renderInlineMarkdown(text)}</p>`);
    }
    paragraph = [];
  }
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push(`<h${headingMatch[1].length}>${renderInlineMarkdown(headingMatch[2])}</h${headingMatch[1].length}>`);
      i += 1;
      continue;
    }
    if (/^```/.test(trimmed)) {
      flushParagraph();
      const fence = trimmed.slice(0, 3);
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }
    if (/^(\s*)[-*+]\s+/.test(line) || /^(\s*)\d+\.\s+/.test(line)) {
      flushParagraph();
      const listLines = [];
      while (i < lines.length && (/^(\s*)[-*+]\s+/.test(lines[i]) || /^(\s*)\d+\.\s+/.test(lines[i]))) {
        const current = lines[i];
        if (!/^(\s*)[-*+]\s+/.test(current) && !/^(\s*)\d+\.\s+/.test(current)) {
          break;
        }
        listLines.push(current);
        i += 1;
      }
      blocks.push(renderListGroup(listLines));
      continue;
    }
    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return blocks.join("\n");
}
function renderListGroup(lines) {
  if (lines.length === 0) {
    return "";
  }
  const isOrdered = lines.every((line) => /^\s*\d+\.\s+/.test(line));
  const tag = isOrdered ? "ol" : "ul";
  const items = lines.map((line) => {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!match) {
      return "";
    }
    const indent = Math.max(0, Math.floor(match[1].length / 2));
    const style = indent > 0 ? ` style="margin-left:${indent * 1.4}em"` : "";
    return `<li${style}>${renderInlineMarkdown(match[3])}</li>`;
  }).filter(Boolean).join("");
  return `<${tag}>${items}</${tag}>`;
}
function renderInlineMarkdown(value) {
  let output = escapeHtml(value);
  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    return `<img alt="${escapeHtmlAttr(alt)}" src="${escapeHtmlAttr(url)}">`;
  });
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
    return `<a href="${escapeHtmlAttr(url)}" target="_blank" rel="noreferrer">${text}</a>`;
  });
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return output;
}
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeHtmlAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
function formatDateTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}
function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "0\u6BEB\u79D2";
  }
  if (durationMs < 1e3) {
    return `${Math.round(durationMs)}\u6BEB\u79D2`;
  }
  const seconds = durationMs / 1e3;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 2 : 1)}\u79D2`;
  }
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${minutes}\u5206${String(remSeconds).padStart(2, "0")}\u79D2`;
}
function formatExecutionWindow(startedAt, endedAt) {
  return `${formatDateTime(startedAt)} \u81F3 ${formatDateTime(endedAt)}`;
}
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}
`);
    process.exit(1);
  });
}
export {
  applyInlineBold,
  buildAssetFilename,
  buildCacheFilename,
  buildDocumentSummary,
  buildMarkdownDocument,
  buildStaticWebDocument,
  decodeXmlEntities,
  downloadAssets,
  extensionFromContentType,
  extensionFromMagicBytes,
  extractDocument,
  extractTagValue,
  extractXmlText,
  fileExists,
  getXmlFontSize,
  guessExtension,
  inferAssetExtension,
  insertDateSpacing,
  joinXmlBlocks,
  main,
  normalizeXmlText,
  parseYoudaoXmlNote,
  readFileIfExists,
  readString,
  registerXmlAsset,
  renderXmlParagraph,
  resolveExportBundlePaths,
  resolveGlobalAssetCacheDir,
  rewriteAssetPlaceholders,
  safePathFromUrl,
  sanitizeFilename
};
