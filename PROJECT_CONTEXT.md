# AI Galgame 项目上下文文档

> 将此文档发给新对话，即可让新助手快速了解项目状态并继续工作。

## 项目概述

- **项目名称**: AI Galgame（AI视觉小说游戏）
- **GitHub仓库**: greenwoodpro/AIgalgame（master分支）
- **部署平台**: Cloudflare Pages
- **网站地址**: https://aigalgame.pages.dev
- **本地路径**: `d:\OneDrive\Desktop\web`

## 项目架构

### 文件结构
```
d:\OneDrive\Desktop\web\
├── index.html          # 主页面（设置面板、响应式设计、hash路由、昼夜模式）
├── app.js              # 主应用逻辑（存储、AI调用、UI处理、昼夜模式）
├── style.css           # 样式（含移动端适配、昼夜模式CSS）
├── worker.js           # Cloudflare Worker（API代理）
├── functions/api/[[path]].js  # Pages Functions代理
├── background.png      # 网页背景图
├── galgame.ico         # 网站图标
├── model_benchmark.html # 模型测试结果分析页面
├── nim_test - 3.html   # NVIDIA NIM 57模型测试参考页面
├── test_results.json   # 最新API测试结果
└── .gitignore
```

### API代理架构
- **Pages Functions** (`functions/api/[[path]].js`): 同域代理，路径 `/api/{provider}/...`
- **Cloudflare Worker** (`worker.js`): 独立代理，地址 `https://galai-proxy.greenwood245.workers.dev`
- 代理会重建请求头（不转发浏览器头），避免API 400错误
- 环境变量在 Cloudflare Pages 设置中配置（ZHIPU_API_KEY, MODELSCOPE_API_KEY, NVIDIA_API_KEY）

### 存储架构
- **localStorage**: 设置、存档、对话历史（~5MB限制）
- **IndexedDB** (`galgame_img_store`): 图片存储（GB级）
- **统一Storage管理器**: 缓存层 + export/import + 数据迁移
- 无R2存储（需绑卡，用户明确拒绝）

## 当前模型配置（app.js API_CONFIGS）

### 智谱AI (zhipu)
- **文本**: glm-4-flash-250414（推荐）, glm-4.7-flash⚠️限流
- **图像**: cogview-3-flash
- 注意: glm-4.7-flash 有429限流问题；glm-4.1v-thinking-flash 已移除（暴露思维链）

### 魔搭社区 (modelscope)
- **文本**: Qwen/Qwen3.5-35B-A3B（推荐）, Kimi-K2.5✨最佳, DeepSeek-V3.2, MiniMax-M2.5, GLM-5（较慢）, DeepSeek-R1🧠, DeepSeek-V4-Flash⚠️不稳定, DeepSeek-V4-Pro⚠️不稳定, GLM-4.7-Flash⚠️限流
- **图像**: Z-Image/Z-Image-Turbo, DiffSynth-Studio/FLUX.1-Kontext-dev-lora-highresfix
- 已移除: Qwen/Qwen3-8B（NoneType）, ZhipuAI/GLM-4.7:DashScope（400不支持）

### NVIDIA NIM
- **文本**: Llama-4-Maverick（推荐）, Kimi-K2✨最佳, Qwen2.5-Coder-32B, GPT-OSS-120B, GPT-OSS-20B, Llama-3.1-8B
- 已移除: deepseek-ai/deepseek-v4-flash（极慢46s+）, meta/llama-3.1-70b-instruct（不稳定502）

### 默认设置
- 文本模型: `Qwen/Qwen3.5-35B-A3B`（魔搭）
- 图像模型: `cogview-3-flash`（智谱）
- 代理模式: 默认开启（useProxyKeys: true）
- 生图冷却: 默认60s
- 昼夜模式: 默认昼（day）

## 已实现功能清单

1. ✅ Cloudflare Pages Functions API代理（同域，避免CORS）
2. ✅ 请求头重建（修复API 400错误）
3. ✅ 429限流自动重试 + 图像生成冷却（默认60s）
4. ✅ 自定义文本输入（AI对话中）
5. ✅ 信息徽章（显示当前模型和连接信息）
6. ✅ 设置面板保存按钮（非自动保存）
7. ✅ 移动端响应式适配
8. ✅ localStorage + IndexedDB 统一存储
9. ✅ 数据导出/导入备份
10. ✅ 图像生成频率可选（30s/45s/60s/90s/120s）
11. ✅ 移动端select下拉框显示修复（去除setTimeout，同步设值）
12. ✅ Hash路由（浏览器后退支持）
13. ✅ 对话历史自动清理
14. ✅ 流式输出（带淡化效果，可选3种模式）
15. ✅ 429自动切换模型 + 悬浮提示
16. ✅ 中途退出AI模式可恢复上次对话
17. ✅ 响应字数区间可调（默认100-300字）
18. ✅ 昼夜模式（默认昼，与主题颜色独立控制）
19. ✅ AI人设优化（真人角色而非AI助手）
20. ✅ 存档系统修复（deleteSlot使用Storage统一管理）

## 模型测试结果（2026-05-07 最新）

### 测试方法
- 通过 Cloudflare Pages 代理（aigalgame.pages.dev/api）
- 模拟Galgame对话开场
- 100分质量评分体系
- 3秒间隔避免限流

