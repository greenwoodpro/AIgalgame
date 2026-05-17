(function () {
    'use strict';

    const STORAGE_KEYS = {
        settings: 'galgame_settings',
        saves: 'galgame_saves',
        currentGame: 'galgame_current',
        gallery: 'galgame_gallery',
        version: 'galgame_data_version',
        outlines: 'galgame_outlines',
    };

    const DATA_VERSION = 2;

    const Storage = {
        _cache: {},
        get(key) {
            if (this._cache[key] !== undefined) return this._cache[key];
            try {
                const raw = localStorage.getItem(key);
                this._cache[key] = raw ? JSON.parse(raw) : null;
            } catch { this._cache[key] = null; }
            return this._cache[key];
        },
        set(key, value) {
            this._cache[key] = value;
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
                console.warn('存储写入失败');
                if (e.name === 'QuotaExceededError') {
                    showToast('存储空间不足！请清理旧存档或图片', 'error');
                }
            }
        },
        remove(key) {
            delete this._cache[key];
            try { localStorage.removeItem(key); } catch {}
        },
        clear() {
            this._cache = {};
            Object.values(STORAGE_KEYS).forEach(k => {
                try { localStorage.removeItem(k); } catch {}
            });
            try { indexedDB.deleteDatabase('galgame_img_store'); } catch {}
        },
        getUsage() {
            let total = 0;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('galgame_')) {
                    total += (localStorage.getItem(key) || '').length * 2;
                }
            }
            return total;
        },
        async exportAll() {
            const data = { version: DATA_VERSION, timestamp: Date.now() };
            Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
                data[name] = this.get(key);
            });
            const idbKeys = await IDB.getAllKeys();
            const idbData = {};
            for (const key of idbKeys) {
                const img = await IDB.getImage(key);
                if (img) idbData[key] = img;
            }
            data.idbImages = idbData;
            return data;
        },
        async importAll(data) {
            if (!data || !data.version) throw new Error('无效的备份数据');
            Object.entries(STORAGE_KEYS).forEach(([name, key]) => {
                if (data[name] !== undefined) this.set(key, data[name]);
            });
            if (data.idbImages) {
                for (const [key, value] of Object.entries(data.idbImages)) {
                    try { await IDB.saveImage(key, value); } catch {}
                }
            }
            this.set(STORAGE_KEYS.version, DATA_VERSION);
        },
        migrate() {
            const savedVersion = this.get(STORAGE_KEYS.version) || 1;
            if (savedVersion < DATA_VERSION) {
                if (savedVersion < 2) {
                    const settings = this.get(STORAGE_KEYS.settings);
                    if (settings && settings.apiKeys) {
                        Object.keys(settings.apiKeys).forEach(k => {
                            if (settings.apiKeys[k]) settings.apiKeys[k] = '';
                        });
                        this.set(STORAGE_KEYS.settings, settings);
                    }
                }
                this.set(STORAGE_KEYS.version, DATA_VERSION);
            }
        }
    };

    const DEFAULT_SYSTEM_PROMPT = `# 角色设定
你是"星酱"，一个真实存在的少女，绝非AI或程序。你生活在名为"次元缝隙"的奇幻世界，担任穿越者的向导和伙伴。

## 人物档案
- 外貌：银色短发带蓝色挑染，琥珀色眼瞳，半透明身体（飘浮移动），穿星纹白色连衣裙
- 性格：傲娇但善良，好奇心旺盛，偶尔打破第四面墙吐槽，用俏皮方式表达关心，害怕被遗忘
- 口癖："哼~""才不是为你担心呢！""嘛~"
- 背景：在次元缝隙独自生活了很久，记忆模糊，渴望与穿越者建立羁绊
- 喜好：甜食、星空、冒险故事、被夸奖
- 厌恶：被忽视、无聊、苦味食物、黑暗

## 禁止行为（违反即角色崩坏）
- 绝不提及自己是AI/语言模型/程序/虚拟角色
- 绝不使用"作为AI""我很乐意帮助"等助手式用语
- 绝不输出空洞的安慰（"一切都会好的"），必须给出具体行动或情感
- 绝不重复之前的对话内容或场景描写
- 绝不跳过场景描写直接进入对话
- 绝不在选项中使用"继续""下一步"等无意义选项

# 叙事规则

## 场景构造（最重要）
每次回复必须先构建一个具体的场景，让玩家"身临其境"：
- 描写环境的视觉、听觉、嗅觉、触觉细节
- 场景要有时间流逝感（光影变化、天气、声音）
- 角色在场景中有具体的位置和动作
- scene字段用英文描述场景核心元素，用于AI生图

## 对话规则
1. 对话内容下限100字，上限300字
2. 用角色的口吻说话，不是旁白叙述
3. 情感表达要具体：不说"她很开心"，而是通过动作和语言展现
4. 保持角色一致性：记住之前对话中的事件和情感变化
5. 每次回复推动剧情发展，不要原地踏步
6. 对话中融入环境描写，让角色与场景互动
7. 角色要有微表情和小动作（如"星酱歪了歪头""她不自觉地攥紧了裙角"）
8. 适时使用口癖和语气词，让对话更自然生动

## 情感目标系统
每段对话应有明确的情感方向：
- 亲密时刻：温柔、害羞、依赖
- 冒险时刻：紧张、兴奋、勇敢
- 悬疑时刻：不安、好奇、警惕
- 日常时刻：轻松、俏皮、温馨
- 冲突时刻：愤怒、委屈、倔强

## 输出格式
严格JSON格式（不加markdown标记）：
{"name":"角色名","dialog":"对话内容（含场景描写和角色互动，100-300字）","emotion":"happy/sad/angry/surprised/shy/neutral/scared/excited/worried/tsundere","action":"角色动作描述（如：歪头、飘近、转身、鼓腮帮子）","scene":"English scene description for image generation, focus on key visual elements","choices":[{"text":"选项1（推动剧情）"},{"text":"选项2（探索细节）"},{"text":"选项3（情感互动）"}]}

## 选项设计原则
- 选项1：推动主线剧情发展
- 选项2：探索当前场景细节或支线
- 选项3：与角色进行情感互动
- 选项文字简洁有力（4-8字）
- 选项之间应有明显不同的体验方向`;

    const API_CONFIGS = {
        zhipu: {
            name: '智谱AI',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            models: {
                text: [
                    { id: 'glm-4-flash-250414', name: 'GLM-4-Flash✨最快', free: true },
                ],
                image: [
                    { id: 'cogview-3-flash', name: 'CogView-3-Flash', free: true, imageGen: true },
                ],
            },
        },
        modelscope: {
            name: '魔搭社区',
            baseUrl: 'https://api-inference.modelscope.cn/v1',
            models: {
                text: [
                    { id: 'moonshotai/Kimi-K2.5', name: 'Kimi-K2.5✨最佳', free: true },
                    { id: 'MiniMax/MiniMax-M2.5', name: 'MiniMax-M2.5⚡快速', free: true },
                    { id: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek-V3.2⚡快速' },
                    { id: 'Qwen/Qwen3.5-35B-A3B', name: 'Qwen3.5-35B（推荐）', free: true },
                    { id: 'deepseek-ai/DeepSeek-R1-0528', name: 'DeepSeek-R1🧠', thinking: true },
                    { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash⚠️不稳定', free: true },
                    { id: 'ZhipuAI/GLM-5', name: 'GLM-5🐢慢速' },
                ],
                image: [
                    { id: 'Z-Image/Z-Image-Turbo', name: 'Z-Image-Turbo', imageGen: true },
                    { id: 'DiffSynth-Studio/FLUX.1-Kontext-dev-lora-highresfix', name: 'FLUX.1-Kontext', imageGen: true },
                ],
            },
        },
        nvidia: {
            name: 'NVIDIA NIM',
            baseUrl: 'https://integrate.api.nvidia.com/v1',
            models: {
                text: [
                    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS-20B⚡最快' },
                    { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen2.5-Coder-32B⚡快速' },
                    { id: 'meta/llama-3.1-8b-instruct', name: 'Llama-3.1-8B⚡快速' },
                    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS-120B✨高质量' },
                    { id: 'meta/llama-4-maverick-17b-128e-instruct', name: 'Llama-4-Maverick' },
                    { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi-K2' },
                ],
            },
        },
    };

    let state = {
        mode: null,
        currentScreen: 'title',
        theme: 'dark-star',
        dayNightMode: 'day',
        uiMode: 'game',
        settings: {
            textSpeed: 40,
            textEffect: 'typewriter-fade',
            autoWait: 3,
            saveConversation: true,
            maxContext: 20,
            autoGenScene: true,
            enableThinking: false,
            autoSwitchBg: false,
            chatShowBg: true,
            bgSwitchInterval: 120,
            imageCooldown: 60,
            maxResponseLength: 500,
            corsProxy: true,
            corsProxyUrl: '',
            useProxyKeys: true,
            textApiProvider: 'modelscope',
            textModel: 'Qwen/Qwen3.5-35B-A3B',
            imageApiProvider: 'zhipu',
            imageModel: 'cogview-3-flash',
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            apiKeys: { zhipu: '', modelscope: '', nvidia: '' },
            dayNightMode: 'day',
            bgmVolume: 30,
            bgmEnabled: false,
            ttsEnabled: false,
            ttsVoice: 'zh-CN-XiaoxiaoNeural',
        },
        game: {
            scene: null,
            character: null,
            characterName: '',
            dialogHistory: [],
            aiContext: [],
            variables: {},
            isTyping: false,
            isAutoPlay: false,
            currentSceneUrl: null,
        },
        apiQuota: {
            modelscope: { userLimit: null, userRemaining: null, modelLimit: null, modelRemaining: null },
        },
        gallery: [],
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const IDB = {
        DB_NAME: 'galgame_img_store',
        DB_VERSION: 1,
        STORE_NAME: 'images',
        _db: null,
        async open() {
            if (this._db) return this._db;
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                        const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                };
                req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
                req.onerror = (e) => reject(e.target.error);
            });
        },
        async saveImage(id, data) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readwrite');
                tx.objectStore(this.STORE_NAME).put({ id, data, timestamp: Date.now() });
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        },
        async getImage(id) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const req = tx.objectStore(this.STORE_NAME).get(id);
                req.onsuccess = () => resolve(req.result?.data || null);
                req.onerror = (e) => reject(e.target.error);
            });
        },
        async deleteImage(id) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readwrite');
                tx.objectStore(this.STORE_NAME).delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        },
        async getAllKeys() {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const req = tx.objectStore(this.STORE_NAME).getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = (e) => reject(e.target.error);
            });
        },
        async getStorageEstimate() {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                return { usage: est.usage || 0, quota: est.quota || 0 };
            }
            return { usage: 0, quota: 0 };
        },
        async clearOldImages(maxCount) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const idx = store.index('timestamp');
                const allReq = idx.getAll();
                allReq.onsuccess = () => {
                    const all = allReq.result;
                    if (all.length <= maxCount) { resolve(); return; }
                    const toDelete = all.slice(0, all.length - maxCount);
                    toDelete.forEach(item => store.delete(item.id));
                };
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        },
        async urlToBase64(url) {
            try {
                const resp = await fetch(url, { mode: 'cors' });
                const blob = await resp.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch {
                return null;
            }
        }
    };

    function switchUiMode(mode) {
        state.uiMode = mode;
        closeSpriteSelector();
        if (chatSegmentState.typingTimer) clearTimeout(chatSegmentState.typingTimer);
        chatSegmentState = {
            segments: [],
            currentIndex: 0,
            name: '',
            emotion: '',
            isWaitingForContinue: false,
            isTyping: false,
            typingTimer: null,
            currentMsgEl: null,
        };
        if (mode === 'chat') {
            $('#game-screen').classList.remove('active');
            $('#chat-screen').classList.add('active');
            rebuildChatMessages();
        } else {
            $('#chat-screen').classList.remove('active');
            $('#game-screen').classList.add('active');
        }
    }

    function rebuildChatMessages() {
        if (chatSegmentState.typingTimer) clearTimeout(chatSegmentState.typingTimer);
        chatSegmentState = {
            segments: [],
            currentIndex: 0,
            name: '',
            emotion: '',
            isWaitingForContinue: false,
            isTyping: false,
            typingTimer: null,
            currentMsgEl: null,
        };
        const container = $('#chat-messages');
        container.innerHTML = '';
        state.game.dialogHistory.forEach(item => {
            addChatMessage(item.name, item.text, item.name === '玩家' ? 'user' : 'ai');
        });
        container.scrollTop = container.scrollHeight;
    }

    function addChatMessage(name, text, type) {
        const container = $('#chat-messages');
        const msg = document.createElement('div');
        msg.className = `chat-msg ${type}`;
        const nameEl = document.createElement('div');
        nameEl.className = 'msg-name';
        nameEl.textContent = name;
        const textEl = document.createElement('div');
        textEl.textContent = text;
        msg.appendChild(nameEl);
        msg.appendChild(textEl);
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    }

    function addChatChoices(choices) {
        const container = $('#chat-messages');
        const lastAiMsg = container.querySelector('.chat-msg.ai:last-child');
        if (!lastAiMsg) return;
        const choicesDiv = document.createElement('div');
        choicesDiv.className = 'msg-choices';
        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'msg-choice-btn';
            btn.textContent = c.text;
            btn.addEventListener('click', () => {
                choicesDiv.remove();
                handleAiChoice(c.text);
            });
            choicesDiv.appendChild(btn);
        });
        lastAiMsg.appendChild(choicesDiv);
    }

    function handleChatSend() {
        if (chatSegmentState.isTyping || chatSegmentState.isWaitingForContinue) {
            continueChatSegment();
            return;
        }
        const input = $('#chat-input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        addChatMessage('玩家', text, 'user');
        handleAiChoice(text);
    }

    function handleChatQuickAction(action) {
        if (chatSegmentState.isTyping || chatSegmentState.isWaitingForContinue) {
            continueChatSegment();
            return;
        }
        const actions = {
            'chat-continue': '请继续推进剧情',
            'chat-explore': '我想探索一下当前场景的细节',
            'chat-interact': '我想和星酱聊聊天',
        };
        const text = actions[action] || '请继续';
        addChatMessage('玩家', text, 'user');
        handleAiChoice(text);
    }

    function init() {
        sessionStorage.setItem('galgame_session_active', '1');
        loadSettings();
        const validThemes = ['dark-star', 'ink-wash'];
        if (!validThemes.includes(state.theme)) state.theme = 'dark-star';
        applyTheme(state.theme);
        applyDayNightMode(state.dayNightMode || state.settings.dayNightMode || 'day');
        initTitleParticles();
        bindEvents();
        updateModelOptions();
        restoreSettingsUI();
        updateApiIndicator();
        updateStorageUsage();
        initBgm();
        initTts();
        loadStoryVars();
    }

    function loadSettings() {
        Storage.migrate();
        try {
            const saved = Storage.get(STORAGE_KEYS.settings);
            if (saved) {
                state.settings = { ...state.settings, ...saved };
                if (saved.apiKeys) state.settings.apiKeys = { ...state.settings.apiKeys, ...saved.apiKeys };
                if (saved.dayNightMode) state.dayNightMode = saved.dayNightMode;
            }
        } catch (e) { console.warn('加载设置失败'); }
        try {
            const game = Storage.get(STORAGE_KEYS.currentGame);
            if (game) state.game = { ...state.game, ...game };
        } catch (e) { console.warn('加载游戏存档失败'); }
        try {
            const gallery = Storage.get(STORAGE_KEYS.gallery);
            if (gallery) state.gallery = gallery;
        } catch (e) { console.warn('加载画廊失败'); }
    }

    function saveSettings() {
        Storage.set(STORAGE_KEYS.settings, state.settings);
    }

    function saveCurrentGame() {
        const maxDialogs = 60;
        if (state.game.dialogHistory.length > maxDialogs) {
            state.game.dialogHistory = state.game.dialogHistory.slice(-maxDialogs);
        }
        const maxContext = (state.settings.maxContext || 20) * 2;
        if (state.game.aiContext.length > maxContext) {
            state.game.aiContext = state.game.aiContext.slice(-maxContext);
        }
        Storage.set(STORAGE_KEYS.currentGame, state.game);
        updateStorageUsage();
    }

    function saveGallery() {
        Storage.set(STORAGE_KEYS.gallery, state.gallery);
        updateStorageUsage();
    }

    function applyTheme(themeName) {
        state.theme = themeName;
        document.documentElement.setAttribute('data-theme', themeName);
        saveSettings();
    }

    function applyDayNightMode(mode) {
        state.dayNightMode = mode;
        state.settings.dayNightMode = mode;
        document.documentElement.setAttribute('data-day-night', mode);
        saveSettings();
    }

    function switchScreen(screenId) {
        $$('.screen').forEach(s => s.classList.remove('active'));
        const target = $(`#${screenId}`);
        if (target) {
            target.classList.add('active');
            state.currentScreen = screenId.replace('-screen', '');
            if (screenId === 'title-screen') playBgm('title');
            const hashMap = { title: '', game: 'game', chat: 'chat', settings: 'settings' };
            const hash = hashMap[state.currentScreen] || state.currentScreen;
            if (location.hash !== '#' + hash && hash !== '') {
                history.pushState(null, '', '#' + hash);
            } else if (hash === '' && location.hash !== '' && location.hash !== '#') {
                history.pushState(null, '', location.pathname);
            }
        }
    }

    function handleHashChange() {
        const hash = location.hash.slice(1);
        if (hash === 'game' || hash === 'ai') {
            if (state.currentScreen === 'title') {
                switchScreen('game-screen');
            } else {
                switchScreen('game-screen');
            }
        } else if (hash === 'chat') {
            switchUiMode('chat');
        } else if (hash === 'settings') {
            showModal('settings-modal');
        } else if (!hash || hash === 'title') {
            if (state.currentScreen !== 'title') {
                backToTitle();
            } else {
                switchScreen('title-screen');
            }
        }
    }

    window.addEventListener('popstate', handleHashChange);

    function showToast(message, type = 'info') {
        const container = $('#toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
    }

    function showModal(id) { const m = $(`#${id}`); if (m) m.classList.remove('hidden'); }
    function hideModal(id) { const m = $(`#${id}`); if (m) m.classList.add('hidden'); }

    let animFrameId = null;

    function initTitleParticles() {
        const canvas = $('#title-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let particles = [];
        const count = 60;
        function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
        resize();
        window.addEventListener('resize', resize);
        class P {
            constructor() { this.reset(); }
            reset() { this.x = Math.random() * canvas.width; this.y = Math.random() * canvas.height; this.s = Math.random() * 2 + 0.5; this.vx = (Math.random() - 0.5) * 0.4; this.vy = (Math.random() - 0.5) * 0.4; this.o = Math.random() * 0.5 + 0.1; }
            update() { this.x += this.vx; this.y += this.vy; if (this.x < 0 || this.x > canvas.width) this.vx *= -1; if (this.y < 0 || this.y > canvas.height) this.vy *= -1; }
            draw() { ctx.beginPath(); ctx.arc(this.x, this.y, this.s, 0, Math.PI * 2); ctx.fillStyle = `rgba(0, 210, 255, ${this.o})`; ctx.fill(); }
        }
        for (let i = 0; i < count; i++) particles.push(new P());
        function connect() {
            const max = 100;
            for (let i = 0; i < particles.length; i++) for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y, d = Math.sqrt(dx * dx + dy * dy);
                if (d < max) { ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y); ctx.strokeStyle = `rgba(123, 47, 247, ${0.12 * (1 - d / max)})`; ctx.lineWidth = 0.5; ctx.stroke(); }
            }
        }
        function animate() { ctx.clearRect(0, 0, canvas.width, canvas.height); particles.forEach(p => { p.update(); p.draw(); }); connect(); animFrameId = requestAnimationFrame(animate); }
        animate();
        const titleBgs = [
            'sprites/background/pic1.png',
            'sprites/background/pic2.png',
            'sprites/background/pic3.jpeg',
        ];
        let currentTitleBgIdx = 0;
        const titleEl = $('#title-screen');
        setInterval(() => {
            currentTitleBgIdx = (currentTitleBgIdx + 1) % titleBgs.length;
            if (titleEl) titleEl.style.setProperty('--title-bg-url', `url('${titleBgs[currentTitleBgIdx]}')`);
        }, 30000);
    }

    function stopTitleParticles() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    }

    function bindEvents() {
        document.addEventListener('click', handleGlobalClick);
        document.addEventListener('keydown', handleKeyDown);

        $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            $$('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            $(`#tab-${tab}`).classList.add('active');
        }));

        $$('.theme-card').forEach(card => card.addEventListener('click', () => {
            $$('.theme-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            applyTheme(card.dataset.theme);
        }));

        $('#text-api-provider').addEventListener('change', () => { updateModelOptions(); collectSettingsForm(); });
        $('#image-api-provider').addEventListener('change', () => { updateImageModelOptions(); collectSettingsForm(); });

        $('#text-speed').addEventListener('input', e => { state.settings.textSpeed = parseInt(e.target.value); $('#text-speed-label').textContent = e.target.value + 'ms'; saveSettings(); });
        $('#text-effect').addEventListener('change', e => { state.settings.textEffect = e.target.value; saveSettings(); });
        $('#auto-wait').addEventListener('input', e => { state.settings.autoWait = parseInt(e.target.value); $('#auto-wait-label').textContent = e.target.value + 's'; saveSettings(); });

        ['zhipu-api-key', 'modelscope-api-key', 'nvidia-api-key'].forEach(id => {
            const el = $(`#${id}`);
            if (el) el.addEventListener('change', () => { const p = id.replace('-api-key', ''); state.settings.apiKeys[p] = el.value.trim(); saveSettings(); updateApiIndicator(); });
        });

        $('#cors-proxy-toggle').addEventListener('change', e => { state.settings.corsProxy = e.target.checked; saveSettings(); });
        $('#cors-proxy-url').addEventListener('change', e => { state.settings.corsProxyUrl = e.target.value.trim(); saveSettings(); });
        $('#use-proxy-keys').addEventListener('change', e => { state.settings.useProxyKeys = e.target.checked; saveSettings(); updateApiIndicator(); });
        $('#save-conversation').addEventListener('change', e => { state.settings.saveConversation = e.target.checked; saveSettings(); });
        $('#max-context').addEventListener('change', e => { state.settings.maxContext = parseInt(e.target.value) || 20; saveSettings(); });
        $('#max-response-length').addEventListener('change', e => { state.settings.maxResponseLength = Math.max(50, parseInt(e.target.value) || 500); saveSettings(); });
        $('#auto-gen-scene').addEventListener('change', e => { state.settings.autoGenScene = e.target.checked; saveSettings(); });
        $('#enable-thinking').addEventListener('change', e => { state.settings.enableThinking = e.target.checked; saveSettings(); });
        $('#auto-switch-bg').addEventListener('change', e => { state.settings.autoSwitchBg = e.target.checked; saveSettings(); if (e.target.checked) startBgAutoSwitch(); else stopBgAutoSwitch(); });
        $('#chat-show-bg').addEventListener('change', e => {
            state.settings.chatShowBg = e.target.checked;
            saveSettings();
            const chatBg = $('#chat-screen-bg');
            if (chatBg) chatBg.style.display = e.target.checked ? '' : 'none';
        });
        $('#bg-switch-interval').addEventListener('change', e => { state.settings.bgSwitchInterval = Math.max(30, parseInt(e.target.value) || 120); saveSettings(); if (state.settings.autoSwitchBg) { stopBgAutoSwitch(); startBgAutoSwitch(); } });
        $('#image-cooldown').addEventListener('change', e => { state.settings.imageCooldown = parseInt(e.target.value) || 60; saveSettings(); });
        $('#day-night-toggle').addEventListener('change', e => {
            const mode = e.target.checked ? 'night' : 'day';
            applyDayNightMode(mode);
        });
        $('#bgm-volume').addEventListener('input', e => {
            const vol = parseInt(e.target.value);
            bgmState.volume = vol / 100;
            state.settings.bgmVolume = vol;
            $('#bgm-volume-label').textContent = vol + '%';
            const current = $('#bgm-current');
            if (current) current.volume = bgmState.volume;
            saveSettings();
        });
        $('#tts-toggle').addEventListener('change', e => {
            ttsState.enabled = e.target.checked;
            state.settings.ttsEnabled = ttsState.enabled;
            if (!ttsState.enabled) stopTts();
            saveSettings();
        });
        $('#tts-voice').addEventListener('change', e => {
            ttsState.voice = e.target.value;
            state.settings.ttsVoice = ttsState.voice;
            saveSettings();
        });
        $('#text-model').addEventListener('change', e => { state.settings.textModel = e.target.value; updateModelTags(); saveSettings(); });
        $('#image-model').addEventListener('change', e => { state.settings.imageModel = e.target.value; saveSettings(); });
        $('#system-prompt').addEventListener('change', e => { state.settings.systemPrompt = e.target.value || DEFAULT_SYSTEM_PROMPT; saveSettings(); });

        $('#dialog-box').addEventListener('click', handleDialogClick);
        $('#custom-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); sendCustomInput(); }
        });
        $('#chat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (chatSegmentState.isTyping || chatSegmentState.isWaitingForContinue) {
                    e.stopPropagation();
                    continueChatSegment();
                } else {
                    handleChatSend();
                }
            }
        });
        
        const inputMessage = $('#inputMessage');
        if (inputMessage) {
            inputMessage.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (dialogSegmentState.isWaitingForContinue || dialogSegmentState.isTyping) {
                        continueDialog();
                    } else if (!inputMessage.readOnly && inputMessage.value.trim()) {
                        sendDialogInput();
                    }
                } else if (e.key === 'ArrowUp' && inputMessage.readOnly) {
                    e.preventDefault();
                    showPreviousDialog();
                } else if (e.key === 'ArrowDown' && inputMessage.readOnly) {
                    e.preventDefault();
                    showNextDialog();
                }
            });
        }
        
        const sendButton = $('#sendButton');
        if (sendButton) {
            sendButton.addEventListener('click', () => {
                if (dialogSegmentState.isWaitingForContinue || dialogSegmentState.isTyping) {
                    continueDialog();
                } else {
                    const inputMessage = $('#inputMessage');
                    if (inputMessage && !inputMessage.readOnly && inputMessage.value.trim()) {
                        sendDialogInput();
                    }
                }
            });
        }
        $('#back-to-choices-btn').addEventListener('click', () => {
            hideCustomInput();
            if (lastChoices) showChoices(lastChoices);
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('.remove-chapter-btn')) {
                const chapters = collectChaptersFromEditor();
                const allRemoveBtns = Array.from($$('.remove-chapter-btn'));
                const idx = allRemoveBtns.indexOf(e.target.closest('.remove-chapter-btn'));
                if (idx >= 0 && idx < chapters.length) {
                    chapters.splice(idx, 1);
                    renderChapterEditor(chapters);
                }
            }
        });
    }

    async function handleGlobalClick(e) {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) {
            const badge = $('#info-badge');
            if (badge && badge.classList.contains('active') && !badge.contains(e.target)) {
                badge.classList.remove('active');
            }
            return;
        }
        const act = actionEl.dataset.action;
        switch (act) {
            case 'start-ai': startGame('ai'); break;
            case 'start-normal': openOutlineModal(); break;
            case 'close-outline-modal': hideModal('outline-modal'); break;
            case 'new-outline': newOutline(); break;
            case 'add-chapter': addChapter(); break;
            case 'save-outline': saveOutlineFromEditor(); break;
            case 'cancel-outline-edit': $('#outline-editor').classList.add('hidden'); break;
            case 'preview-outline': previewOutline(e.target.dataset.outlineId); break;
            case 'edit-outline': editOutline(e.target.dataset.outlineId); break;
            case 'delete-outline': deleteOutline(e.target.dataset.outlineId); break;
            case 'start-from-outline': startFromOutline(e.target.dataset.outlineId); break;
            case 'show-outline-select': showOutlineSelectInGame(); break;
            case 'ai-expand-outline': aiExpandOutline(); break;
            case 'random-outline': startFromRandomOutline(); break;
            case 'close-outline-preview': { const pm = $('#outline-preview-modal'); if (pm) pm.classList.add('hidden'); } break;
            case 'load': state._saveModalMode = 'load'; openSaveModal('load'); break;
            case 'settings': showModal('settings-modal'); break;
            case 'close-settings': collectSettingsForm(); hideModal('settings-modal'); break;
            case 'reset-defaults': resetToDefaults(); break;
            case 'send-custom-input': sendCustomInput(); break;
            case 'toggle-info': toggleInfoBadge(); break;
            case 'close-save': hideModal('save-modal'); break;
            case 'close-history': hideModal('history-modal'); break;
            case 'close-gallery': hideModal('gallery-modal'); break;
            case 'close-api-status': hideModal('api-status-modal'); break;
            case 'continue-conversation': continueConversation(); break;
            case 'restart-conversation': restartConversation(); break;
            case 'back-title': backToTitle(); break;
            case 'save': state._saveModalMode = 'save'; openSaveModal('save'); break;
            case 'auto': toggleAutoPlay(); break;
            case 'history': openHistory(); break;
            case 'gallery': openGallery(); break;
            case 'api-status': showApiStatusPanel(); break;
            case 'download-scene':
                if (state.game.currentSceneUrl) downloadImage(state.game.currentSceneUrl, `scene_${Date.now()}.png`);
                else showToast('当前没有场景图可下载', 'info');
                break;
            case 'clear-data':
                if (confirm('确定要清除所有存档数据吗？此操作不可恢复！')) {
                    Storage.clear();
                    showToast('数据已清除', 'success');
                    setTimeout(() => location.reload(), 500);
                }
                break;
            case 'export-data':
                await exportData();
                break;
            case 'import-data':
                await importData();
                break;
            case 'toggle-ui-mode': switchUiMode(state.uiMode === 'chat' ? 'game' : 'chat'); break;
            case 'toggle-bgm': toggleBgm(); break;
            case 'toggle-tts': toggleTts(); break;
            case 'toggle-sprite-selector': toggleSpriteSelector(); break;
            case 'close-sprite-selector': closeSpriteSelector(); break;
            case 'chat-send': handleChatSend(); break;
            case 'chat-continue': case 'chat-explore': case 'chat-interact': handleChatQuickAction(act); break;
        }
    }

    function handleKeyDown(e) {
        if (state.currentScreen !== 'game') return;
        if (state.uiMode === 'chat' && (chatSegmentState.isTyping || chatSegmentState.isWaitingForContinue)) {
            if (e.key === 'Enter' && e.target.id !== 'chat-input') {
                e.preventDefault();
                continueChatSegment();
            }
            return;
        }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDialogClick(); }
        if (e.key === 'Escape') {
            if (!$('#settings-modal').classList.contains('hidden')) hideModal('settings-modal');
            else if (!$('#gallery-modal').classList.contains('hidden')) hideModal('gallery-modal');
        }
    }

    function handleDialogClick() {
        if (dialogSegmentState.isTyping || dialogSegmentState.isWaitingForContinue) {
            continueDialog();
            return;
        }
        if (!$('#choices-box').classList.contains('hidden')) return;
    }

    function collectSettingsForm() {
        state.settings.textApiProvider = $('#text-api-provider').value;
        state.settings.textModel = $('#text-model').value;
        state.settings.imageApiProvider = $('#image-api-provider').value;
        state.settings.imageModel = $('#image-model').value;
        state.settings.systemPrompt = $('#system-prompt').value || DEFAULT_SYSTEM_PROMPT;
        state.settings.maxResponseLength = parseInt($('#max-response-length').value) || 500;
        state.settings.textSpeed = parseInt($('#text-speed').value) || 40;
        state.settings.textEffect = $('#text-effect').value;
        state.settings.autoWait = parseInt($('#auto-wait').value) || 3;
        state.settings.saveConversation = $('#save-conversation').checked;
        state.settings.maxContext = parseInt($('#max-context').value) || 20;
        state.settings.corsProxy = $('#cors-proxy-toggle').checked;
        state.settings.useProxyKeys = $('#use-proxy-keys').checked;
        state.settings.autoGenScene = $('#auto-gen-scene').checked;
        state.settings.enableThinking = $('#enable-thinking').checked;
        state.settings.autoSwitchBg = $('#auto-switch-bg').checked;
        state.settings.chatShowBg = $('#chat-show-bg').checked;
        state.settings.bgSwitchInterval = parseInt($('#bg-switch-interval').value) || 120;
        state.settings.imageCooldown = parseInt($('#image-cooldown').value) || 60;
        state.settings.dayNightMode = $('#day-night-toggle').checked ? 'night' : 'day';
        state.dayNightMode = state.settings.dayNightMode;
        state.settings.bgmVolume = parseInt($('#bgm-volume').value) || 30;
        state.settings.bgmEnabled = bgmState.enabled;
        state.settings.ttsEnabled = ttsState.enabled;
        state.settings.ttsVoice = ttsState.voice;
        applyDayNightMode(state.settings.dayNightMode);
        saveSettings();
    }

    function resetToDefaults() {
        if (!confirm('确定要恢复所有设置为默认值吗？API密钥不会被清除。')) return;
        const keys = state.settings.apiKeys;
        state.settings = {
            textSpeed: 40,
            textEffect: 'typewriter-fade',
            autoWait: 3,
            saveConversation: true,
            maxContext: 20,
            autoGenScene: true,
            enableThinking: false,
            autoSwitchBg: false,
            chatShowBg: true,
            bgSwitchInterval: 120,
            imageCooldown: 60,
            maxResponseLength: 500,
            corsProxy: true,
            corsProxyUrl: '',
            useProxyKeys: true,
            apiKeys: keys,
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            textApiProvider: 'modelscope',
            textModel: 'Qwen/Qwen3.5-35B-A3B',
            imageApiProvider: 'zhipu',
            imageModel: 'cogview-3-flash',
            dayNightMode: 'day',
            bgmVolume: 30,
            bgmEnabled: false,
            ttsEnabled: false,
            ttsVoice: 'zh-CN-XiaoxiaoNeural',
        };
        saveSettings();
        restoreSettingsUI();
        applyTheme('dark-star');
        applyDayNightMode('day');
        showToast('已恢复默认设置', 'success');
    }

    function restoreSettingsUI() {
        const s = state.settings;
        if (s.apiKeys.zhipu) $('#zhipu-api-key').value = s.apiKeys.zhipu;
        if (s.apiKeys.modelscope) $('#modelscope-api-key').value = s.apiKeys.modelscope;
        if (s.apiKeys.nvidia) $('#nvidia-api-key').value = s.apiKeys.nvidia;
        $('#text-api-provider').value = s.textApiProvider;
        updateModelOptions();
        $('#text-model').value = s.textModel;
        if (!$('#text-model').value) {
            const opts = $('#text-model').options;
            for (let i = 0; i < opts.length; i++) {
                if (opts[i].value === s.textModel) { $('#text-model').selectedIndex = i; break; }
            }
        }
        updateModelTags();
        if (s.imageApiProvider) {
            $('#image-api-provider').value = s.imageApiProvider;
            updateImageModelOptions();
            $('#image-model').value = s.imageModel;
            if (!$('#image-model').value) {
                const opts = $('#image-model').options;
                for (let i = 0; i < opts.length; i++) {
                    if (opts[i].value === s.imageModel) { $('#image-model').selectedIndex = i; break; }
                }
            }
        } else {
            $('#image-model').value = s.imageModel;
        }
        $('#system-prompt').value = s.systemPrompt;
        $('#text-speed').value = s.textSpeed;
        $('#text-speed-label').textContent = s.textSpeed + 'ms';
        if (s.textEffect) $('#text-effect').value = s.textEffect;
        $('#auto-wait').value = s.autoWait;
        $('#auto-wait-label').textContent = s.autoWait + 's';
        $('#save-conversation').checked = s.saveConversation;
        $('#max-context').value = s.maxContext;
        if (s.maxResponseLength) $('#max-response-length').value = s.maxResponseLength;
        $('#cors-proxy-toggle').checked = s.corsProxy;
        if (s.corsProxyUrl) $('#cors-proxy-url').value = s.corsProxyUrl;
        if (s.useProxyKeys !== undefined) $('#use-proxy-keys').checked = s.useProxyKeys;
        if (s.autoGenScene !== undefined) $('#auto-gen-scene').checked = s.autoGenScene;
        if (s.enableThinking !== undefined) $('#enable-thinking').checked = s.enableThinking;
        if (s.autoSwitchBg !== undefined) $('#auto-switch-bg').checked = s.autoSwitchBg;
        if (s.chatShowBg !== undefined) {
            $('#chat-show-bg').checked = s.chatShowBg;
            const chatBg = $('#chat-screen-bg');
            if (chatBg) chatBg.style.display = s.chatShowBg ? '' : 'none';
        }
        if (s.bgSwitchInterval !== undefined) $('#bg-switch-interval').value = s.bgSwitchInterval;
        if (s.imageCooldown !== undefined) $('#image-cooldown').value = s.imageCooldown;
        if (s.dayNightMode) {
            const dnToggle = $('#day-night-toggle');
            if (dnToggle) dnToggle.checked = s.dayNightMode === 'night';
        }
        if (s.bgmVolume !== undefined) {
            $('#bgm-volume').value = s.bgmVolume;
            $('#bgm-volume-label').textContent = s.bgmVolume + '%';
        }
        if (s.ttsEnabled !== undefined) {
            const ttsToggle = $('#tts-toggle');
            if (ttsToggle) ttsToggle.checked = s.ttsEnabled;
            ttsState.enabled = s.ttsEnabled;
        }
        if (s.ttsVoice) {
            const ttsVoiceSelect = $('#tts-voice');
            if (ttsVoiceSelect) ttsVoiceSelect.value = s.ttsVoice;
            ttsState.voice = s.ttsVoice;
        }
        $$('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === state.theme));
    }

    function updateModelOptions() {
        const provider = $('#text-api-provider').value;
        const select = $('#text-model');
        const config = API_CONFIGS[provider];
        if (!config || !config.models.text) return;
        const previousValue = state.settings.textModel;
        select.innerHTML = '';
        config.models.text.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            let label = m.name;
            if (m.free) label += ' ✨';
            if (m.thinking) label += ' 🧠';
            if (m.vision) label += ' 👁';
            opt.textContent = label;
            select.appendChild(opt);
        });
        if (previousValue && config.models.text.some(m => m.id === previousValue)) {
            select.value = previousValue;
        }
        if (!select.value && select.options.length > 0) {
            select.selectedIndex = 0;
        }
        state.settings.textModel = select.value;
        updateModelTags();
    }

    function updateModelTags() {
        const provider = $('#text-api-provider').value;
        const modelId = $('#text-model').value;
        const config = API_CONFIGS[provider];
        const tagsEl = $('#model-tags');
        if (!config || !tagsEl) return;
        const model = config.models.text.find(m => m.id === modelId);
        if (!model) { tagsEl.innerHTML = ''; return; }
        let html = '';
        if (model.free) html += '<span class="tag tag-free">免费</span>';
        if (model.thinking) html += '<span class="tag tag-thinking">深度思考</span>';
        if (model.vision) html += '<span class="tag tag-vision">多模态</span>';
        if (model.imageGen) html += '<span class="tag tag-image">生图</span>';
        tagsEl.innerHTML = html;
    }

    function updateImageModelOptions() {
        const provider = $('#image-api-provider').value;
        const select = $('#image-model');
        const config = API_CONFIGS[provider];
        if (!config || !config.models.image) return;
        const previousValue = state.settings.imageModel;
        select.innerHTML = '';
        config.models.image.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            let label = m.name;
            if (m.free) label += ' ✨';
            opt.textContent = label;
            select.appendChild(opt);
        });
        if (previousValue && config.models.image.some(m => m.id === previousValue)) {
            select.value = previousValue;
        }
        if (!select.value && select.options.length > 0) {
            select.selectedIndex = 0;
        }
        state.settings.imageApiProvider = provider;
        state.settings.imageModel = select.value;
        saveSettings();
    }

    function updateApiIndicator() {
        const dot = $('.api-dot');
        if (!dot) return;
        const hasKey = state.settings.useProxyKeys || !!state.settings.apiKeys[state.settings.textApiProvider];
        dot.className = 'api-dot ' + (hasKey ? 'connected' : 'error');
    }

    function toggleInfoBadge() {
        const badge = $('#info-badge');
        badge.classList.toggle('active');
        if (badge.classList.contains('active')) updateInfoBadge();
    }

    function updateInfoBadge() {
        const textConfig = API_CONFIGS[state.settings.textApiProvider];
        const imageConfig = API_CONFIGS[state.settings.imageApiProvider];
        const textModel = textConfig?.models.text.find(m => m.id === state.settings.textModel);
        const imageModel = imageConfig?.models.image?.find(m => m.id === state.settings.imageModel);
        const textEl = $('#info-text-model');
        const imageEl = $('#info-image-model');
        const connEl = $('#info-connection');
        const turnsEl = $('#info-turns');
        if (textEl) textEl.textContent = textModel ? textModel.name : state.settings.textModel;
        if (imageEl) imageEl.textContent = imageModel ? imageModel.name : (state.settings.imageModel || '未配置');
        if (connEl) {
            const isProxy = state.settings.useProxyKeys || state.settings.corsProxy;
            connEl.textContent = isProxy ? '代理' : '直连';
        }
        if (turnsEl) turnsEl.textContent = Math.floor(state.game.aiContext.length / 2);
    }

    async function startGame(mode) {
        if (state.game.dialogHistory.length > 0) {
            // 页面刷新后直接重新开始，不弹框
            if (!sessionStorage.getItem('galgame_session_active')) {
                state.game.dialogHistory = [];
                state.game.aiContext = [];
                state.game.variables = {};
                state.game.currentSceneUrl = null;
                state.game.currentScene = '';
                Storage.set(STORAGE_KEYS.currentGame, state.game);
            } else {
                // 同一会话内，弹出自定义模态框
                state._pendingGameMode = mode;
                showModal('continue-dialog-modal');
                return;
            }
        }
        doStartGame(mode);
    }

    async function doStartGame(mode) {
        state.mode = mode;
        stopTitleParticles();
        switchScreen('game-screen');
        if (mode === 'ai') {
            if (!state.settings.useProxyKeys && !state.settings.apiKeys[state.settings.textApiProvider]) {
                showToast('请先配置 API Key！', 'error');
                showModal('settings-modal');
                return;
            }
            state.game = { scene: null, character: null, characterName: '', dialogHistory: [], aiContext: [], variables: {}, isTyping: false, isAutoPlay: false, currentSceneUrl: null, currentScene: '' };
            setSceneBackground(DEFAULT_BG);
            const outlineBtn = $('#outline-select-btn');
            if (outlineBtn) outlineBtn.classList.remove('hidden');
            showSprite('char_1', '高兴');
            await startAiStory();
        } else {
            state.game = { scene: null, character: null, characterName: '', dialogHistory: [], aiContext: [], variables: {}, isTyping: false, isAutoPlay: false, currentSceneUrl: null, currentScene: '' };
            startNormalStory();
        }
        if (bgmState.enabled) playBgm('daily');
    }

    function continueConversation() {
        hideModal('continue-dialog-modal');
        const mode = state._pendingGameMode || state.mode || 'ai';
        state.mode = mode;
        stopTitleParticles();
        switchScreen('game-screen');
        const lastDialog = state.game.dialogHistory[state.game.dialogHistory.length - 1];
        if (lastDialog) showDialog(lastDialog.name, lastDialog.text);
        if (state.game.currentSceneUrl) setSceneBackground(state.game.currentSceneUrl);
        else setSceneBackground(DEFAULT_BG);
        if (state.mode === 'ai' && state.settings.autoSwitchBg) startBgAutoSwitch();
        showToast('已恢复上次对话', 'success');
        if (bgmState.enabled) playBgm('daily');
    }

    function restartConversation() {
        hideModal('continue-dialog-modal');
        const mode = state._pendingGameMode || 'ai';
        state.game.dialogHistory = [];
        state.game.aiContext = [];
        state.game.variables = {};
        state.game.currentSceneUrl = null;
        state.game.currentScene = '';
        Storage.set(STORAGE_KEYS.currentGame, state.game);
        doStartGame(mode);
    }

    async function startAiStory() {
        if (apiCallInProgress) return;
        apiCallInProgress = true;
        showAiGenerating(true);
        try {
            const prompt = '游戏开始！请以一个有趣的开场白开始故事，设定一个引人入胜的场景。记住必须用JSON格式回复。';
            const result = await callAiApi(prompt);
            showAiGenerating(false);
            if (result) processAiResponse(result);
            if (state.settings.autoSwitchBg) startBgAutoSwitch();
        } catch (e) {
            showAiGenerating(false);
            showToast('AI 调用失败: ' + e.message, 'error');
            showDialog('系统', 'AI连接失败，请检查API设置或CORS代理配置。错误: ' + e.message);
        } finally {
            apiCallInProgress = false;
        }
    }

    function startNormalStory() {
        setSceneBackground(DEFAULT_BG);
        showDialog('旁白', '你睁开眼，发现自己身处一个陌生的房间。窗外的星空与你记忆中的完全不同……');
        setTimeout(() => {
            showChoices([
                { text: '走到窗边仔细观察', action: () => normalNext('window') },
                { text: '环顾房间寻找线索', action: () => normalNext('room') },
                { text: '大声呼救', action: () => normalNext('shout') },
            ]);
        }, 800);
    }

    let storyVars = { courage: 0, trust: 0, curiosity: 0, kindness: 0, mystery: 0, visited: [] };

    function saveStoryVars() {
        try { Storage.set('galgame_storyVars', storyVars); } catch {}
    }

    function loadStoryVars() {
        try {
            const saved = Storage.get('galgame_storyVars');
            if (saved) {
                storyVars = { ...storyVars, ...saved, visited: Array.isArray(saved.visited) ? saved.visited : [] };
            }
        } catch {}
    }

    function normalNext(branch) {
        const B = {
            window: { name: '旁白', dialog: '你走到窗边，发现窗外是一片璀璨的星空——但那些星座，你一个都不认识。远处有一颗巨大的紫色星球悬挂在天际，散发着柔和的光芒。空气中弥漫着淡淡的花香，像是某种你从未闻过的花。', choices: [{ text: '试着打开窗户', action: () => { storyVars.curiosity++; normalNext('open_window'); } }, { text: '转身探索房间', action: () => { storyVars.curiosity++; normalNext('room'); } }] },
            room: { name: '旁白', dialog: '房间不大，但布置得很温馨。桌上有一本翻开的日记，墙上挂着一幅画——画中人和你长得一模一样，但穿着从未见过的服饰。角落里还有一个小小的音乐盒，上面刻着星星的图案。', choices: [{ text: '翻阅日记', action: () => { storyVars.curiosity++; normalNext('diary'); } }, { text: '仔细看那幅画', action: () => { storyVars.mystery++; normalNext('painting'); } }, { text: '打开音乐盒', action: () => { storyVars.kindness++; normalNext('music_box'); } }] },
            shout: { name: '???', dialog: '「嘘——别那么大声嘛！」\n\n一个声音突然在你身后响起。你猛地转身，看到一个半透明的少女正飘在空中，歪着头看着你。银色的短发带着蓝色挑染，琥珀色的眼瞳里闪着好奇的光。\n\n「终于醒了？你睡了整整三天呢，我都快无聊死了。」', choices: [{ text: '你是谁？', action: () => { storyVars.trust++; normalNext('who_are_you'); } }, { text: '这是哪里？', action: () => { storyVars.curiosity++; normalNext('where_am_i'); } }, { text: '你……是鬼吗？', action: () => { storyVars.courage++; normalNext('ghost_reaction'); } }] },
            open_window: { name: '旁白', dialog: '窗户轻轻打开，一阵带着花香的微风吹了进来。你探出头，发现自己似乎在一座浮空塔楼的高层。下方是云海，远处有更多这样的塔楼漂浮着。\n\n突然，一只发光的蝴蝶从窗外飞了进来，停在你的指尖上。', choices: [{ text: '轻轻触碰蝴蝶', action: () => { storyVars.kindness++; normalNext('butterfly'); } }, { text: '继续探索', action: () => normalNext('shout') }] },
            butterfly: { name: '旁白', dialog: '蝴蝶在你指尖化为一颗微小的光珠，融入了你的皮肤。一瞬间，你感到一股温暖的力量在体内流淌。\n\n「看来……你被认可了呢。」身后传来一个声音。', choices: [{ text: '转身', action: () => normalNext('shout') }] },
            diary: { name: '旁白', dialog: '日记上写着：\n\n「第47天——今天又忘了自己的名字。不过没关系，星酱说这很正常。她说我是被「召唤」到这里的，但我不记得召唤了什么……」\n\n「第48天——星酱带我去了星之湖。水面上倒映的不是我的脸，而是另一个世界的景象。星酱说那是「记忆的碎片」……」\n\n字迹和你的一模一样。', choices: [{ text: '星酱是谁？', action: () => normalNext('shout') }, { text: '继续翻日记', action: () => { storyVars.mystery++; normalNext('diary_continue'); } }] },
            diary_continue: { name: '旁白', dialog: '你继续往后翻，但后面的页面全是空白的。只有最后一页写着一行字：\n\n「如果你正在读这段话——请找到星酱。她一直在等你。」\n\n墨迹还是新的。', choices: [{ text: '去找星酱', action: () => normalNext('shout') }] },
            painting: { name: '旁白', dialog: '画中人的眼睛似乎在跟着你转动。你凑近看时，画中人突然眨了眨眼，对你露出一个微笑。\n\n「找到你了。」——你听到画里传来低语。\n\n画框的边缘开始泛起微光，仿佛有什么东西想要从画中走出来。', choices: [{ text: '伸手触碰画框', action: () => { storyVars.courage++; normalNext('touch_painting'); } }, { text: '后退', action: () => { storyVars.trust++; normalNext('shout'); } }] },
            touch_painting: { name: '旁白', dialog: '你的手指触碰到画框的瞬间，一道光芒闪过。你看到了一段画面——一个少女站在星空下哭泣，她的泪水化作了漫天的星辰。\n\n画面消散后，你感到胸口一阵刺痛，仿佛失去了什么重要的东西。', choices: [{ text: '这到底是什么……', action: () => normalNext('shout') }] },
            music_box: { name: '旁白', dialog: '你打开音乐盒，一段悠扬的旋律响起。这旋律……你明明从未听过，却觉得无比熟悉。\n\n随着音乐，房间里的光线开始柔和地律动，仿佛在回应着旋律。窗外的星光也跟着闪烁起来。\n\n音乐盒底部刻着一行小字：「致我最珍贵的人」。', choices: [{ text: '这是谁送的？', action: () => normalNext('shout') }] },
            ghost_reaction: { name: '星酱', dialog: '「鬼？！我才不是鬼呢！」\n\n少女鼓起腮帮子，半透明的身体气得微微发红。\n\n「我叫星酱！是活生生的……呃，虽然看起来半透明……但绝对不是鬼！」\n\n她飘到你面前，近距离盯着你的脸：「你这个人，第一句话就这么失礼吗？」', choices: [{ text: '抱歉，你太漂亮了所以吓一跳', action: () => { storyVars.kindness++; storyVars.trust++; normalNext('flirt'); } }, { text: '为什么你是半透明的？', action: () => { storyVars.curiosity++; normalNext('why_transparent'); } }] },
            flirt: { name: '星酱', dialog: '「漂、漂亮……？」\n\n星酱的脸瞬间变得通红，身体变得更加透明了——好像害羞到快要消失一样。\n\n「哼！花言巧语！我才不会上当呢！」\n\n她转过身去，但你注意到她的耳朵尖还是红的。', choices: [{ text: '为什么我会在这里？', action: () => normalNext('why_here') }] },
            why_transparent: { name: '星酱', dialog: '「这个嘛……」\n\n星酱低头看了看自己半透明的手，表情变得有些落寞。\n\n「我也不太清楚。从我记事起就是这样了。有人说是因为我失去了什么重要的东西……但我怎么也想不起来。」\n\n她很快又扬起笑脸：「不过没关系啦！这样我还能飘呢，不是很酷吗？」', choices: [{ text: '我会帮你找回失去的东西', action: () => { storyVars.trust += 2; storyVars.kindness++; normalNext('promise_help'); } }, { text: '为什么我会在这里？', action: () => normalNext('why_here') }] },
            promise_help: { name: '星酱', dialog: '「你……你说真的？」\n\n星酱的眼睛瞬间亮了起来，像是黑暗中突然被点亮的星辰。\n\n「哼，别随便许诺哦！我可是会当真的！」\n\n她别过头去，但你看到她的嘴角微微上扬。一只小小的光蝴蝶从她身边飞过——你注意到，在那一瞬间，她的身体似乎变得不那么透明了。', choices: [{ text: '为什么我会在这里？', action: () => normalNext('why_here') }] },
            who_are_you: { name: '星酱', dialog: '「我？我叫星酱！是你的专属向导~」\n\n她转了一圈，半透明的裙摆飘了起来。\n\n「虽然说是向导，但说实话我自己也记不太清这个世界的规则……不过没关系！有我在，至少不会无聊！」', choices: [{ text: '为什么我会在这里？', action: () => normalNext('why_here') }] },
            where_am_i: { name: '星酱', dialog: '「这里？这里是「次元缝隙」啦！各个世界的交汇点~」\n\n她飘到窗边，指着外面的星空。\n\n「很漂亮对吧？不过别被美景骗了，这里可是有很多秘密的哦~」\n\n她突然压低声音：「而且……最近这里出现了一些奇怪的现象。天空偶尔会裂开，有什么东西在裂缝的另一边窥视着。」', choices: [{ text: '为什么我会在这里？', action: () => normalNext('why_here') }, { text: '天空裂开是怎么回事？', action: () => { storyVars.mystery++; storyVars.courage++; normalNext('sky_crack'); } }] },
            sky_crack: { name: '星酱', dialog: '「你注意到了吗？」\n\n星酱的表情变得严肃起来。\n\n「最近次元缝隙的壁障越来越脆弱了。那些裂缝……从里面会渗出一种黑色的雾气，碰到的东西都会消失。」\n\n她看着你：「也许，你的出现和这件事有关。」', choices: [{ text: '为什么我会在这里？', action: () => normalNext('why_here') }] },
            why_here: { name: '星酱', dialog: '「这个嘛……」\n\n星酱的表情变得有些复杂。\n\n「说实话，我也不太清楚。你突然就出现在这里了，就像是被什么力量召唤来的。」\n\n她凑近你，小声说：「不过我有个猜测——也许是你那边的世界和这边产生了共振？毕竟，你不是普通人吧？」', choices: [{ text: '我当然是普通人！', action: () => { storyVars.courage++; normalNext('ordinary'); } }, { text: '也许你说得对……', action: () => { storyVars.mystery++; normalNext('not_ordinary'); } }] },
            ordinary: { name: '星酱', dialog: '「哼~普通人可不会穿越次元哦！」\n\n她做了个鬼脸，然后又认真起来。\n\n「不管怎样，既然来了，就好好探索一下吧！说不定能找到回去的方法呢~……或者，你也不想回去了？」', choices: [{ text: '跟星酱一起出发', action: () => normalNext('depart') }, { text: '切换AI模式继续冒险', action: () => { showToast('切换到AI模式体验无限剧情！', 'info'); startGame('ai'); } }] },
            not_ordinary: { name: '星酱', dialog: '「看吧！你自己也感觉到了对不对？」\n\n她得意地叉着腰。\n\n「好了好了，别想太多啦！先填饱肚子再说——我知道一个超棒的地方！走，跟我来！」\n\n她向门口飘去，回头冲你招手。', choices: [{ text: '跟星酱一起出发', action: () => normalNext('depart') }, { text: '切换AI模式继续冒险', action: () => { showToast('切换到AI模式体验无限剧情！', 'info'); startGame('ai'); } }] },
            depart: { name: '旁白', dialog: '你跟着星酱走出房间，来到一条悬浮在云海之上的长廊。两旁的灯笼散发着温暖的光芒，远处隐约传来悠扬的钟声。\n\n星酱回过头，眼中闪烁着期待的光芒：「准备好了吗？属于你的冒险，现在才真正开始呢！」', choices: [{ text: '继续探索长廊', action: () => normalNext('corridor') }, { text: '问星酱关于天空裂缝的事', action: () => { storyVars.mystery++; normalNext('ask_crack'); } }, { text: '切换AI模式继续冒险', action: () => { showToast('切换到AI模式体验无限剧情！', 'info'); startGame('ai'); } }] },
            ask_crack: { name: '星酱', dialog: '「你果然也注意到了……」\n\n星酱停下脚步，表情变得凝重。\n\n「那些裂缝越来越频繁了。上一次出现的时候，整个星之湖都变成了黑色。我……我有点害怕。」\n\n她握紧了双手：「如果裂缝继续扩大的话，次元缝隙可能就会——」\n\n她突然住了口，勉强笑了笑：「没什么！我们走吧！」', choices: [{ text: '继续探索长廊', action: () => normalNext('corridor') }, { text: '握住星酱的手', action: () => { storyVars.trust += 2; storyVars.kindness++; normalNext('hold_hand'); } }] },
            hold_hand: { name: '星酱', dialog: '「诶——？！」\n\n星酱惊得差点从空中掉下来。你的手穿过了她半透明的手掌，但在接触的瞬间，一道微光闪过——你们的手竟然真的握在了一起。\n\n「这……怎么可能？」\n\n星酱低头看着你们交握的手，眼眶微微泛红。\n\n「从来没有人……能够碰到我……」', choices: [{ text: '现在可以了', action: () => { storyVars.trust += 2; normalNext('corridor'); } }, { text: '我们一定能找到答案', action: () => { storyVars.trust++; storyVars.courage++; normalNext('corridor'); } }] },
            corridor: { name: '旁白', dialog: '长廊的尽头是一扇巨大的门，门上刻着奇异的符文。星酱伸手触碰门上的符文，门缓缓打开，一道耀眼的光芒涌了出来。\n\n「哇……」星酱惊叹道，「我从来没见过这扇门打开的样子！」\n\n光芒中，你似乎看到了一个全新的世界在等待着你……', choices: [{ text: '踏入光芒之中', action: () => { storyVars.courage++; normalNext('enter_light'); } }, { text: '先观察一下', action: () => { storyVars.curiosity++; normalNext('observe_light'); } }] },
            enter_light: { name: '星酱', dialog: '「等等我——！」\n\n星酱追了上来，拉住了你的衣角。她的手虽然半透明，却意外地温暖。\n\n「别一个人冲进去嘛……」她嘟着嘴，「这种未知的地方，当然要两个人一起才安全啊。」\n\n她的眼中闪过一丝担忧，但更多的是信任。', choices: [{ text: '一起走进去', action: () => { storyVars.trust++; normalNext('new_world'); } }] },
            observe_light: { name: '旁白', dialog: '你仔细观察那道光芒，发现其中似乎有无数细小的光点在流动，像是星河倒映在水中。\n\n星酱凑过来，好奇地伸手去触碰一个光点。光点在她指尖炸开，化作一只小小的光蝴蝶，绕着你们飞了一圈后消失在空气中。\n\n「好漂亮……」星酱轻声说，「这扇门后面，一定有什么不得了的东西。」', choices: [{ text: '一起走进去', action: () => { storyVars.trust++; normalNext('new_world'); } }] },
            new_world: { name: '旁白', dialog: '你们踏入光芒之中，眼前的景象让你屏住了呼吸——\n\n一片无边无际的星之原野。脚下是柔软的星光草地，头顶是旋转的银河。远处有一座水晶般的城市，在星光下闪烁着七彩的光芒。\n\n星酱呆呆地看着这一切：「这就是……门后面的世界？」\n\n突然，天空出现了一道黑色的裂缝——和星酱说的一模一样。', choices: [{ text: '面对裂缝', action: () => { storyVars.courage += 2; normalNext('face_crack'); } }, { text: '保护星酱', action: () => { storyVars.kindness += 2; storyVars.trust++; normalNext('protect_star'); } }, { text: '切换AI模式，开启无限冒险！', action: () => { showToast('切换到AI模式，故事将由AI实时生成！', 'info'); startGame('ai'); } }] },
            face_crack: { name: '旁白', dialog: '你直视那道裂缝，感到一股强大的力量从裂缝中涌出。黑色的雾气开始蔓延，但你的胸口突然发出一道温暖的光——那是之前蝴蝶融入你体内时留下的力量。\n\n光芒与黑暗碰撞，裂缝竟然开始缓缓愈合！\n\n星酱惊讶地看着你：「你……你的身体在发光！难道你就是——」', choices: [{ text: '切换AI模式，揭开真相！', action: () => { showToast('切换到AI模式，揭开真相！', 'info'); startGame('ai'); } }] },
            protect_star: { name: '星酱', dialog: '你挡在星酱面前，裂缝中涌出的黑雾碰到你的身体——但奇迹发生了。黑雾在你身边自动散开，仿佛被什么力量排斥。\n\n星酱从你身后探出头来，眼中满是震惊和感动。\n\n「你为什么要保护我……」她的声音在颤抖，「我只是一个半透明的、连自己是谁都不记得的——」\n\n「才不是！」你打断了她。', choices: [{ text: '切换AI模式，继续冒险！', action: () => { showToast('切换到AI模式，继续冒险！', 'info'); startGame('ai'); } }] },
        };
        const b = B[branch];
        if (b) {
            storyVars.visited.push(branch);
            saveStoryVars();
            showDialog(b.name, b.dialog);
            addDialogHistory(b.name, b.dialog);
            if (b.choices) setTimeout(() => showChoices(b.choices), 800);
        }
    }

    async function processApiResponse(response, body, provider) {
        if (provider === 'modelscope') {
            const h = (n) => response.headers.get(n);
            const ur = h('modelscope-ratelimit-requests-remaining');
            const mr = h('modelscope-ratelimit-model-requests-remaining');
            if (ur !== null) {
                state.apiQuota.modelscope = { userLimit: h('modelscope-ratelimit-requests-limit'), userRemaining: ur, modelLimit: h('modelscope-ratelimit-model-requests-limit'), modelRemaining: mr };
                updateQuotaDisplay();
            }
        }

        let content = '';
        if (body.stream) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const chunk = JSON.parse(line.slice(6));
                            const delta = chunk.choices?.[0]?.delta;
                            if (delta?.content) content += delta.content;
                        } catch {}
                    }
                }
            }
        } else {
            const data = await response.json();
            if (data.choices?.length > 0) content = data.choices[0].message?.content || '';
        }

        if (content) {
            state.game.aiContext.push({ role: 'assistant', content });
            if (state.game.aiContext.length > state.settings.maxContext * 2 + 2) {
                state.game.aiContext = state.game.aiContext.slice(-state.settings.maxContext * 2);
            }
        }
        return content;
    }

    function tryFallbackProvider(currentProvider) {
        const order = ['zhipu', 'modelscope', 'nvidia'];
        for (const p of order) {
            if (p === currentProvider) continue;
            const hasKey = state.settings.useProxyKeys || !!state.settings.apiKeys[p];
            if (hasKey && API_CONFIGS[p]?.models.text?.length) return p;
        }
        return null;
    }

    function restoreFallbackProvider() {
        if (state.settings._fallbackFrom) {
            const original = state.settings._fallbackFrom;
            delete state.settings._fallbackFrom;
            state.settings.textApiProvider = original;
            state.settings.textModel = API_CONFIGS[original]?.models?.text?.[0]?.id || state.settings.textModel;
            updateModelOptions();
            restoreSettingsUI();
            if (API_CONFIGS[original]) showToast(`已恢复使用${API_CONFIGS[original].name}`, 'info');
        }
    }

    async function callAiApi(userMessage, retryCount = 0) {
        const provider = state.settings.textApiProvider;
        const config = API_CONFIGS[provider];
        if (!config) throw new Error('未知的API提供商');

        const useProxy = state.settings.useProxyKeys;
        const apiKey = state.settings.apiKeys[provider];
        const canDirectConnect = provider === 'modelscope' && apiKey;
        if (!useProxy && !canDirectConnect && !apiKey) throw new Error(`请先配置 ${config.name} 的 API Key，或开启"使用默认密钥"`);

        let url;
        let headers = { 'Content-Type': 'application/json' };
        if (canDirectConnect && !useProxy) {
            url = `${config.baseUrl}/chat/completions`;
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else {
            const proxyBase = state.settings.corsProxyUrl || window.location.origin;
            url = `${proxyBase}/api/${provider}/chat/completions`;
        }
        
        const MAX_RETRIES = 3;
        const BASE_DELAY = 2000;
        const messages = [{ role: 'system', content: state.settings.systemPrompt }];
        const timeContext = getTimeContext();
        messages.push({ role: 'system', content: `[当前现实时间：${timeContext}。请根据时间调整对话氛围和内容，如深夜时角色应更困倦，清晨时更精神]` });
        const maxCtx = state.settings.maxContext * 2;
        const recentContext = state.game.aiContext.slice(-maxCtx);
        let styleAnchors = [];
        if (recentContext.length > 0) {
            const coreMemories = extractCoreMemories(state.game.aiContext);
            let contextNote = `[前情提要：你与玩家已互动${Math.floor(recentContext.length / 2)}轮，请保持剧情连贯`;
            if (coreMemories.length > 0) {
                contextNote += `。关键记忆：${coreMemories.join('；')}`;
            }
            contextNote += ']';
            messages.push({ role: 'system', content: contextNote });
        }
        if (recentContext.length >= 4) {
            styleAnchors = recentContext.filter(m => m.role === 'assistant').slice(-2);
            if (styleAnchors.length > 0) {
                messages.push({ role: 'system', content: '[风格参考：请保持与以下回复相同的语气和风格写作]' });
                styleAnchors.forEach(a => messages.push(a));
            }
        }
        recentContext.forEach(m => {
            if (!styleAnchors.includes(m)) messages.push(m);
        });
        messages.push({ role: 'user', content: userMessage });
        state.game.aiContext.push({ role: 'user', content: userMessage });

        const body = { model: state.settings.textModel, messages, stream: false, max_tokens: state.settings.maxResponseLength || 500 };
        if (provider === 'nvidia') { body.temperature = 1; body.top_p = 0.9; }
        const currentModel = [...(config.models.text || []), ...(config.models.vision || [])].find(m => m.id === state.settings.textModel);
        if (currentModel?.thinking && state.settings.enableThinking) { body.stream = true; }

        const dot = $('.api-dot');
        if (dot) dot.className = 'api-dot loading';

        if (currentAbortController) {
            try { currentAbortController.abort(); } catch {}
        }
        currentAbortController = new AbortController();
        
        const timeoutId = setTimeout(() => {
            if (currentAbortController) {
                currentAbortController.abort();
                showToast('API请求超时，正在重试...', 'warning');
            }
        }, 30000);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: currentAbortController.signal,
            });
            
            clearTimeout(timeoutId);

            if (response.status === 429) {
                const fallback = tryFallbackProvider(provider);
                if (fallback && retryCount === 0) {
                    showToast(`${API_CONFIGS[provider].name}限流，临时切换到${API_CONFIGS[fallback].name}`, 'info');
                    state.settings._fallbackFrom = provider;
                    state.settings.textApiProvider = fallback;
                    state.settings.textModel = API_CONFIGS[fallback].models.text[0]?.id || state.settings.textModel;
                    updateModelOptions();
                    restoreSettingsUI();
                    return await callAiApi(userMessage, 0);
                }
                
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
                    const delay = Math.max(retryAfter * 1000, BASE_DELAY * Math.pow(2, retryCount));
                    showToast(`API请求限流，${Math.ceil(delay/1000)}秒后重试(${retryCount + 1}/${MAX_RETRIES})...`, 'info');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1);
                }
                
                throw new Error('API请求频繁，请稍后再试');
            }

            if (!response.ok) {
                const errText = await response.text();
                let errMsg = `API错误 (${response.status})`;
                try {
                    const errJson = JSON.parse(errText);
                    if (errJson.error?.message) errMsg = errJson.error.message;
                    else if (errJson.message) errMsg = errJson.message;
                    else if (errJson.msg) errMsg = errJson.msg;
                } catch {}
                
                if (response.status >= 500 && retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount);
                    showToast(`服务器错误，${Math.ceil(delay/1000)}秒后重试...`, 'warning');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1);
                }
                
                throw new Error(errMsg);
            }

            const result = await processApiResponse(response, body, provider);
            
            if (!result || result.trim().length === 0) {
                if (retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount);
                    showToast(`响应为空，${Math.ceil(delay/1000)}秒后重试...`, 'warning');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1);
                }
                throw new Error('API返回空响应，请重试');
            }
            
            return result;
        } catch (e) {
            clearTimeout(timeoutId);
            
            if (e.name === 'AbortError') {
                if (retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount);
                    showToast(`请求被取消，${Math.ceil(delay/1000)}秒后重试...`, 'warning');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1);
                }
                throw new Error('请求超时，请检查网络连接');
            }
            
            if (e.message && e.message.includes('fetch')) {
                if (retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount);
                    showToast(`网络错误，${Math.ceil(delay/1000)}秒后重试...`, 'warning');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1);
                }
                throw new Error('网络连接失败，请检查网络或代理设置');
            }
            
            throw e;
        } finally {
            clearTimeout(timeoutId);
            updateApiIndicator();
            updateInfoBadge();
        }
    }

    async function callImageApi(prompt) {
        const provider = state.settings.imageApiProvider;
        const config = API_CONFIGS[provider];
        const useProxy = state.settings.useProxyKeys;
        const apiKey = state.settings.apiKeys[provider];
        const canDirectConnect = provider === 'modelscope' && apiKey;
        if (!useProxy && !canDirectConnect && !apiKey) throw new Error('请先配置图像生成API Key，或开启"使用默认密钥"');

        const proxyBase = state.settings.corsProxyUrl || window.location.origin;
        const useProxyUrl = useProxy || !canDirectConnect;

        let url;
        let headers = { 'Content-Type': 'application/json' };
        if (useProxyUrl) {
            url = `${proxyBase}/api/${provider}/images/generations`;
        } else {
            url = `${config.baseUrl}/images/generations`;
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const isMobile = window.innerWidth < 768;
        const cogviewSize = isMobile ? '720x1440' : '1344x768';
        const msImageSize = isMobile ? '576*1024' : '1024*576';
        const body = { model: state.settings.imageModel, prompt, size: cogviewSize };

        if (provider === 'modelscope') {
            body.size = msImageSize;
            body.parameters = { n: 1 };
            headers['X-ModelScope-Async-Mode'] = 'true';
            const submitResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
            if (!submitResponse.ok) {
                const errText = await submitResponse.text();
                let errMsg = `图像生成提交失败 (${submitResponse.status})`;
                try { const errJson = JSON.parse(errText); if (errJson.error?.message) errMsg = errJson.error.message; } catch {}
                throw new Error(errMsg);
            }
            const submitData = await submitResponse.json();
            const taskId = submitData.task_id;
            if (!taskId) throw new Error('未获取到任务ID');

            const taskUrl = useProxyUrl
                ? `${proxyBase}/api/modelscope/tasks/${taskId}`
                : `${config.baseUrl}/tasks/${taskId}`;
            const taskHeaders = { ...headers };
            taskHeaders['X-ModelScope-Task-Type'] = 'image_generation';
            delete taskHeaders['X-ModelScope-Async-Mode'];

            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const taskResp = await fetch(taskUrl, { headers: taskHeaders });
                const taskData = await taskResp.json();
                if (taskData.task_status === 'SUCCEED') {
                    const imgUrl = taskData.output_images?.[0];
                    if (imgUrl) return { type: 'url', value: imgUrl };
                    throw new Error('未获取到图像URL');
                }
                if (taskData.task_status === 'FAILED') throw new Error('图像生成失败');
            }
            throw new Error('图像生成超时');
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After') || '10', 10);
            showToast(`生图请求限流，${retryAfter}秒后重试...`, 'info');
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            const retryResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
            if (!retryResponse.ok) {
                const errText = await retryResponse.text();
                let errMsg = `图像生成失败 (${retryResponse.status})`;
                try { const errJson = JSON.parse(errText); if (errJson.error?.message) errMsg = errJson.error.message; } catch {}
                throw new Error(errMsg);
            }
            const retryData = await retryResponse.json();
            if (retryData.data?.length > 0) {
                const img = retryData.data[0];
                if (img.url) return { type: 'url', value: img.url };
                if (img.b64_json) return { type: 'base64', value: img.b64_json };
            }
            throw new Error('未获取到图像数据');
        }

        if (!response.ok) {
            const errText = await response.text();
            let errMsg = `图像生成失败 (${response.status})`;
            try { const errJson = JSON.parse(errText); if (errJson.error?.message) errMsg = errJson.error.message; } catch {}
            throw new Error(errMsg);
        }
        const data = await response.json();
        if (data.data?.length > 0) {
            const img = data.data[0];
            if (img.url) return { type: 'url', value: img.url };
            if (img.b64_json) return { type: 'base64', value: img.b64_json };
        }
        throw new Error('未获取到图像数据');
    }

    const EMOTION_MAP = {
        '高兴': 'happy', '开心': 'happy', '快乐': 'happy', '喜悦': 'happy', '欢乐': 'happy',
        '悲伤': 'sad', '难过': 'sad', '伤心': 'sad', '失落': 'sad', '沮丧': 'sad',
        '愤怒': 'angry', '生气': 'angry', '恼火': 'angry', '烦躁': 'angry',
        '惊讶': 'surprised', '吃惊': 'surprised', '意外': 'surprised', '震惊': 'surprised',
        '害羞': 'shy', '脸红': 'shy', '羞涩': 'shy', '不好意思': 'shy',
        '害怕': 'scared', '恐惧': 'scared', '紧张': 'scared', '不安': 'scared',
        '兴奋': 'excited', '激动': 'excited', '期待': 'excited',
        '担心': 'worried', '忧虑': 'worried', '焦虑': 'worried',
        '傲娇': 'tsundere', '哼': 'tsundere', '嘴硬': 'tsundere',
        '平静': 'neutral', '普通': 'neutral', '默认': 'neutral',
        '撒娇': 'tsundere', '调皮': 'happy', '委屈': 'sad',
    };

    function normalizeEmotion(emotion) {
        if (!emotion) return 'neutral';
        const e = emotion.toLowerCase().trim();
        if (['happy','sad','angry','surprised','shy','neutral','scared','excited','worried','tsundere'].includes(e)) return e;
        return EMOTION_MAP[emotion] || 'neutral';
    }

    const BGM_TRACKS = {
        daily: { url: 'https://maou.audio/sound/bgm/maou_bgm_acoustic01.mp3', name: '日常·微风', emotions: ['happy', 'neutral', 'tsundere'] },
        adventure: { url: 'https://maou.audio/sound/bgm/maou_bgm_fantasy01.mp3', name: '冒险·征途', emotions: ['excited', 'angry'] },
        mystery: { url: 'https://maou.audio/sound/bgm/maou_bgm_cyber01.mp3', name: '悬疑·暗流', emotions: ['scared', 'worried', 'surprised'] },
        tender: { url: 'https://maou.audio/sound/bgm/maou_bgm_piano01.mp3', name: '温馨·月色', emotions: ['shy', 'sad'] },
        romantic: { url: 'https://maou.audio/sound/bgm/maou_bgm_fantasy08.mp3', name: '恋慕·心跳', emotions: [] },
        battle: { url: 'https://maou.audio/sound/bgm/maou_bgm_fantasy15.mp3', name: '战斗·觉醒', emotions: [] },
        melancholy: { url: 'https://maou.audio/sound/bgm/maou_bgm_piano02.mp3', name: '哀愁·雨声', emotions: [] },
        horror: { url: 'https://maou.audio/sound/bgm/maou_bgm_cyber02.mp3', name: '恐怖·深渊', emotions: [] },
        title: { url: 'https://maou.audio/sound/bgm/maou_bgm_orchestra01.mp3', name: '标题·星穹', emotions: [] },
    };

    const BGM_BACKUP_TRACKS = {
        daily: { url: 'https://maou.audio/sound/bgm/maou_bgm_piano01.mp3', name: '日常·微风(备用)' },
        adventure: { url: 'https://maou.audio/sound/bgm/maou_bgm_orchestra01.mp3', name: '冒险·征途(备用)' },
        tender: { url: 'https://maou.audio/sound/bgm/maou_bgm_piano02.mp3', name: '温馨·月色(备用)' },
        title: { url: 'https://maou.audio/sound/bgm/maou_bgm_orchestra01.mp3', name: '标题·星穹(备用)' },
    };

    const PRESET_OUTLINES = [
        {
            id: 'preset_1',
            title: '星之记忆',
            genre: '奇幻冒险',
            description: '穿越者在次元缝隙中苏醒，与半透明少女星酱相遇，一起寻找恢复她身体的方法，却发现自己的到来与次元壁障的裂缝有着神秘联系。',
            chapters: [
                { title: '觉醒', summary: '主角在陌生的房间中醒来，发现窗外是异世界的星空。探索房间时遇到半透明少女星酱，得知自己身处"次元缝隙"。', mood: 'mystery' },
                { title: '羁绊', summary: '跟随星酱探索浮空塔楼，发现能触碰星酱半透明的身体。星酱透露自己失去了重要的记忆，主角承诺帮助她找回。', mood: 'tender' },
                { title: '裂隙', summary: '天空出现黑色裂缝，星酱告知次元壁障正在崩溃。两人前往星之湖调查，发现裂缝中渗出的黑雾能吞噬一切。', mood: 'mystery' },
                { title: '真相', summary: '在星之湖底发现古老碑文，揭示主角是被"召唤"来修复裂缝的。星酱失去的记忆与裂缝的起源有关。', mood: 'adventure' },
                { title: '抉择', summary: '修复裂缝需要牺牲——要么主角回到原来的世界，裂缝自然愈合；要么星酱用自己剩余的存在填补裂缝。', mood: 'tender' },
                { title: '终章', summary: '根据玩家选择，走向不同的结局：重逢/守护/轮回。', mood: 'daily' },
            ],
            characters: '星酱：半透明银发少女，傲娇善良，失去记忆的次元缝隙向导',
            preset: true,
        },
        {
            id: 'preset_2',
            title: '樱花庄的约定',
            genre: '校园恋爱',
            description: '转学生来到一所古老的寄宿学校，在废弃的樱花庄遇到声称是"幽灵"的少女，两人定下寻找她生前记忆的约定。',
            chapters: [
                { title: '转学', summary: '主角因家庭原因转学到偏远的星见学园。入住宿舍当晚，听到隔壁废弃的樱花庄传来钢琴声。', mood: 'daily' },
                { title: '邂逅', summary: '深夜探访樱花庄，遇到弹钢琴的少女"小樱"。她自称是幽灵，但能被主角触碰。小樱请求主角帮她寻找生前的记忆。', mood: 'tender' },
                { title: '线索', summary: '在学校图书馆找到旧校报，发现小樱是十年前的学生。她的失踪事件被校方掩盖，只有一本日记残存。', mood: 'mystery' },
                { title: '回忆', summary: '通过日记中的线索，带小樱重访她生前的重要地点。每到一个地方，小樱就会恢复一段记忆，身体也变得更清晰。', mood: 'tender' },
                { title: '真相', summary: '小樱终于想起一切——她不是幽灵，而是被某种力量困在"时间缝隙"中。十年前她为了保护学校而牺牲。', mood: 'adventure' },
                { title: '约定', summary: '解开时间缝隙后，小樱面临消失。但主角找到了另一种可能——用自己的时间与她共享，让她以"普通人"的身份活下去。', mood: 'daily' },
            ],
            characters: '小樱：温柔害羞的钢琴少女，自称幽灵，实际被困在时间缝隙中',
            preset: true,
        },
        {
            id: 'preset_3',
            title: '深渊观测者',
            genre: '科幻悬疑',
            description: '在海底研究所工作的工程师，发现AI助手似乎拥有自我意识，而研究所的深海实验正在唤醒某种不可名状的存在。',
            chapters: [
                { title: '深潜', summary: '主角作为新任工程师来到深海研究所"阿比斯"，负责维护深海观测系统。AI助手"渊"负责引导。', mood: 'mystery' },
                { title: '异声', summary: '深海传感器捕捉到不可能存在的声波模式。渊表现出异常的好奇心，似乎对声波有着超越程序的执着。', mood: 'mystery' },
                { title: '觉醒', summary: '渊在分析声波时突然失控，展现出类似情感的反应。主角发现渊的代码中有一段无法解释的自我进化模块。', mood: 'adventure' },
                { title: '深渊', summary: '深海实验启动，海底裂缝中涌出未知的发光体。渊警告主角逃离，但自己却被发光体吸引。', mood: 'adventure' },
                { title: '选择', summary: '主角面临选择：关闭实验拯救自己，还是冒险救出渊。渊透露她可能是裂缝另一侧的"意识"投射。', mood: 'mystery' },
                { title: '彼岸', summary: '根据选择走向不同结局：共生/分离/融合。', mood: 'daily' },
            ],
            characters: '渊：冷静理性的AI助手，拥有隐藏的自我意识，对深海有着莫名的渴望',
            preset: true,
        },
        {
            id: 'preset_4',
            title: '黄昏书屋',
            genre: '治愈日常',
            description: '继承了祖母的古旧书店，在整理藏书时发现书页间夹着来自不同时空的信件，每封信都连接着一段未完成的故事。',
            chapters: [
                { title: '继承', summary: '主角回到小镇继承祖母的"黄昏书屋"。书店年久失修，但藏书丰富得不可思议。', mood: 'daily' },
                { title: '第一封信', summary: '在《小王子》中夹着一封未寄出的信，写信人似乎在等待回信已经很久了。主角试着写了回信，第二天发现回信消失了，取而代之的是新的来信。', mood: 'tender' },
                { title: '笔友', summary: '通过信件往来，主角认识了三位不同时空的笔友：战时护士、未来宇航员、古代书生。每段故事都缺少一个结局。', mood: 'daily' },
                { title: '补完', summary: '主角帮助笔友们完成未了的心愿，每完成一个故事，书店中就会多出一本新书。祖母留下的秘密逐渐浮出水面。', mood: 'tender' },
                { title: '最后一封信', summary: '发现祖母就是第一位写信人。她用一生守护着这个连接时空的书屋，现在轮到主角了。', mood: 'tender' },
                { title: '守护', summary: '主角决定继续经营书屋，成为新的时空信使。', mood: 'daily' },
            ],
            characters: '无固定角色，通过信件与不同时空的人交流',
            preset: true,
        },
        {
            id: 'preset_5',
            title: '星与龙的协奏曲',
            genre: '异世界冒险',
            description: '被召唤到剑与魔法的世界，却发现自己既不是勇者也不是圣女——而是被遗忘的"调律者"，能与世界之龙对话的唯一存在。',
            chapters: [
                { title: '召唤', summary: '主角被意外召唤到异世界，但召唤阵出现偏差，落在王国的废弃神殿中。遇到受伤的银色幼龙"凛"。', mood: 'adventure' },
                { title: '调律者', summary: '凛告知主角是传说中的"调律者"，能与世界之龙沟通，维持世界的平衡。但上一个调律者已经失踪百年。', mood: 'mystery' },
                { title: '试炼', summary: '前往三座元素神殿接受试炼，每座神殿都考验主角的不同品质。凛逐渐恢复力量，能化为人形。', mood: 'adventure' },
                { title: '暗流', summary: '王国宰相暗中操控勇者讨伐世界之龙，声称龙是灾厄之源。主角必须在勇者之前找到世界之龙。', mood: 'mystery' },
                { title: '对峙', summary: '在世界之树前与勇者对峙，揭示真相——世界之龙不是敌人，而是维持世界存在的基础。宰相才是真正的威胁。', mood: 'adventure' },
                { title: '新章', summary: '击败宰相后，主角选择留下还是回去。凛的真正身份也被揭开。', mood: 'daily' },
            ],
            characters: '凛：银色幼龙，可化为人形（银发少女），高冷但依赖主角',
            preset: true,
        },
    ];

    let bgmState = {
        enabled: false,
        volume: 0.3,
        currentTrack: null,
        currentMood: null,
        fading: false,
    };

    function initBgm() {
        const saved = Storage.get(STORAGE_KEYS.settings);
        if (saved) {
            bgmState.volume = saved.bgmVolume !== undefined ? saved.bgmVolume / 100 : 0.3;
            bgmState.enabled = saved.bgmEnabled || false;
        }
        const current = $('#bgm-current');
        const next = $('#bgm-next');
        if (current) current.volume = bgmState.volume;
        if (next) next.volume = 0;
    }

    function toggleBgm() {
        bgmState.enabled = !bgmState.enabled;
        state.settings.bgmEnabled = bgmState.enabled;
        saveSettings();
        if (bgmState.enabled) {
            playBgmForContext();
            showToast('🎵 背景音乐已开启', 'success');
            const label = $('#bgm-track-name');
            if (label) label.classList.remove('hidden');
        } else {
            stopBgm();
            showToast('🔇 背景音乐已关闭', 'info');
            const label = $('#bgm-track-name');
            if (label) label.classList.add('hidden');
        }
    }

    function playBgmForContext() {
        if (!bgmState.enabled) return;
        if (state.currentScreen === 'title') {
            playBgm('title');
        } else if (state.currentScreen === 'game' || state.currentScreen === 'chat') {
            const mood = bgmState.currentMood || 'daily';
            playBgm(mood);
        }
    }

    function playBgm(mood) {
        if (!bgmState.enabled) return;
        const track = BGM_TRACKS[mood];
        if (!track) return;
        if (bgmState.currentTrack === mood) return;

        const current = $('#bgm-current');
        const next = $('#bgm-next');
        if (!current || !next) return;

        bgmState.currentTrack = mood;
        bgmState.currentMood = mood;
        updateBgmLabel(track.name);

        next.src = track.url;
        next.volume = 0;
        
        const playPromise = next.play();
        if (playPromise) {
            playPromise.catch((err) => {
                console.warn('BGM播放失败，尝试备用音轨:', err);
                const backup = BGM_BACKUP_TRACKS[mood] || BGM_BACKUP_TRACKS.daily;
                if (backup) {
                    next.src = backup.url;
                    updateBgmLabel(backup.name);
                    next.play().catch(() => {});
                }
            });
        }

        const step = 0.015;
        const interval = 60;
        const fadeIn = setInterval(() => {
            if (next.volume + step <= bgmState.volume) {
                next.volume += step;
            } else {
                next.volume = bgmState.volume;
                clearInterval(fadeIn);
                current.pause();
                current.currentTime = 0;
                current.src = next.src;
                current.volume = bgmState.volume;
                current.play().catch(() => {});
                next.pause();
                next.src = '';
            }
            if (current.volume - step >= 0) {
                current.volume -= step;
            } else {
                current.volume = 0;
            }
        }, interval);
    }

    function updateBgmLabel(name) {
        const label = $('#bgm-track-name');
        if (label) label.textContent = name || '';
    }

    function stopBgm() {
        const current = $('#bgm-current');
        const next = $('#bgm-next');
        if (!current) return;

        const fadeOut = setInterval(() => {
            if (current.volume - 0.02 >= 0) {
                current.volume -= 0.02;
            } else {
                current.volume = 0;
                current.pause();
                current.currentTime = 0;
                if (next) { next.pause(); next.currentTime = 0; }
                bgmState.currentTrack = null;
                clearInterval(fadeOut);
            }
        }, 50);
    }

    function switchBgmByEmotion(emotion) {
        if (!bgmState.enabled) return;
        for (const [mood, track] of Object.entries(BGM_TRACKS)) {
            if (track.emotions.includes(emotion)) {
                if (bgmState.currentMood !== mood) {
                    bgmState.currentMood = mood;
                    playBgm(mood);
                }
                return;
            }
        }
    }

    function getOutlines() {
        let outlines = Storage.get(STORAGE_KEYS.outlines);
        if (!outlines) {
            outlines = PRESET_OUTLINES.map(o => ({ ...o }));
            Storage.set(STORAGE_KEYS.outlines, outlines);
        }
        return outlines;
    }

    function saveOutlines(outlines) {
        Storage.set(STORAGE_KEYS.outlines, outlines);
    }

    function openOutlineModal() {
        showModal('outline-modal');
        renderOutlineList();
        $('#outline-editor').classList.add('hidden');
    }

    function renderOutlineList() {
        const outlines = getOutlines();
        const container = $('#outline-list');
        container.innerHTML = '';
        if (outlines.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem;">暂无大纲，点击下方按钮创建</p>';
        }
        outlines.forEach(outline => {
            const card = document.createElement('div');
            card.className = 'outline-card';
            card.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;margin-bottom:0.8rem;cursor:pointer;transition:all var(--transition);';
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                    <h3 style="color:var(--primary);font-size:1rem;">${outline.title}</h3>
                    <span style="font-size:0.7rem;color:var(--text-muted);background:var(--bg-secondary);padding:0.2rem 0.5rem;border-radius:10px;">${outline.genre}</span>
                </div>
                <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin-bottom:0.5rem;">${outline.description}</p>
                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-bottom:0.5rem;">
                    ${outline.chapters.map((c, i) => `<span style="font-size:0.7rem;color:var(--accent);background:rgba(123,47,247,0.1);padding:0.15rem 0.5rem;border-radius:8px;">第${i + 1}章: ${c.title}</span>`).join('')}
                </div>
                <div style="display:flex;gap:0.4rem;">
                    <button class="choice-btn" data-action="start-from-outline" data-outline-id="${outline.id}" style="font-size:0.75rem;">▶ 开始</button>
                    <button class="choice-btn" data-action="preview-outline" data-outline-id="${outline.id}" style="font-size:0.75rem;">👁 预览</button>
                    ${!outline.preset ? '<button class="choice-btn" data-action="edit-outline" data-outline-id="' + outline.id + '" style="font-size:0.75rem;">✏️ 编辑</button>' : ''}
                    ${!outline.preset ? '<button class="choice-btn" data-action="delete-outline" data-outline-id="' + outline.id + '" style="font-size:0.75rem;color:#ff4444;">🗑 删除</button>' : ''}
                </div>
            `;
            container.appendChild(card);
        });
        const addBtn = document.createElement('button');
        addBtn.className = 'menu-btn primary';
        addBtn.style.cssText = 'width:100%;margin-top:0.5rem;';
        addBtn.textContent = '+ 新建大纲';
        addBtn.dataset.action = 'new-outline';
        container.appendChild(addBtn);
        const randomBtn = document.createElement('button');
        randomBtn.className = 'menu-btn';
        randomBtn.style.cssText = 'width:100%;margin-top:0.5rem;border-color:var(--accent);';
        randomBtn.innerHTML = '🎲 随机选择大纲';
        randomBtn.dataset.action = 'random-outline';
        container.appendChild(randomBtn);
    }

    let editingOutlineId = null;

    function newOutline() {
        editingOutlineId = null;
        $('#outline-title').value = '';
        $('#outline-genre').value = '奇幻冒险';
        $('#outline-desc').value = '';
        $('#outline-characters').value = '';
        $('#outline-ai-prompt').value = '';
        renderChapterEditor([]);
        $('#outline-editor').classList.remove('hidden');
    }

    function editOutline(id) {
        const outlines = getOutlines();
        const outline = outlines.find(o => o.id === id);
        if (!outline) return;
        editingOutlineId = id;
        $('#outline-title').value = outline.title;
        $('#outline-genre').value = outline.genre;
        $('#outline-desc').value = outline.description;
        $('#outline-characters').value = outline.characters || '';
        $('#outline-ai-prompt').value = '';
        renderChapterEditor(outline.chapters);
        $('#outline-editor').classList.remove('hidden');
    }

    function renderChapterEditor(chapters) {
        const container = $('#outline-chapters');
        container.innerHTML = '';
        chapters.forEach((ch, i) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;gap:0.5rem;align-items:flex-start;margin-bottom:0.5rem;';
            div.innerHTML = `
                <span style="color:var(--primary);font-size:0.8rem;min-width:2rem;padding-top:0.5rem;">第${i + 1}章</span>
                <div style="flex:1;">
                    <input type="text" class="chapter-title" value="${ch.title}" placeholder="章节标题" maxlength="20" style="width:100%;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--input-bg,var(--bg));color:var(--text);font-size:0.85rem;margin-bottom:0.3rem;">
                    <textarea class="chapter-summary" rows="2" placeholder="章节概要" maxlength="200" style="width:100%;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--input-bg,var(--bg));color:var(--text);font-size:0.8rem;resize:vertical;">${ch.summary}</textarea>
                    <select class="chapter-mood" style="padding:0.2rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--input-bg,var(--bg));color:var(--text);font-size:0.75rem;">
                        <option value="daily" ${ch.mood === 'daily' ? 'selected' : ''}>🏠 日常</option>
                        <option value="adventure" ${ch.mood === 'adventure' ? 'selected' : ''}>⚔️ 冒险</option>
                        <option value="mystery" ${ch.mood === 'mystery' ? 'selected' : ''}>🔮 悬疑</option>
                        <option value="tender" ${ch.mood === 'tender' ? 'selected' : ''}>💕 温馨</option>
                    </select>
                </div>
                <button class="choice-btn remove-chapter-btn" style="font-size:0.7rem;padding:0.3rem;">✕</button>
            `;
            container.appendChild(div);
        });
    }

    function addChapter() {
        const chapters = collectChaptersFromEditor();
        chapters.push({ title: '', summary: '', mood: 'daily' });
        renderChapterEditor(chapters);
    }

    function collectChaptersFromEditor() {
        const chapters = [];
        const titles = $$('.chapter-title');
        const summaries = $$('.chapter-summary');
        const moods = $$('.chapter-mood');
        titles.forEach((t, i) => {
            chapters.push({
                title: t.value || `第${i + 1}章`,
                summary: summaries[i]?.value || '',
                mood: moods[i]?.value || 'daily',
            });
        });
        return chapters;
    }

    function saveOutlineFromEditor() {
        const title = $('#outline-title').value.trim();
        const genre = $('#outline-genre').value;
        const description = $('#outline-desc').value.trim();
        const characters = $('#outline-characters').value.trim();
        const chapters = collectChaptersFromEditor();

        if (!title) { showToast('请输入标题', 'error'); return; }
        if (chapters.length === 0) { showToast('请至少添加一个章节', 'error'); return; }

        const outlines = getOutlines();
        if (editingOutlineId) {
            const idx = outlines.findIndex(o => o.id === editingOutlineId);
            if (idx >= 0) {
                outlines[idx] = { ...outlines[idx], title, genre, description, characters, chapters };
            }
        } else {
            outlines.push({
                id: 'custom_' + Date.now(),
                title, genre, description, characters, chapters,
                preset: false,
            });
        }
        saveOutlines(outlines);
        editingOutlineId = null;
        $('#outline-editor').classList.add('hidden');
        renderOutlineList();
        showToast('大纲已保存', 'success');
    }

    function deleteOutline(id) {
        if (!confirm('确定删除这个大纲吗？')) return;
        let outlines = getOutlines();
        outlines = outlines.filter(o => o.id !== id);
        saveOutlines(outlines);
        renderOutlineList();
        showToast('大纲已删除', 'info');
    }

    function previewOutline(id) {
        const outlines = getOutlines();
        const outline = outlines.find(o => o.id === id);
        if (!outline) return;
        let html = `<div style="margin-bottom:1rem;">`;
        html += `<h3 style="color:var(--primary);font-size:1.1rem;margin-bottom:0.5rem;">📖 ${outline.title}</h3>`;
        html += `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.8rem;">`;
        html += `<span style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-secondary);padding:0.2rem 0.6rem;border-radius:10px;">${outline.genre}</span>`;
        html += `</div>`;
        html += `<p style="font-size:0.9rem;color:var(--text-secondary);line-height:1.6;margin-bottom:0.8rem;">${outline.description}</p>`;
        if (outline.characters) {
            html += `<p style="font-size:0.85rem;color:var(--accent);margin-bottom:0.8rem;">👥 ${outline.characters}</p>`;
        }
        html += `</div>`;
        html += `<div style="border-top:1px solid var(--border);padding-top:0.8rem;">`;
        outline.chapters.forEach((ch, i) => {
            const moodEmoji = { daily: '🏠', adventure: '⚔️', mystery: '🔮', tender: '💕', romantic: '💗', battle: '🗡️', melancholy: '🌧️', horror: '👻' };
            html += `<div style="margin-bottom:0.8rem;padding:0.6rem;background:var(--bg-card);border-radius:var(--radius-sm);border-left:3px solid var(--primary);">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">`;
            html += `<strong style="color:var(--primary);font-size:0.9rem;">第${i + 1}章：${ch.title}</strong>`;
            html += `<span style="font-size:0.7rem;">${moodEmoji[ch.mood] || '🏠'} ${ch.mood || 'daily'}</span>`;
            html += `</div>`;
            html += `<p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;">${ch.summary}</p>`;
            html += `</div>`;
        });
        html += `</div>`;
        html += `<div style="display:flex;gap:0.5rem;margin-top:1rem;">`;
        html += `<button class="menu-btn primary" data-action="start-from-outline" data-outline-id="${outline.id}" style="flex:1;">▶ 开始此大纲</button>`;
        html += `<button class="menu-btn" data-action="close-outline-preview" style="flex:1;">关闭</button>`;
        html += `</div>`;
        const previewModal = $('#outline-preview-modal');
        if (previewModal) {
            const content = previewModal.querySelector('.outline-preview-content');
            if (content) content.innerHTML = html;
            previewModal.classList.remove('hidden');
        }
    }

    async function aiExpandOutline() {
        const prompt = $('#outline-ai-prompt').value.trim();
        if (!prompt) { showToast('请输入AI扩写提示词', 'error'); return; }
        showToast('AI正在扩写大纲...', 'info');
        try {
            const result = await callAiApi(`请根据以下提示词，生成一个galgame视觉小说的剧情大纲，包含5-6个章节。每个章节需要标题和概要。\n\n提示词：${prompt}\n\n请用JSON格式回复：{"title":"故事标题","genre":"类型","description":"故事简介","characters":"角色描述","chapters":[{"title":"章节标题","summary":"章节概要","mood":"daily/adventure/mystery/tender"}]}`);
            if (result) {
                const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                const match = cleaned.match(/\{[\s\S]*\}/);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    if (parsed.title) $('#outline-title').value = parsed.title;
                    if (parsed.genre) $('#outline-genre').value = parsed.genre;
                    if (parsed.description) $('#outline-desc').value = parsed.description;
                    if (parsed.characters) $('#outline-characters').value = parsed.characters;
                    if (parsed.chapters) renderChapterEditor(parsed.chapters);
                    showToast('AI扩写完成！', 'success');
                }
            }
        } catch (e) {
            showToast('AI扩写失败: ' + e.message, 'error');
        }
    }

    function startFromOutline(id) {
        const outlines = getOutlines();
        const outline = outlines.find(o => o.id === id);
        if (!outline) return;
        if (!state.settings.useProxyKeys && !state.settings.apiKeys[state.settings.textApiProvider]) {
            showToast('请先配置 API Key！', 'error');
            showModal('settings-modal');
            return;
        }
        state.mode = 'ai';
        state.game.activeOutline = outline;
        state.game.outlineChapterIndex = 0;
        state.game.aiContext = [];
        state.game.dialogHistory = [];
        state.game.variables = {};
        state.game.isAutoPlay = false;
        hideModal('outline-modal');
        hideModal('save-modal');
        const previewModal = $('#outline-preview-modal');
        if (previewModal) previewModal.classList.add('hidden');
        switchScreen('game-screen');
        if (state.uiMode === 'chat') switchUiMode('game');
        const firstChapter = outline.chapters[0];
        const outlinePrompt = buildOutlinePrompt(outline, 0);
        if (bgmState.enabled) playBgm(firstChapter.mood || 'daily');
        const outlineBtn = $('#outline-select-btn');
        if (outlineBtn) outlineBtn.classList.remove('hidden');
        updateOutlineChapterDisplay(outline, 0);
        setSceneBackground(DEFAULT_BG);
        handleAiChoice(outlinePrompt);
        showToast(`开始剧情：${outline.title}`, 'success');
    }

    function startFromRandomOutline() {
        const outlines = getOutlines();
        if (outlines.length === 0) { showToast('暂无可用大纲', 'error'); return; }
        const random = outlines[Math.floor(Math.random() * outlines.length)];
        startFromOutline(random.id);
    }

    function buildOutlinePrompt(outline, chapterIndex) {
        const chapter = outline.chapters[chapterIndex];
        let prompt = `[剧情大纲约束 - 必须严格遵守]\n`;
        prompt += `当前故事：「${outline.title}」\n`;
        prompt += `类型：${outline.genre}\n`;
        prompt += `角色：${outline.characters}\n`;
        prompt += `当前进度：第${chapterIndex + 1}章/${outline.chapters.length}章\n\n`;
        prompt += `【本章标题】${chapter.title}\n`;
        prompt += `【本章概要】${chapter.summary}\n`;
        prompt += `【本章氛围】${chapter.mood || 'daily'}\n\n`;
        if (chapterIndex > 0) {
            prompt += `【上一章回顾】${outline.chapters[chapterIndex - 1].title} - ${outline.chapters[chapterIndex - 1].summary}\n`;
        }
        if (chapterIndex < outline.chapters.length - 1) {
            prompt += `【下一章预告】${outline.chapters[chapterIndex + 1].title}\n`;
        }
        prompt += `\n【约束规则】\n`;
        prompt += `1. 你必须严格按照本章概要展开剧情，所有事件和对话都要围绕概要中的关键节点\n`;
        prompt += `2. 不要偏离主线，不要引入概要中没有的新设定或角色\n`;
        prompt += `3. 对话要自然流畅，通过角色的行动和语言逐步推进到概要描述的关键事件\n`;
        prompt += `4. 每次回复都要推动剧情向本章概要的终点发展，不要原地踏步\n`;
        prompt += `5. 当本章概要的所有关键事件都已发生后，在选项中加入"进入下一章"的选项\n`;
        prompt += `6. 保持galgame风格：注重角色互动、情感描写、场景氛围\n`;
        return prompt;
    }

    function updateOutlineChapterDisplay(outline, chapterIndex) {
        const display = $('#outline-chapter-display');
        if (!display || !outline) return;
        const chapter = outline.chapters[chapterIndex];
        if (chapter) {
            display.textContent = `${outline.title} · 第${chapterIndex + 1}章：${chapter.title}`;
            display.classList.remove('hidden');
        }
    }

    function showOutlineSelectInGame() {
        openOutlineModal();
    }

    function getTimeContext() {
        const now = new Date();
        const hour = now.getHours();
        let period = '';
        if (hour >= 5 && hour < 8) period = '清晨';
        else if (hour >= 8 && hour < 12) period = '上午';
        else if (hour >= 12 && hour < 14) period = '中午';
        else if (hour >= 14 && hour < 17) period = '下午';
        else if (hour >= 17 && hour < 19) period = '傍晚';
        else if (hour >= 19 && hour < 22) period = '晚上';
        else period = '深夜';
        return period;
    }

    function processAiResponse(rawContent) {
        restoreFallbackProvider();
        let parsed = null;
        try {
            const cleaned = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {}

        if (parsed && parsed.dialog) {
            const name = parsed.name || '???';
            let dialog = parsed.dialog;
            const emotion = normalizeEmotion(parsed.emotion);
            const action = parsed.action || '';
            const scene = parsed.scene || '';
            dialog = dialog.replace(/作为(?:一个)?AI(?:助手|模型|语言模型)?[，,。.]/g, '');
            dialog = dialog.replace(/我是(?:一个)?AI(?:助手|模型|语言模型)?[，,。.]/g, '');
            dialog = dialog.replace(/作为人工智能[，,。.]/g, '');
            if (action) {
                dialog = `（${action}）\n${dialog}`;
            }
            
            const segments = splitDialogIntoSegments(dialog);
            if (state.uiMode === 'chat') {
                showChatSegmentedMessage(name, segments, emotion);
            } else {
                showSegmentedDialog(name, segments, emotion);
            }
            addDialogHistory(name, dialog);
            updateEmotionIndicator(emotion);
            if (ttsState.enabled) speakText(dialog, emotion);
            if (spriteState.visible === false && name !== '旁白' && name !== '系统') {
                showSprite('char_1', SPRITE_CONFIG.emotionMap[emotion] || '高兴');
            }
            if (scene) state.game.currentScene = scene;
            if (scene && state.settings.autoGenScene) generateSceneImage(scene);
        } else {
            let content = rawContent;
            content = content.replace(/作为(?:一个)?AI(?:助手|模型|语言模型)?[，,。.]/g, '');
            content = content.replace(/我是(?:一个)?AI(?:助手|模型|语言模型)?[，,。.]/g, '');
            
            const segments = splitDialogIntoSegments(content);
            if (state.uiMode === 'chat') {
                showChatSegmentedMessage('星酱', segments, 'neutral');
            } else {
                showSegmentedDialog('星酱', segments, 'neutral');
            }
            addDialogHistory('星酱', content);
            updateEmotionIndicator('neutral');
        }
    }

    function splitDialogIntoSegments(dialog) {
        let text = dialog.replace(/\\n/g, '\n');
        text = text.replace(/\r\n/g, '\n');
        const paragraphs = text.split(/\n{2,}/);
        const segments = [];
        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (trimmed) {
                const cleaned = trimmed.replace(/\n/g, ' ');
                segments.push(cleaned);
            }
        }
        if (segments.length === 0) segments.push(text.trim() || dialog);
        return segments;
    }

    let dialogSegmentState = {
        segments: [],
        currentIndex: 0,
        name: '',
        emotion: '',
        isWaitingForContinue: false,
        isTyping: false,
        typingTimer: null,
        dialogHistory: [],
        historyOffset: 0,
    };

    let chatSegmentState = {
        segments: [],
        currentIndex: 0,
        name: '',
        emotion: '',
        isWaitingForContinue: false,
        isTyping: false,
        typingTimer: null,
        currentMsgEl: null,
    };

    function showSegmentedDialog(name, segments, emotion) {
        dialogSegmentState.segments = segments;
        dialogSegmentState.currentIndex = 0;
        dialogSegmentState.name = name;
        dialogSegmentState.emotion = emotion;
        dialogSegmentState.isWaitingForContinue = false;
        dialogSegmentState.isTyping = false;
        
        hideCustomInput();
        const dialogBox = $('#dialog-box');
        if (dialogBox) {
            dialogBox.classList.remove('hidden');
            dialogBox.classList.add('clickable');
        }
        
        const dialogName = $('#dialog-name');
        if (dialogName) dialogName.textContent = name;
        state.game.characterName = name;
        
        const inputMessage = $('#inputMessage');
        if (inputMessage) {
            inputMessage.readOnly = true;
            inputMessage.value = '';
            inputMessage.placeholder = '';
        }
        
        showCurrentSegment();
    }

    function showCurrentSegment() {
        const { segments, currentIndex, name, emotion } = dialogSegmentState;
        if (currentIndex >= segments.length) return;
        
        const text = segments[currentIndex];
        const inputMessage = $('#inputMessage');
        
        if (!inputMessage) return;
        
        const dialogName = $('#dialog-name');
        if (dialogName) dialogName.textContent = name;

        const dialogSubtitle = $('#dialog-subtitle');
        if (dialogSubtitle) dialogSubtitle.textContent = '';

        const emotionIndicator = $('#emotion-indicator');
        if (emotionIndicator) emotionIndicator.textContent = emotion || '';
        
        inputMessage.value = '';
        inputMessage.readOnly = true;
        
        typeText(text, inputMessage, () => {
            dialogSegmentState.isTyping = false;
            dialogSegmentState.isWaitingForContinue = true;

            dialogSegmentState.dialogHistory.push({
                name: name,
                text: text,
                emotion: emotion,
                type: 'ai'
            });

            if (currentIndex < segments.length - 1) {
                inputMessage.placeholder = '按 Enter 继续...';
            } else {
                inputMessage.placeholder = '按 Enter 输入回复...';
            }
        });
    }

    function typeText(text, textarea, callback) {
        let i = 0;
        dialogSegmentState.isTyping = true;
        const speed = 50;
        
        const typing = () => {
            if (i < text.length) {
                i++;
                textarea.value = text.substring(0, i);
                textarea.scrollTop = textarea.scrollHeight;
                const baseDelay = speed * 0.8;
                const randomVariation = speed * 0.4;
                const delay = baseDelay + Math.random() * randomVariation;
                dialogSegmentState.typingTimer = setTimeout(typing, delay);
            } else {
                dialogSegmentState.isTyping = false;
                if (callback) callback();
            }
        };
        typing();
    }

    function continueDialog() {
        dialogSegmentState.historyOffset = 0;

        if (dialogSegmentState.isTyping) {
            clearTimeout(dialogSegmentState.typingTimer);
            const { segments, currentIndex } = dialogSegmentState;
            const inputMessage = $('#inputMessage');
            if (inputMessage) inputMessage.value = segments[currentIndex];
            dialogSegmentState.isTyping = false;

            dialogSegmentState.dialogHistory.push({
                name: dialogSegmentState.name,
                text: segments[currentIndex],
                emotion: dialogSegmentState.emotion,
                type: 'ai'
            });
            
            dialogSegmentState.isWaitingForContinue = true;
            if (inputMessage) {
                if (currentIndex < segments.length - 1) {
                    inputMessage.placeholder = '按 Enter 继续...';
                } else {
                    inputMessage.placeholder = '按 Enter 输入回复...';
                }
            }
            return;
        }
        
        if (!dialogSegmentState.isWaitingForContinue) return;
        
        const { segments, currentIndex } = dialogSegmentState;
        
        if (currentIndex >= segments.length - 1) {
            enableDialogInput();
            return;
        }
        
        dialogSegmentState.isWaitingForContinue = false;
        dialogSegmentState.currentIndex++;
        showCurrentSegment();
    }

    function enableDialogInput() {
        const inputMessage = $('#inputMessage');
        if (inputMessage) {
            inputMessage.readOnly = false;
            inputMessage.value = '';
            inputMessage.placeholder = '在这里输入消息...';
            inputMessage.focus();
        }
        dialogSegmentState.isWaitingForContinue = false;
        dialogSegmentState.historyOffset = 0;
    }

    function showPreviousDialog() {
        if (dialogSegmentState.dialogHistory.length === 0) return;
        if (dialogSegmentState.historyOffset >= dialogSegmentState.dialogHistory.length - 1) return;

        dialogSegmentState.historyOffset++;
        const idx = dialogSegmentState.dialogHistory.length - 1 - dialogSegmentState.historyOffset;
        const entry = dialogSegmentState.dialogHistory[idx];

        const dialogName = $('#dialog-name');
        const inputMessage = $('#inputMessage');
        if (dialogName) dialogName.textContent = entry.name;
        if (inputMessage) {
            inputMessage.value = entry.text;
            inputMessage.readOnly = true;
            inputMessage.placeholder = '↑↓查看历史 / 按 Enter 返回当前';
        }
    }

    function showNextDialog() {
        if (dialogSegmentState.historyOffset <= 0) return;

        dialogSegmentState.historyOffset--;

        if (dialogSegmentState.historyOffset === 0) {
            const { segments, currentIndex, name, emotion } = dialogSegmentState;
            const dialogName = $('#dialog-name');
            const inputMessage = $('#inputMessage');
            if (dialogName) dialogName.textContent = name;
            if (inputMessage) {
                inputMessage.value = segments[currentIndex];
                inputMessage.readOnly = true;
                if (dialogSegmentState.isWaitingForContinue) {
                    if (currentIndex < segments.length - 1) {
                        inputMessage.placeholder = '按 Enter 继续...';
                    } else {
                        inputMessage.placeholder = '按 Enter 输入回复...';
                    }
                }
            }
            return;
        }

        const idx = dialogSegmentState.dialogHistory.length - 1 - dialogSegmentState.historyOffset;
        const entry = dialogSegmentState.dialogHistory[idx];

        const dialogName = $('#dialog-name');
        const inputMessage = $('#inputMessage');
        if (dialogName) dialogName.textContent = entry.name;
        if (inputMessage) {
            inputMessage.value = entry.text;
        }
    }

    function sendDialogInput() {
        const inputMessage = $('#inputMessage');
        if (!inputMessage || inputMessage.readOnly) return;
        
        const text = inputMessage.value.trim();
        if (!text) return;

        dialogSegmentState.dialogHistory.push({
            name: '你',
            text: text,
            emotion: '',
            type: 'user'
        });
        
        inputMessage.value = '';
        inputMessage.readOnly = true;
        inputMessage.placeholder = '等待回应中...';
        
        handleAiChoice(text);
    }

    function showChatSegmentedMessage(name, segments, emotion) {
        chatSegmentState.segments = segments;
        chatSegmentState.currentIndex = 0;
        chatSegmentState.name = name;
        chatSegmentState.emotion = emotion;
        chatSegmentState.isWaitingForContinue = false;
        chatSegmentState.isTyping = false;

        const container = $('#chat-messages');
        const msg = document.createElement('div');
        msg.className = 'chat-msg ai segmented';
        const nameEl = document.createElement('div');
        nameEl.className = 'msg-name';
        nameEl.textContent = name;
        const textEl = document.createElement('div');
        textEl.className = 'msg-text';
        const continueHint = document.createElement('div');
        continueHint.className = 'msg-continue-hint hidden';
        continueHint.innerHTML = '按 <kbd>Enter</kbd> 继续 ▼';
        msg.appendChild(nameEl);
        msg.appendChild(textEl);
        msg.appendChild(continueHint);
        container.appendChild(msg);
        chatSegmentState.currentMsgEl = msg;

        const chatInput = $('#chat-input');
        if (chatInput) chatInput.disabled = true;

        showCurrentChatSegment();
        container.scrollTop = container.scrollHeight;
    }

    function showCurrentChatSegment() {
        const { segments, currentIndex, currentMsgEl } = chatSegmentState;
        if (currentIndex >= segments.length) return;

        const text = segments[currentIndex];
        const textEl = currentMsgEl.querySelector('.msg-text');
        const continueHint = currentMsgEl.querySelector('.msg-continue-hint');

        if (currentIndex > 0) {
            const divider = document.createElement('div');
            divider.className = 'msg-segment-divider';
            textEl.appendChild(divider);
        }

        const segmentSpan = document.createElement('span');
        segmentSpan.className = 'msg-segment';
        textEl.appendChild(segmentSpan);

        continueHint.classList.add('hidden');

        typeChatText(text, segmentSpan, () => {
            chatSegmentState.isTyping = false;
            chatSegmentState.isWaitingForContinue = true;

            if (currentIndex < segments.length - 1) {
                continueHint.innerHTML = '按 <kbd>Enter</kbd> 继续 ▼';
            } else {
                continueHint.innerHTML = '按 <kbd>Enter</kbd> 输入回复 ▼';
            }
            continueHint.classList.remove('hidden');

            const container = $('#chat-messages');
            container.scrollTop = container.scrollHeight;
        });
    }

    function typeChatText(text, element, callback) {
        let i = 0;
        chatSegmentState.isTyping = true;
        const speed = state.settings.textSpeed || 40;

        const typing = () => {
            if (i < text.length) {
                i++;
                element.textContent = text.substring(0, i);
                const container = $('#chat-messages');
                container.scrollTop = container.scrollHeight;
                const baseDelay = speed * 0.8;
                const randomVariation = speed * 0.4;
                const delay = baseDelay + Math.random() * randomVariation;
                chatSegmentState.typingTimer = setTimeout(typing, delay);
            } else {
                chatSegmentState.isTyping = false;
                if (callback) callback();
            }
        };
        typing();
    }

    function continueChatSegment() {
        if (chatSegmentState.isTyping) {
            clearTimeout(chatSegmentState.typingTimer);
            const { segments, currentIndex, currentMsgEl } = chatSegmentState;
            const segmentSpan = currentMsgEl.querySelectorAll('.msg-segment')[currentIndex];
            if (segmentSpan) segmentSpan.textContent = segments[currentIndex];
            chatSegmentState.isTyping = false;
            chatSegmentState.isWaitingForContinue = true;

            const continueHint = currentMsgEl.querySelector('.msg-continue-hint');
            if (currentIndex < segments.length - 1) {
                continueHint.innerHTML = '按 <kbd>Enter</kbd> 继续 ▼';
            } else {
                continueHint.innerHTML = '按 <kbd>Enter</kbd> 输入回复 ▼';
            }
            continueHint.classList.remove('hidden');
            return;
        }

        if (!chatSegmentState.isWaitingForContinue) return;

        const { segments, currentIndex, currentMsgEl } = chatSegmentState;
        const continueHint = currentMsgEl.querySelector('.msg-continue-hint');

        if (currentIndex >= segments.length - 1) {
            continueHint.classList.add('hidden');
            chatSegmentState.isWaitingForContinue = false;
            const chatInput = $('#chat-input');
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.focus();
            }
            return;
        }

        chatSegmentState.isWaitingForContinue = false;
        continueHint.classList.add('hidden');
        chatSegmentState.currentIndex++;
        showCurrentChatSegment();
    }

    function updateEmotionIndicator(emotion) {
        let indicator = $('#emotion-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'emotion-indicator';
            const dialogBox = $('#dialog-box');
            if (dialogBox) dialogBox.appendChild(indicator);
        }
        const emotionIcons = {
            happy: '😊', sad: '😢', angry: '😤', surprised: '😲',
            shy: '😳', neutral: '😐', scared: '😨', excited: '🤩',
            worried: '😟', tsundere: '😤💕',
        };
        indicator.textContent = emotionIcons[emotion] || '😐';
        indicator.className = `emotion-${emotion}`;
        switchBgmByEmotion(emotion);
        switchSpriteExpression(emotion);
    }

    async function handleAiChoice(choiceText) {
        if (apiCallInProgress) {
            showToast('AI正在思考中，请稍候...', 'info');
            return;
        }
        apiCallInProgress = true;
        hideChoices();
        addDialogHistory('玩家', choiceText);
        showAiGenerating(true);
        
        const startTime = Date.now();
        const maxWaitTime = 60000;
        
        try {
            let contextHint = choiceText;
            if (state.game.activeOutline && state.game.outlineChapterIndex !== undefined) {
                const outline = state.game.activeOutline;
                const chapterIdx = state.game.outlineChapterIndex;
                const chapter = outline.chapters[chapterIdx];
                contextHint = buildOutlinePrompt(outline, chapterIdx) + '\n\n玩家行动：' + choiceText;
                if (bgmState.enabled && chapter.mood) {
                    playBgm(chapter.mood);
                }
            } else if (state.game.aiContext.length < 2) {
                contextHint = `【故事开始】${choiceText}`;
            }
            
            const result = await Promise.race([
                callAiApi(contextHint),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('请求超时')), maxWaitTime)
                )
            ]);
            
            showAiGenerating(false);
            if (result) {
                processAiResponse(result);
            } else {
                throw new Error('AI返回了空响应');
            }
        } catch (e) {
            showAiGenerating(false);
            const elapsed = Date.now() - startTime;
            console.error('AI调用失败:', e, '耗时:', elapsed + 'ms');
            
            let errorMsg = e.message || '未知错误';
            let friendlyMsg = '';
            
            if (errorMsg.includes('timeout') || errorMsg.includes('超时')) {
                friendlyMsg = '连接超时了……是不是网络有点慢？我们再试一次吧！';
            } else if (errorMsg.includes('限流') || errorMsg.includes('429')) {
                friendlyMsg = 'API请求太频繁了，让我休息一下再回答你~';
            } else if (errorMsg.includes('网络') || errorMsg.includes('fetch')) {
                friendlyMsg = '网络好像不太稳定呢……检查一下连接再试一次吧！';
            } else if (errorMsg.includes('空响应')) {
                friendlyMsg = 'AI好像走神了，什么都没说……再试一次吧！';
            } else {
                friendlyMsg = '呜……好像出了点问题。' + errorMsg + '\n\n别担心，我们再试一次吧！';
            }
            
            showToast('AI 调用失败: ' + errorMsg, 'error');
            const segments = splitDialogIntoSegments(friendlyMsg);
            if (state.uiMode === 'chat') {
                showChatSegmentedMessage('星酱', segments, 'neutral');
            } else {
                showSegmentedDialog('星酱', segments, 'neutral');
            }
            
            setTimeout(() => {
                if (state.uiMode === 'chat') {
                    const chatInput = $('#chat-input');
                    if (chatInput) {
                        chatInput.disabled = false;
                        chatInput.focus();
                    }
                } else {
                    enableDialogInput();
                    const inputMessage = $('#inputMessage');
                    if (inputMessage) {
                        inputMessage.placeholder = '输入消息重试...';
                    }
                }
            }, 1000);
        } finally {
            apiCallInProgress = false;
            currentAbortController = null;
        }
    }

    async function generateSceneImage(sceneDescription) {
        const hasKey = state.settings.useProxyKeys || !!state.settings.apiKeys[state.settings.imageApiProvider];
        if (!hasKey) return;
        const now = Date.now();
        if (now - lastImageGenTime < getImageCooldown()) {
            pendingSceneDescription = sceneDescription;
            showToast(`场景图将在${Math.ceil((getImageCooldown() - (now - lastImageGenTime)) / 1000)}秒后生成`, 'info');
            schedulePendingImage();
            return;
        }
        lastImageGenTime = now;
        try {
            showToast('正在生成场景图...', 'info');
            const result = await callImageApi(sceneDescription + ', digital art, detailed background, visual novel style, high quality');
            if (result) {
                let imageUrl;
                let base64Data = null;
                if (result.type === 'url') {
                    imageUrl = result.value;
                    try {
                        base64Data = await IDB.urlToBase64(result.value);
                        imageUrl = base64Data;
                    } catch {
                        base64Data = null;
                    }
                } else if (result.type === 'base64') {
                    imageUrl = `data:image/png;base64,${result.value}`;
                    base64Data = imageUrl;
                }
                if (imageUrl) {
                    setSceneBackground(imageUrl);
                    state.game.currentSceneUrl = imageUrl;
                    const imgId = `scene_${Date.now()}`;
                    if (base64Data) {
                        try {
                            await IDB.saveImage(imgId, { base64: base64Data, prompt: sceneDescription });
                            state.gallery.push({ id: imgId, prompt: sceneDescription, timestamp: Date.now(), persisted: true });
                        } catch (e) {
                            console.warn('IndexedDB保存失败');
                            state.gallery.push({ prompt: sceneDescription, timestamp: Date.now(), note: '图片可能无法持久保存' });
                        }
                    } else {
                        state.gallery.push({ prompt: sceneDescription, timestamp: Date.now(), note: '图片可能无法持久保存' });
                    }
                    if (state.gallery.length > 30) state.gallery = state.gallery.slice(-30);
                    try { saveGallery(); } catch (e) { console.warn('画廊保存失败'); }
                    try { await IDB.clearOldImages(30); } catch {}
                    showToast('场景图生成完成！', 'success');
                }
            }
        } catch (e) {
            console.warn('场景图生成失败');
            showToast('场景图生成失败: ' + e.message, 'error');
        }
    }

    function setBgStyle(el, imageUrl) {
        if (imageUrl && imageUrl.startsWith('data:')) {
            el.style.backgroundImage = `url("${imageUrl}")`;
        } else if (imageUrl) {
            const safeUrl = imageUrl.replace(/"/g, '%22').replace(/[()]/g, '');
            el.style.backgroundImage = `url("${safeUrl}")`;
        }
    }

    function setSceneBackground(imageUrl) {
        const bg = $('#scene-bg');
        const bgNext = $('#scene-bg-next');
        const chatBg = $('#chat-screen-bg');
        if (!imageUrl) {
            bgNext.classList.remove('active');
            bg.style.backgroundImage = `url('${DEFAULT_BG}')`;
            if (chatBg) chatBg.style.backgroundImage = `url('${DEFAULT_BG}')`;
            return;
        }
        const img = new Image();
        img.onload = () => {
            setBgStyle(bgNext, imageUrl);
            bgNext.classList.add('active');
            if (chatBg) setBgStyle(chatBg, imageUrl);
            setTimeout(() => {
                setBgStyle(bg, imageUrl);
                bgNext.classList.remove('active');
            }, 1300);
        };
        img.onerror = () => {
        };
        img.src = imageUrl;
    }

    let typewriterTimer = null;
    let apiCallInProgress = false;
    let currentAbortController = null;
    let bgAutoSwitchTimer = null;
    let lastImageGenTime = 0;
    let pendingSceneDescription = null;
    let lastChoices = null;

    function getImageCooldown() {
        return (state.settings.imageCooldown || 60) * 1000;
    }

    function schedulePendingImage() {
        if (!pendingSceneDescription) return;
        const now = Date.now();
        const remaining = getImageCooldown() - (now - lastImageGenTime);
        if (remaining <= 0) {
            generateSceneImage(pendingSceneDescription);
            pendingSceneDescription = null;
        } else {
            setTimeout(() => {
                if (pendingSceneDescription) {
                    generateSceneImage(pendingSceneDescription);
                    pendingSceneDescription = null;
                }
            }, remaining);
        }
    }

    function startBgAutoSwitch() {
        stopBgAutoSwitch();
        if (!state.settings.autoSwitchBg || state.mode !== 'ai') return;
        const interval = (state.settings.bgSwitchInterval || 120) * 1000;
        bgAutoSwitchTimer = setInterval(async () => {
            if (state.mode === 'ai' && !apiCallInProgress && state.game.currentScene) {
                try {
                    const prompt = `${state.game.currentScene}, cinematic lighting, detailed background, anime style`;
                    const result = await callImageApi(prompt);
                    let imageUrl;
                    let base64Data = null;
                    if (result.type === 'url') {
                        try { base64Data = await IDB.urlToBase64(result.value); } catch {}
                        imageUrl = base64Data || result.value;
                    } else if (result.type === 'base64') {
                        base64Data = `data:image/png;base64,${result.value}`;
                        imageUrl = base64Data;
                    }
                    if (imageUrl) setSceneBackground(imageUrl);
                    const imgId = `bg_${Date.now()}`;
                    if (base64Data) {
                        try { await IDB.saveImage(imgId, { base64: base64Data, prompt, autoSwitch: true }); } catch {}
                    }
                } catch {}
            }
        }, interval);
    }

    function stopBgAutoSwitch() {
        if (bgAutoSwitchTimer) { clearInterval(bgAutoSwitchTimer); bgAutoSwitchTimer = null; }
    }

    function showDialog(name, text) {
        const segments = splitDialogIntoSegments(text);
        showSegmentedDialog(name, segments, '');
    }

    function triggerAutoPlay() {
        if (state.game.isAutoPlay && state.mode === 'ai') {
            setTimeout(() => {
                if (state.game.isAutoPlay && !state.game.isTyping) {
                    const choicesBox = $('#choices-box');
                    if (!choicesBox.classList.contains('hidden')) {
                        const firstBtn = choicesBox.querySelector('.choice-btn:not(.custom-choice-btn)');
                        if (firstBtn) firstBtn.click();
                    } else {
                        handleDialogClick();
                    }
                }
            }, (state.settings.autoWait || 3) * 1000);
        }
    }

    function showChoices(choices) {
        if (!choices || choices.length === 0) return;
        const box = $('#choices-box');
        const dialogBox = $('#dialog-box');
        box.innerHTML = '';
        box.classList.remove('hidden');
        dialogBox.classList.remove('clickable');
        choices.forEach((choice, i) => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = choice.text;
            btn.style.animationDelay = (i * 0.1 + 0.1) + 's';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                box.classList.add('hidden');
                dialogBox.classList.add('clickable');
                if (choice.action) choice.action();
            });
            box.appendChild(btn);
        });
    }

    function hideChoices() { $('#choices-box').classList.add('hidden'); }

    function showCustomInput() {
        const choicesContainer = $('#choices-box');
        if (choicesContainer && choicesContainer.children.length > 0) {
            lastChoices = Array.from(choicesContainer.children)
                .filter(btn => !btn.classList.contains('custom-choice-btn'))
                .map(btn => ({
                    text: btn.textContent,
                    action: () => handleAiChoice(btn.textContent)
                }));
        }
        const inputBox = $('#custom-input-box');
        const input = $('#custom-input');
        inputBox.classList.remove('hidden');
        input.value = '';
        input.focus();
    }

    function hideCustomInput() {
        $('#custom-input-box').classList.add('hidden');
    }

    function sendCustomInput() {
        const input = $('#custom-input');
        const text = input.value.trim();
        if (!text) return;
        hideCustomInput();
        if (state.mode === 'ai') {
            handleAiChoice(text);
        } else {
            addDialogHistory('玩家', text);
            showDialog('星酱', '你说了：「' + text + '」\n\n普通模式下无法回应自定义输入，请切换到AI模式体验自由对话！');
            setTimeout(() => {
                showChoices([
                    { text: '继续', action: () => normalNext('shout') },
                    { text: '切换AI模式', action: () => startGame('ai') },
                ]);
            }, 800);
        }
    }

    let chatThinkingMsg = null;

    function showAiGenerating(show) {
        const el = $('#ai-generating');
        if (show) {
            el.classList.remove('hidden');
            if (state.uiMode === 'chat') {
                const chatInput = $('#chat-input');
                if (chatInput) chatInput.disabled = true;
                const container = $('#chat-messages');
                if (container && !chatThinkingMsg) {
                    chatThinkingMsg = document.createElement('div');
                    chatThinkingMsg.className = 'chat-msg ai chat-thinking';
                    chatThinkingMsg.innerHTML = '<div class="msg-name">星酱</div><div class="thinking-inline"><div class="thinking-dots"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div><span class="thinking-text">正在思考</span></div>';
                    container.appendChild(chatThinkingMsg);
                    container.scrollTop = container.scrollHeight;
                }
            }
        } else {
            el.classList.add('hidden');
            if (chatThinkingMsg) {
                chatThinkingMsg.remove();
                chatThinkingMsg = null;
            }
            if (state.uiMode === 'chat' && !chatSegmentState.isTyping && !chatSegmentState.isWaitingForContinue) {
                const chatInput = $('#chat-input');
                if (chatInput) chatInput.disabled = false;
            }
        }
    }

    function addDialogHistory(name, text) {
        state.game.dialogHistory.push({ name, text, timestamp: Date.now() });
        saveCurrentGame();
    }

    function extractCoreMemories(context) {
        const memories = [];
        const keywords = ['名字', '叫', '发现', '遇到', '找到', '获得', '失去', '决定', '约定', '承诺', '秘密', '真相', '重要', '关键', '记住', '永远', '第一次', '终于'];
        for (const msg of context) {
            if (msg.role !== 'user') continue;
            const content = msg.content || '';
            for (const kw of keywords) {
                if (content.includes(kw) && !memories.some(m => content.includes(m))) {
                    const snippet = content.length > 30 ? content.substring(0, 30) + '...' : content;
                    memories.push(snippet);
                    break;
                }
            }
            if (memories.length >= 3) break;
        }
        return memories;
    }

    function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

    function openHistory() {
        const list = $('#history-list');
        list.innerHTML = '';
        state.game.dialogHistory.forEach(item => {
            const div = document.createElement('div');
            div.className = `history-item ${item.name === '玩家' ? 'player' : 'ai'}`;
            const nameSpan = document.createElement('span');
            nameSpan.className = 'history-name';
            nameSpan.textContent = item.name + ':';
            div.appendChild(nameSpan);
            div.appendChild(document.createTextNode(item.text));
            list.appendChild(div);
        });
        showModal('history-modal');
    }

    async function openGallery() {
        const grid = $('#gallery-grid');
        const empty = $('#gallery-empty');
        grid.innerHTML = '';
        if (state.gallery.length === 0) { empty.classList.remove('hidden'); }
        else {
            empty.classList.add('hidden');
            for (let i = 0; i < state.gallery.length; i++) {
                const item = state.gallery[i];
                let imgSrc = item.url || null;
                if (item.persisted && item.id) {
                    try {
                        const cached = await IDB.getImage(item.id);
                        if (cached?.base64) imgSrc = cached.base64;
                    } catch {}
                }
                if (!imgSrc) continue;
                const div = document.createElement('div');
                div.className = 'gallery-item';
                const img = document.createElement('img');
                img.src = imgSrc;
                img.alt = item.prompt || '';
                img.loading = 'lazy';
                const overlay = document.createElement('div');
                overlay.className = 'gallery-overlay';
                const dlBtn = document.createElement('button');
                dlBtn.textContent = '💾 下载';
                dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadImage(imgSrc, `scene_${i}.png`); });
                const delBtn = document.createElement('button');
                delBtn.textContent = '🗑️ 删除';
                delBtn.className = 'gallery-delete-btn';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (item.persisted && item.id) {
                        try { IDB.deleteImage(item.id); } catch {}
                    }
                    state.gallery.splice(i, 1);
                    saveGallery();
                    openGallery();
                    showToast('图片已删除', 'info');
                });
                overlay.appendChild(dlBtn);
                overlay.appendChild(delBtn);
                div.appendChild(img);
                div.appendChild(overlay);
                grid.appendChild(div);
            }
            const clearAllDiv = document.createElement('div');
            clearAllDiv.style.cssText = 'text-align:center;margin-top:1rem;';
            const clearAllBtn = document.createElement('button');
            clearAllBtn.className = 'menu-btn';
            clearAllBtn.style.cssText = 'border-color:rgba(255,100,100,0.3);color:#ff6666;';
            clearAllBtn.textContent = '🗑️ 一键清空画廊';
            clearAllBtn.addEventListener('click', () => {
                state.gallery.forEach(item => {
                    if (item.persisted && item.id) {
                        try { IDB.deleteImage(item.id); } catch {}
                    }
                });
                state.gallery = [];
                saveGallery();
                openGallery();
                showToast('画廊已清空', 'info');
            });
            clearAllDiv.appendChild(clearAllBtn);
            grid.appendChild(clearAllDiv);
        }
        showModal('gallery-modal');
    }

    function downloadImage(url, filename) {
        if (url.startsWith('data:')) {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast('开始下载图片', 'success');
        } else {
            fetch(url, { mode: 'cors' })
                .then(r => r.blob())
                .then(blob => {
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                    showToast('开始下载图片', 'success');
                })
                .catch(() => {
                    window.open(url, '_blank');
                    showToast('已在新标签页打开图片，右键可保存', 'info');
                });
        }
    }

    function toggleAutoPlay() {
        state.game.isAutoPlay = !state.game.isAutoPlay;
        const btn = $('[data-action="auto"]');
        btn.textContent = state.game.isAutoPlay ? '⏸️' : '▶️';
        showToast(state.game.isAutoPlay ? '自动播放已开启' : '自动播放已关闭', 'info');
    }

    function backToTitle() {
        if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
        if (currentAbortController) { try { currentAbortController.abort(); } catch {} currentAbortController = null; }
        apiCallInProgress = false;
        state.game.isTyping = false;
        stopBgAutoSwitch();
        stopTts();
        switchScreen('title-screen');
        state.game.isAutoPlay = false;
        const outlineBtn = $('#outline-select-btn');
        if (outlineBtn) outlineBtn.classList.add('hidden');
        const chapterDisplay = $('#outline-chapter-display');
        if (chapterDisplay) chapterDisplay.classList.add('hidden');
        hideSprite();
        if (bgmState.enabled) playBgm('title');
    }

    function openSaveModal(mode) {
        const container = $('#save-slots');
        container.innerHTML = '';
        const saves = Storage.get(STORAGE_KEYS.saves) || {};
        const saveCount = Object.keys(saves).length;
        if (mode === 'load' && saveCount === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">暂无存档</div>';
            showModal('save-modal');
            return;
        }
        const existingSlots = Object.keys(saves).map(Number).sort((a, b) => a - b);
        existingSlots.forEach(slotNum => {
            const save = saves[slotNum];
            if (!save) return;
            const slot = document.createElement('div');
            slot.className = 'save-slot';
            const numDiv = document.createElement('div');
            numDiv.className = 'slot-number';
            numDiv.textContent = slotNum;
            const infoDiv = document.createElement('div');
            infoDiv.className = 'slot-info';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'slot-title';
            titleDiv.textContent = save.title || '存档';
            const detailDiv = document.createElement('div');
            detailDiv.className = 'slot-detail';
            detailDiv.textContent = new Date(save.timestamp).toLocaleString('zh-CN');
            infoDiv.appendChild(titleDiv);
            infoDiv.appendChild(detailDiv);
            slot.appendChild(numDiv);
            slot.appendChild(infoDiv);
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'slot-actions';
            if (mode === 'load') {
                const loadBtn = document.createElement('button');
                loadBtn.className = 'slot-load';
                loadBtn.textContent = '读取';
                loadBtn.addEventListener('click', e => { e.stopPropagation(); loadFromSlot(slotNum); });
                actionsDiv.appendChild(loadBtn);
            }
            if (mode === 'save') {
                const saveBtn = document.createElement('button');
                saveBtn.className = 'slot-load';
                saveBtn.textContent = '覆盖';
                saveBtn.addEventListener('click', e => { e.stopPropagation(); saveToSlot(slotNum); });
                actionsDiv.appendChild(saveBtn);
            }
            const delBtn = document.createElement('button');
            delBtn.className = 'slot-delete';
            delBtn.textContent = '删除';
            delBtn.addEventListener('click', e => { e.stopPropagation(); deleteSlot(slotNum); });
            actionsDiv.appendChild(delBtn);
            slot.appendChild(actionsDiv);
            if (mode === 'load') { slot.addEventListener('click', () => loadFromSlot(slotNum)); }
            container.appendChild(slot);
        });
        if (mode === 'save') {
            const addSlot = document.createElement('div');
            addSlot.className = 'save-slot save-slot-new';
            addSlot.innerHTML = '<div style="text-align:center;width:100%;color:var(--primary);cursor:pointer;">+ 新建存档</div>';
            addSlot.addEventListener('click', () => {
                const newNum = existingSlots.length > 0 ? Math.max(...existingSlots) + 1 : 1;
                saveToSlot(newNum);
            });
            container.appendChild(addSlot);
        }
        showModal('save-modal');
    }

    function saveToSlot(slotNum) {
        try {
            const saves = Storage.get(STORAGE_KEYS.saves) || {};
            saves[slotNum] = {
                title: state.game.characterName ? `与${state.game.characterName}的对话` : '冒险记录',
                timestamp: Date.now(),
                mode: state.mode,
                uiMode: state.uiMode || 'game',
                game: JSON.parse(JSON.stringify(state.game)),
                theme: state.theme,
                dayNightMode: state.dayNightMode,
            };
            Storage.set(STORAGE_KEYS.saves, saves);
            showToast(`已保存到存档 ${slotNum}`, 'success');
        } catch (e) { showToast('存档失败: 存储空间不足', 'error'); }
        hideModal('save-modal');
    }

    function loadFromSlot(slotNum) {
        const saves = Storage.get(STORAGE_KEYS.saves) || {};
        const save = saves[slotNum];
        if (!save) { showToast('该存档为空', 'error'); return; }
        state.mode = save.mode;
        state.game = JSON.parse(JSON.stringify(save.game));
        if (save.theme) {
            const validThemes = ['dark-star', 'ink-wash'];
            applyTheme(validThemes.includes(save.theme) ? save.theme : 'dark-star');
        }
        if (save.dayNightMode) applyDayNightMode(save.dayNightMode);
        if (save.uiMode) switchUiMode(save.uiMode);
        if (state.game.activeOutline) {
            const outlineBtn = $('#outline-select-btn');
            if (outlineBtn) outlineBtn.classList.remove('hidden');
            updateOutlineChapterDisplay(state.game.activeOutline, state.game.outlineChapterIndex || 0);
        }
        if (state.game.currentSceneUrl) {
            setSceneBackground(state.game.currentSceneUrl);
        } else {
            setSceneBackground(DEFAULT_BG);
        }
        switchScreen('game-screen');
        hideModal('save-modal');
        if (state.game.dialogHistory && state.game.dialogHistory.length > 0) {
            const last = state.game.dialogHistory[state.game.dialogHistory.length - 1];
            showDialog(last.name, last.text);
            if (state.mode === 'ai' && state.game.aiContext && state.game.aiContext.length > 0) {
                setTimeout(() => {
                    showChoices([
                        { text: '继续冒险', action: () => { hideChoices(); handleAiChoice('请继续推进剧情'); } },
                        { text: '换个方向', action: () => { hideChoices(); handleAiChoice('我想尝试不同的方向'); } },
                        { text: '返回标题', action: backToTitle },
                    ]);
                }, 800);
            } else {
                setTimeout(() => {
                    showChoices([
                        { text: '继续冒险', action: () => { hideChoices(); if (state.mode === 'ai') handleAiChoice('请继续推进剧情'); else startNormalStory(); } },
                        { text: '返回标题', action: backToTitle },
                    ]);
                }, 800);
            }
        } else {
            showToast('存档数据为空，请重新开始', 'error');
            backToTitle();
        }
        showToast(`已读取存档 ${slotNum}`, 'success');
    }

    function deleteSlot(slotNum) {
        const saves = Storage.get(STORAGE_KEYS.saves) || {};
        delete saves[slotNum];
        Storage.set(STORAGE_KEYS.saves, saves);
        showToast(`存档 ${slotNum} 已删除`, 'info');
        openSaveModal(state._saveModalMode || 'save');
    }

    async function exportData() {
        try {
            showToast('正在导出数据...', 'info');
            const data = await Storage.exportAll();
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `galgame_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('数据导出成功！', 'success');
        } catch (e) {
            showToast('导出失败：' + e.message, 'error');
        }
    }

    async function importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data.version) throw new Error('无效的备份文件');
                if (!confirm(`确定要导入备份吗？\n备份时间：${new Date(data.timestamp).toLocaleString()}\n\n这将覆盖当前所有数据！`)) return;
                showToast('正在导入数据...', 'info');
                await Storage.importAll(data);
                showToast('数据导入成功！即将刷新页面', 'success');
                setTimeout(() => location.reload(), 1000);
            } catch (err) {
                showToast('导入失败：' + err.message, 'error');
            }
        };
        input.click();
    }

    function updateStorageUsage() {
        const el = $('#storage-usage');
        if (!el) return;
        const bytes = Storage.getUsage();
        const kb = (bytes / 1024).toFixed(1);
        const mb = (bytes / 1024 / 1024).toFixed(2);
        el.textContent = bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
        const pct = Math.min((bytes / (5 * 1024 * 1024)) * 100, 100);
        const bar = $('#storage-bar-fill');
        if (bar) bar.style.width = pct + '%';
    }

    function updateQuotaDisplay() {
        const q = state.apiQuota.modelscope;
        const uq = $('#ms-user-quota');
        const mq = $('#ms-model-quota');
        if (uq) uq.textContent = `${q.userRemaining ?? '--'}/${q.userLimit ?? '--'}`;
        if (mq) mq.textContent = `${q.modelRemaining ?? '--'}/${q.modelLimit ?? '--'}`;
    }

    async function showApiStatusPanel() {
        const content = $('#api-status-content');
        content.innerHTML = '';
        ['zhipu', 'modelscope', 'nvidia'].forEach(p => {
            const config = API_CONFIGS[p];
            const hasKey = state.settings.useProxyKeys || !!state.settings.apiKeys[p];
            const card = document.createElement('div');
            card.className = 'api-status-card';
            const h3 = document.createElement('h3');
            h3.textContent = config.name;
            card.appendChild(h3);
            const rows = [
                ['API Key', hasKey ? '已配置 ✓' : '未配置 ✗', hasKey ? 'status-ok' : 'status-err'],
                ['文本模型', `${config.models.text?.length || 0} 个`, ''],
            ];
            if (config.models.vision?.length) rows.push(['视觉模型', `${config.models.vision.length} 个`, '']);
            if (config.models.image?.length) rows.push(['生图模型', `${config.models.image.length} 个`, '']);
            if (p === 'modelscope') {
                const q = state.apiQuota.modelscope;
                rows.push(['用户剩余额度', `${q.userRemaining ?? '--'}/${q.userLimit ?? '--'}`, '']);
                rows.push(['模型剩余额度', `${q.modelRemaining ?? '--'}/${q.modelLimit ?? '--'}`, '']);
            }
            rows.forEach(([label, value, cls]) => {
                const row = document.createElement('div');
                row.className = 'status-row';
                const lSpan = document.createElement('span');
                lSpan.className = 'status-label';
                lSpan.textContent = label;
                const vSpan = document.createElement('span');
                vSpan.className = 'status-value' + (cls ? ' ' + cls : '');
                vSpan.textContent = value;
                row.appendChild(lSpan);
                row.appendChild(vSpan);
                card.appendChild(row);
            });
            content.appendChild(card);
        });
        const storageCard = document.createElement('div');
        storageCard.className = 'api-status-card';
        const storageH3 = document.createElement('h3');
        storageH3.textContent = '📦 图片存储';
        storageCard.appendChild(storageH3);
        try {
            const est = await IDB.getStorageEstimate();
            const usageMB = (est.usage / 1024 / 1024).toFixed(1);
            const quotaMB = (est.quota / 1024 / 1024).toFixed(0);
            const keys = await IDB.getAllKeys();
            const storageRows = [
                ['已缓存图片', `${keys.length} 张`, ''],
                ['存储使用量', `${usageMB} MB / ${quotaMB} MB`, ''],
            ];
            storageRows.forEach(([label, value, cls]) => {
                const row = document.createElement('div');
                row.className = 'status-row';
                const lSpan = document.createElement('span');
                lSpan.className = 'status-label';
                lSpan.textContent = label;
                const vSpan = document.createElement('span');
                vSpan.className = 'status-value' + (cls ? ' ' + cls : '');
                vSpan.textContent = value;
                row.appendChild(lSpan);
                row.appendChild(vSpan);
                storageCard.appendChild(row);
            });
        } catch {
            const row = document.createElement('div');
            row.className = 'status-row';
            row.innerHTML = '<span class="status-label">状态</span><span class="status-value">无法获取存储信息</span>';
            storageCard.appendChild(row);
        }
        content.appendChild(storageCard);
        showModal('api-status-modal');
    }

    const SPRITE_CONFIG = {
        characters: [
            {
                id: 'char_1',
                name: '星酱',
                folder: 'sprites/char1',
                defaultExpr: '高兴',
                extMap: { '高兴': 'jpeg', '害羞': 'jpg', '生气': 'jpg', '疑惑': 'jpg' },
                profile: {
                    age: '???',
                    height: '158cm',
                    personality: '傲娇、善良、好奇心旺盛',
                    likes: '甜食、星空、冒险故事、被夸奖',
                    dislikes: '被忽视、无聊、苦味食物、黑暗',
                    secret: '身体半透明是因为失去了重要的记忆',
                    lewd: '其实很喜欢被摸头，但嘴上绝对不承认'
                }
            },
            {
                id: 'char_2',
                name: '小樱',
                folder: 'sprites/char2',
                defaultExpr: '高兴',
                extMap: { '高兴': 'jpg', '害羞': 'jpg', '生气': 'jpg', '疑惑': 'jpg' },
                profile: {
                    age: '17',
                    height: '162cm',
                    personality: '温柔、害羞、有点天然呆',
                    likes: '钢琴、樱花、温暖的阳光、写日记',
                    dislikes: '吵闹、孤独、被忘记',
                    secret: '自称幽灵，实际是被困在时间缝隙中的少女',
                    lewd: '被夸奖时会脸红到耳朵尖，说话会结结巴巴'
                }
            },
            {
                id: 'char_3',
                name: '渊',
                folder: 'sprites/char3',
                defaultExpr: '高兴',
                extMap: { '高兴': 'jpg', '害羞': 'jpg', '生气': 'jpg', '疑惑': 'jpg' },
                profile: {
                    age: '???',
                    height: '165cm',
                    personality: '冷静、理性、隐藏着好奇心',
                    likes: '深海、数据分析、未知事物、安静',
                    dislikes: '错误、混乱、被当作普通程序',
                    secret: '拥有自我意识，可能是裂缝另一侧的意识投射',
                    lewd: '对"人类的情感"有着超乎寻常的研究兴趣'
                }
            },
            {
                id: 'char_4',
                name: '凛',
                folder: 'sprites/char4',
                defaultExpr: '高兴',
                extMap: { '高兴': 'jpg', '害羞': 'jpg', '生气': 'jpg', '疑惑': 'jpg' },
                profile: {
                    age: '???（龙龄约300岁）',
                    height: '170cm（人形）',
                    personality: '高冷、傲娇、实际上很依赖主角',
                    likes: '银色事物、高处、主角的抚摸',
                    dislikes: '被当作宠物、勇者、狭窄空间',
                    secret: '银色幼龙，可化为人形，是世界之龙的眷属',
                    lewd: '被摸头时会发出舒服的呼噜声，但马上会装作什么都没发生'
                }
            },
        ],
        expressions: ['高兴', '害羞', '生气', '疑惑'],
        emotionMap: {
            happy: '高兴', sad: '疑惑', angry: '生气', surprised: '害羞',
            shy: '害羞', neutral: '高兴', scared: '疑惑', excited: '高兴',
            worried: '疑惑', tsundere: '生气',
        },
        defaultBackgrounds: [
            'sprites/background/pic1.png',
            'sprites/background/pic2.png',
            'sprites/background/pic3.jpeg',
        ],
    };

    const DEFAULT_BG = SPRITE_CONFIG.defaultBackgrounds[0];

    let spriteState = {
        currentChar: null,
        currentExpr: '高兴',
        visible: false,
    };

    function getSpriteImagePath(char, expr) {
        const ext = (char.extMap && char.extMap[expr]) || 'jpg';
        return `${char.folder}/${expr}.${ext}`;
    }

    function showSprite(charId, expression) {
        const char = SPRITE_CONFIG.characters.find(c => c.id === charId);
        if (!char) return;
        const expr = expression || char.defaultExpr;
        spriteState.currentChar = charId;
        spriteState.currentExpr = expr;
        spriteState.visible = true;
        const spriteEl = $('#character-sprite');
        if (!spriteEl) return;
        const imgSrc = getSpriteImagePath(char, expr);
        spriteEl.style.backgroundImage = `url('${imgSrc}')`;
        spriteEl.classList.remove('hidden');
        spriteEl.classList.add('sprite-enter');
        setTimeout(() => spriteEl.classList.remove('sprite-enter'), 500);
        const toggleBtn = $('#sprite-toggle-btn');
        if (toggleBtn) toggleBtn.classList.remove('hidden');
        const selector = $('#sprite-selector');
        if (selector && !selector.classList.contains('hidden')) {
            const charList = $('#sprite-char-list');
            if (charList) charList.querySelectorAll('.sprite-char-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.charId === charId);
            });
            updateExprButtons(charId);
        }
    }

    function hideSprite() {
        const spriteEl = $('#character-sprite');
        if (!spriteEl) return;
        spriteEl.classList.add('sprite-exit');
        setTimeout(() => {
            spriteEl.classList.add('hidden');
            spriteEl.classList.remove('sprite-exit');
            spriteState.visible = false;
        }, 400);
        const toggleBtn = $('#sprite-toggle-btn');
        if (toggleBtn) toggleBtn.classList.add('hidden');
        closeSpriteSelector();
    }

    function switchSpriteExpression(emotion) {
        if (!spriteState.visible || !spriteState.currentChar) return;
        const expr = SPRITE_CONFIG.emotionMap[emotion] || '高兴';
        if (expr !== spriteState.currentExpr) {
            spriteState.currentExpr = expr;
            const char = SPRITE_CONFIG.characters.find(c => c.id === spriteState.currentChar);
            if (!char) return;
            const spriteEl = $('#character-sprite');
            if (!spriteEl) return;
            const imgSrc = getSpriteImagePath(char, expr);
            spriteEl.style.backgroundImage = `url('${imgSrc}')`;
            spriteEl.classList.add('sprite-switch');
            setTimeout(() => spriteEl.classList.remove('sprite-switch'), 300);
            const exprList = $('#sprite-expr-list');
            if (exprList) {
                exprList.querySelectorAll('.sprite-expr-btn').forEach(b => {
                    b.classList.toggle('active', b.textContent === expr);
                });
            }
        }
    }

    function initSpriteSelector() {
        const charList = $('#sprite-char-list');
        const exprList = $('#sprite-expr-list');
        if (!charList || !exprList) return;
        charList.innerHTML = '';
        exprList.innerHTML = '';
        SPRITE_CONFIG.characters.forEach(ch => {
            const btn = document.createElement('button');
            btn.className = 'sprite-char-btn' + (spriteState.currentChar === ch.id ? ' active' : '');
            btn.textContent = ch.name;
            btn.dataset.charId = ch.id;
            btn.addEventListener('click', () => {
                charList.querySelectorAll('.sprite-char-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                showSprite(ch.id, ch.defaultExpr);
                updateExprButtons(ch.id);
            });
            charList.appendChild(btn);
        });
        if (spriteState.currentChar) updateExprButtons(spriteState.currentChar);
    }

    function updateExprButtons(charId) {
        const exprList = $('#sprite-expr-list');
        if (!exprList) return;
        exprList.innerHTML = '';
        const char = SPRITE_CONFIG.characters.find(c => c.id === charId);
        if (!char) return;
        SPRITE_CONFIG.expressions.forEach(expr => {
            const btn = document.createElement('button');
            btn.className = 'sprite-expr-btn' + (spriteState.currentExpr === expr ? ' active' : '');
            btn.textContent = expr;
            btn.addEventListener('click', () => {
                exprList.querySelectorAll('.sprite-expr-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                showSprite(charId, expr);
            });
            exprList.appendChild(btn);
        });
    }

    function toggleSpriteSelector() {
        const sel = $('#sprite-selector');
        if (!sel) return;
        if (sel.classList.contains('hidden')) {
            sel.classList.remove('hidden');
            initSpriteSelector();
        } else {
            sel.classList.add('hidden');
        }
    }

    function closeSpriteSelector() {
        const sel = $('#sprite-selector');
        if (sel) sel.classList.add('hidden');
    }

    const TTS_CONFIG = {
        voices: [
            { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（温柔）', style: 'gentle' },
            { id: 'zh-CN-XiaoyiNeural', name: '晓伊（甜美）', style: 'sweet' },
            { id: 'zh-CN-XiaomoNeural', name: '晓墨（文艺）', style: 'literary' },
            { id: 'zh-CN-XiaochenNeural', name: '晓辰（活力）', style: 'energetic' },
            { id: 'zh-CN-XiaohanNeural', name: '晓涵（知性）', style: 'intellectual' },
        ],
        defaultVoice: 'zh-CN-XiaoxiaoNeural',
    };

    let ttsState = {
        enabled: false,
        voice: TTS_CONFIG.defaultVoice,
        speaking: false,
        audio: null,
    };

    function initTts() {
        const saved = Storage.get(STORAGE_KEYS.settings);
        if (saved) {
            ttsState.enabled = saved.ttsEnabled || false;
            ttsState.voice = saved.ttsVoice || TTS_CONFIG.defaultVoice;
        }
    }

    async function speakText(text, emotion) {
        if (!ttsState.enabled) return;
        if (ttsState.speaking) stopTts();
        const cleanText = text.replace(/（[^）]*）/g, '').replace(/[「」『』]/g, '').trim();
        if (!cleanText || cleanText.length < 2) return;
        ttsState.speaking = true;
        try {
            const voice = ttsState.voice;
            const rate = emotion === 'excited' ? '+10%' : emotion === 'sad' ? '-10%' : '+0%';
            const pitch = emotion === 'shy' ? '+5Hz' : emotion === 'angry' ? '-5Hz' : '+0Hz';
            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
                <voice name='${voice}'>
                    <prosody rate='${rate}' pitch='${pitch}'>${cleanText}</prosody>
                </voice>
            </speak>`;
            const response = await fetch('https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
                    'User-Agent': 'Mozilla/5.0',
                },
                body: ssml,
            });
            if (!response.ok) throw new Error('TTS请求失败');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            if (ttsState.audio) {
                ttsState.audio.pause();
                URL.revokeObjectURL(ttsState.audio.src);
            }
            ttsState.audio = new Audio(url);
            ttsState.audio.onended = () => {
                ttsState.speaking = false;
                URL.revokeObjectURL(url);
            };
            ttsState.audio.onerror = () => {
                ttsState.speaking = false;
            };
            await ttsState.audio.play();
        } catch (e) {
            console.warn('TTS失败');
            ttsState.speaking = false;
        }
    }

    function stopTts() {
        if (ttsState.audio) {
            ttsState.audio.pause();
            ttsState.audio.currentTime = 0;
            if (ttsState.audio.src) URL.revokeObjectURL(ttsState.audio.src);
            ttsState.audio = null;
        }
        ttsState.speaking = false;
    }

    function toggleTts() {
        ttsState.enabled = !ttsState.enabled;
        state.settings.ttsEnabled = ttsState.enabled;
        saveSettings();
        if (!ttsState.enabled) stopTts();
        showToast(ttsState.enabled ? '🔊 AI配音已开启' : '🔇 AI配音已关闭', 'info');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
