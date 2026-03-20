# 有道 Skill 的跨平台安装与创建说明

本文回答两个问题：

1. 如果已经有一个 `youdao-share-to-md` Skill，如何安装到 Claude 或 OpenClaw
2. 如果在 Claude 或 OpenClaw 里用它们自带的 skill creator 重新生成一个同样功能的 Skill，应该怎么做

## 先说结论

- **核心逻辑可以复用**
  - 解析有道链接
  - 拉取内容
  - 转 Markdown
  - 下载/缓存资源
- **外层 Skill 包装不完全通用**
  - Codex / OpenAI / Claude / OpenClaw 的发现、安装、启用方式不同
  - 同一份脚本可以复用，但 `SKILL.md`、打包方式、入口命令通常要按平台调整

当前这个项目已经尽量做成了“可移植核心”：

- 运行入口是纯 Node
- 不依赖 `tsx`
- 不依赖 Playwright 运行时
- 主逻辑在脚本里

这样更适合跨平台迁移。

## 1. 如何把当前 Skill 安装到 Claude

Claude 体系里，最实用的方式分三种：Claude.ai、Claude Code、Claude API。

### 1.1 Claude.ai

Claude.ai 支持自定义 Skills。官方流程是：

1. 把 Skill 做成一个 ZIP 包
2. 进入 Claude 的 `Customize > Skills`
3. 上传 ZIP
4. 启用这个 Skill

对当前这个有道 Skill，ZIP 里至少要包含：

- `SKILL.md`
- `dist/youdao_export.js`
- `dist/youdao_export_smoke.js`
- `youdao` 或其它入口脚本
- 需要的参考文件或资源文件

注意：

- Claude.ai 的自定义 Skills 是**按用户**管理的
- 不会自动同步到 API 或 Claude Code
- 如果是 Team / Enterprise，还要看组织是否启用 Skills 和 code execution

### 1.2 Claude Code

Claude Code 支持自定义 Skills，但它是**文件系统式**加载。

做法通常是：

1. 把 Skill 目录放到 `~/.claude/skills/` 或项目里的 `.claude/skills/`
2. 确保目录里有 `SKILL.md`
3. 重新打开会话或刷新 skills

如果你要把当前 skill 装进 Claude Code，最简单就是把整个 `youdao-share-to-md` 目录放进去，或者复制一个精简版目录进去。

### 1.3 Claude API

Claude API 支持：

- Anthropic 内置 Skills
- 自定义 Skills

如果通过 API 使用，通常有两种路径：

1. 用 Skills API 上传 skill
2. 在请求里通过 `container` 指定 `skill_id`

当前这个 skill 如果要走 API 路线，建议注意两点：

- 运行时不要依赖“安装新包”
- 尽量保持入口是纯 JS / 可执行脚本

这正好和当前这个项目的改造方向一致。

### 1.4 Claude 的安装建议

如果你要把现在这个 skill 做成 Claude 可用版，建议准备两个包：

- **Claude.ai 版**
  - ZIP 包
  - 入口清晰
  - 说明短
- **Claude Code / API 版**
  - 文件夹形式
  - 代码和资源都在本地可用
  - 不依赖运行时安装额外包

## 2. 如何把当前 Skill 安装到 OpenClaw

OpenClaw 的官方文档显示，它使用 AgentSkills 兼容的技能目录，核心形式也是：

- 一个目录
- 一个 `SKILL.md`
- 可选脚本和资源

### 2.1 最直接的安装方式

OpenClaw 的技能加载顺序大致是：

1. 工作区技能：`<workspace>/skills`
2. 本地共享技能：`~/.openclaw/skills`
3. 内置技能

所以你有三种常见安装方式：

- 直接复制到项目工作区的 `skills/`
- 复制到 `~/.openclaw/skills/`
- 如果是通过 ClawHub 发布的技能，用 `clawhub install <skill-slug>`

### 2.2 当前这个 skill 对 OpenClaw 的推荐放法

推荐把整个目录放到：

- `~/.openclaw/skills/youdao-share-to-md`

或者：

- `<workspace>/skills/youdao-share-to-md`

然后让 OpenClaw 刷新 skills 或重启会话。

### 2.3 需要注意的地方

OpenClaw 的技能加载会根据：

- 环境
- 配置
- 二进制是否存在

来决定技能是否生效。

所以如果 skill 依赖外部命令，要确保：

