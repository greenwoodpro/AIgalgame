# AI Galgame — 次元邂逅

一个纯前端 AI 驱动的视觉小说游戏，通过大语言模型实时生成剧情对话，支持多角色、多情绪、AI 生图背景、深度思考过程展示，无需后端服务器即可运行。

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
| AI 实时对话 | 大语言模型根据玩家输入生成剧情，JSON 格式返回角色回复 |
| 深度思考展示 | 思考过程以淡化折叠气泡实时流式显示，完成后自动折叠并显示思考用时 |
| 流式输出 | 默认开启，AI 回复实时逐字显示（可在设置关闭） |
| 建议选项 | 每次回复附带 3 个剧情走向建议，点击即继续（也支持自由输入） |
| 情感系统 | 10 种情绪，对应不同立绘表情与动画 |
| 大纲模式 | 用户创建剧情大纲 → AI 按章节推进故事 |
| AI 生成背景 | 根据 scene 字段调用图像 API 生成场景图，支持冷却时间控制 |
| 进阶模式 | 成年角色设定下更成熟的浪漫互动描写（默认关闭，聊天界面可快捷切换） |

### 模型提供商（动态模型列表）

| 提供商 | 文本模型 | 图像模型 | 特点 |
|---|---|---|---|
| 魔搭社区 | Qwen / Kimi / DeepSeek 等 | Z-Image / Qwen-Image-2.1 / Krea-2 / FLUX.2 | 支持直连，异步生图 |
| 商汤 SenseNova | SenseNova-6.8 / DeepSeek-V4 / GLM-5.2 / Kimi-K3 | SenseNova-U1 系列 | 免费公测，OpenAI 兼容 |
| 智谱 AI | GLM-4-Flash | CogView-3-Flash | 免费额度 |
| NVIDIA NIM | Llama-4 / GPT-OSS / Kimi-K2 | — | 高性能推理 |
| Agnes AI | Agnes-2.0-Flash | Agnes-Image 系列 | 免费模型 |
| 自定义 | 任意 OpenAI 兼容 API | 任意 | 默认走代理防 CORS，直连失败自动切代理 |

**模型选择器**：内置推荐列表 + 搜索过滤 + 「🔄 获取列表」按钮实时拉取服务商最新模型（缓存 12 小时）。模型下架不再影响使用。

### 视觉与主题

- **6 套主题**：古风 / 暗夜星辰 / 浅墨 / 樱色物语 / 赛博霓虹 / 碧海晴空，各有专属配色与粒子效果（樱花/星光/墨点/气泡）
- **可选字体**：对话与界面字体独立设置（霞鹜文楷 / 马善政楷书 / 站酷系列等）
- 对话框内建消息导航（↑↓ 浏览历史，Enter 跳到下一条，最后输入框 Enter 发送）
- 聊天模式输入框支持 ↑↓ 召回历史输入（终端式）
- 存档支持自定义命名、重命名
- 未存档退出游戏时弹出确认，防止误触丢进度

### 设置系统

- 思考模式开关 + 思考强度（低/中/高，自动适配各模型参数格式）
- 上下文轮数、最大回复长度、打字速度/特效
- 自动场景图生成开关 / 冷却时间
- 数据导出 / 导入（完整备份所有设置和存档）
- API 代理开关（默认启用，密钥安全存储在服务端）

---

## 项目结构

```
├── index.html                  # 游戏界面（所有屏幕 + hash 路由）
├── app.js                      # 核心逻辑（IIFE 闭包）
├── style.css                   # 样式（6主题/移动端适配/动态效果）
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
start index.html         # Windows

# API 代理本地测试（需要配置 .dev.vars）
npx wrangler pages dev .
```

`.dev.vars` 文件（已 gitignore）用于本地存放 API 密钥：
```
ZHIPU_API_KEY=your_key_here
MODELSCOPE_API_KEY=your_key_here
NVIDIA_API_KEY=your_key_here
AGNES_API_KEY=your_key_here
SENSE_API_KEY=your_key_here
```

---

## 部署

本项目使用 Cloudflare Pages 自动部署：

1. Fork 本仓库
2. 在 Cloudflare Pages 中连接 GitHub 仓库
3. 配置环境变量（`ZHIPU_API_KEY`, `MODELSCOPE_API_KEY`, `NVIDIA_API_KEY`, `AGNES_API_KEY`, `SENSE_API_KEY`）
4. Push 到 `master` 分支即自动部署

> **注意**: 部署通常需要 1-3 分钟，部署期间网站仍可正常访问旧版本。

---

## 使用注意

| 项目 | 说明 |
|---|---|
| **自定义 API 兼容性** | 需兼容 OpenAI 格式（`/v1/chat/completions`）。默认通过同域代理转发避免 CORS 报错；若关闭代理直连失败，会自动切代理重试 |
| **模型列表获取** | 「获取列表」按钮通过服务端代理调用 `/models` 端点，需要代理正常工作；魔搭填了 Token 也可直连获取 |
| **商汤生图** | U1 系列为同步接口，直接返回图片 URL；免费公测每模型 1500 次/5小时 |
| **魔搭生图额度** | 文生图所有模型共享约 50 次/天，用完第二天恢复 |
| localStorage 5MB 限制 | 对话历史长期积累可能超出限制，建议定期导出备份 |
| 图片仅存 IndexedDB | 清除浏览器数据会丢失所有 AI 生成的场景图 |
| 无云存档 | 数据全部在浏览器本地，换设备需要手动导入 |

---

## 数据存储

| 存储方式 | 内容 | 容量 |
|---|---|---|
| localStorage | 设置、存档、对话历史、模型列表缓存 | ~5MB |
| IndexedDB (`galgame_img_store`) | AI 生成的场景图片 | GB 级 |

支持导出/导入备份：设置页面 → "导出数据" / "导入数据"

---

## 安全说明

- API 密钥存储在 Cloudflare 环境变量中，**不暴露在前端代码**
- 用户自定义 API Key 仅存浏览器本地，通过代理头转发，不上传任何服务器
- `.dev.vars` 已加入 `.gitignore`，不会泄露到 Git 仓库

---

## 许可证

本项目为开源项目，仅供学习和个人使用。

---

## 致谢

- AI 文本生成: 魔搭社区 / 商汤 SenseNova / 智谱AI / NVIDIA NIM / Agnes AI
- AI 图像生成: Z-Image / Qwen-Image / Krea / FLUX / CogView / SenseNova-U1
- 部署平台: Cloudflare Pages
