# AI 网页阅读助手 · 重构方案（Agent 化架构）

> 目标：可维护性最大化 · 成熟设计模式 · 可读性 · 可扩展性最大化 ·
> 把后台的 AI 能力抽象为「智能体（Agent）」，为后续 **Tools（函数调用）/ Skills（技能加载）/ MCP（模型上下文协议）** 预留标准扩展点。

---

## 1. 重构目标与原则

| 目标 | 落地手段 |
|---|---|
| 可维护性 | 单一职责分层、显式依赖注入、每个模块可独立测试 |
| 成熟设计模式 | 注册表 / 策略 / 命令 / 适配器 / 观察者（事件总线）/ 门面 / 状态机 / 管道 |
| 可读性 | 领域化命名（Agent / Skill / Tool / Capability / Provider），协议类型化 |
| 可扩展性 | 一切能力走「注册表 + 接口」，新增能力零改动核心代码 |
| Agent 化 | 后台 AI 模块收敛为 AgentRuntime，通过 Tool / Skill / MCP 组合能力 |

设计铁律：

1. **核心不感知具体实现**：AgentRuntime 只依赖接口（Provider / Tool / Skill / Store），不 import 任何具体实现；
2. **能力即注册项**：新增工具/技能/模型服务商 = 新增一个注册项，不修改 Agent 核心与 UI；
3. **UI 与智能体解耦**：UI 只跟 `AgentBridge`（消息门面）交互，不感知 LLM/工具/技能细节；
4. **协议稳定**：扩展的 postMessage / runtime 消息协议保持不变（或仅做增量），保证逐步迁移、随时可回滚。

---

## 2. 现状问题诊断（为什么重构）

- `src/background/index.ts`：一个文件同时承担**消息路由、端口管理、对话流式、总结、翻译、校验、快捷键**，switch-case 遍地，新增能力必须改核心文件；
- LLM 调用、提示词组装、上下文预算、错误处理**散落在多处**（background / chat / popup / content）；
- 「总结全文 / 翻译 / 代码解析 / 疑难答疑」等能力是**硬编码 prompt 字符串**，无法热插拔、无法叠加技能、无法接工具；
- 无法演进到 function calling / skills / MCP——扩展点不存在；
- 存储访问直接散调 `chrome.storage.local`，无领域边界；
- 内容脚本的宿主逻辑（窗口管理、划词、提取、消息中继）耦合在一个文件。

---

## 3. 目标架构总览（分层）

```
┌────────────────────────────────────────────────────────────┐
│  UI 层（Vue）                                                │
│  popup / chat / translate   ←→  composables（useAgentBridge │
│                                  useChatSession / useSettings）│
└───────────────┬────────────────────────────────────────────┘
                │ 稳定协议（runtime message / port / postMessage）
┌───────────────▼────────────────────────────────────────────┐
│  后台 Service Worker                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ AgentFacade（门面，唯一入口）                          │  │
│  │  handle(req) → AgentEventBus（事件流）                 │  │
│  └──────────┬───────────────────────────────┬───────────┘  │
│             │ 依赖注入                       │              │
│  ┌──────────▼─────────┐   ┌─────────────────▼───────────┐  │
│  │ AgentRuntime        │   │ 路由器 MessageRouter         │  │
│  │ 状态机+ToolLoop     │   │ (runtime/port 消息→Capability)│  │
│  └──┬────┬────┬────┬──┘   └─────────────────────────────┘  │
│     │    │    │    │                                       │
│  ┌──▼─┐┌─▼──┐┌─▼──┐┌─▼────────┐   ┌─────────────────────┐ │
│  │Provider│Skills│Tools│Capabilities│   │ MCP Manager(预留)   │ │
│  │适配层   │注册表 │注册表 │注册表     │   │ 服务器→工具同步      │ │
│  └─────┘└────┘└────┘└──────────┘   └─────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Stores（领域存储）：ConfigStore / SettingsStore /       │  │
│  │ SessionStore / AgentStateStore（均基于 StorageAdapter）│  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────┬────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────┐
│  Content Script 宿主（分层）                                 │
│  Extractor(Strategy) / WindowManager / SelectionService /   │
│  TranslateController / MessageRelay                        │
└────────────────────────────────────────────────────────────┘
```

---

## 4. 智能体核心（Agent Core）—— 重构中心

### 4.1 请求与事件模型（类型化协议）

