---
name: release-builder
description: 'Use when asked to build, package, or release this project ("打包", "发布", "生成版本压缩包", "出包", "build release", "make a release zip"), to produce the versioned archive under releases/ via the fingerprint + semver pipeline, including choosing the correct BUMP level, enforcing version uniqueness, and skipping packaging when dist is unchanged.'
---

# AI 网页阅读助手 · 版本发布打包（Release Builder）

生成 `releases/ai-web-reading-assistant-v<版本号>/`（内含 zip + 技术向变更文档）与 `releases/update.md`（产品向更新日志）的自动化工作流。产物与规则由本项目脚本落地，本技能定义**何时用、怎么选版本、如何验证**，避免凭感觉出包或重复出包。

## 何时使用

- 用户要求“打包 / 发布 / 出包 / 生成版本压缩包 / build release / make release zip”；
- 重构、加功能、修 bug 之后需要产出可分发 zip；
- 需要确认当前 dist 相对上次发布是否有变动、是否该递增版本。

## 核心事实（先读，不要凭印象）

- 构建链（按序执行，任一失败即停止、不产出 zip）：
  `node scripts/gen-icons.mjs && vite build && vite build --config vite.content.config.ts && node scripts/postbuild.mjs && node scripts/release.mjs`
  - `vite build`：主页面 + 后台（**所有编译产物带内容指纹** `js/[name]-[hash].js` / `assets/[name]-[hash][extname]`）；
  - `vite build --config vite.content.config.ts`：content script（IIFE，`js/content-[hash].js`）；
  - `scripts/postbuild.mjs`：拷贝图标/manifest，**按实际指纹重写 manifest** 的 `background.service_worker` 与 `content_scripts`，校验产物缺失即失败；
  - `scripts/release.mjs`：指纹比对 → 版本递增 → 版本目录 + zip → 变更文档 → 同步版本号。
- 一键命令：`npm run build`（递增级别**默认由大模型依据 git 记录自动判定**，配置在 `.env`：`MODEL_BASE_URL` / `MODEL_API_KEY` / `MODEL_NAME`）；也可手动覆盖：`BUMP=minor npm run build`。
- 大模型逻辑：`scripts/llm-release.mjs`（`decideBump` / `decideChangelog`）——以 `releases/version.json` 记录的上一版本 commit（无记录时用最新 `v*` 标签）为基线，收集到当前 HEAD 的 git 差异摘要，交由大模型判断 major / minor / patch，并生成两份变更文档：
  - **技术向** → `releases/ai-web-reading-assistant-v<版本>/update_release_doc.md`（本次构建变更了哪些内容）；
  - **产品向** → 追加到 `releases/update.md`（里程碑 / 时间 / 版本迭代内容，每次构建向文件末尾追加）。
  - 基线缺失或大模型不可用 / 失败时：级别兜底 patch、文档用 git 摘要兜底，构建不中断。
- 版本来源与规则：`scripts/release-lib.mjs`（`nextVersion` / `uniqueVersion` / `computeFingerprints`），状态记录在 `releases/version.json`（含 `commit` / `baselineCommit`，供下次差异对比）。

## 执行流程

### 1. 先确认代码已就绪

```sh
git status --short            # 或确认工作区就是本次要发布的版本
npm install                  # 依赖缺失时
```

### 2. 判定本次变动的规模，选择 BUMP（最重要的一步）

默认情况下 `npm run build` 会**自动调用大模型**，依据「上一版本 commit → 当前 HEAD」的 git 差异（文件数 / 增删行 / 提交记录）判定递增级别。手动指定 `BUMP` 可覆盖自动判定：

| 变更规模 | BUMP | 示例 |
|---|---|---|
| 重构 / 架构级大变动 | `major` | 后台 Agent 化重构、协议不兼容变更、内容差异很大 → `2.0.0` |
| 新模块 / 较大功能 | `minor` | 新增 MCP、技能面板、划词提问 → `1.1.0` |
| 小优化 / 小 bug 修复 | `patch`（自动判定兜底值） | 文案、性能微调、缺陷修复 → `1.0.1` |

不确定时按“改动落进哪些文件、影响面多大”判断：改了后台/内容层主流程 = 至少 minor；只改文案/样式/单测 = patch。

> 自动判定依赖“上一版本对应的 commit”：每次发布时 `release.mjs` 会把当前 commit 写入 `releases/version.json`。历史版本没有该记录时，可用标签补上：`git tag v1.1.1`。可单独调试判定：`npm run release:judge`。

### 3. 执行构建 + 发布

```sh
npm run build                      # 递增级别由大模型自动判定（推荐）
BUMP=minor npm run build           # 手动覆盖：major | minor | patch
```

### 4. 核对产物（必须）

