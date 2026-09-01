---
name: code-writer
description: 'Use when writing, creating, or modifying source files (.vue / .ts / .js / .css / .scss / .less / .stylus，如「写/新建/改一个组件、页面、方法、样式」), to enforce: ≤400 lines per file, `<script setup>` first then `<template>`, Tailwind-first styling with custom CSS after the template, ESLint-clean code with no deprecated APIs, and extraction of a large .vue template to an external html via `<template src>` when it can no longer be split.'
---

# 代码书写规范（Code Writer）

为本项目书写 / 修改源码文件（`.vue` / `.ts` / `.js` / 样式文件）时的统一约定，避免文件膨胀、样式散落、使用过期 API。

## 何时使用

- 新建或修改任何 `.vue` / `.ts` / `.js` / `.css` / `.scss` / `.less` / `.stylus` 文件；
- 拆分过长文件、抽取公共组件 / composable / 工具函数；
- 判断一个文件是否该拆、样式与结构该如何组织。

## 通用硬规则（适用于所有文件）

1. **单文件 ≤ 400 行**（含注释）。超限必须拆：
   - `.vue` → 拆 `components/` 子组件、`composables/`（`useXxx.ts`）；
   - `.ts / .js` → 拆工具模块、composable，或按功能分文件；
   - 样式文件 → 按主题 / 区块拆分，无法再拆时用 `@import` 抽离部分选择器到独立文件。
2. **符合 ESLint 校验**：不得引入 lint 报错。若当前仓库暂未配置 ESLint，则按通用规则自查；一旦接入 ESLint，新代码必须通过。
3. **不得使用已废弃或即将废弃的 API**：如 `String.prototype.substr`、`Date.prototype.getYear`、`with` 语句、`window.event` 等；不确定时以当前依赖版本文档为准。
4. **核心方法必须加注释**：说明“做什么 / 为什么这么做 / 边界情况（超时、重试、异常兜底）”。逻辑非显而易见处必须写，一句话即可。

## .vue 文件规则

1. 采用 `<script setup lang="ts">`，且 **script 在前、template 在后**（唯一顺序）。
2. 样式默认用 Tailwind 工具类；确需自定义 CSS 时才写 `<style>`，放在 template 之后、文件末尾，且用 `scoped`——跨组件共享类放全局样式文件（如 `chat.css`），不写在组件里。
3. 组件接口用 `defineProps` / `defineEmits` / `defineModel`；交互通过 `emit('xxx', payload)` 向上通知，编排逻辑留在父级。
4. 模板中直接引用的响应式值，从 composable 返回对象**解构到顶层**（嵌套在普通对象里的 ref 在模板中不会自动解包）。
5. 单文件尽量 ≤ 400 行（页面 / 根组件目标更严）。确实无法再拆、但行数仍较大时，将 template 抽到独立 `.html` 文件，用 `<template src="./Xxx.html" />` 引入（本仓库 `@vitejs/plugin-vue` 支持所有 SFC 块类型带 `src`）。html 中**较大的模块必须加注释**，注明这块是哪种布局 / 区域。

## TS / JS 文件规则

### 一、命名规范（最影响可读性）

1. 大小写约定：

| 类型 | 风格 | 示例 |
|---|---|---|
| 变量、普通函数、方法 | 小驼峰 `camelCase` | `getUserInfo`、`userList` |
| 类、TS 类型、接口、枚举 | 大驼峰 `PascalCase` | `UserInfo`、`HttpResponse` |
| 常量（硬编码不变值） | 全大写下划线 `SNAKE_CASE` | `MAX_PAGE_SIZE`、`TOKEN_KEY` |
| 文件、文件夹 | `kebab-case`（推荐）/ 小驼峰 | `user-service.ts`、`use-table-list.ts` |

2. 命名原则：
   - 见名知意，拒绝缩写：`currentDate`（而非 `d`）、`userList`（而非 `lst`）；
   - 布尔值前缀 `is` / `has` / `can` / `should`：`isLoading`、`hasPermission`、`canSubmit`；
   - 函数用「动词 + 名词」：查询 `get/fetch/query`，新增 `create/add`，修改 `update/edit`，删除 `remove/delete`；
   - 避免泛型命名 `data` / `temp` / `item`（局部循环短变量除外）。

### 二、文件 & 模块结构规则

1. **单文件职责单一**（最重要）：一个文件只做一件事。工具函数不要一个文件塞几十个无关的；service 文件只放接口请求、不掺杂业务判断；hook 一个组合式函数一个文件 `use-xxx.ts`。
2. **文件内部代码顺序**（固定，所有人一致，自上而下）：

   1. 第三方 import
   2. 项目内部模块 import（`@/`）
   3. 类型、接口、枚举定义
   4. 常量
   5. 私有辅助函数（仅本文件内部使用）
   6. 导出函数 / 主逻辑

   import 分组之间空一行，不要 import 散落文件各处。

### 三、函数书写规则

