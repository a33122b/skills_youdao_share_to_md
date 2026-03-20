---
name: youdao-share-to-md
description: 将 share.note.youdao.com 的完整分享链接自动导出为 Markdown，并把资源和静态站点一并生成。
---

# 有道分享页转 Markdown

适用于用户贴出完整的 `https://share.note.youdao.com/` 链接。

## 处理目标

- 导出为 Markdown
- 默认输出到工作区内固定目录 `./youdao-output`
- 默认文件名为 `index.md`、`index.html`、`index.assets.json`
- 可用 `--output-dir` 指定目录，用 `--output` 指定精确文件路径
- 资源文件与 Markdown 同级保存，并尽量复用
- 导出成功后自动执行 `scripts/auto_deploy_youdao.sh`

## 通用规则

- 默认用中文输出，保留代码、路径、URL、产品名和必须保留的英文术语
- 以后生成的同类说明文档、出口内容和总结内容也默认用中文
- 需要固定参数名、文件名或接口名时，保持原样，不翻译
- 这份 skill 要尽量简短，能用脚本就不要手写流程

## 固定回复格式

最终回复使用下面这组字段：

- `摘要`
- `网页`
- `文档`
- `资源`
- `部署`
- `本地访问`
- `公网访问`
- `状态`

其中：

- `部署` 需要说明成功或失败
- 部署成功时，必须包含 `本地访问` 和 `公网访问`
