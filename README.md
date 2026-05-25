# AI Galgame — 次元邂逅

<!-- 封面图 -->
<p align="center">
  <img src="preview.jpg" width="800" alt="AI Galgame 预览">
</p>

一个纯前端 AI 驱动的视觉小说游戏，通过大语言模型实时生成剧情对话，支持多角色、多情绪、AI 生图背景，无需后端服务器即可运行。

**在线体验**: [galai.dpdns.org](https://galai.dpdns.org) / [aigalgame.pages.dev](https://aigalgame.pages.dev)

---

## 技术栈

- **前端**: 纯 HTML / CSS / JavaScript（无框架、无构建步骤）
- **API 代理**: Cloudflare Pages Functions + Cloudflare Worker
- **存储**: localStorage（设置/存档）+ IndexedDB（AI 生成图片）
- **部署**: Cloudflare Pages（git push 自动部署）

---

## 已实现功能

### 核心游戏系统

| 功能 | 说明 |
|---|---|
| AI 实时对话 | 大语言模型根据玩家选择生成剧情，JSON 格式返回角色回复 |
| 分段打字机效果 | 长文本自动分段（最多 3 段），逐字显示 + 情感动画 |
| 情感系统 | 8 种情绪（happy/sad/angry/surprised/shy/neutral/scared/tsundere），对应不同立绘表情 |
| 选项驱动 | 每次回复生成 3 个选项，推动主线 / 探索支线 / 情感互动 |
| 大纲模式 | 用户创建剧情大纲 → AI 按章节推进故事 |
| AI 生成背景 | 根据 scene 字段调用图像 API 生成场景背景图 |

### 角色系统

四名可攻略角色，每次开局随机分配，各有独立人设和口癖：

| 角色 | 身份 | 性格标签 |
|---|---|---|
| 星酱 (char_1) | 同桌兼女朋友 | 温柔、害羞、善解人意 |
| 小樱 (char_2) | 邻座活泼少女 | 古灵精怪、爱恶作剧 |
| 流萤 (char_3) | 低年级学妹 | 天真无邪、纯真可爱 |
| 豆包 (char_4) | 高年级学姐 | 傲娇毒舌、嘴硬心软 |

### 对话与交互

- **Enter 发送 / Shift+Enter 换行**，对话框右下角有发送按钮
- 对话历史浏览（上翻/下翻查看之前的回复）
- 自定义输入模式（AI 模式下玩家可自由输入回复）
- Chat 界面（类 IM 聊天气泡样式，可切换）
- 对话存档 / 读档（localStorage 持久化）

### 视觉与动画

- 首页毛玻璃标题 + 背景图 30 秒自动随机轮换
- 鼠标点击爱心上浮消失动画（全屏）
- 角色立绘入场抖动效果 + 表情切换
- 粒子系统背景（可开关）
- 浅墨水墨风 UI 配色

### 模型提供商

| 提供商 | 文本模型 | 图像模型 | 特点 |
|---|---|---|---|
| 智谱 AI | GLM-4-Flash | CogView-3-Flash | 免费额度 |
| 魔搭社区 | Qwen / Kimi / DeepSeek 等 | Z-Image / FLUX | 多模型可选，支持异步轮询 |
| NVIDIA NIM | Llama-4 / Kimi 等 | — | 高性能推理 |
| 自定义 | 任意 OpenAI 兼容 API | 任意 | 灵活接入 |

### 设置系统

- 上下文轮数（默认 5 轮，可调 2-50）
- 最大回复长度（默认 350 tokens，可调 50-4096）
- 打字速度 / 文字特效切换
- 自动场景图生成开关 / 冷却时间
- 粒子背景开关
- API 代理开关（默认启用，密钥安全存储在服务端）
- 数据导出 / 导入（完整备份所有设置和存档）

---

## 项目结构

```
├── index.html                  # 游戏界面（所有屏幕 + hash 路由）
├── app.js                      # 核心逻辑（~4200 行，IIFE 闭包）
├── style.css                   # 样式（毛玻璃/昼夜模式/移动端适配）
├── worker.js                   # Cloudflare Worker API 代理
├── functions/
│   └── api/
│       └── [[path]].js         # Pages Functions 同域 API 代理
├── sprites/
│   ├── background/             # 默认背景图（pic1-3）
│   ├── char1/ ~ char4/         # 四角色 × 4 表情立绘
│   └── particles/              # 粒子特效素材
├── galgame.ico                 # 网站图标
└── .gitignore
```

---

## 本地开发

本项目无构建步骤，直接用浏览器打开 `index.html` 即可。

```bash
# 克隆仓库
git clone https://github.com/greenwoodpro/AIgalgame.git
cd AIgalgame

# 直接打开
open index.html          # macOS
start index.html         # Windows

# 或用 VS Code Live Server

# API 代理本地测试（需要配置 .dev.vars）
npx wrangler pages dev .
```

`.dev.vars` 文件（已 gitignore）用于本地存放 API 密钥：
```
ZHIPU_API_KEY=your_key_here
MODELSCOPE_API_KEY=your_key_here
NVIDIA_API_KEY=your_key_here
```

---

## 部署

本项目使用 Cloudflare Pages 自动部署：

1. Fork 本仓库
2. 在 Cloudflare Pages 中连接 GitHub 仓库
3. 配置环境变量（`ZHIPU_API_KEY`, `MODELSCOPE_API_KEY`, `NVIDIA_API_KEY`）
4. Push 到 `master` 分支即自动部署

> **注意**: 部署通常需要 1-3 分钟，首次绑定域名可能需要更长时间。部署期间网站仍可正常访问旧版本。

---

## 已知问题

### 功能性问题

| 问题 | 严重度 | 说明 |
|---|---|---|
| BGM 功能不可用 | 中 | HTML 中缺少 `#bgm-current` / `#bgm-next` 音频元素，JS 代码有但无法播放 |
| TTS 语音不可用 | 中 | HTML 中缺少 `#tts-toggle` / `#tts-voice` 表单元素，用户无法控制 |
| BGM 音量滑块缺失 | 低 | `#bgm-volume` 元素不存在，设置存了但无 UI 控制 |
| 非 AI 模式剧情固定 | 低 | 普通模式（非 AI）的剧情分支写死了"星酱"相关内容，不随角色变化 |

### 使用注意

| 项目 | 说明 |
|---|---|
| **自定义 API 兼容性** | 自定义 API 需要兼容 OpenAI 格式（`/v1/chat/completions`），部分非标准服务可能无法正常工作。图像生成的自定义 API 支持更有限，建议优先使用内置的智谱/魔搭 |
| **Cloudflare 部署延迟** | Cloudflare Pages 自动部署通常需要 1-3 分钟，首次部署或冷启动可能更慢（5-10 分钟）。部署完成后需要手动刷新页面才能看到更新 |
| **API 代理延迟** | 通过 Cloudflare Worker/Functions 代理的请求会增加一层网络延迟，国内访问海外模型时可能较慢。如果响应超时，系统会自动重试最多 3 次 |
| localStorage 5MB 限制 | 对话历史长期积累可能超出限制，建议定期导出备份 |
| 图片仅存 IndexedDB | 清除浏览器数据会丢失所有 AI 生成的场景图 |
| 无云存档 | 数据全部在浏览器本地，换设备需要手动导入 |
| 单文件架构 | `app.js` 约 4200 行在一个 IIFE 中，维护成本较高 |

---

## 数据存储

| 存储方式 | 内容 | 容量 |
|---|---|---|
| localStorage | 设置、存档、对话历史 | ~5MB |
| IndexedDB (`galgame_img_store`) | AI 生成的场景图片 | GB 级 |

支持导出/导入备份：设置页面 → "导出数据" / "导入数据"

---

## 安全说明

- API 密钥存储在 Cloudflare 环境变量中，**不暴露在前端代码**
- 用户自定义 API Key 仅存浏览器本地，不上传任何服务器
- `.dev.vars` 已加入 `.gitignore`，不会泄露到 Git 仓库

---

## 许可证

本项目为开源项目，仅供学习和个人使用。

---

## 致谢

- AI 文本生成: 智谱AI / 魔搭社区 / NVIDIA NIM
- AI 图像生成: CogView / Z-Image / FLUX
- 部署平台: Cloudflare Pages