```ts
// agent/types.ts
export type AgentRequestKind = 'chat' | 'summarize' | 'translate' | 'validate' | 'command'

export interface AgentRequest {
  kind: AgentRequestKind
  input: string                        // 用户输入（chat/command）或待处理内容
  pageContext?: PageContext
  history?: LLMChatMessage[]           // 会话历史（截断后的最近 N 条）
  skillIds?: string[]                  // 本次启用的技能（缺省=全局启用的技能）
  toolNames?: string[]                 // 本次可用的工具（缺省=全局启用的工具）
  meta?: Record<string, unknown>       // 页面标题/URL/域名等
  signal?: AbortSignal
}

export type AgentEvent =
  | { type: 'chunk'; delta: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; ok: boolean }
  | { type: 'done'; content: string; toolOutput?: unknown }
  | { type: 'error'; message: string }
```

### 4.2 AgentRuntime（门面 + 状态机 + 工具循环）

```ts
export interface AgentDeps {
  provider: ChatProvider
  tools: ToolRegistry
  skills: SkillRegistry
  configStore: ConfigStore
  sessionStore: SessionStore
  logger: Logger
}

export class AgentRuntime {
  constructor(private deps: AgentDeps) {}

  /** 唯一入口：返回可订阅的事件流 */
  async* handle(req: AgentRequest): AsyncGenerator<AgentEvent> {
    // 状态机：IDLE → ASSEMBLING → STREAMING ⇄ TOOL_CALL → DONE / ERROR
    const cfg = await this.deps.configStore.getActiveConfig()
    if (!cfg) { yield { type: 'error', message: '尚未配置大模型…' }; return }
    const budget = resolveContextChars(cfg.maxTokens)
    const sysPrompt = PromptAssembler.assemble({
      base: SYSTEM_PROMPT,
      skills: this.deps.skills.enabledFor(req.skillIds),   // 技能片段叠加
      tools: this.deps.tools.schemasFor(req.toolNames),    // 工具 schema
    })
    const messages = PromptAssembler.build({ sysPrompt, pageBlock, history, input })
    let iteration = 0
    for (;;) {                                            // ToolLoop
      const turn = this.deps.provider.stream(messages, cfg, req.signal)
      for await (const ev of turn) {
        if (ev.kind === 'delta') yield { type: 'chunk', delta: ev.text }
        if (ev.kind === 'tool-calls' && ev.calls?.length) {
          if (iteration >= MAX_TOOL_ITERATIONS) { yield { type: 'error', message: '工具调用次数超限' }; return }
          iteration++
          for (const call of ev.calls) {
            yield { type: 'tool-call', tool: call.name, args: call.arguments }
            const r = await this.deps.tools.execute(call.name, call.arguments, req)
            yield { type: 'tool-result', tool: call.name, ok: !r.isError }
            messages.push(toolCallMessage(call), toolResultMessage(r))   // 回填给模型
          }
          continue                                            // 再次请求模型
        }
      }
      break
    }
    yield { type: 'done', content: finalText }
  }
}
```

要点：

- **状态机**把"组装 → 流式 → 工具调用 → 再请求"的生命周期显式化，可观测、可中断（`AbortSignal` 贯穿）；
- **ToolLoop** 是后续 Tools / MCP 的天然挂载点：模型返回 `tool_calls` 就执行并回填，迭代上限防死循环；
- AgentRuntime **不 import 任何具体实现**，全部来自 `AgentDeps`（构造注入），单测可注入 Mock Provider 全流程验证。

### 4.3 PromptAssembler（提示词组装器）

```ts
export class PromptAssembler {
  static assemble(opts: {
    base: string
    skills: Skill[]          // 技能片段：按序拼接进 system prompt
    tools?: ToolSchema[]     // 工具说明（OpenAI function schema 文本化）
    role?: string            // 人设（如「技术专家」「新手科普」——预留自定义 Agent 人设）
  }): string
  static build(opts: { sysPrompt: string; pageBlock: string; history: LLMChatMessage[]; input: string }): LLMChatMessage[]
}
```

---

## 5. 可插拔能力层（重构重点：为 Tools / Skills / MCP 铺路）

### 5.1 Provider 适配层（Adapter + Factory）

```ts
export interface ChatProvider {
  readonly id: 'openai-compatible' | 'anthropic' | ...
  stream(messages: LLMChatMessage[], cfg: ModelConfig, signal?: AbortSignal):
    AsyncGenerator<ProviderEvent>          // delta | tool-calls | message
  complete(messages, cfg, signal?): Promise<string>
  validate(cfg: ModelConfig): Promise<{ ok: boolean; message: string }>
}

export class ProviderFactory {
  static create(cfg: ModelConfig): ChatProvider   // 按 cfg.protocol 路由
}
```