1. 单个函数控制在 **50–80 行**以内，超长拆小函数；一个函数只完成一个动作。
2. 参数 > 3 个时改用对象入参：

   ```ts
   // ❌ function createUser(name, age, phone, address) {}
   // ✅
   type CreateUserOpt = { name: string; age: number; phone: string; address: string }
   function createUser(opt: CreateUserOpt) {}
   ```

3. **优先提前 return（卫语句）**，扁平化，拒绝超大嵌套 if-else：

   ```ts
   // ❌
   function getUser(id?: number) {
     if (id) {
       if (id > 0) return queryUser(id)
     }
     return null
   }
   // ✅
   function getUser(id?: number) {
     if (!id) return null
     if (id <= 0) return null
     return queryUser(id)
   }
   ```

4. 纯函数优先：无副作用、相同输入恒返回相同结果，适合工具方法。

### 四、类型（TypeScript）维护规则

- **不要滥用 `any`**：临时不知类型用 `unknown` + 类型收窄；
- 对象结构优先 `interface`；`type` 用于联合、别名（如 `type Status = 'success' | 'fail'`）；
- 类型抽离到顶层 / 独立文件，不要散落在业务行内（`Array<{id;name}>` → `interface UserItem`）；
- API 返回结构单独定义 **DTO**，前后端契约对齐。

### 五、条件、循环、分支（可读性大坑区）

- 超长判断条件抽成布尔变量：

  ```ts
  const isAdult = user.age > 18
  const isAccountNormal = user.status === 1
  const isVipUser = user.vip
  if (isAdult && isAccountNormal && isVipUser) {}
  ```

- 多分支优先 `switch` / 对象映射表，拒绝超长 if-else 链：

  ```ts
  const statusMap: Record<number, string> = { 0: '待审核', 1: '已通过', 2: '已拒绝' }
  const text = statusMap[status] ?? '未知状态'
  ```

- 三元运算符只适合简单单行，**禁止嵌套三元**。

### 六、异步代码最佳规则（Promise / async-await）

- 优先 `async/await`，少用 `.then()` 链式回调；
- 异步函数必须 `try-catch`，不要漏掉异常处理；
- 并行请求用 `Promise.all`，不要串行无谓等待：

  ```ts
  const [user, dept] = await Promise.all([fetchUser(), fetchDept()])
  ```

### 七、注释规范（少而精，拒绝废话注释）

- 代码告诉你「怎么做」，注释告诉你「**为什么**」；
- 三类必须写注释：① 业务特殊逻辑、坑点、历史遗留问题；② 复杂算法、公式、边界判断；③ 对外导出的公共函数（用 JSDoc）：

  ```ts
  /** 根据用户 id 获取详情
   *  @param userId - 用户编号 */
  export function getUserDetail(userId: number) {}
  ```

- 禁止废话注释（`// 定义用户列表`、`// 循环遍历`）；理想目标：代码自解释，好命名 > 注释。

### 八、副作用 & 可维护性避坑

- 禁止在顶层直接执行副作用（导入即自动发请求、修改全局变量）；
- 尽量不修改入参对象（避免副作用），优先返回新对象（`{ ...user, name: 'xxx' }`）；
- **魔法数字全部提取为常量**，禁止裸写数字：

  ```ts
  const PASS_SCORE = 60
  if (score >= PASS_SCORE) {}
  ```

### 九、导出与导入规范

- 优先**具名导出** `export function` / `export const`，慎用 `export default`（default 适合单文件唯一组件 `.vue`，普通 ts/js 文件少用）；
- 不要 `import * as xxx` 大包导入，按需引入。

### 十、配套工程化落地（用工具自动校验，不靠人自觉）

- Prettier：格式化（换行、空格、分号、引号）；
- ESLint：强制代码质量规则，推荐开启几条高收益规则：

  ```jsonc
  {
    "rules": {
      "max-lines": ["warn", { "max": 80 }],
      "max-nested-callbacks": ["warn", 3],
      "no-else-return": "error",
      "prefer-const": "error",
      "no-magic-numbers": ["warn", { "ignore": [0, 1] }]
    }
  }
  ```

## 样式文件规则（.css / .scss / .less / .stylus）

1. 单文件 ≤ 400 行。
2. **尽量使用兼容性高的属性**：避免过度依赖过新或厂商独占属性；非必要不加 `-webkit-` 等前缀，现代 CSS 特性先用无前缀写法并保证有可用的降级表现。
3. **尽量使用变量**：颜色 / 间距 / 字号等收敛为 CSS 自定义属性（`--xxx`）或 SCSS/LESS/Stylus 变量，方便未来整体换肤 / 换样式。
4. 大类目（区块）之间加注释分组，便于定位。

## 反例（避免）

- ❌ 任何文件超 400 行仍硬塞（应拆组件 / composable / 模块）
- ❌ 使用 `substr`、`getYear` 等废弃 / 即将废弃 API
- ❌ 核心方法无注释，只留给人猜
- ❌ `.vue` 中 `<template>` 在前，或 `<style>` 夹在 script 与 template 之间
- ❌ 能用 Tailwind 一句话表达的样式却写 `<style>`
- ❌ 样式文件写死颜色 / 间距值，不用变量
- ❌ 大 `.vue` 不拆 template、硬堆到 400+ 行
