# AI 网页阅读助手（Chrome 扩展）

基于产品需求文档（`Chrome AI网页阅读助手插件产品需求文档（PRD）.md`）实现的 **Chrome Extension MV3** 插件：
**网页智能解析 + AI 对话辅助**，聚焦技术文档、开源文档、技术博客、教程类网页场景。支持自定义任意
OpenAI 兼容大模型，右侧悬浮对话小窗，一键开关，全程不干扰原生网页浏览。

- 技术栈：Chrome Extension **Manifest V3** · **Vue3（组合式 API）** · **Naive UI** · **Tailwind CSS** · Vite · TypeScript
- UI 规范：现代简约风，低饱和科技蓝，CSS 变量主题，支持浅色 / 深色 / 跟随系统
- 兼容：Chrome 102+ / Edge / 所有 Chromium 内核浏览器，Windows / macOS / Linux

---

## 功能总览（对照 PRD）

| PRD 模块 | 落地情况 |
|---|---|
| 3.1 全局开关 | 插件弹窗顶部总开关，默认开启，状态持久化；关闭后完全静默（不注入 UI、不抓取内容） |
| 3.1.3 网页单独禁用 | 弹窗内「当前网页 · 单独禁用」开关，按域名生效 |
| 3.2 大模型配置 | 任意 OpenAI 兼容接口（域名/密钥/模型名/Temperature/最大上下文/超时）；密钥 AES-GCM 本地加密 |
| 3.2.3 配置增强 | 内置预设（DeepSeek / GPT / 通义千问 / Kimi / 智谱 / 本地 Ollama）、接口连通性校验、多套配置一键切换 |
| 3.3 网页解析 Agent | Readability 提取正文、过滤导航/广告，抽取标题大纲与代码块，作为对话上下文 |
| 3.3.2 技术文档辅助 | 代码解读/纠错/改写、术语解析、长文档分段总结、英文翻译、基于章节定位作答 |
| 3.4 右侧悬浮对话窗 | 380px 默认宽、拖拽、拉伸缩放、收起悬浮圆钮、全屏、流式输出、快捷指令栏、历史记录（按域名）、复制回答、深浅色 |
| 3.5 总结导出 | 完整对话留存 / AI 精简总结双模式，标准 Markdown（来源/时间/主题/问答/代码块），可插拔输出渠道架构 |
| 3.6 划词翻译 | 独立开关（默认关），单词（英美音标+多义项+上下文释义）/ 短语 / 长段三场景，随选随译、自动避让边界 |
| 3.7 UI 规范 | Vue3 + Naive UI + Tailwind CSS，CSS 变量主题，深浅色一键切换，轻量微动效；弹窗采用「快捷对话」主页 + 设置子页的简约布局 |
| 3.8 体验增强 | 权限最小化（无 tabs/history/downloads 等冗余权限）、离线与未配置提示、闲置零资源占用、快捷键自定义、数据仅存本地 |

## 目录结构

```
├── public/                 # manifest.json + 图标（构建时拷贝进 dist）
├── scripts/
│   ├── gen-icons.mjs       # 纯 Node 生成 PNG 图标
│   └── postbuild.mjs       # 构建后校验 + 产物清单
├── src/
│   ├── shared/             # 类型 / 加密存储 / 模型预设 / 提示词 / 主题 / 消息协议
│   ├── background/         # Service Worker：LLM 流式客户端(SSE)、校验、翻译、快捷键、消息路由
│   ├── content/            # Content Script：网页提取(Readability)、悬浮窗宿主、拖拽/缩放/收起/全屏、划词触发
│   ├── popup/              # 弹窗配置面板（Vue3 + Naive UI）
│   ├── chat/               # 右侧对话窗 iframe（流式对话/快捷指令/历史/导出/主题）
│   └── translate/          # 划词翻译悬浮小窗 iframe
├── tests/smoke.test.ts     # 运行时冒烟测试（28 项）
├── popup.html / chat.html / translate.html   # Vite 多页面入口
└── vite.config.ts / vite.content.config.ts   # 主构建 + content IIFE 独立构建
```

## 构建与安装

```bash
npm install
npm run build        # 产出 dist/（含图标、manifest、静态校验）
npm test             # 运行冒烟测试（可选）
```

安装：

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `dist/` 目录
4. 首次使用：点击工具栏插件图标 → 选择模型预设（如 DeepSeek）→ 填入 API 密钥 →「校验接口」→「保存为新配置」→「打开对话窗」

## 使用指南

- **进入插件**：已配置模型 → 点击图标默认进入**快捷对话页**（可直接提问，点 ⚙️ 进设置）；未配置模型 → 直接进入**设置页**完成配置
- **唤起悬浮对话窗**：快捷对话页点 🪟（或设置页「打开悬浮窗」）；快捷键 `Alt+Shift+R`（可自定义）
- **总结页面**：快捷键 `Alt+Shift+S`，或在对话窗点「📝 总结全文」
- **全局开关**：快捷键 `Alt+Shift+X`，或插件弹窗顶部开关
- **快捷指令**：总结全文 / 解读核心知识点 / 翻译全文 / 代码解析 / 疑难答疑
- **划词翻译**：弹窗内开启开关后，选中网页英文内容即触发（单词含英美音标；中文/数字/符号不触发）；弹窗高度随内容自适应，长文本完整展示（超高时弹窗内部滚动）
- **导出**：对话窗顶部「📤」→ 完整对话留存 或 AI 精简总结 → 本地下载 Markdown（文件名=网页标题+时间戳）

