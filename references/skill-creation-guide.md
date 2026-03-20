# 从 0 到 1 创建一个可用 Skill

本文以 `youdao-share-to-md` 为例，说明如何把一个重复、稳定、容易耗 token 的任务，做成一个 AI 可以直接复用的 Skill。

## 1. 先定义问题

Skill 适合解决这类任务：

- 输入形式稳定
- 输出格式稳定
- 流程重复
- 人工临场推理容易浪费上下文
- 可以被脚本确定性执行

有道分享链接转 Markdown 就很典型：

- 输入：`https://share.note.youdao.com/` 的完整链接
- 输出：Markdown + 资源文件
- 处理方式：解析链接、拉取内容、转换结构、保存资源

## 2. 设计目标

目标不是“写一段长提示词”，而是让 AI 只做两件事：

1. 识别任务适合用哪个 Skill
2. 执行 Skill 提供的最短入口命令

这样可以把大部分 token 消耗从“推理”转到“脚本执行”。

## 3. 推荐架构

一个实用 Skill 最好分三层：

### 第一层：`SKILL.md`

只保留最少的触发说明和执行入口。

职责：

- 告诉 AI 这个 Skill 什么时候用
- 告诉 AI 该执行哪个命令
- 不解释太多内部实现

本项目当前入口是：

- [`/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/SKILL.md`](/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/SKILL.md)

### 第二层：脚本

把真正的业务逻辑放进脚本，而不是放进 prompt。

职责：

- 参数校验
- 数据获取
- 内容转换
- 文件写入
- 缓存与增量更新

本项目当前主逻辑在：

- [`/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/scripts/youdao_export.ts`](/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/scripts/youdao_export.ts)

### 第三层：参考和回归

把不适合放进 `SKILL.md` 的细节，移到参考文件和 smoke 样例里。

本项目目前有：

- [`/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/references/youdao-format.md`](/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/references/youdao-format.md)
- [`/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/references/youdao-regression.md`](/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/references/youdao-regression.md)
- [`/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/scripts/youdao_export_smoke.ts`](/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/scripts/youdao_export_smoke.ts)

## 4. 从 0 到 1 的实施步骤

### Step 1: 定义边界

先把任务说清楚：

- 只支持什么输入
- 输出长什么样
- 不做什么
- 哪些情况允许降级

对于有道这个案例，边界是：

- 只处理完整分享链接
- 默认优先公开链接
- 不尝试绕过权限
- 内容不完整时尽量保留原始信息

### Step 2: 做最小 `SKILL.md`

`SKILL.md` 只写三件事：

- 什么时候触发
- 执行哪个命令
- 如何验证

不要把复杂解析、块映射、异常处理都塞进去。

### Step 3: 把重逻辑下沉到脚本

把所有“每次都要重复解释”的东西变成代码：

- URL 校验
- 拉取内容
- Markdown 转换
- 资源下载
- 缓存和增量更新

这样 AI 每次复用时就不用重新理解一大段 workflow。

这个项目的导出结果默认写到当前设备的 `~/Downloads`，也可以通过命令参数改到指定目录或指定文件路径。

### Step 4: 加回归样例

至少准备：

- 一个最小 smoke 样例
- 一个真实链接样例
- 一套关键断言

目的不是覆盖所有情况，而是保证后续改动不会把核心输出格式弄坏。

### Step 5: 减少运行时依赖

Skill 的 token 优化，不只在 prompt，还在执行环境：

- 尽量少依赖额外运行时工具
- 尽量让入口命令短
- 尽量让脚本可直接执行

这个项目最后把入口收成了：

- [`/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/youdao`](/Users/hejian/Documents/project/bfe_project/skills/youdao-share-to-md/youdao)

## 5. 这个项目的经验总结

这个有道 Skill 最终做成了下面这种形态：

- `SKILL.md` 很短，只负责触发和调用
- 主逻辑在脚本中
- smoke 样例保证稳定性
- 运行入口尽量短
- 资源和输出支持缓存与增量更新

最终结果是：

- AI 不需要反复解释怎么做
- 复用时上下文消耗更低
- 新线程里输入链接后，能直接生成文档

## 6. 跨平台通用性

### Codex / OpenAI

这类 Skill 在 Codex / OpenAI 体系里是原生适配的。

OpenAI 官方说明里提到，Skills 是可复用、可分享的工作流，并且支持在 ChatGPT、Codex 和 API 中使用；同时它们遵循 Agent Skills 开放标准。  
参考：

- [OpenAI Help: Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)
- [OpenAI: From model to agent: Equipping the Responses API with a computer environment](https://openai.com/index/equip-responses-api-computer-environment)

### Claude

Claude 也有自己的 Agent Skills 体系，但它不是 OpenAI 这套 `SKILL.md` 运行时的原样兼容实现。  
Anthropic 官方文档说明，Claude 的 Skills 也是基于“文件夹 + 指令 + 资源 + 代码执行环境”的模式，但其 API、配置和加载方式是 Claude 自己的一套。  
参考：

- [Claude Docs: Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills)
- [Claude Docs: Using Agent Skills with the API](https://docs.claude.com/en/api/skills-guide)

### OpenClaw

如果 OpenClaw 支持类似的技能包、脚本调用或工具注入机制，那么：

- 脚本逻辑大概率可以复用
- `SKILL.md` 可能需要按它的格式重写
- 入口命令和安装方式要适配它的环境

如果它没有类似的技能系统，就不能直接说“原样通用”，只能说“核心逻辑可移植”。

## 7. 对外表述建议

如果你要向别人解释这个项目，可以这样说：

> 我们把有道分享链接转 Markdown 做成了一个 Skill。  
> 做法是把任务拆成“极简触发层 + 脚本执行层 + 回归层”：`SKILL.md` 只保留最短命令，真正的解析和导出逻辑放在脚本里，再用 smoke 样例锁住输出。  
> 这样 AI 复用时几乎不用重新理解流程，token 和环境成本都会明显下降。  
> 在 Codex / OpenAI 体系里可以直接用；到 Claude 或其他平台时，通常要保留脚本核心，但外层 Skill 封装需要按平台重接一层。

## 8. 一句话原则

> Skill 不是把模型教会，而是把重复劳动封装成可执行工具。