### 质量排名（成功模型 13/17）
| 排名 | 模型 | 平台 | 质量分 | 耗时 |
|------|------|------|--------|------|
| 1 | Kimi-K2.5 | 魔搭 | 100 | 5.8s |
| 2 | Kimi-K2 | NVIDIA | 100 | 10.1s |
| 3 | DeepSeek-V3.2 | 魔搭 | 92 | 5.6s |
| 4 | GLM-5 | 魔搭 | 92 | 32.6s |
| 5 | MiniMax-M2.5 | 魔搭 | 92 | 5.4s |
| 6 | Llama-4-Maverick | NVIDIA | 92 | 1.9s |
| 7 | Qwen2.5-Coder-32B | NVIDIA | 92 | 1.6s |
| 8 | Qwen3.5-35B | 魔搭 | 86 | 13.0s |
| 9 | DeepSeek-R1 | 魔搭 | 86 | 7.3s |
| 10 | GLM-4-Flash | 智谱 | 86 | 4.0s |
| 11 | GPT-OSS-120B | NVIDIA | 86 | 3.7s |
| 12 | GPT-OSS-20B | NVIDIA | 86 | 1.8s |
| 13 | Llama-3.1-8B | NVIDIA | 86 | 1.5s |

### 速度排名（成功模型）
| 排名 | 模型 | 平台 | 耗时 |
|------|------|------|------|
| 1 | Llama-3.1-8B | NVIDIA | 1.5s |
| 2 | Qwen2.5-Coder-32B | NVIDIA | 1.6s |
| 3 | GPT-OSS-20B | NVIDIA | 1.8s |
| 4 | Llama-4-Maverick | NVIDIA | 1.9s |
| 5 | GLM-4-Flash | 智谱 | 4.0s |
| 6 | GPT-OSS-120B | NVIDIA | 3.7s |
| 7 | MiniMax-M2.5 | 魔搭 | 5.4s |
| 8 | DeepSeek-V3.2 | 魔搭 | 5.6s |
| 9 | Kimi-K2.5 | 魔搭 | 5.8s |
| 10 | DeepSeek-R1 | 魔搭 | 7.3s |
| 11 | Kimi-K2 | NVIDIA | 10.1s |
| 12 | Qwen3.5-35B | 魔搭 | 13.0s |
| 13 | GLM-5 | 魔搭 | 32.6s |

### 失败模型（4/17）
- **魔搭**: DeepSeek-V4-Flash（响应内容为空）, DeepSeek-V4-Pro（响应内容为空）, GLM-4.7-Flash（响应内容为空）
- **智谱**: GLM-4.7-Flash（429限流/响应为空）

详细测试结果见: `test_results.json`

## 已知问题 & 待办

1. 魔搭社区部分模型API返回空内容（DeepSeek-V4-Flash/V4-Pro, GLM-4.7-Flash），可能是代理转发时响应解析问题
2. 智谱GLM-4.7-Flash限流严重，需要更好的429处理
3. GPT-OSS-20B的选项偶尔用英文
4. Llama-3.1-8B偶尔用错角色名（"你"而非"星酱"），且偶尔缺少choices字段
5. GLM-5响应极慢（32.6s），不适合实时对话
6. wrangler.toml 已不需要（用户npm版本不够，已将worker.js和dev分支放入仓库）
7. nim_test - 3.html 是NVIDIA NIM 57模型测试的参考页面，保留供参考

## AI叙事架构设计（基于行业研究）

### 核心设计理念
- **固定里程碑+灵活对话**：关键剧情节点固定，中间对话AI生成，避免叙事混乱
- **AI作为调味料而非主菜**：不是所有内容都由AI生成，保持质量
- **角色一致性优先**：详细的角色档案+禁止行为+风格锚点

### 提示词架构
- **三元提示架构**：角色设定(Character) + 场景背景(Context) + 目标动因(Goal)
- **禁止行为清单**：6条明确的禁止规则，违反即角色崩坏
- **情感目标系统**：5种情感方向（亲密/冒险/悬疑/日常/冲突）
- **选项设计原则**：主线推进/支线探索/情感互动三个方向

### 上下文管理
- **核心记忆提取**：`extractCoreMemories()` 从对话历史中提取关键事件（最多3条）
- **风格锚点**：最近2条assistant回复作为风格参考，保持语气一致
- **前情提要**：动态生成包含互动轮数和关键记忆的上下文提示
- **上下文裁剪**：`maxContext * 2` 条消息，避免token溢出

### 参考项目
- 主角光环(Protagonist Halo)：Gemini驱动的互动小说引擎，RAG记忆系统
- IntelliVNG Studio：3 Agent + 1 Orchestrator多智能体架构
- StoryNight：固定里程碑+灵活对话，角色专属提示合约
- AI4VisualNovel：DAG拓扑排序+Actor Agent防OOC
- ElyHa：Planner→Writer→Reviewer→Synthesizer工作流

## CORS策略
- **魔搭社区**: 支持CORS，有API Key时可直接连接
- **智谱AI**: 不支持CORS，必须走代理
- **NVIDIA NIM**: 不支持CORS，必须走代理
- 默认开启代理模式（useProxyKeys: true），使用Cloudflare环境变量中的密钥

## 关键代码位置

- 模型配置: `app.js` API_CONFIGS
- 默认设置: `app.js` state.settings
- 存储管理: `app.js` Storage
- IndexedDB: `app.js` IDB
- AI调用: `app.js` callAiApi
- 图像生成: `app.js` generateSceneImage
- 昼夜模式: `app.js` applyDayNightMode
- Hash路由: `app.js` switchScreen / handleHashChange