- `OpenAIChatProvider`：现 `llm.ts` 收敛而来（SSE 流式 / 非流式回退 / JSON 容错 / 超时）；
- `AnthropicProvider`：**预留**（DeepSeek 也有 `/anthropic` 端点，未来可直接接）；
- `ModelConfig` 增加 `protocol?: 'openai' | 'anthropic'` 字段，Pop up 下拉选择。

### 5.2 Tools 注册表（OpenAI function calling 标准）

```ts
export interface AgentTool {
  name: string
  description: string
  parameters: JSONSchema          // 与 OpenAI/MCP 对齐的 JSON Schema
  enabled?: boolean
  execute(args: unknown, ctx: AgentRequest): Promise<{ content: string; isError?: boolean }>
}

export class ToolRegistry {
  register(tool: AgentTool): void
  unregister(name: string): void
  schemasFor(names?: string[]): ToolSchema[]     // 组装进 system/工具消息
  execute(name: string, args: unknown, ctx: AgentRequest): Promise<AgentToolResult>
  /** MCP 动态注入入口 */
  syncFromMcp(serverId: string, tools: AgentTool[]): void
}
```

首批内置工具（把"现在硬编码的能力"工具化）：

| Tool | 说明 |
|---|---|
| `get_page_context` | 读取当前页面上下文（对接 content 宿主；现在由 UI 侧携带，重构后可改为工具主动拉取） |
| `summarize_page` | 总结当前页（本质=skill 引导的对话，也可作为工具供其他 Agent 调用） |
| `export_conversation` | 导出对话（复用可插拔导出器）——预留 |
| `search_web` / `fetch_url` | 预留联网能力 |

### 5.3 Skills 注册表（技能加载）

```ts
export interface Skill {
  id: string
  name: string
  description: string
  /** 注入 system prompt 的片段（技能的核心） */
  systemPrompt: string
  /** 技能推荐的快捷指令 */
  suggestedCommands?: QuickCommandDef[]
  enabledByDefault?: boolean
}

export class SkillRegistry {
  load(skill: Skill): void
  unload(id: string): void
  /** 按用户启用的技能列表返回片段（持久化在 SettingsStore.skillIds） */
  enabledFor(skillIds?: string[]): Skill[]
  /** 预留：从 JSON/URL 加载技能包（Skill Pack） */
  loadFromPack(pack: { skills: Skill[] }): void
}
```

内置技能（把现有 prompt 工程化沉淀为技能包）：

| Skill | 系统提示词片段要点 |
|---|---|
| `tech-doc-reading`（技术文档阅读，默认启用） | 章节定位作答、代码解读/纠错/改写、术语解析、markdown 输出规范 |
| `summarizer`（长文档总结） | 分层总结模板（主题→章节→要点→注意事项） |
| `translator`（翻译） | 术语译法、直译/意译双轨、JSON 输出约定 |
| `code-analyst`（代码解析） | 功能/思路/易错点/改进示例 |

**技能加载（用户点名能力）**：`SkillRegistry` 支持运行时 `load/unload/loadFromPack`；UI（设置页）提供技能启停面板；未来可从文件/URL 导入技能包，与 MCP 服务器动态发现相呼应。

### 5.4 MCP 预留层（Adapter 标准接口）

```ts
// mcp/types.ts —— 与任意 MCP 客户端解耦的标准接口
export interface MCPServerConfig { id: string; name: string; transport: 'stdio' | 'sse' | 'http'; url?: string; command?: string; enabled: boolean }

export interface MCPAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  listTools(): Promise<MCPServerTool[]>      // { name, description, parameters, serverId }
  callTool(name: string, args: unknown): Promise<{ content: string; isError?: boolean }>
}

export class MCPManager {
  servers = new Map<string, MCPAdapter>()
  async connectServer(cfg: MCPServerConfig, toolRegistry: ToolRegistry): Promise<void> {
    // 连接 → listTools → 转成 AgentTool 注入 ToolRegistry（Adapter→Registry 桥接）
  }
  async disconnectServer(id: string, toolRegistry: ToolRegistry): Promise<void> {
    // 移除该服务器注入的所有工具
  }
}
```

- `MCPManager` 只依赖 `MCPAdapter` 接口：未来落地 stdio/SSE/HTTP 传输时各自实现 Adapter，不影响 Agent 核心与 UI；
- MCP 工具与内置工具**进入同一个 ToolRegistry**，ToolLoop 天然支持，UI 无需感知来源。

### 5.5 Capabilities 注册表（把后台的"菜单模块"收敛为用例）