```sh
ls -la releases/                          # 应出现 ai-web-reading-assistant-v<新版本>/ 目录与 update.md
ls -la releases/ai-web-reading-assistant-v<新版本>/   # zip + update_release_doc.md
cat releases/update.md                    # 本次条目已追加（里程碑 / 时间 / 版本迭代内容）
cat releases/version.json                 # version / history（不得重复）/ fingerprints / commit
python3 -c "import json;print(json.load(open('dist/manifest.json'))['version'])"   # 版本已同步
python3 -c "import json;print(json.load(open('package.json'))['version'])"
```

- 产物结构：`releases/ai-web-reading-assistant-v<版本>/` 目录内含 `ai-web-reading-assistant-v<版本>.zip`（根目录包含 `dist/`）与 `update_release_doc.md`（技术向变更说明）；
- `releases/update.md`：产品向更新日志，每次构建向文件末尾追加一条（`## v<版本> · <日期>`）；
- 版本号已同步到 `dist/manifest.json`、`public/manifest.json`、`package.json`。

## 三条硬规则（脚本已强制，复核输出确认）

1. **版本不得重复**：`uniqueVersion` 会对照 `releases/version.json.history` 自动把重复版本递增到唯一；若输出中 history 出现重复，视为异常，检查 `releases/version.json` 是否被手工改坏。
2. **dist 无变动不打包**：指纹（全部 dist 文件 SHA-256，排除含版本号的 `manifest.json`）与上次发布一致时，`release.mjs` 打印 `dist 无任何变动，跳过打包` 并退出 0——此时**不要**手动再打一个同版本 zip，也不要误报“发布失败”。
3. **打包失败不产出压缩包**：zip 先写临时文件再改名，`zip` 命令失败会清理并退出非 0；构建/postbuild 任一步失败同样中断。失败时排查原因后重跑，**禁止手工复制 dist 冒充产物**。

## 常见输出与解读

| 输出 | 含义 | 下一步 |
|---|---|---|
| `[release] 版本递增：1.0.0 → v1.0.1（patch）` + `📄 已生成 ...update_release_doc.md` + `✅ 已生成 releases/.../` | 正常发布 | 按“核对产物”检查 |
| `[release] ℹ️ dist 无任何变动，跳过打包（版本保持 v1.0.0）` | 无代码变化 | 无需动作；若确实改了代码，先确认改动进了 dist（见下） |
| `[release] 🤖 大模型判定递增级别：...` / `📄 已生成 ... 并追加 releases/update.md` | 大模型正常参与判定与文档生成 | 复核级别是否符合预期，不符可 `BUMP=...` 覆盖重跑 |
| `[release] ⚠️ ... 按 patch 兜底` / `⚠️ ... 使用 git 摘要兜底` | 缺基线或大模型失败 | 为上一版本补标签 `git tag v<版本>`，或检查 `.env` 模型配置后重跑 |
| `[postbuild] ❌ 缺少产物文件` | 构建不完整 | 检查源码/依赖，修复后重跑 |
| `[release] ❌ zip 打包失败` | 系统无 `zip` 命令或磁盘问题 | 安装 zip 或清理 releases 后重跑 |

## 疑难排查

- **改了源码却“无变动跳过”**：确认改动会进入 dist（注释/README 改动不影响 bundle）；或先 `npm run build`（不带 BUMP）确认 postbuild 打印的指纹文件有变化。
- **想强制重新出包**（如怀疑指纹状态损坏）：删除 `releases/version.json` 后重跑（版本会按 package.json 重新计算，注意与历史保持一致）；优先保留 history。
- **本地逻辑自检**：`node tests/release.test.mjs` 覆盖递增规则/唯一性/指纹比对，改动 `scripts/release-lib.mjs` 后必须跑它。

## 相关文件索引

- `scripts/release.mjs` — 发布编排（指纹比对 / 版本递增 / 版本目录 + zip / 变更文档 / 版本同步 / 状态写入）
- `scripts/llm-release.mjs` — 大模型判定与文档生成（`.env` 模型配置 / 基线定位 / git 差异摘要 / `decideBump` / `decideChangelog` / 兜底），可单独运行调试：`npm run release:judge`
- `scripts/release-lib.mjs` — 纯逻辑（`nextVersion` / `uniqueVersion` / `computeFingerprints` / `fingerprintsEqual`）
- `scripts/postbuild.mjs` — manifest 指纹重写与产物校验
- `releases/version.json` — 发布状态（version / history / fingerprints / commit / baselineCommit），**不要手工编辑**（历史版本无 commit 记录时用 git 标签补基线）
- `releases/update.md` — 产品向更新日志（里程碑 / 时间 / 版本迭代内容），脚本自动追加
- `releases/ai-web-reading-assistant-v<版本>/` — 每次发布的目录：zip + `update_release_doc.md`（技术向）
- `tests/release.test.mjs` — 发布逻辑单测（含大模型输出解析 / .env 解析 / 文档渲染与追加）
