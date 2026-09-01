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