```ts
export interface Capability {
  id: 'chat' | 'summarize' | 'translate' | 'validate' | ...
  handle(req: AgentRequest, runtime: AgentRuntime): AsyncGenerator<AgentEvent>
}

export class CapabilityRegistry { register(cap: Capability): void; get(id): Capability }
```

| 现状 | 重构后 |
|---|---|
| `handleChat` | `ChatCapability`（skill 默认集 + pageContext） |
| `handleSummarize` | `SummarizeCapability`（调用 summarizer skill + 导出器管道） |
| `runTranslate` | `TranslateCapability`（translator skill + JSON 解析 → 结构化结果） |
| `runValidate` | `ValidateCapability`（Provider.validate） |
| 快捷指令（总结/解读/翻译/代码/答疑） | `CommandRegistry`：命令 → 技能 + 模板，一键执行 |

---

## 6. 消息路由重构（替换 switch-case）

```ts
// router/MessageRouter.ts
export class MessageRouter {
  handlers = new Map<string, (msg: any, sender: SenderCtx, runtime: AgentRuntime) => Promise<unknown>>()
  register(type: string, handler): void
  dispatch(msg, sender, runtime): Promise<unknown>
}

// 端口流：PortHub 把 chat-port/popup-port 的请求转成 AgentRequest，
// 订阅 AgentEventBus 并把事件转发回端口（chunk/done/error 与现状协议一致）
```

- `background/index.ts` 瘦身为：**装配根**（创建 Stores / Registries / AgentRuntime / Router）+ 注册表注册 + 快捷键 + `onInstalled`；
- 新增能力 = `router.register(type, handler)` + 注册一个 Capability/Tool/Skill，**不再改装配根**。

---

## 7. Content Script 宿主分层（Strategy + 服务拆分）

```
src/content/
  extraction/
    Extractor.ts            # interface：extract(ctx): PageContext
    ReadabilityExtractor.ts # 预算内路径（现有常规路径收敛）
    LightweightExtractor.ts # 预算外轻量路径（时间盒）
    Budget.ts               # 节点/深度/时间盒预算评估（现有 assessDocument 收敛）
    ExtractorFactory.ts     # 按预算选择策略（Strategy + Factory）
  host/
    HostController.ts       # 宿主生命周期、iframe 注入（现有 ensureHost 收敛）
    ChatWindowController.ts # 打开/收起/拖拽/缩放/全屏/状态持久化
    TranslateController.ts  # 划词触发、弹窗定位、结果重放
    SelectionService.ts     # 选区识别（英文/单词/短语判定）
    MessageRelay.ts         # postMessage 协议校验（nonce）与转发
```

好处：窗口管理、划词、提取各自独立可测；新增交互（如划词提问）只需新增一个 Controller。

---

## 8. 共享层领域化（可读性 + 维护性）

```
src/shared/
  types/            # 按域拆分：agent.ts / model.ts / page.ts / protocol.ts / ui.ts
  protocol/         # msg.ts 演进为类型化协议（消息 + 载荷类型 + 常量）
  stores/           # ConfigStore / SettingsStore / SessionStore / PopupSessionStore（封装 chrome.storage，含配额/容错）
  services/         # logger.ts（已有可插拔）、crypto.ts、context.ts（预算）
  themes/           # 主题令牌与 naive-ui 覆写
```

`ConfigStore.getActiveConfig()` 取代现在散落的 `getConfigs()+getActiveConfigId()` 组合调用。

---

## 9. UI 层（Vue composables 化）

| 现状 | 重构后 |
|---|---|
| chat/App.vue 内联全部逻辑 | `useChatSession`（消息、流式合并、会话持久化）+ `useAgentBridge`（端口连接、事件订阅） |
| popup/App.vue 双视图逻辑 | `useSettings`（表单/校验/预设）+ `usePopupChat` |
| translate/App.vue | `useTranslatePopup` |

UI 通过 `AgentBridge.subscribe(events)` 收事件、`AgentBridge.request(req)` 发请求——**UI 不再知道 Provider/Tool/Skill 的存在**，后续接 MCP 时 UI 零改动。

---

## 10. 设计模式对照表