## 大模型配置说明

- 接口统一兼容 **OpenAI Chat Completions 协议**（`POST {baseUrl}/chat/completions`，SSE 流式）
- 地址示例：DeepSeek `https://api.deepseek.com/v1`、通义千问 `https://dashscope.aliyuncs.com/compatible-mode/v1`、
  智谱 `https://open.bigmodel.cn/api/paas/v4`、本地 Ollama `http://localhost:11434/v1`（密钥留空）
- 技术文档阅读默认 `temperature=0.2`（严谨模式）；「最大上下文」同时约束正文截断与回复预算；
  超时默认 15s 可调，适配本地低速模型
- 未配置模型 / 网络异常时给出明确中文提示，不会崩溃

## 架构与安全设计

- **MV3**：Service Worker（ESM）+ Content Script（IIFE 注入隔离世界）+ 扩展页面 iframe，无远程代码
- **Agent 化后台**：AI 能力收敛为 `AgentRuntime`（智能体门面，状态机 + ToolLoop），按「能力 Capability / 模型服务商 Provider / 工具 Tool / 技能 Skill」四层注册表可插拔；
  Provider 适配层（OpenAI 兼容已落地，Anthropic 预留）、Tools（function calling 预留，含 `get_page_context` 示例）、Skills（内置技术文档阅读/总结/翻译/代码解析，可运行时加载技能包）、MCP（`MCPManager` 接口骨架，工具经 Adapter→Registry 桥接注入）；消息路由 `MessageRouter` + `PortHub`，协议向后兼容
- **不污染页面**：对话窗 / 翻译窗均为独立扩展页面 iframe，置于 Shadow DOM 容器中，样式完全隔离
- **消息链路**：
  - 对话/总结流式：chat iframe ↔ Service Worker 长连接端口（扩展内部信道，逐 token 推送）
  - 网页上下文：Content Script 提取 → `storage.session`（页面不可读写）→ chat 读取
  - 窗口交互：iframe ↔ 宿主 `postMessage`，随机 nonce 校验来源（页面无法伪造）
- **隐私**：API 密钥 AES-GCM（PBKDF2 派生密钥）本地加密存储；配置、对话记录仅存
  `chrome.storage.local`；无埋点、无广告、无任何云端上传
- **导出可插拔架构**：`EXPORT_TARGETS` 注册表（本地下载已落地；控制台打印 / 云端存储 / 多格式为预留拓展点），
  新增渠道无需重构核心代码
- **日志可插拔架构**：`src/shared/logger.ts` 输出渠道注册表（`console` 控制台已落地；`page` 页面浮层、
  `server` 上报服务器为预留拓展点），`setSinkEnabled(id, on)` 可按渠道开关，互不影响；日志带
  `[chat]` / `[host]` / `[bg]` 作用域标签，方便定位问题（如页面上下文提取、消息链路）
- **资源轻量化**：插件闲置时不注入任何 DOM、不轮询、不抓取（上下文仅在提问/翻译时按需提取）
- **防崩溃加固**：网页提取带安全预算（节点数 6 万 / 深度 300 超限走轻量路径，轻量路径带 24ms 时间盒，
  全文统一 textContent）；上下文在宿主侧按模型预算提前截断（避免全量跨进程传输）；流式渲染 40ms 节流合并 +
  长回复/长列表上限；存储写入统一容错 + 会话/消息配额，最大限度避免标签页卡死、内存膨胀与写入异常

## 快捷键（默认）

| 功能 | 默认快捷键 |
|---|---|
| 打开 / 收起对话窗 | `Alt+Shift+R` |
| AI 总结当前页面 | `Alt+Shift+S` |
| 全局开关插件 | `Alt+Shift+X` |

弹窗「快捷键」卡片内可直接修改（需 Chrome 117+，否则请到 `chrome://extensions/shortcuts` 修改）。

## 常见问题

- **无法唤起对话窗**：插件会在旧标签页上自动补注入内容脚本；若仍失败，说明是浏览器内部页面
  （`chrome://`、应用商店、PDF 阅读器等）或本地 `file://` 页面（需在扩展详情开启「允许访问文件网址」），
  请在普通网页使用
- **校验接口失败**：检查接口地址/模型名/密钥，本地模型请确认服务已启动且地址可达
- **对话没有页面上下文**：请确认已打开对话窗后提问（上下文在提问时自动提取刷新）
- **划词翻译不触发**：确认弹窗内已开启「划词翻译」且当前页面未被单独禁用

## 架构重构方案

面向 Agent 化的完整重构方案（Tools / Skills / MCP 扩展点、设计模式对照、迁移路线图）见 [`docs/REFACTORING.md`](docs/REFACTORING.md)。

## 许可

仅供学习使用。数据与配置均保存在本地浏览器，请自行妥善保管 API 密钥。
