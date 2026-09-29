# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AI Galgame（次元邂逅）—— 一个纯前端 AI 视觉小说游戏，部署在 Cloudflare Pages。

- **仓库**: greenwoodpro/AIgalgame（master分支）
- **部署**: https://galai.dpdns.org / https://aigalgame.pages.dev
- **技术栈**: 纯 HTML/CSS/JS（无构建步骤），Cloudflare Pages Functions + Worker 作为 API 代理

## 开发命令

本项目无构建工具，直接用浏览器打开 `index.html` 即可开发。

- **本地开发**: 直接打开 `index.html`，或任意静态服务器（`python -m http.server`）
- **API 代理本地测试**: `npx wrangler pages dev .`（需配置 `.dev.vars` 存放 API keys）
- **部署**: git push 到 master 分支，Cloudflare Pages 自动部署
- **语法检查**: `node --check app.js`（改完 JS 必查）

## 核心架构

### 单文件架构（无框架）

- **`app.js`** (~5200行): IIFE 闭包。核心模块：
  - `Storage` / `IDB` — localStorage 缓存层 + IndexedDB 图片存储
  - `API_CONFIGS` — 提供商配置（modelscope/sense/zhipu/nvidia/agnes/custom），含 `supportsModelList` 标记
  - 模型选择器组件 — `initModelPicker` / `renderModelList` / `fetchModelsForProvider`（可搜索下拉 + 动态 `/models` 拉取 + 12h localStorage 缓存，key 前缀 `galgame_models_`）
  - `buildThinkingBody()` — 按模型家族生成思考参数（qwen3→enable_thinking，deepseek-v4→thinking.type，gpt-oss→reasoning_effort；未知模型不传防 400）
  - `callAiApi(userMessage, retryCount, streamCallbacks, _forceProxy)` — streamCallbacks 结构化回调 { onText, onThinking, onThinkingDone }；直连 fetch 失败（CORS）自动 `_forceProxy=true` 重试一次
  - `processApiResponse` — 流式解析 delta.content + delta.reasoning_content/reasoning
  - `prepareStreamUI` / `makeStreamCallbacks` / `finishStreamUI` — 思考气泡（聊天）与淡化思考文本（游戏）统一管理
  - `requestBackToTitle` — state._dirty 未存档时弹确认 modal
  - `showSuggestedChoices` — AI 回复附带 choices 的渲染（游戏 choices-box / 聊天内联按钮）
- **`index.html`** (~700行): 所有屏幕 + hash 路由 + 设置面板（4 tab）
- **`style.css`** (~4000行): 6 主题（light/dark-star/ink-wash/sakura/cyber/ocean）+ 新组件样式（v2 扩展块在文件末尾）

### API 代理（双通道）

- **Pages Functions** (`functions/api/[[path]].js`): 同域代理，`/api/{provider}/...`
- **Worker** (`worker.js`): 独立代理 `https://galai-proxy.greenwood245.workers.dev`
- provider: zhipu / modelscope / nvidia / agnes / **sense**（商汤 token.sensenova.cn/v1）/ custom（X-Custom-Target-URL 头）
- 环境变量：`ZHIPU_API_KEY`, `MODELSCOPE_API_KEY`, `NVIDIA_API_KEY`, `AGNES_API_KEY`, `SENSE_API_KEY`
- GET /models 请求被原样转发 → 前端动态模型列表依赖此能力
- 两个代理文件内容几乎一致，**改一个必须同步改另一个**

### 内容边界（重要）

- 所有角色年龄为成年人（19/18/19/20），大学校园背景（SPRITE_CONFIG profiles + DEFAULT_SYSTEM_PROMPT 中声明）
- 进阶模式（advancedMode）仅提升浪漫描写的成熟度，保持文学性与分寸感，不含露骨内容（ADVANCED_MODE_PROMPT 中有明确边界约束）
- 角色年龄不得改回未成年数值

### 存储架构

- **localStorage**: 设置、存档（可重命名）、对话历史、模型列表缓存
- **IndexedDB** (`galgame_img_store`): AI 生成图片
- `state._dirty` 追踪未保存进度；存档成功后 `markClean()`

### 关键设计决策

- AI 回复 JSON：`{name, dialog, emotion, action, scene, choices[3]}`；choices 是 v2 新增的建议选项
- 思考默认开启（enableThinking: true, thinkingEffort: 'low'），流式默认开启（streamOutput: true）
- 对话历史浏览：Enter = 跳到下一条消息，到底部才继续/发送（showPreviousDialog/showNextDialog + inputDraft 草稿保护）
- 画廊性能：先渲染骨架 + URL 图，IDB base64 分批（8张/批）并行异步填充（openGallery）
- 主题切换 applyTheme + VALID_THEMES 常量（新增主题必须三处同步：CSS 变量块、index.html theme-card、VALID_THEMES + 粒子类型映射）

## 文件忽略规则

`LingChat/`、`PROJECT_CONTEXT.md`、`.trae/` 已加入 `.gitignore`。