| 模式 | 应用点 |
|---|---|
| 注册表（Registry） | ToolRegistry / SkillRegistry / CapabilityRegistry / ProviderFactory / EXPORT_TARGETS / LOG_SINKS |
| 策略（Strategy） | Extractor（Readability vs Lightweight）、Provider（OpenAI vs Anthropic） |
| 适配器（Adapter） | ChatProvider、MCPAdapter、StorageAdapter、日志 Sink |
| 命令（Command） | QuickCommandRegistry、MessageRouter 的 handler 映射 |
| 观察者/事件总线 | AgentEventBus、storage.onChanged、端口流转发 |
| 门面（Facade） | AgentRuntime（唯一能力入口）、AgentBridge（UI 入口） |
| 状态机（State Machine） | Agent 运行生命周期（ASSEMBLING→STREAMING⇄TOOL_CALL→DONE/ERROR） |
| 管道/责任链（Pipeline） | 请求流水线：校验→预算→组装→流式→工具循环→后处理 |
| 工厂（Factory） | ProviderFactory、ExtractorFactory |
| 依赖注入（DI） | AgentDeps 构造注入（单测友好） |

---

## 11. 迁移路线图（每阶段独立交付、可回滚）

| 阶段 | 内容 | 交付物 | 风险 |
|---|---|---|---|
| **P0 底座** | 目录重建 + Stores 收敛 + `shared/context`、`protocol` 类型化 | 行为不变，全量测试通过 | 低 |
| **P1 智能体核心** | `AgentRuntime + AgentEventBus + PromptAssembler + ChatProvider(OpenAI) + Capabilities(chat/summarize/translate/validate)`；background 改为装配根 + Router；UI 走 AgentBridge（协议不变） | 功能等价，可单测 Agent | 中 |
| **P2 工具与技能** | `ToolRegistry + ToolLoop`；`SkillRegistry + 内置技能包`；快捷指令改 CommandRegistry；设置页技能启停面板 | 工具/技能可插拔 | 中 |
| **P3 MCP 预留落地** | `MCPManager + MCPAdapter 接口 + 首个 Adapter（SSE/stdio）`；MCP 工具注入 ToolRegistry；设置页 MCP 服务器管理 | MCP 工具可调用 | 中高 |
| **P4 UI 与内容层** | 内容脚本分层（Strategy + Controllers）；Vue composables 化；长线优化（虚拟滚动等） | 结构收敛 | 低 |

兼容策略：

- **协议向后兼容**：`llm-chat / summarize / translate / validate / abort` 消息名与载荷结构保持不变，UI 与后台可分开迁移；
- **逐步替换**：每阶段结束跑全量单测（现有 57 项 + 新增 Agent 单测）+ 构建校验，任一阶段可回滚到上一阶段产物；
- **新增测试**：AgentRuntime 用 Mock Provider 做「流式/工具循环/错误/中止」全流程单测，这是本次重构最直接的收益之一。

---

## 12. 目标目录结构（摘要）

```
src/
├── background/
│   ├── main.ts                  # 装配根（唯一业务入口）
│   ├── agent/
│   │   ├── AgentRuntime.ts
│   │   ├── AgentEventBus.ts
│   │   ├── AgentContext.ts
│   │   ├── PromptAssembler.ts
│   │   └── ToolLoop.ts
│   ├── capabilities/            # Chat / Summarize / Translate / Validate
│   ├── commands.ts              # CommandRegistry
│   ├── providers/               # ChatProvider(接口) / OpenAIChatProvider / ProviderFactory / AnthropicProvider(预留)
│   ├── tools/                   # Tool(接口) / ToolRegistry / tools/*
│   ├── skills/                  # Skill(接口) / SkillRegistry / skills/*
│   ├── mcp/                     # MCPManager / MCPAdapter(接口) / adapters/*(预留)
│   ├── router/                  # MessageRouter / PortHub
│   └── config.ts                # 依赖装配
├── content/
│   ├── extraction/              # Extractor(接口) / Readability / Lightweight / Budget / Factory
│   └── host/                    # HostController / ChatWindow / Translate / Selection / Relay
├── shared/
│   ├── types/  protocol/  stores/  services/  themes/
└── ui/  (popup/chat/translate)  # composables + 组件
```

---

## 13. 关键取舍与说明

- **为什么用 AsyncGenerator 而非回调**：事件流天然可组合（`yield*` 串联 Capability 与 Provider）、可取消（`return` 即终止）、可测试（直接消费生成器）；
- **为什么 UI 不直接调 Provider**：AgentBridge 隔离后，未来"本地模型 vs 云端 vs MCP 组合"对 UI 完全透明；
- **MCP 本期只做接口与 Manager 骨架**：避免在没有真实需求前引入客户端依赖，但接口形状已与主流 MCP SDK 对齐，落地时零重构；
- **预算/配额/容错等防崩溃逻辑保留**：在重构中全部迁入新层（context.ts / stores），不丢失既有加固成果。
