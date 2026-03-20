#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildDocumentSummary, buildStaticWebDocument, parseYoudaoXmlNote, resolveExportBundlePaths, rewriteAssetPlaceholders, } from './youdao_export.js';
const titleAndImageSample = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><note xmlns="http://note.youdao.com" file-version="0" schema-version="1.0.3"><head><list id="k3yM-1772941021962" type="unordered"/></head><body><para><coId>3060-1621846615933</coId><text> </text><inline-styles><font-size><from>0</from><to>1</to><value>16</value></font-size></inline-styles><styles><fontSize>14</fontSize></styles></para><para><coId>lrX5-1772941021819</coId><text>AI行情遇到了一个尴尬期20260308</text><inline-styles><bold><from>0</from><to>12</to><value>true</value></bold><font-size><from>0</from><to>20</to><value>16</value></font-size></inline-styles><styles><fontSize>14</fontSize></styles></para><list-item level="1" list-id="k3yM-1772941021962"><coId>NkhE-1772941021824</coId><text>第一段正文</text><inline-styles><bold><from>0</from><to>4</to><value>true</value></bold></inline-styles><styles/></list-item><image><coId>SwpY-1772941021975</coId><source>https://note.youdao.com/yws/public/resource/6fb2d33f370e65488a5cf20dcde96b84/xmlnote/WEBRESOURCE6e4f86c4d0221b6b509b67f9647abce2/148363</source><text/><styles><width>470px</width></styles></image></body></note>`;
const nestedListSample = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><note xmlns="http://note.youdao.com" file-version="0" schema-version="1.0.3"><head><list id="a1" type="unordered"/><list id="a2" type="unordered"/></head><body><para><coId>head-1</coId><text>第二个样例标题</text><inline-styles><font-size><from>0</from><to>6</to><value>16</value></font-size></inline-styles><styles/></para><list-item level="1" list-id="a1"><coId>li-1</coId><text>一级条目</text><inline-styles/><styles/></list-item><list-item level="2" list-id="a2"><coId>li-2</coId><text>二级条目</text><inline-styles><bold><from>0</from><to>4</to><value>true</value></bold></inline-styles><styles/></list-item><image><coId>img-1</coId><source>https://note.youdao.com/yws/public/resource/6fb2d33f370e65488a5cf20dcde96b84/xmlnote/WEBRESOURCEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/148364</source><text/><styles/></image><image><coId>img-2</coId><source>https://note.youdao.com/yws/public/resource/6fb2d33f370e65488a5cf20dcde96b84/xmlnote/WEBRESOURCEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/148365</source><text/><styles/></image></body></note>`;
const titleResult = parseYoudaoXmlNote(titleAndImageSample);
assert.ok(titleResult.markdown.includes('## AI行情遇到了一个尴尬期 20260308'));
assert.ok(titleResult.markdown.includes('- **第一段正**文'));
assert.ok(titleResult.markdown.includes('![]([[YOUDAO_ASSET_0]])'));
assert.equal(titleResult.assets.length, 1);
const nestedResult = parseYoudaoXmlNote(nestedListSample);
assert.ok(nestedResult.markdown.includes('## 第二个样例标题'));
assert.ok(nestedResult.markdown.includes('- 一级条目'));
assert.ok(nestedResult.markdown.includes('- **二级条目**'));
assert.ok(nestedResult.markdown.includes('![]([[YOUDAO_ASSET_0]])'));
assert.ok(nestedResult.markdown.includes('![]([[YOUDAO_ASSET_1]])'));
assert.equal(nestedResult.assets.length, 2);
const previewResult = rewriteAssetPlaceholders('![]([[YOUDAO_ASSET_0]])\n[attachment]([[YOUDAO_ASSET_1]])', [
    {
        placeholder: '[[YOUDAO_ASSET_0]]',
        url: 'https://example.com/image.png',
        kind: 'image',
        suggestedName: 'image-1',
        alt: 'image',
    },
    {
        placeholder: '[[YOUDAO_ASSET_1]]',
        url: 'https://example.com/doc.pdf',
        kind: 'attachment',
        suggestedName: 'attachment-1',
        alt: 'attachment',
    },
], new Map([
    ['[[YOUDAO_ASSET_0]]', './assets/001-image-1.png'],
    ['[[YOUDAO_ASSET_1]]', './assets/002-attachment-1.pdf'],
]));
assert.ok(previewResult.includes('![image](./assets/001-image-1.png)'));
assert.ok(previewResult.includes('<!-- remote: https://example.com/image.png -->'));
assert.ok(previewResult.includes('[attachment](./assets/002-attachment-1.pdf)'));
assert.ok(previewResult.includes('<!-- remote: https://example.com/doc.pdf -->'));
const summaryResult = buildDocumentSummary('AI行情遇到了一个尴尬期0308@kk.note', `## AI行情遇到了一个尴尬期 20260308

- **AI行情遇到了一个尴尬期。**本周有宏观的地缘政治的影响，多往前看看过去1个月的时间。
- 先放一张图，给大家一点对产业的信心。
- **海外投资者看的是ROI，收入追不上投入那就跌。**
`);
assert.ok(summaryResult.includes('AI行情遇到了一个尴尬期。'));
assert.ok(summaryResult.includes('先放一张图，给大家一点对产业的信心。'));
assert.ok(summaryResult.length <= 80);
const bundlePaths = resolveExportBundlePaths({ url: 'https://share.note.youdao.com/ynoteshare/index.html?id=6fb2d33f370e65488a5cf20dcde96b84&type=note&_time=1772941234118#/', timeoutMs: 45000, headless: true, includeAttachments: true }, 'https://share.note.youdao.com/ynoteshare/index.html?id=6fb2d33f370e65488a5cf20dcde96b84&type=note&_time=1772941234118#/');
assert.ok(bundlePaths.rootDir.endsWith('/6fb2d33f370e65488a5cf20dcde96b84'));
assert.ok(bundlePaths.markdownPath.endsWith('/index.md'));
assert.ok(bundlePaths.htmlPath.endsWith('/index.html'));
assert.ok(bundlePaths.assetsDir.endsWith('/6fb2d33f370e65488a5cf20dcde96b84/assets'));
assert.ok(bundlePaths.assetsJsonPath.endsWith('/index.assets.json'));
const defaultBundlePaths = resolveExportBundlePaths({ url: 'https://share.note.youdao.com/ynoteshare/index.html?id=6fb2d33f370e65488a5cf20dcde96b84&type=note&_time=1772941234118#/', timeoutMs: 45000, headless: true, includeAttachments: true }, 'https://share.note.youdao.com/ynoteshare/index.html?id=6fb2d33f370e65488a5cf20dcde96b84&type=note&_time=1772941234118#/');
assert.ok(defaultBundlePaths.rootDir.includes('/Downloads/youdao/'));
const htmlResult = buildStaticWebDocument({
    title: 'AI行情遇到了一个尴尬期0308@kk.note',
    sourceUrl: 'https://share.note.youdao.com/ynoteshare/index.html?id=6fb2d33f370e65488a5cf20dcde96b84&type=note&_time=1772941234118#/',
    status: 'SUCCESS',
    startedAt: new Date('2026-03-19T10:00:00+08:00'),
    endedAt: new Date('2026-03-19T10:00:03+08:00'),
    durationMs: 3000,
    summary: summaryResult,
    markdownBody: titleResult.markdown,
    markdownPath: bundlePaths.markdownPath,
    htmlPath: bundlePaths.htmlPath,
    assetsDir: bundlePaths.assetsDir,
});
assert.ok(htmlResult.includes('执行时间'));
assert.ok(htmlResult.includes('耗时'));
assert.ok(htmlResult.includes('状态'));
assert.ok(htmlResult.includes('Markdown 文件'));
assert.ok(htmlResult.includes('资源目录'));
assert.ok(htmlResult.includes('HTML 文件'));
assert.ok(htmlResult.includes('href="'));
assert.ok(htmlResult.includes('file://'));
assert.ok(htmlResult.includes('footer-links'));
assert.ok(htmlResult.includes('电脑预览'));
assert.ok(htmlResult.includes('iPhone 14'));
assert.ok(htmlResult.includes('iPhone 12'));
assert.ok(htmlResult.includes('Android'));
assert.ok(htmlResult.includes('iPad 10'));
assert.ok(htmlResult.includes('AI行情遇到了一个尴尬期0308@kk.note'));
process.stdout.write(`${titleResult.markdown}\n\n${nestedResult.markdown}\n`);