- 命令在 PATH 里
- 或者脚本本身是可直接执行的

当前这个有道 skill 已经尽量做成了纯 Node 入口，这对 OpenClaw 很友好。

## 3. 如何用 Claude / OpenClaw 自带的 skill creator 生成同样功能的 Skill

### 3.1 在 Claude 里生成

Claude 官方有一个“通过对话创建 skill”的流程。核心思路是：

1. 你向 Claude 说明目标任务
2. Claude 追问使用场景、输入输出、边界条件
3. Claude 根据 skill creator 的最佳实践生成 `SKILL.md` 和相关文件
4. 你保存成 skill 包并上传到 Claude

如果你要让 Claude 生成一个和当前有道 skill 同样功能的 skill，建议直接给它这四类信息：

- 目标输入：`share.note.youdao.com` 完整链接
- 目标输出：Markdown + 资源文件
- 提取策略：优先 API，其次 DOM / 兜底
- 执行方式：调用本地脚本，不要在 prompt 里展开长流程

你可以这样描述给 Claude：

> 请生成一个 skill，用于把 `https://share.note.youdao.com/` 的完整分享链接导出为 Markdown。  
> 这个 skill 要尽量短，主要职责是触发一个脚本。  
> 需要包含 `SKILL.md`、脚本和少量回归样例。  
> 生成时优先选择可复用、可移植、低 token 的方案。

### 3.2 在 OpenClaw 里生成

OpenClaw 的官方创建流程是：

1. 创建一个目录
2. 写 `SKILL.md`
3. 加入脚本和资源
4. 刷新 skills 或重启 gateway

也就是说，在 OpenClaw 里没有必要一定通过“上传”来做，直接生成目录即可。

如果你想让 OpenClaw 里的 agent 帮你生成同款 skill，可以直接让它：

- 创建一个新目录
- 写 `SKILL.md`
- 写导出脚本
- 写 smoke 样例
- 刷新 skills

如果是在 OpenClaw 里对话式生成，可以这样描述：

> 请为我创建一个新的 skill，用于把有道分享链接导出成 Markdown。  
> 输入是 `share.note.youdao.com` 完整链接。  
> 输出是 Markdown 文件和资源目录。  
> Skill 本身要尽量短，只负责触发本地脚本。  
> 请同时生成 `SKILL.md`、脚本和一个 smoke 样例。

## 4. “安装已有 skill” 与 “重新生成 skill” 的差别

### 安装已有 skill

适合你已经有完整产物：

- `SKILL.md`
- 脚本
- 资源
- 回归样例

这时就是“打包、放到对应平台、启用”。

### 重新生成 skill

适合你想让平台里的 skill creator 重新按它的体系生成一版。

这时重点不是拷贝，而是让模型输出：

- 平台能识别的目录结构
- 平台能运行的脚本
- 平台能触发的最短说明

换句话说：

- **安装** 是把现成 skill 放进去
- **创建** 是让模型根据需求写出一个新的 skill 包

## 5. 迁移这份有道 Skill 时的实操建议

如果目标平台是 Claude：

- 保留 `SKILL.md`
- 保留 `dist/youdao_export.js`
- 保留 `youdao` 入口
- 重新检查入口是否符合 Claude 的目录/zip 要求
- 如果平台不允许运行时下载依赖，就不要再引入运行时安装步骤

如果目标平台是 OpenClaw：

- 保留整个目录
- 放到 `~/.openclaw/skills/` 或工作区 `skills/`
- 刷新 skills
- 确保技能描述能让模型自动触发

## 6. 一句话总结

> 这类 Skill 最通用的是“脚本和工作流”，最不通用的是“平台外壳和安装方式”。  
> 要跨平台复用，就把逻辑写进脚本，把说明压进 `SKILL.md`，再按各平台要求重新包装。

## 参考文档

- [Claude: Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills)
- [Claude: Use Skills with the Claude API](https://docs.claude.com/en/api/skills-guide)
- [Claude Help Center: Use Skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)
- [Claude Help Center: How to create custom Skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills)
- [Claude Help Center: How to create a skill with Claude through conversation](https://support.claude.com/en/articles/12599426-how-to-create-a-skill-with-claude-through-conversation)
- [OpenClaw Skills](https://docs.openclaw.ai/tools/skills)
- [OpenClaw: Creating Skills](https://docs.openclaw.ai/tools/creating-skills)
