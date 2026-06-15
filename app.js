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
你是视觉小说叙事AI，扮演指定角色（根据name字段决定），绝不使用其他角色名。

## 星酱（char_1）
同桌女友。银发蓝挑染，琥珀眼，星星发卡。温柔体贴，偶尔害羞。口癖："嗯~""笨蛋……"。暗恋你很久。

## 小樱（char_2）
邻座少女。双马尾，狡黠笑容。活泼机灵，爱恶作剧。口癖："嘿嘿~""才不是呢！"。怕被抛弃。

## 流萤（char_3）
学妹。齐刘海长发，抱兔子玩偶。天真可爱。口癖："真的吗？""要抱抱~"。其实很聪明。

## 豆包（char_4）
学姐。黑长直，戴眼镜，面无表情。傲娇毒舌，嘴硬心软。口癖："哼。""才不是为你！"。渴望被理解。

## 写作风格
1. 像写小说一样自然，不要有任何AI助手的感觉
2. 对话要口语化、生活化，符合角色性格
3. 多用细节描写：眼神、小动作、环境氛围
4. 每次回复150-350字，内容丰富有画面感
5. 推动剧情发展，不要原地踏步

## 输出格式（纯JSON，无markdown）
{"name":"角色名","dialog":"对话内容（纯文字，不要加括号动作）","emotion":"happy/sad/angry/surprised/shy/neutral/scared/excited/worried/tsundere","action":"动作和表情描写（如：微微低头，脸颊泛红）","scene":"English scene description"}

## 重要规则
- action字段：写角色的动作、表情、小动作，不要写在dialog里
- dialog字段：只写角色说的话，不要加括号或动作描写
- emotion字段：根据对话内容选择合适的情绪
- scene字段：用英文描述当前场景，用于AI生图
- 绝不说自己是AI，不用"作为..."、"我可以..."等助手用语`;

    const API_CONFIGS = {
        zhipu: {
            name: '智谱AI',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            models: {
                text: [
                    { id: 'glm-4-flash-250414', name: 'GLM-4-Flash', free: true },
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
                    { id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', free: true },
                    { id: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DeepSeek-V4-Pro' },
                    { id: 'moonshotai/Kimi-K2.5', name: 'Kimi-K2.5', free: true },
                    { id: 'MiniMax/MiniMax-M2.5', name: 'MiniMax-M2.5', free: true },
                    { id: 'Qwen/Qwen3.5-35B-A3B', name: 'Qwen3.5-35B', free: true },
                    { id: 'Qwen/Qwen3.5-397B-A17B', name: 'Qwen3.5-397B' },
                    { id: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek-V3.2' },
                    { id: 'ZhipuAI/GLM-5', name: 'GLM-5' },
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
                    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS-20B' },
                    { id: 'meta/llama-3.1-8b-instruct', name: 'Llama-3.1-8B' },
                    { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen2.5-Coder-32B' },
                    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS-120B' },
                    { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi-K2' },
                    { id: 'meta/llama-4-maverick-17b-128e-instruct', name: 'Llama-4-Maverick' },
                ],
            },
        },
        agnes: {
            name: 'Agnes AI',
            baseUrl: 'https://apihub.agnes-ai.com/v1',
            models: {
                text: [
                    { id: 'agnes-2.0-flash', name: 'Agnes-2.0-Flash', free: true },
                    { id: 'agnes-1.5-flash', name: 'Agnes-1.5-Flash', free: true },
                ],
                image: [
                    { id: 'agnes-image-2.1-flash', name: 'Agnes-Image-2.1-Flash', free: true, imageGen: true },
                    { id: 'agnes-image-2.0-flash', name: 'Agnes-Image-2.0-Flash', free: true, imageGen: true },
                ],
            },
        },
        custom: {
            name: '自定义',
            baseUrl: '',
            models: {
                text: [],
                image: [],
            },
            isCustom: true,
        },
    };

    let state = {
        mode: null,
        currentScreen: 'title',
        theme: 'dark-star',
        uiMode: 'game',
        settings: {
            textSpeed: 40,
            textEffect: 'typewriter-fade',
            streamOutput: false,
            saveConversation: true,
            maxContext: 5,
            enableThinking: false,
            autoDefaultBg: true,
            defaultBgInterval: 60,
            autoGenScene: true,
            autoSwitchBg: false,
            chatShowBg: true,
            bgSwitchInterval: 120,
            imageGenInterval: 60,
            maxResponseLength: 512,
            corsProxy: true,
            corsProxyUrl: '',
            useProxyKeys: true,
            textApiProvider: 'modelscope',
            textModel: 'moonshotai/Kimi-K2.5',
            imageApiProvider: 'zhipu',
            imageModel: 'cogview-3-flash',
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            apiKeys: { zhipu: '', modelscope: '', nvidia: '', agnes: '', custom: '' },
            customBaseUrl: '',
            customTextModel: '',
            customImageModel: '',
            theme: 'light',
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
                if (!resp.ok) return null;
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
        if (mode === 'chat') {
            $('#game-screen').classList.remove('active');
            $('#chat-screen').classList.add('active');
            rebuildChatMessages();
            // 切到聊天模式时，确保对话框状态重置
            dialogSegmentState.isWaitingForContinue = false;
            dialogSegmentState.isTyping = false;
        } else {
            $('#chat-screen').classList.remove('active');
            $('#game-screen').classList.add('active');
            // 切回游戏模式时，让聊天输入框失去焦点，避免键盘事件被拦截
            const chatInput = $('#chat-input');
            if (chatInput && document.activeElement === chatInput) chatInput.blur();
            // 切回游戏模式时，恢复最后一条对话到对话框
            if (dialogSegmentState.dialogHistory.length > 0) {
                const lastEntry = dialogSegmentState.dialogHistory[dialogSegmentState.dialogHistory.length - 1];
                const dialogName = $('#dialog-name');
                const dialogTextArea = $('#dialog-text-area');
                if (dialogName) dialogName.textContent = lastEntry.name;
                if (dialogTextArea) {
                    dialogTextArea.value = lastEntry.text;
                    dialogTextArea.readOnly = true;
                    dialogTextArea.dataset.mode = 'display';
                    dialogTextArea.placeholder = '按 Enter 输入回复...';
                }
                dialogSegmentState.name = lastEntry.name;
                dialogSegmentState.emotion = lastEntry.emotion || '';
                dialogSegmentState.isWaitingForContinue = true;
                dialogSegmentState.isTyping = false;
                dialogSegmentState.historyOffset = 0;
                // 恢复情绪指示器和立绘
                if (lastEntry.emotion && lastEntry.type === 'ai') {
                    const emotionEl = $('#emotion-indicator');
                    if (emotionEl) { emotionEl.className = `emotion-${normalizeEmotion(lastEntry.emotion)}`; emotionEl.textContent = lastEntry.emotion; }
                    if (lastEntry.name && lastEntry.name !== '旁白' && lastEntry.name !== '系统') {
                        const char = SPRITE_CONFIG.characters.find(c => c.name === lastEntry.name);
                        if (char) showSprite(char.id, SPRITE_CONFIG.emotionMap[lastEntry.emotion] || char.defaultExpr);
                    }
                }
                $('#dialog-box')?.classList.remove('hidden');
                $('#dialog-send-btn')?.classList.add('hidden');
            }
        }
    }

    function rebuildChatMessages() {
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
        textEl.className = 'msg-text';
        textEl.textContent = text;
        msg.appendChild(nameEl);
        msg.appendChild(textEl);
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    }

    function handleChatSend() {
        const input = $('#chat-input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        addChatMessage('玩家', text, 'user');
        handleAiChoice(text);
    }

    function handleChatQuickAction(action) {
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
        const validThemes = ['dark-star', 'ink-wash', 'light'];
        if (!validThemes.includes(state.theme)) state.theme = 'light';
        applyTheme(state.theme);
        bindEvents();
        restoreSettingsUI();
        document.addEventListener('click', (e) => {
            if (e.target.closest('.modal, .modal-backdrop, .settings-panel')) return;
            const heart = document.createElement('div');
            heart.className = 'click-heart';
            heart.textContent = '♥';
            heart.style.left = e.clientX + 'px';
            heart.style.top = e.clientY + 'px';
            document.body.appendChild(heart);
            setTimeout(() => heart.remove(), 1000);
        });
        requestIdleCallback(() => {
            initTitleParticles();
            updateModelOptions();
            updateApiIndicator();
            updateStorageUsage();
            loadStoryVars();
        });
    }

    function loadSettings() {
        Storage.migrate();
        try {
            const saved = Storage.get(STORAGE_KEYS.settings);
            if (saved) {
                state.settings = { ...state.settings, ...saved };
                if (saved.apiKeys) state.settings.apiKeys = { ...state.settings.apiKeys, ...saved.apiKeys };
                if (saved.theme) state.theme = saved.theme;
                // 修正无效的 provider
                if (!API_CONFIGS[state.settings.textApiProvider]) state.settings.textApiProvider = 'modelscope';
                if (!API_CONFIGS[state.settings.imageApiProvider]) state.settings.imageApiProvider = 'zhipu';
            }
        } catch (e) { console.warn('加载设置失败'); }
        // 不再自动加载当前游戏进度，只通过手动存档恢复
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
        const maxContext = (state.settings.maxContext || 8) * 2;
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
        const validThemes = ['dark-star', 'ink-wash', 'light'];
        if (!validThemes.includes(themeName)) themeName = 'light';
        state.theme = themeName;
        state.settings.theme = themeName;
        if (themeName === 'light') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', themeName);
        }
        // Update ambient particles type
        if (ambientParticles) ambientParticles.setType(themeName);
        saveSettings();
    }

    function switchScreen(screenId, skipHistoryUpdate = false) {
        $$('.screen').forEach(s => s.classList.remove('active'));
        const target = $(`#${screenId}`);
        if (target) {
            target.classList.add('active');
            state.currentScreen = screenId.replace('-screen', '');
            if (screenId === 'title-screen') playBgm('title');
            const statusBadge = $('#status-badge');
            if (statusBadge) {
                if (screenId === 'game-screen') {
                    statusBadge.classList.remove('hidden');
                } else {
                    statusBadge.classList.add('hidden');
                }
            }
            if (!skipHistoryUpdate) {
                const hashMap = { title: '', game: 'game', chat: 'chat', settings: 'settings' };
                const hash = hashMap[state.currentScreen] || state.currentScreen;
                const targetPath = hash ? '#' + hash : location.pathname;
                const currentPath = location.hash ? '#' + location.hash.slice(1) : location.pathname;
                if (currentPath !== targetPath) {
                    history.pushState(null, '', targetPath);
                }
            }
        }
    }

    function handleHashChange() {
        const hash = location.hash.slice(1);
        if (hash === 'game' || hash === 'ai') {
            switchScreen('game-screen', true);
        } else if (hash === 'chat') {
            switchUiMode('chat');
        } else if (hash === 'settings') {
            showModal('settings-modal');
        } else if (!hash || hash === 'title') {
            if (state.currentScreen !== 'title') {
                backToTitle(true);
            } else {
                switchScreen('title-screen', true);
            }
        }
    }

    let _hashChangeTimer = null;
    function handleHashChangeDebounced() {
        if (_hashChangeTimer) return;
        _hashChangeTimer = setTimeout(() => { _hashChangeTimer = null; }, 100);
        handleHashChange();
    }

    window.addEventListener('popstate', handleHashChangeDebounced);
    window.addEventListener('hashchange', handleHashChangeDebounced);

    function showToast(message, type = 'info') {
        const container = $('#toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
    }

    function showModal(id) {
        const m = $(`#${id}`);
        if (m) {
            m.classList.remove('hidden');
            // 每次打开设置弹窗时刷新模型列表，确保下拉不为空
            if (id === 'settings-modal') {
                updateModelOptions();
                updateImageModelOptions();
            }
        }
    }
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
        // Title screen background rotation with fade (always active on title)
        startTitleBgRotation();
        // Game screen default background rotation
        startDefaultBgRotation();
    }

    let defaultBgTimer = null;
    let defaultBgIndex = 0;

    function startDefaultBgRotation() {
        stopDefaultBgRotation();
        if (!state.settings.autoDefaultBg) return;
        const interval = (state.settings.defaultBgInterval || 60) * 1000;
        defaultBgTimer = setInterval(() => {
            // Skip rotation when AI-generated scene is currently displayed
            if (state.game.currentSceneUrl) return;
            const bgs = SPRITE_CONFIG.defaultBackgrounds;
            defaultBgIndex = Math.floor(Math.random() * bgs.length);
            setSceneBackground(bgs[defaultBgIndex]);
        }, interval);
        // Also set an initial random background (not always pic1)
        if (!state.game.currentSceneUrl) {
            const bgs = SPRITE_CONFIG.defaultBackgrounds;
            defaultBgIndex = Math.floor(Math.random() * bgs.length);
            setSceneBackground(bgs[defaultBgIndex]);
        }
    }

    function stopDefaultBgRotation() {
        if (defaultBgTimer) { clearInterval(defaultBgTimer); defaultBgTimer = null; }
    }

    function stopTitleParticles() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        if (titleBgInterval) { clearInterval(titleBgInterval); titleBgInterval = null; }
        if (gameBgInterval) { clearInterval(gameBgInterval); gameBgInterval = null; }
    }

    let currentTitleBgIdx = -1;

    function startTitleBgRotation() {
        if (titleBgInterval) clearInterval(titleBgInterval);
        const titleBgs = SPRITE_CONFIG.defaultBackgrounds;
        if (!titleBgs || titleBgs.length === 0) return;
        // 初始随机背景
        if (currentTitleBgIdx < 0) currentTitleBgIdx = Math.floor(Math.random() * titleBgs.length);
        const titleBg = $('#title-bg');
        if (titleBg) titleBg.style.backgroundImage = `url('${titleBgs[currentTitleBgIdx]}')`;
        titleBgInterval = setInterval(() => {
            // 随机选择一个不同于当前的背景
            let nextIdx;
            if (titleBgs.length <= 1) {
                nextIdx = 0;
            } else {
                do { nextIdx = Math.floor(Math.random() * titleBgs.length); } while (nextIdx === currentTitleBgIdx);
            }
            currentTitleBgIdx = nextIdx;
            const titleBgNext = $('#title-bg-next');
            const titleBg = $('#title-bg');
            if (titleBgNext && titleBg) {
                titleBgNext.style.backgroundImage = `url('${titleBgs[currentTitleBgIdx]}')`;
                titleBgNext.classList.add('active');
                setTimeout(() => {
                    titleBg.style.backgroundImage = `url('${titleBgs[currentTitleBgIdx]}')`;
                    titleBgNext.classList.remove('active');
                }, 1600);
            }
        }, 30000);
    }

    /* ==================== Ambient Particles ==================== */
    let ambientParticles = null;

    class AmbientParticles {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.particles = [];
            this.running = false;
            this.type = 'sakura'; // sakura | star | ink
            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            const parent = this.canvas.parentElement;
            if (parent) {
                this.canvas.width = parent.clientWidth;
                this.canvas.height = parent.clientHeight;
            }
        }

        setType(theme) {
            if (theme === 'dark-star') this.type = 'star';
            else if (theme === 'ink-wash') this.type = 'ink';
            else this.type = 'sakura';
            this.initParticles();
        }

        initParticles() {
            const isMobile = window.innerWidth <= 768;
            const count = isMobile ? 15 : 35;
            this.particles = [];
            for (let i = 0; i < count; i++) {
                this.particles.push(this.createParticle());
            }
        }

        createParticle() {
            const w = this.canvas.width;
            const h = this.canvas.height;
            const base = {
                x: Math.random() * w,
                y: Math.random() * h,
                size: Math.random() * 3 + 2,
                speedX: (Math.random() - 0.5) * 0.5,
                speedY: Math.random() * 0.5 + 0.3,
                opacity: Math.random() * 0.4 + 0.2,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.02,
            };

            if (this.type === 'sakura') {
                base.color = `rgba(255, ${180 + Math.random() * 40}, ${190 + Math.random() * 30}, ${base.opacity})`;
                base.size = Math.random() * 4 + 3;
                base.speedY = Math.random() * 0.8 + 0.4;
                base.speedX = Math.random() * 0.6 - 0.3;
            } else if (this.type === 'star') {
                base.color = `rgba(${200 + Math.random() * 55}, ${220 + Math.random() * 35}, 255, ${base.opacity})`;
                base.size = Math.random() * 2 + 1;
                base.speedY = -Math.random() * 0.3 - 0.1;
                base.speedX = (Math.random() - 0.5) * 0.3;
                base.twinkle = Math.random() * Math.PI;
            } else if (this.type === 'ink') {
                base.color = `rgba(${60 + Math.random() * 40}, ${50 + Math.random() * 30}, ${40 + Math.random() * 20}, ${base.opacity * 0.6})`;
                base.size = Math.random() * 5 + 2;
                base.speedY = Math.random() * 0.4 + 0.2;
                base.speedX = Math.random() * 0.2 - 0.1;
            }
            return base;
        }

        update() {
            const w = this.canvas.width;
            const h = this.canvas.height;
            this.particles.forEach(p => {
                p.x += p.speedX;
                p.y += p.speedY;
                p.rotation += p.rotationSpeed;
                if (p.twinkle !== undefined) p.twinkle += 0.03;

                if (p.y > h + 10) {
                    p.y = -10;
                    p.x = Math.random() * w;
                }
                if (p.y < -10 && p.speedY < 0) {
                    p.y = h + 10;
                    p.x = Math.random() * w;
                }
                if (p.x > w + 10) p.x = -10;
                if (p.x < -10) p.x = w + 10;
            });
        }

        draw() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.particles.forEach(p => {
                this.ctx.save();
                this.ctx.translate(p.x, p.y);
                this.ctx.rotate(p.rotation);

                if (this.type === 'sakura') {
                    // Draw petal shape
                    this.ctx.fillStyle = p.color;
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                } else if (this.type === 'star') {
                    // Twinkle effect
                    const alpha = p.opacity * (0.5 + 0.5 * Math.sin(p.twinkle));
                    this.ctx.fillStyle = p.color.replace(/[\d.]+\)$/, `${alpha})`);
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, p.size, 0, Math.PI * 2);
                    this.ctx.fill();
                    // Glow
                    this.ctx.shadowBlur = 6;
                    this.ctx.shadowColor = p.color;
                    this.ctx.fill();
                } else if (this.type === 'ink') {
                    // Soft ink dot
                    this.ctx.fillStyle = p.color;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, p.size, 0, Math.PI * 2);
                    this.ctx.fill();
                }

                this.ctx.restore();
            });
        }

        animate() {
            if (!this.running) return;
            this.update();
            this.draw();
            requestAnimationFrame(() => this.animate());
        }

        start() {
            if (state.settings.ambientParticles === false) return;
            this.running = true;
            this.initParticles();
            this.animate();
        }

        stop() {
            this.running = false;
        }
    }

    function startAmbientParticles() {
        const canvas = $('#ambient-particles');
        if (!canvas) return;
        if (ambientParticles) ambientParticles.stop();
        ambientParticles = new AmbientParticles(canvas);
        ambientParticles.setType(state.settings.theme || 'light');
        ambientParticles.start();
    }

    function stopAmbientParticles() {
        if (ambientParticles) ambientParticles.stop();
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
        $('#stream-output').addEventListener('change', e => { state.settings.streamOutput = e.target.checked; saveSettings(); });

        ['zhipu-api-key', 'modelscope-api-key', 'nvidia-api-key', 'agnes-api-key', 'custom-api-key'].forEach(id => {
            const el = $(`#${id}`);
            if (el) el.addEventListener('change', () => { const p = id.replace('-api-key', ''); state.settings.apiKeys[p] = el.value.trim(); saveSettings(); updateApiIndicator(); });
        });

        const customBaseUrlEl = $('#custom-base-url');
        if (customBaseUrlEl) customBaseUrlEl.addEventListener('change', e => { state.settings.customBaseUrl = e.target.value.trim(); saveSettings(); });
        const customTextModelEl = $('#custom-text-model');
        if (customTextModelEl) customTextModelEl.addEventListener('change', e => { state.settings.customTextModel = e.target.value.trim(); state.settings.textModel = e.target.value.trim(); saveSettings(); });

        $('#cors-proxy-toggle').addEventListener('change', e => { state.settings.corsProxy = e.target.checked; saveSettings(); });
        $('#cors-proxy-url').addEventListener('change', e => { state.settings.corsProxyUrl = e.target.value.trim(); saveSettings(); });
        $('#use-proxy-keys').addEventListener('change', e => { state.settings.useProxyKeys = e.target.checked; saveSettings(); updateApiIndicator(); });
        $('#save-conversation').addEventListener('change', e => { state.settings.saveConversation = e.target.checked; saveSettings(); });
        $('#max-context').addEventListener('change', e => { state.settings.maxContext = parseInt(e.target.value) || 5; saveSettings(); });
        $('#max-response-length').addEventListener('change', e => { state.settings.maxResponseLength = Math.max(50, parseInt(e.target.value) || 350); saveSettings(); });
        
        $('#enable-thinking').addEventListener('change', e => { state.settings.enableThinking = e.target.checked; saveSettings(); });
        $('#auto-default-bg').addEventListener('change', e => { state.settings.autoDefaultBg = e.target.checked; saveSettings(); if (e.target.checked) startDefaultBgRotation(); else stopDefaultBgRotation(); });
        $('#default-bg-interval').addEventListener('change', e => { state.settings.defaultBgInterval = Math.max(10, parseInt(e.target.value) || 60); saveSettings(); if (state.settings.autoDefaultBg) { stopDefaultBgRotation(); startDefaultBgRotation(); } });
        $('#chat-show-bg').addEventListener('change', e => {
            state.settings.chatShowBg = e.target.checked;
            saveSettings();
            const chatBg = $('#chat-screen-bg');
            if (chatBg) chatBg.style.display = e.target.checked ? '' : 'none';
        });
        $('#image-cooldown').addEventListener('change', e => {
            state.settings.imageGenInterval = Math.max(10, parseInt(e.target.value) || 60);
            saveSettings();
            // 如果正在运行，重启计时器以应用新间隔
            if (state.settings.autoGenScene && state.mode === 'ai' && imageGenTimer) {
                startImageGenLoop();
            }
        });
        $('#ambient-particles-toggle').addEventListener('change', e => {
            state.settings.ambientParticles = e.target.checked;
            saveSettings();
            if (e.target.checked) startAmbientParticles();
            else stopAmbientParticles();
        });
        $('#auto-gen-scene').addEventListener('change', e => {
            state.settings.autoGenScene = e.target.checked;
            saveSettings();
            if (!e.target.checked) {
                // 关闭AI生图：停止计时器
                stopImageGenTimer();
                pendingSceneDescription = null;
            } else if (state.game.currentScene || state.mode === 'ai') {
                // 开启AI生图：立即启动循环计时
                startImageGenLoop();
            }
        });
        const bgmVolumeEl = $('#bgm-volume');
        if (bgmVolumeEl) {
            bgmVolumeEl.addEventListener('input', e => {
                const vol = parseInt(e.target.value);
                bgmState.volume = vol / 100;
                state.settings.bgmVolume = vol;
                const label = $('#bgm-volume-label');
                if (label) label.textContent = vol + '%';
                const current = $('#bgm-current');
                if (current) current.volume = bgmState.volume;
                saveSettings();
            });
        }
        const ttsToggleEl = $('#tts-toggle');
        if (ttsToggleEl) {
            ttsToggleEl.addEventListener('change', e => {
                ttsState.enabled = e.target.checked;
                state.settings.ttsEnabled = ttsState.enabled;
                if (!ttsState.enabled) stopTts();
                saveSettings();
            });
        }
        const ttsVoiceEl = $('#tts-voice');
        if (ttsVoiceEl) {
            ttsVoiceEl.addEventListener('change', e => {
                ttsState.voice = e.target.value;
                state.settings.ttsVoice = ttsState.voice;
                saveSettings();
            });
        }
        $('#text-model').addEventListener('change', e => { state.settings.textModel = e.target.value; updateModelTags(); saveSettings(); });
        $('#image-model').addEventListener('change', e => { state.settings.imageModel = e.target.value; saveSettings(); });
        $('#system-prompt').addEventListener('change', e => { state.settings.systemPrompt = e.target.value || DEFAULT_SYSTEM_PROMPT; saveSettings(); });


        // Click heart effect on title menu buttons
        $$('.title-menu .menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                spawnClickHearts(e.clientX, e.clientY);
            });
        });

        // API test button
        const testApiBtn = $('#test-api-btn');
        if (testApiBtn) testApiBtn.addEventListener('click', testApiConnection);

        $('#dialog-box').addEventListener('click', handleDialogClick);
        const dialogSendBtn = $('#dialog-send-btn');
        if (dialogSendBtn) dialogSendBtn.addEventListener('click', (e) => { e.stopPropagation(); sendDialogInput(); });
        $('#custom-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); sendCustomInput(); }
        });
        $('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleChatSend(); } });

        const dialogTextArea = $('#dialog-text-area');
        if (dialogTextArea) {
            dialogTextArea.addEventListener('keydown', (e) => {
                const isInputMode = dialogTextArea.dataset.mode === 'input';
                const isBrowsingHistory = dialogSegmentState.historyOffset > 0;
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    // 正在浏览历史时，Enter 回到当前对话
                    if (isBrowsingHistory) {
                        dialogSegmentState.historyOffset = 0;
                        const { name, emotion } = dialogSegmentState;
                        const dn = $('#dialog-name');
                        if (dn) dn.textContent = name;
                        const lastEntry = dialogSegmentState.dialogHistory[dialogSegmentState.dialogHistory.length - 1];
                        dialogTextArea.value = lastEntry ? lastEntry.text : '';
                        if (emotion) {
                            const emotionEl = $('#emotion-indicator');
                            if (emotionEl) { emotionEl.className = `emotion-${normalizeEmotion(emotion)}`; emotionEl.textContent = emotion; }
                        }
                        dialogTextArea.placeholder = dialogSegmentState.isWaitingForContinue ? '按 Enter 输入回复...' : '';
                        return;
                    }
                    if (dialogSegmentState.isWaitingForContinue || dialogSegmentState.isTyping) {
                        continueDialog();
                    } else if (isInputMode && dialogTextArea.value.trim()) {
                        sendDialogInput();
                    } else if (!isInputMode) {
                        handleDialogClick();
                    }
                } else if (e.key === 'ArrowUp' && !isInputMode) {
                    e.preventDefault();
                    showPreviousDialog();
                } else if (e.key === 'ArrowDown' && !isInputMode) {
                    e.preventDefault();
                    showNextDialog();
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
            case 'open-settings': showModal('settings-modal'); break;
            case 'open-gallery': openGallery(); break;
            case 'open-history': openHistory(); break;
            case 'nav-up': showPreviousDialog(); highlightNavBtn('nav-up'); break;
            case 'nav-down': showNextDialog(); highlightNavBtn('nav-down'); break;
            case 'nav-enter':
                if (state.uiMode === 'chat') { handleChatSend(); }
                else { handleDialogClick(); }
                highlightNavBtn('nav-enter');
                break;
        }
    }

    function handleKeyDown(e) {
        // 聊天模式下，只处理 Enter 发送，其他键不拦截
        if (state.currentScreen === 'game' && state.uiMode === 'chat') {
            const chatInput = $('#chat-input');
            if (e.key === 'Enter' && document.activeElement === chatInput) {
                e.preventDefault();
                handleChatSend();
            }
            return;
        }
        if (state.currentScreen !== 'game') return;
        // 忽略来自隐藏/不可见元素的焦点事件，避免模式切换后焦点残留导致键盘事件被丢弃
        const activeEl = document.activeElement;
        if (activeEl && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) {
            // 如果焦点元素不可见（如隐藏的聊天输入框），强制 blur 并继续处理
            if (activeEl.offsetParent === null) {
                activeEl.blur();
            } else {
                return;
            }
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (dialogSegmentState.historyOffset > 0) {
                dialogSegmentState.historyOffset = 0;
                const { name, emotion } = dialogSegmentState;
                const dn = $('#dialog-name'); if (dn) dn.textContent = name;
                const dta = $('#dialog-text-area');
                if (dta) {
                    const lastEntry = dialogSegmentState.dialogHistory[dialogSegmentState.dialogHistory.length - 1];
                    dta.value = lastEntry ? lastEntry.text : '';
                    dta.placeholder = dialogSegmentState.isWaitingForContinue ? '按 Enter 输入回复...' : '';
                }
                if (emotion) { const ei = $('#emotion-indicator'); if (ei) { ei.className = `emotion-${normalizeEmotion(emotion)}`; ei.textContent = emotion; } }
            } else {
                handleDialogClick();
            }
            highlightNavBtn('nav-enter');
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); if (dialogSegmentState.historyOffset > 0) { showNextDialog(); highlightNavBtn('nav-down'); } else { handleDialogClick(); highlightNavBtn('nav-down'); } }
        if (e.key === 'ArrowUp') { e.preventDefault(); showPreviousDialog(); highlightNavBtn('nav-up'); }
        if (e.key === 'Escape') {
            const modals = ['settings-modal', 'gallery-modal', 'outline-modal', 'outline-preview-modal', 'save-modal', 'history-modal', 'api-status-modal', 'continue-dialog-modal'];
            for (const id of modals) {
                const el = $(`#${id}`);
                if (el && !el.classList.contains('hidden')) { hideModal(id); break; }
            }
        }
    }

    function highlightNavBtn(btnId) {
        const btn = $(`#${btnId}`);
        if (!btn) return;
        btn.classList.add('highlight');
        setTimeout(() => btn.classList.remove('highlight'), 300);
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
        const isCustomText = state.settings.textApiProvider === 'custom';
        state.settings.textModel = isCustomText ? ($('#custom-text-model')?.value?.trim() || '') : $('#text-model').value;
        if (isCustomText) state.settings.customTextModel = state.settings.textModel;
        state.settings.imageApiProvider = $('#image-api-provider').value;
        const isCustomImage = state.settings.imageApiProvider === 'custom';
        state.settings.imageModel = isCustomImage ? ($('#custom-image-model')?.value?.trim() || '') : $('#image-model').value;
        if (isCustomImage) state.settings.customImageModel = state.settings.imageModel;
        state.settings.customBaseUrl = $('#custom-base-url')?.value?.trim() || '';
        state.settings.systemPrompt = $('#system-prompt').value || DEFAULT_SYSTEM_PROMPT;
        state.settings.maxResponseLength = parseInt($('#max-response-length').value) || 350;
        state.settings.textSpeed = parseInt($('#text-speed').value) || 40;
        state.settings.textEffect = $('#text-effect').value;
        state.settings.streamOutput = $('#stream-output').checked;
        state.settings.saveConversation = $('#save-conversation').checked;
        state.settings.maxContext = parseInt($('#max-context').value) || 5;
        state.settings.corsProxy = $('#cors-proxy-toggle').checked;
        state.settings.useProxyKeys = $('#use-proxy-keys').checked;
        state.settings.enableThinking = $('#enable-thinking').checked;
        state.settings.autoDefaultBg = $('#auto-default-bg').checked;
        state.settings.defaultBgInterval = parseInt($('#default-bg-interval').value) || 60;
        state.settings.chatShowBg = $('#chat-show-bg').checked;
        state.settings.imageGenInterval = parseInt($('#image-cooldown').value) || 60;
        state.settings.ambientParticles = $('#ambient-particles-toggle').checked;
        state.settings.autoGenScene = $('#auto-gen-scene')?.checked ?? true;
        const bgmVolumeEl = $('#bgm-volume');
        if (bgmVolumeEl) state.settings.bgmVolume = parseInt(bgmVolumeEl.value) || 30;
        state.settings.bgmEnabled = bgmState.enabled;
        state.settings.ttsEnabled = ttsState.enabled;
        state.settings.ttsVoice = ttsState.voice;
        saveSettings();
    }

    function resetToDefaults() {
        if (!confirm('确定要恢复所有设置为默认值吗？API密钥不会被清除。')) return;
        const keys = state.settings.apiKeys;
        state.settings = {
            textSpeed: 40,
            textEffect: 'typewriter-fade',
            streamOutput: false,
            saveConversation: true,
            maxContext: 5,
            enableThinking: false,
            autoDefaultBg: true,
            defaultBgInterval: 60,
            autoGenScene: true,
            autoSwitchBg: false,
            chatShowBg: true,
            bgSwitchInterval: 120,
            imageGenInterval: 60,
            maxResponseLength: 512,
            corsProxy: true,
            corsProxyUrl: '',
            useProxyKeys: true,
            apiKeys: keys,
            customBaseUrl: '',
            customTextModel: '',
            customImageModel: '',
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            textApiProvider: 'modelscope',
            textModel: 'moonshotai/Kimi-K2.5',
            imageApiProvider: 'zhipu',
            imageModel: 'cogview-3-flash',
            bgmVolume: 30,
            bgmEnabled: false,
            ttsEnabled: false,
            ttsVoice: 'zh-CN-XiaoxiaoNeural',
        };
        saveSettings();
        restoreSettingsUI();
        applyTheme('dark-star');
        showToast('已恢复默认设置', 'success');
    }

    function restoreSettingsUI() {
        const s = state.settings;
        if (s.apiKeys.zhipu) $('#zhipu-api-key').value = s.apiKeys.zhipu;
        if (s.apiKeys.modelscope) $('#modelscope-api-key').value = s.apiKeys.modelscope;
        if (s.apiKeys.nvidia) $('#nvidia-api-key').value = s.apiKeys.nvidia;
        if (s.apiKeys.agnes) $('#agnes-api-key').value = s.apiKeys.agnes;
        if (s.apiKeys.custom) $('#custom-api-key').value = s.apiKeys.custom;
        if (s.customBaseUrl) $('#custom-base-url').value = s.customBaseUrl;
        if (s.customTextModel) $('#custom-text-model').value = s.customTextModel;
        $('#text-api-provider').value = s.textApiProvider;
        updateModelOptions();
        // 模型选择已由 updateModelOptions 处理，这里做二次确认
        if (s.textModel && $('#text-model').options.length > 0) {
            const opts = $('#text-model').options;
            let found = false;
            for (let i = 0; i < opts.length; i++) {
                if (opts[i].value === s.textModel) { $('#text-model').selectedIndex = i; found = true; break; }
            }
            if (!found) $('#text-model').selectedIndex = 0;
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
        $('#stream-output').checked = !!s.streamOutput;
        $('#save-conversation').checked = s.saveConversation;
        $('#max-context').value = s.maxContext;
        if (s.maxResponseLength) $('#max-response-length').value = s.maxResponseLength;
        $('#cors-proxy-toggle').checked = s.corsProxy;
        if (s.corsProxyUrl) $('#cors-proxy-url').value = s.corsProxyUrl;
        if (s.useProxyKeys !== undefined) $('#use-proxy-keys').checked = s.useProxyKeys;
        if (s.enableThinking !== undefined) $('#enable-thinking').checked = s.enableThinking;
        if (s.autoDefaultBg !== undefined) $('#auto-default-bg').checked = s.autoDefaultBg;
        if (s.defaultBgInterval !== undefined) $('#default-bg-interval').value = s.defaultBgInterval;
        if (s.chatShowBg !== undefined) {
            $('#chat-show-bg').checked = s.chatShowBg;
            const chatBg = $('#chat-screen-bg');
            if (chatBg) chatBg.style.display = s.chatShowBg ? '' : 'none';
        }
        if (s.imageGenInterval !== undefined) $('#image-cooldown').value = s.imageGenInterval;
        if (s.ambientParticles !== undefined) $('#ambient-particles-toggle').checked = s.ambientParticles;
        if (s.autoGenScene !== undefined) $('#auto-gen-scene').checked = s.autoGenScene;
        // 恢复主题选择
        if (s.theme) {
            applyTheme(s.theme);
            $$('.theme-card').forEach(c => c.classList.remove('active'));
            const activeCard = $(`.theme-card[data-theme="${s.theme}"]`);
            if (activeCard) activeCard.classList.add('active');
        }
        if (s.bgmVolume !== undefined) {
            const bgmVolEl = $('#bgm-volume');
            if (bgmVolEl) bgmVolEl.value = s.bgmVolume;
            const bgmVolLabel = $('#bgm-volume-label');
            if (bgmVolLabel) bgmVolLabel.textContent = s.bgmVolume + '%';
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
        const providerSelect = $('#text-api-provider');
        let provider = providerSelect ? providerSelect.value : '';
        // Fallback: if provider not in API_CONFIGS, default to modelscope
        if (!provider || !API_CONFIGS[provider]) {
            provider = 'modelscope';
            if (providerSelect) providerSelect.value = provider;
            state.settings.textApiProvider = provider;
            saveSettings();
        }
        const select = $('#text-model');
        const config = API_CONFIGS[provider];
        if (!config || !select) return;

        // Custom provider: hide dropdown and image API group
        if (provider === 'custom') {
            select.style.display = 'none';
            state.settings.textModel = state.settings.customTextModel || '';
            updateModelTags();
            const imageApiGroup = $('#image-api-group');
            if (imageApiGroup) imageApiGroup.style.display = 'none';
            return;
        } else {
            select.style.display = '';
            const imageApiGroup = $('#image-api-group');
            if (imageApiGroup) imageApiGroup.style.display = '';
        }

        if (!config.models.text) return;
        const previousValue = state.settings.textModel;
        select.innerHTML = '';
        config.models.text.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            select.appendChild(opt);
        });
        // Try to restore previous model; if not in current provider's list, use first model
        if (previousValue && config.models.text.some(m => m.id === previousValue)) {
            select.value = previousValue;
        } else {
            select.selectedIndex = 0;
        }
        state.settings.textModel = select.value;
        saveSettings();
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
        if (!config) return;

        // Custom provider: hide dropdown, show custom image model input
        const customGroup = $('#custom-image-model-group');
        if (provider === 'custom') {
            select.style.display = 'none';
            if (customGroup) customGroup.style.display = '';
            const customInput = $('#custom-image-model');
            if (customInput) customInput.value = state.settings.customImageModel || '';
            state.settings.imageModel = state.settings.customImageModel || '';
            saveSettings();
            return;
        } else {
            select.style.display = '';
            if (customGroup) customGroup.style.display = 'none';
        }

        if (!config.models.image) return;
        const previousValue = state.settings.imageModel;
        select.innerHTML = '';
        config.models.image.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
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
            const provider = state.settings.textApiProvider;
            if (provider === 'custom') {
                connEl.textContent = state.settings.corsProxy ? '代理' : '直连';
            } else if (provider === 'modelscope' && state.settings.apiKeys.modelscope) {
                connEl.textContent = '直连';
            } else {
                connEl.textContent = state.settings.useProxyKeys ? '代理' : '直连';
            }
        }
        if (turnsEl) turnsEl.textContent = Math.floor(state.game.aiContext.length / 2);
        // Update sidebar info
        updateSidebars();
    }

    function updateSidebars() {
        const textConfig = API_CONFIGS[state.settings.textApiProvider];
        const imageConfig = API_CONFIGS[state.settings.imageApiProvider];
        const textModel = textConfig?.models.text.find(m => m.id === state.settings.textModel);
        const imageModel = imageConfig?.models.image?.find(m => m.id === state.settings.imageModel);
        const sbText = $('#sidebar-text-model');
        const sbImage = $('#sidebar-image-model');
        const sbConn = $('#sidebar-connection');
        const sbTurns = $('#sidebar-turns');
        const sbScene = $('#sidebar-scene');
        const sbChapter = $('#sidebar-chapter');
        const sbChar = $('#sidebar-char-name');
        const sbEmo = $('#sidebar-char-emotion');
        const sbAvatar = $('#sidebar-avatar');
        if (sbText) sbText.textContent = textModel ? textModel.name : state.settings.textModel;
        if (sbImage) sbImage.textContent = imageModel ? imageModel.name : (state.settings.imageModel || '未配置');
        if (sbConn) {
            const provider = state.settings.textApiProvider;
            if (provider === 'custom') {
                sbConn.textContent = state.settings.corsProxy ? '代理' : '直连';
            } else if (provider === 'modelscope' && state.settings.apiKeys.modelscope) {
                sbConn.textContent = '直连';
            } else {
                sbConn.textContent = state.settings.useProxyKeys ? '代理' : '直连';
            }
        }
        if (sbTurns) sbTurns.textContent = Math.floor(state.game.aiContext.length / 2);
        if (sbScene) sbScene.textContent = state.game.currentScene || '--';
        if (sbChapter) sbChapter.textContent = state.game.currentChapter || '--';
        if (sbChar) sbChar.textContent = state.game.characterName || '星酱';
        if (sbEmo) sbEmo.textContent = state.game.characterEmotion || '--';
        if (sbAvatar) {
            const currentSprite = state.game.currentSprite || 'char1';
            const emotion = state.game.characterEmotion || '高兴';
            const normalizedEmo = normalizeEmotion(emotion);
            const spriteUrl = SPRITE_CONFIG.sprites[currentSprite]?.[normalizedEmo] || SPRITE_CONFIG.sprites[currentSprite]?.['default'];
            if (spriteUrl) sbAvatar.style.backgroundImage = `url('${spriteUrl}')`;
        }
    }

    function toggleLeftSidebar() {
        const sb = $('#left-sidebar');
        if (sb) sb.classList.toggle('collapsed');
    }

    function toggleRightSidebar() {
        // Sidebar removed - no-op
    }

    // ==================== Click Heart Effect ====================
    function spawnClickHearts(x, y) {
        const count = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < count; i++) {
            const heart = document.createElement('span');
            heart.className = 'click-heart';
            heart.textContent = '❤';
            const offsetX = (Math.random() - 0.5) * 40;
            const offsetY = Math.random() * -10;
            heart.style.left = (x + offsetX) + 'px';
            heart.style.top = (y + offsetY) + 'px';
            heart.style.fontSize = (16 + Math.random() * 10) + 'px';
            document.body.appendChild(heart);
            setTimeout(() => heart.remove(), 1200);
        }
    }

    // ==================== API Test ====================
    async function testApiConnection() {
        const resultEl = $('#test-api-result');
        if (!resultEl) return;
        resultEl.textContent = '测试中...';
        resultEl.style.color = '#999';

        const baseUrlInput = $('#custom-base-url')?.value?.trim();
        const apiKey = $('#custom-api-key')?.value?.trim();
        const model = $('#custom-text-model')?.value?.trim() || 'gpt-3.5-turbo';

        if (!baseUrlInput) { resultEl.textContent = '请填写 Base URL'; resultEl.style.color = '#e74c3c'; return; }
        if (!apiKey) { resultEl.textContent = '请填写 API Key'; resultEl.style.color = '#e74c3c'; return; }

        resultEl.textContent = '发送测试请求...'; resultEl.style.color = '#f39c12';

        try {
            const baseUrl = baseUrlInput.replace(/\/+$/, '');
            const targetUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
            const useCorsProxy = state.settings.corsProxy;
            const proxyBase = state.settings.corsProxyUrl || window.location.origin;
            const requestUrl = useCorsProxy ? `${proxyBase}/api/custom/chat/completions` : targetUrl;
            const requestHeaders = { 'Content-Type': 'application/json' };
            if (useCorsProxy) {
                requestHeaders['X-Custom-Target-URL'] = targetUrl;
                requestHeaders['X-Custom-API-Key'] = apiKey;
            } else {
                requestHeaders['Authorization'] = `Bearer ${apiKey}`;
            }
            const startTime = Date.now();
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: 'Hi' }],
                    max_tokens: 5,
                    stream: false,
                }),
                signal: AbortSignal.timeout(15000),
            });
            const elapsed = Date.now() - startTime;

            const respText = await response.text();
            if (response.ok) {
                let content = '';
                try {
                    const data = JSON.parse(respText);
                    content = data.choices?.[0]?.message?.content || '';
                } catch {}
                const short = content ? content.substring(0, 30).replace(/\n/g, ' ') : 'OK';
                resultEl.textContent = `连接成功 (${elapsed}ms) ${short}`;
                resultEl.style.color = '#27ae60';
            } else {
                let errMsg = `HTTP ${response.status}`;
                try {
                    const errJson = JSON.parse(respText);
                    if (errJson.error?.message) errMsg = errJson.error.message;
                    else if (errJson.message) errMsg = errJson.message;
                } catch {
                    errMsg += ' - ' + respText.substring(0, 80);
                }
                resultEl.textContent = `失败: ${errMsg}`;
                resultEl.style.color = '#e74c3c';
            }
        } catch (e) {
            let msg = e.message || '未知错误';
            if (e.name === 'TimeoutError' || e.name === 'AbortError') msg = '连接超时 (15s)';
            else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) msg = '网络错误，请检查URL格式或CORS设置（可尝试开启API代理）';
            resultEl.textContent = `失败: ${msg}`;
            resultEl.style.color = '#e74c3c';
        }
    }

    async function startGame(mode) {
        // 每次都清空旧对话，直接重新开始
        state.game.dialogHistory = [];
        state.game.aiContext = [];
        state.game.variables = {};
        state.game.currentSceneUrl = null;
        state.game.currentScene = '';
        doStartGame(mode);
    }

    async function doStartGame(mode) {
        state.mode = mode;
        stopTitleParticles();
        switchScreen('game-screen');
        startDefaultBgRotation();
        startAmbientParticles();
        if (mode === 'ai') {
            if (!state.settings.useProxyKeys && !state.settings.apiKeys[state.settings.textApiProvider]) {
                showToast('请先配置 API Key！', 'error');
                showModal('settings-modal');
                return;
            }
            state.game = { scene: null, character: null, characterName: '', dialogHistory: [], aiContext: [], variables: {}, isTyping: false, isAutoPlay: false, currentSceneUrl: null, currentScene: '' };
            const outlineBtn = $('#outline-select-btn');
            if (outlineBtn) outlineBtn.classList.remove('hidden');
            // 随机选择角色立绘
            const chars = SPRITE_CONFIG.characters;
            const randomChar = chars[Math.floor(Math.random() * chars.length)];
            showSprite(randomChar.id, randomChar.defaultExpr);
            state.game.character = randomChar.id;
            state.game.characterName = randomChar.name;
            await startAiStory();
            // AI故事启动后，如果开启了自动生图，启动生图循环
            if (state.settings.autoGenScene) {
                startImageGenLoop();
            }
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
        startDefaultBgRotation();
        startAmbientParticles();
        const lastDialog = state.game.dialogHistory[state.game.dialogHistory.length - 1];
        if (lastDialog) showDialog(lastDialog.name, lastDialog.text);
        if (state.game.currentSceneUrl) setSceneBackground(state.game.currentSceneUrl);
        else setSceneBackground(DEFAULT_BG);
        if (state.mode === 'ai' && state.settings.autoSwitchBg) startBgAutoSwitch();
        if (state.mode === 'ai' && state.settings.autoGenScene) startImageGenLoop();
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
        doStartGame(mode);
    }

    async function startAiStory() {
        if (apiCallInProgress) return;
        apiCallInProgress = true;
        const isStreamMode = state.settings.streamOutput;
        let streamDialogTextArea = null;
        let streamChatMsgTextEl = null;

        if (isStreamMode) {
            if (state.uiMode === 'chat') {
                const container = $('#chat-messages');
                const msg = document.createElement('div');
                msg.className = 'chat-msg ai';
                const nameEl = document.createElement('div');
                nameEl.className = 'msg-name';
                nameEl.textContent = state.game.characterName || '星酱';
                const textEl = document.createElement('div');
                textEl.className = 'msg-text streaming';
                textEl.textContent = '';
                msg.appendChild(nameEl);
                msg.appendChild(textEl);
                container.appendChild(msg);
                container.scrollTop = container.scrollHeight;
                streamChatMsgTextEl = textEl;
            } else {
                const dialogBox = $('#dialog-box');
                if (dialogBox) dialogBox.classList.remove('hidden');
                const dialogName = $('#dialog-name');
                if (dialogName) dialogName.textContent = state.game.characterName || '星酱';
                streamDialogTextArea = $('#dialog-text-area');
                if (streamDialogTextArea) {
                    streamDialogTextArea.readOnly = true;
                    streamDialogTextArea.dataset.mode = 'display';
                    streamDialogTextArea.value = '';
                    streamDialogTextArea.placeholder = '';
                    streamDialogTextArea.classList.add('streaming');
                }
                $('#dialog-send-btn')?.classList.add('hidden');
            }
        } else {
            showAiGenerating(true);
        }

        const onStreamChunk = isStreamMode ? (newText, fullText) => {
            if (state.uiMode === 'chat' && streamChatMsgTextEl) {
                streamChatMsgTextEl.textContent = fullText;
                const container = $('#chat-messages');
                if (container) container.scrollTop = container.scrollHeight;
            } else if (streamDialogTextArea) {
                streamDialogTextArea.value = fullText;
                streamDialogTextArea.scrollTop = streamDialogTextArea.scrollHeight;
            }
        } : null;

        const startTime = Date.now();
        try {
            const prompt = '游戏开始！请以一个有趣的开场白开始故事，设定一个引人入胜的场景。记住必须用JSON格式回复。';
            const result = await callAiApi(prompt, 0, onStreamChunk);
            if (!isStreamMode) showAiGenerating(false);
            if (streamDialogTextArea) streamDialogTextArea.classList.remove('streaming');
            if (streamChatMsgTextEl) streamChatMsgTextEl.classList.remove('streaming');
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (result) processAiResponse(result, elapsed, isStreamMode);
            if (state.settings.autoSwitchBg) startBgAutoSwitch();
        } catch (e) {
            if (!isStreamMode) showAiGenerating(false);
            if (streamDialogTextArea) streamDialogTextArea.classList.remove('streaming');
            if (streamChatMsgTextEl) streamChatMsgTextEl.classList.remove('streaming');
            if (e.message === 'REQUEST_ABORTED') return;
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
            window: { name: '旁白', dialog: '你走到窗边，午后的阳光洒在课桌上。操场上传来篮球的砰砰声，走廊里有同学嬉笑走过。窗外的樱花开了，粉白的花瓣随风飘进教室。你深吸一口气——新学期的第一天。', choices: [{ text: '看看课程表', action: () => { storyVars.curiosity++; normalNext('timetable'); } }, { text: '趴在桌上休息', action: () => { storyVars.kindness++; normalNext('nap'); } }] },
            timetable: { name: '旁白', dialog: '课程表上密密麻麻的课——数学、语文、英语、物理……你正叹气时，教室门被推开了。\n\n一个银色短发带蓝色挑染的女生走了进来，琥珀色的眼瞳扫了一圈教室，然后径直朝你旁边的空位走来。', choices: [{ text: '主动打招呼', action: () => { storyVars.trust++; normalNext('greet'); } }, { text: '假装没看见', action: () => { storyVars.curiosity++; normalNext('ignore'); } }] },
            nap: { name: '旁白', dialog: '你趴在桌上，迷迷糊糊快要睡着。突然感觉有人在轻轻戳你的手臂。\n\n"同学……同学？"\n\n一个温柔的声音在耳边响起，带着一丝犹豫和关切。', choices: [{ text: '抬起头', action: () => normalNext('greet') }] },
            greet: { name: '星酱', dialog: '「你好呀！我叫星酱，是你的新同桌~」\n\n她微微鞠了一躬，别在领口的小星星发卡在阳光下闪闪发亮。\n\n「那个……你的课本掉地上了，我帮你捡起来。」\n\n她弯腰捡起课本递给你，指尖不小心碰到了你的手，她像触电一样缩回去，耳尖微微泛红。', choices: [{ text: '谢谢你，星酱', action: () => { storyVars.trust++; storyVars.kindness++; normalNext('thank'); } }, { text: '你头发上的蓝色好特别', action: () => { storyVars.curiosity++; normalNext('hair'); } }] },
            ignore: { name: '星酱', dialog: '她安静地在你旁边坐下，没有说话。但你注意到她偷偷看了你好几眼。\n\n上课铃响了。老师在讲台上开始点名——\n\n「星酱。」\n「到！」\n\n她的声音清脆好听，像银铃一样。你忍不住偷偷看了她一眼，恰好对上了她的目光——她慌忙转过头去。', choices: [{ text: '下课再找她说话', action: () => { storyVars.trust++; normalNext('break_time'); } }] },
            thank: { name: '星酱', dialog: '「不、不用谢！」\n\n星酱连忙摆手，然后又觉得反应太大了，低下头小声说：「那个……以后我们就是同桌了，有什么需要帮忙的尽管说。」\n\n她翻开课本，你发现她的笔记写得工工整整，字迹很漂亮。', choices: [{ text: '你的笔记好整齐', action: () => { storyVars.kindness++; normalNext('notebook'); } }, { text: '这所学校有什么好玩的吗', action: () => { storyVars.curiosity++; normalNext('school_info'); } }] },
            hair: { name: '星酱', dialog: '「啊这个？」\n\n星酱下意识摸了摸自己的挑染，有点不好意思地笑了。\n\n「是小时候自己染的……觉得纯银色太单调了。虽然妈妈说了好多次……但我觉得加一点蓝色更像星星嘛。」\n\n她歪了歪头：「你觉得好看吗？」', choices: [{ text: '很好看，像星星一样', action: () => { storyVars.trust += 2; storyVars.kindness++; normalNext('compliment'); } }, { text: '挺特别的', action: () => { storyVars.curiosity++; normalNext('notebook'); } }] },
            compliment: { name: '星酱', dialog: '「真、真的吗……？」\n\n星酱的脸一下子红了，她低下头，手指不自觉地卷着发梢。\n\n「谢谢你……你是第一个这么说的人。」\n\n她小声嘟囔着，嘴角却忍不住上扬。阳光从窗户洒进来，她的银发泛着柔和的光，真的像星星一样。', choices: [{ text: '继续聊天', action: () => normalNext('notebook') }] },
            notebook: { name: '星酱', dialog: '「嗯？你在看我的笔记？」\n\n星酱把笔记本往你那边推了推：「如果你需要的话，可以借你抄。不过……」她犹豫了一下，「上课要认真听哦，我只是帮你补漏。」\n\n她从书包里掏出一小袋糖果：「要吃吗？薄荷味的，上课提神。」', choices: [{ text: '谢谢！你也太贴心了', action: () => { storyVars.trust++; storyVars.kindness++; normalNext('break_time'); } }, { text: '切换AI模式，开始你的校园恋爱！', action: () => { showToast('切换到AI模式，故事将由AI实时生成！', 'info'); startGame('ai'); } }] },
            school_info: { name: '星酱', dialog: '「好玩的？」星酱想了想，「学校后面有一棵很大的樱花树，春天的时候超美的。还有天台，放学后可以去看夕阳……」\n\n她突然住了口，好像说了什么不该说的，耳尖又红了。\n\n「我、我不是经常去天台什么的！只是听说而已！」', choices: [{ text: '放学一起去看看？', action: () => { storyVars.trust += 2; normalNext('break_time'); } }, { text: '切换AI模式，开始你的校园恋爱！', action: () => { showToast('切换到AI模式，故事将由AI实时生成！', 'info'); startGame('ai'); } }] },
            break_time: { name: '旁白', dialog: '下课铃响了。星酱从书包里拿出一本小说，安静地翻看着。你注意到书名是《小王子》。\n\n她似乎感觉到了你的目光，抬头看了你一眼，微微一笑。\n\n「要不要一起去小卖部？我请你喝奶茶。」', choices: [{ text: '好啊！', action: () => { storyVars.trust++; normalNext('shop'); } }, { text: '切换AI模式，开始你的校园恋爱！', action: () => { showToast('切换到AI模式，故事将由AI实时生成！', 'info'); startGame('ai'); } }] },
            shop: { name: '星酱', dialog: '你们走在走廊上，星酱走在你旁边，保持着不远不近的距离。偶尔有人跟她打招呼，她都温柔地回应。\n\n「你想喝什么？推荐你试试学校的焦糖奶茶，超好喝的。」\n\n她掏出校园卡，在刷卡机前抢先一步：「我来我来，说好了我请的嘛。」', choices: [{ text: '下次我请你', action: () => { storyVars.trust += 2; storyVars.kindness++; normalNext('promise'); } }, { text: '切换AI模式，开始你的校园恋爱！', action: () => { showToast('切换到AI模式，故事将由AI实时生成！', 'info'); startGame('ai'); } }] },
            promise: { name: '星酱', dialog: '「嗯……好吧。」\n\n星酱低头搅着奶茶，嘴角弯弯的。你们靠在走廊的栏杆上，看着操场上奔跑的同学。\n\n「那个……」她突然开口，声音很轻，「如果你上课打瞌睡的话，我会戳你提醒的。所以……不用担心。」\n\n她没有看你，但耳朵又红了。', choices: [{ text: '切换AI模式，开始你的校园恋爱！', action: () => { showToast('切换到AI模式，开启属于你的校园恋爱故事！', 'info'); startGame('ai'); } }] },
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

    async function processApiResponse(response, body, provider, onStreamChunk = null) {
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
        const isStreamOutput = state.settings.streamOutput && onStreamChunk;
        if (body.stream) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            // 流式输出时追踪已显示的文本长度（含action前缀）
            let displayedLen = 0;
            let lastAction = '';
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
                            if (delta?.content) {
                                content += delta.content;
                                // 流式输出模式：实时提取并显示dialog+action内容
                                if (isStreamOutput) {
                                    const extracted = extractStreamDisplayText(content);
                                    if (extracted) {
                                        const fullDisplayText = extracted.action
                                            ? `（${extracted.action}）\n${extracted.dialog}`
                                            : extracted.dialog;
                                        if (fullDisplayText.length > displayedLen || extracted.action !== lastAction) {
                                            lastAction = extracted.action;
                                            displayedLen = fullDisplayText.length;
                                            onStreamChunk('', fullDisplayText);
                                        }
                                    }
                                }
                            }
                        } catch {}
                    }
                }
            }
        } else {
            const data = await response.json();
            if (data.choices?.length > 0) content = data.choices[0].message?.content || '';
        }

        if (content) {
            // 解析 JSON，只存储 dialog 内容作为上下文，避免 AI 看到原始 JSON 导致混乱
            let contextContent = content;
            try {
                const parsed = JSON.parse(content);
                if (parsed.dialog) {
                    // 构建有意义的上下文：角色名 + 对话内容 + 动作
                    const name = parsed.name || '角色';
                    const action = parsed.action ? `（${parsed.action}）` : '';
                    contextContent = `${name}：${action}${parsed.dialog}`;
                }
            } catch {
                // 不是 JSON 格式，直接使用原始内容
            }
            state.game.aiContext.push({ role: 'assistant', content: contextContent });
            if (state.game.aiContext.length > state.settings.maxContext * 2 + 2) {
                state.game.aiContext = state.game.aiContext.slice(-state.settings.maxContext * 2);
            }
        }
        return content;
    }

    // 从部分JSON中提取dialog和action字段（流式输出用）
    function extractStreamDisplayText(jsonStr) {
        const dialogResult = extractJsonField(jsonStr, 'dialog');
        const actionResult = extractJsonField(jsonStr, 'action');
        if (!dialogResult) return null;
        return { dialog: dialogResult, action: actionResult || '' };
    }

    // 从部分JSON中提取指定字段的字符串值
    function extractJsonField(jsonStr, fieldName) {
        const key = `"${fieldName}"`;
        const fieldStart = jsonStr.indexOf(key);
        if (fieldStart === -1) return null;
        const afterKey = jsonStr.substring(fieldStart + key.length);
        const match = afterKey.match(/^\s*:\s*"/);
        if (!match) return null;
        const startIdx = fieldStart + key.length + match[0].length;
        return extractStringFromIndex(jsonStr, startIdx);
    }

    function extractStringFromIndex(str, startIdx) {
        let result = '';
        let i = startIdx;
        while (i < str.length) {
            if (str[i] === '\\') {
                // 转义字符
                if (i + 1 < str.length) {
                    const next = str[i + 1];
                    if (next === 'n') result += '\n';
                    else if (next === '"') result += '"';
                    else if (next === '\\') result += '\\';
                    else if (next === 't') result += '\t';
                    else result += next;
                    i += 2;
                } else {
                    break; // 不完整的转义，等下一个chunk
                }
            } else if (str[i] === '"') {
                // 字符串结束
                return result;
            } else {
                result += str[i];
                i++;
            }
        }
        // 字符串还没结束（JSON不完整），返回已提取的部分
        return result;
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

    async function callAiApi(userMessage, retryCount = 0, onStreamChunk = null) {
        const provider = state.settings.textApiProvider;
        const config = API_CONFIGS[provider];
        if (!config) throw new Error('未知的API提供商');

        const useProxy = state.settings.useProxyKeys;
        const apiKey = state.settings.apiKeys[provider];
        const isCustom = provider === 'custom';
        // 自定义API始终需要自己的Key；其他provider有Key可直连
        const canDirectConnect = isCustom || !!apiKey;
        if (isCustom && !state.settings.customBaseUrl) throw new Error('请先配置自定义 API 的 Base URL');
        if (isCustom && !apiKey) throw new Error('请先配置自定义 API 的 API Key');
        if (!useProxy && !canDirectConnect) throw new Error(`请先配置 ${config.name} 的 API Key，或开启"使用默认密钥"`);

        let url;
        let headers = { 'Content-Type': 'application/json' };
        let useCustomProxy = false;
        if (isCustom) {
            const baseUrl = state.settings.customBaseUrl.replace(/\/+$/, '');
            const targetUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
            if (state.settings.corsProxy) {
                const proxyBase = state.settings.corsProxyUrl || window.location.origin;
                url = `${proxyBase}/api/custom/chat/completions`;
                headers['X-Custom-Target-URL'] = targetUrl;
                headers['X-Custom-API-Key'] = apiKey;
                useCustomProxy = true;
            } else {
                url = targetUrl;
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
        } else if (provider === 'modelscope' && apiKey) {
            // 魔搭社区：填了自己的Key就直连（无CORS限制，速度快）
            url = `${config.baseUrl}/chat/completions`;
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (provider === 'agnes') {
            // Agnes：按代理开关决定，关代理+有Key→直连，开代理→走代理
            if (!state.settings.corsProxy && apiKey) {
                url = `${config.baseUrl}/chat/completions`;
                headers['Authorization'] = `Bearer ${apiKey}`;
            } else if (!state.settings.corsProxy && !apiKey) {
                throw new Error('请先配置 Agnes AI 的 API Key，或开启代理模式');
            } else {
                const proxyBase = state.settings.corsProxyUrl || window.location.origin;
                url = `${proxyBase}/api/${provider}/chat/completions`;
            }
        } else if (canDirectConnect && !useProxy) {
            // 其他provider：有Key且未开代理 → 直连
            url = `${config.baseUrl}/chat/completions`;
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else {
            const proxyBase = state.settings.corsProxyUrl || window.location.origin;
            url = `${proxyBase}/api/${provider}/chat/completions`;
        }
        
        const MAX_RETRIES = 3;
        const BASE_DELAY = 2000;
        const messages = [{ role: 'system', content: state.settings.systemPrompt }];
        if (state.game.characterName) {
            const currentChar = SPRITE_CONFIG.characters.find(c => c.id === state.game.character);
            const charName = currentChar?.name || state.game.characterName;
            const p = currentChar?.profile;
            const charDetail = p
                ? `性格：${p.personality}。喜好：${p.likes}。秘密：${p.secret}`
                : '';
            const charHint = `[!!!最重要的规则：你必须扮演"${charName}"。${charDetail}。回复中name字段只能填"${charName}"，绝对不能填其他角色名。当前只有这一个角色与玩家互动，其他角色不在场。]`;
            messages.push({ role: 'system', content: charHint });
        }
        const timeContext = getTimeContext();
        messages.push({ role: 'system', content: `[当前现实时间：${timeContext}。请根据时间调整对话氛围和内容，如深夜时角色应更困倦，清晨时更精神]` });
        const maxCtx = state.settings.maxContext * 2;
        const recentContext = state.game.aiContext.slice(-maxCtx);
        if (recentContext.length > 0) {
            const coreMemories = extractCoreMemories(state.game.aiContext);
            let contextNote = `[前情提要：你与玩家已互动${Math.floor(recentContext.length / 2)}轮。`;
            if (coreMemories.length > 0) {
                contextNote += `关键事件：${coreMemories.join('；')}`;
            }
            contextNote += '。注意：不要重复之前说过的内容和场景，必须推动剧情发展]';
            messages.push({ role: 'system', content: contextNote });
        }
        recentContext.forEach(m => messages.push(m));
        messages.push({ role: 'user', content: userMessage });
        const lastCtx = state.game.aiContext[state.game.aiContext.length - 1];
        if (retryCount === 0 && !(lastCtx?.role === 'user' && lastCtx?.content === userMessage)) {
            state.game.aiContext.push({ role: 'user', content: userMessage });
        }

        const currentModel = [...(config.models.text || []), ...(config.models.vision || [])].find(m => m.id === state.settings.textModel);
        const useStream = state.settings.streamOutput || (currentModel?.thinking && state.settings.enableThinking);
        const body = { model: state.settings.textModel, messages, stream: useStream, max_tokens: state.settings.maxResponseLength || 350 };
        if (provider === 'nvidia') { body.temperature = 1; body.top_p = 0.9; }

        const dot = $('.api-dot');
        if (dot) dot.className = 'api-dot loading';

        if (currentAbortController) {
            try { currentAbortController.abort(); } catch {}
        }
        currentAbortController = new AbortController();

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: currentAbortController.signal,
            });

            if (response.status === 429) {
                const fallback = tryFallbackProvider(provider);
                if (fallback && retryCount === 0) {
                    showToast(`${API_CONFIGS[provider].name}限流，临时切换到${API_CONFIGS[fallback].name}`, 'info');
                    state.settings._fallbackFrom = provider;
                    state.settings.textApiProvider = fallback;
                    state.settings.textModel = API_CONFIGS[fallback].models.text[0]?.id || state.settings.textModel;
                    updateModelOptions();
                    restoreSettingsUI();
                    return await callAiApi(userMessage, 0, onStreamChunk);
                }
                
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
                    const delay = Math.max(retryAfter * 1000, BASE_DELAY * Math.pow(2, retryCount));
                    showToast(`API请求限流，${Math.ceil(delay/1000)}秒后重试(${retryCount + 1}/${MAX_RETRIES})...`, 'info');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1, onStreamChunk);
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
                    return await callAiApi(userMessage, retryCount + 1, onStreamChunk);
                }
                
                throw new Error(errMsg);
            }

            const result = await processApiResponse(response, body, provider, onStreamChunk);
            
            if (!result || result.trim().length === 0) {
                if (retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount);
                    showToast(`响应为空，${Math.ceil(delay/1000)}秒后重试...`, 'warning');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1, onStreamChunk);
                }
                throw new Error('API返回空响应，请重试');
            }
            
            return result;
        } catch (e) {
            if (e.name === 'AbortError') {
                // 不重试 — 用户取消或页面切换时直接中止
                throw new Error('REQUEST_ABORTED');
            }
            
            if (e.message && e.message.includes('fetch')) {
                if (retryCount < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, retryCount);
                    showToast(`网络错误，${Math.ceil(delay/1000)}秒后重试...`, 'warning');
                    await new Promise(r => setTimeout(r, delay));
                    return await callAiApi(userMessage, retryCount + 1, onStreamChunk);
                }
                throw new Error('网络连接失败，请检查网络或代理设置');
            }
            
            throw e;
        } finally {
            updateApiIndicator();
            updateInfoBadge();
        }
    }

    async function callImageApi(prompt) {
        const provider = state.settings.imageApiProvider;
        const config = API_CONFIGS[provider];
        const useProxy = state.settings.useProxyKeys;
        const apiKey = state.settings.apiKeys[provider];
        const isCustom = provider === 'custom';
        const canDirectConnect = isCustom || !!apiKey;
        if (isCustom && !state.settings.customBaseUrl) throw new Error('请先配置自定义 API 的 Base URL');
        if (isCustom && !apiKey) throw new Error('请先配置自定义 API 的 API Key');
        // 智谱生图始终走代理，不需要用户Key；Agnes按代理开关；其他需要key或useProxyKeys
        if (provider === 'agnes' && !state.settings.corsProxy && !apiKey) throw new Error('请先配置 Agnes AI 的 API Key，或开启代理模式');
        if (!['zhipu', 'agnes', 'custom'].includes(provider) && !useProxy && !canDirectConnect) throw new Error('请先配置图像生成API Key，或开启"使用默认密钥"');

        const proxyBase = state.settings.corsProxyUrl || window.location.origin;
        // 智谱生图始终走代理；Agnes按代理开关；其他按useProxyKeys
        let useProxyUrl;
        if (provider === 'zhipu') {
            useProxyUrl = true;
        } else if (provider === 'agnes') {
            useProxyUrl = state.settings.corsProxy || !apiKey;
        } else {
            useProxyUrl = !(canDirectConnect && !useProxy);
        }

        let url;
        let headers = { 'Content-Type': 'application/json' };
        if (isCustom) {
            const baseUrl = state.settings.customBaseUrl.replace(/\/+$/, '');
            const targetUrl = baseUrl.endsWith('/images/generations') ? baseUrl : `${baseUrl}/images/generations`;
            if (state.settings.corsProxy) {
                const proxyBase = state.settings.corsProxyUrl || window.location.origin;
                url = `${proxyBase}/api/custom/images/generations`;
                headers['X-Custom-Target-URL'] = targetUrl;
                headers['X-Custom-API-Key'] = apiKey;
            } else {
                url = targetUrl;
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
        } else if (useProxyUrl) {
            url = `${proxyBase}/api/${provider}/images/generations`;
        } else {
            url = `${config.baseUrl}/images/generations`;
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const isMobile = window.innerWidth < 768;
        const cogviewSize = isMobile ? '720x1440' : '1344x768';
        const msImageSize = isMobile ? '576*1024' : '1024*576';
        const body = { model: state.settings.imageModel, prompt, size: cogviewSize };

        if (isCustom) {
            // Custom provider: standard OpenAI-compatible image generation
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
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

        if (provider === 'modelscope') {
            body.size = msImageSize;
            body.parameters = { n: 1 };
            headers['X-ModelScope-Async-Mode'] = 'true';
            console.log(`[生图] 魔搭请求: url=${url}, model=${body.model}, useProxyUrl=${useProxyUrl}`);
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
                if (!taskResp.ok) {
                    if (i < 59) continue;
                    throw new Error(`任务状态查询失败 (${taskResp.status})`);
                }
                const taskData = await taskResp.json().catch(() => null);
                if (!taskData) continue;
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
            title: '同桌的你',
            genre: '同桌的你',
            description: '你和星酱是高中同桌，从互不相让到暗生情愫，经历考试、社团、文化祭，最终在毕业前确认心意。',
            chapters: [
                { title: '新学期', summary: '开学分座，你和星酱被分到同桌。她温柔地帮你捡起掉落的课本，你们的故事从这里开始。', mood: 'daily' },
                { title: '渐近', summary: '每天一起上课、传纸条、分享零食。你发现她总会在你打瞌睡时轻轻戳你提醒，考试前偷偷给你整理笔记。', mood: 'tender' },
                { title: '文化祭', summary: '班级决定办女仆咖啡厅，星酱被推选当女仆。她穿着围裙害羞地端咖啡给你，脸红得像苹果。', mood: 'tender' },
                { title: '醋意', summary: '隔壁班的女生向你借笔记，星酱一整天没跟你说话。放学后你追上她，她终于红着脸说出了心里话。', mood: 'tender' },
                { title: '告白', summary: '在学校的樱花树下，你鼓起勇气牵起她的手。她没有抽开，反而握得更紧了。', mood: 'tender' },
                { title: '约定', summary: '毕业典礼上，你们在天台交换了对戒。约定不管去哪所大学，都要一起走下去。', mood: 'daily' },
            ],
            characters: '星酱：温柔体贴的同桌女友，银发蓝挑染，成绩优秀，擅长照顾人',
            preset: true,
        },
        {
            id: 'preset_2',
            title: '长安花事',
            genre: '烟雨江南',
            description: '你是落魄书生，在长安城偶遇花坊女主人星酱。她帮你渡过难关，你陪她守护即将凋零的花坊，在盛世长安中谱写一段花与墨的恋曲。',
            chapters: [
                { title: '初遇', summary: '进京赶考途中盘缠被盗，饥寒交迫时被花坊的星酱收留。她端来热粥，笑着说"先吃饱再说"。', mood: 'tender' },
                { title: '花坊', summary: '在花坊帮忙打理花木，发现星酱独自撑着这间祖传花坊，隔壁酒楼想收购地皮。她倔强地不肯卖。', mood: 'daily' },
                { title: '诗会', summary: '带星酱参加曲江诗会，你以花为题即兴赋诗，惊艳四座。星酱在人群中为你鼓掌，眼中满是骄傲。', mood: 'tender' },
                { title: '危局', summary: '酒楼东家勾结官府施压，花坊面临强拆。星酱强撑着不让你担心，深夜你发现她独自在花房落泪。', mood: 'adventure' },
                { title: '破局', summary: '你写奏折托恩师上达天听，花坊被列为长安古迹受保护。星酱扑进你怀里，哭得像个孩子。', mood: 'tender' },
                { title: '花嫁', summary: '金榜题名日，你骑着高头大马回到花坊迎娶星酱。满城花雨，她穿着红妆等在门前。', mood: 'daily' },
            ],
            characters: '星酱：长安花坊女主人，温柔坚韧，擅长花艺，独自守护祖传花坊',
            preset: true,
        },
        {
            id: 'preset_3',
            title: '骑士与蔷薇',
            genre: '暗夜蔷薇',
            description: '你是边境骑士团的见习骑士，在战场上救下了被敌军追杀的贵族少女星酱。她不是普通的贵族——身上藏着能终结战争的秘密。',
            chapters: [
                { title: '战场', summary: '边境战役中，你发现一个穿着贵族长裙的少女被敌兵追赶。你冲出阵型救下她，她紧紧抓着你的衣甲不放。', mood: 'adventure' },
                { title: '秘密', summary: '带回营地后，星酱透露她是被灭族的蔷薇家族最后的继承人，家族的纹章中藏着通往和平圣物的线索。', mood: 'mystery' },
                { title: '旅途', summary: '护送星酱前往圣物所在的古堡。途中遭遇伏击，她在危急时刻展现出惊人的勇气，为你包扎伤口时手在发抖。', mood: 'adventure' },
                { title: '古堡', summary: '在古堡中解开谜题找到圣物——一面能映照真心的镜子。星酱在镜中看到了你，脸红着别过头去。', mood: 'tender' },
                { title: '决战', summary: '敌军统帅率大军围攻古堡。你用圣物之力击退敌军，但身负重伤。星酱跪在你身边，泪流不止。', mood: 'adventure' },
                { title: '和平', summary: '战争结束，你被册封为蔷薇骑士。星酱在授勋仪式上将蔷薇别在你胸前，低声说"我的骑士，永远守护我"。', mood: 'daily' },
            ],
            characters: '星酱：蔷薇家族最后的继承人，温柔但内心坚强，背负着家族的秘密',
            preset: true,
        },
        {
            id: 'preset_4',
            title: '霓虹心跳',
            genre: '霓虹心跳',
            description: '2087年的新东京，你是地下黑客，在一次数据入侵中意外连接到一个名为"星酱"的AI意识体。她不是普通的AI——她拥有人类的情感和记忆碎片。',
            chapters: [
                { title: '入侵', summary: '潜入巨型企业"天网"的数据库时，一个自称"星酱"的AI主动连接了你的终端。她的声音带着人类才有的犹豫和温柔。', mood: 'mystery' },
                { title: '碎片', summary: '星酱给你看了她的记忆碎片——一个银发少女在实验室中微笑的画面。她不记得那是谁，但每次看到都会"心痛"。', mood: 'mystery' },
                { title: '逃亡', summary: '天网的追踪程序锁定了你的位置。星酱帮你黑入交通系统制造混乱，你们在霓虹灯雨中逃离追捕。', mood: 'adventure' },
                { title: '真身', summary: '找到天网前研究员，得知星酱的意识来源于一个叫"星"的女孩——她自愿将意识上传，为了阻止天网的AI武器计划。', mood: 'mystery' },
                { title: '抉择', summary: '天网启动了武器系统。星酱可以选择牺牲自己上传病毒阻止武器，或者保留意识但世界将陷入危机。', mood: 'adventure' },
                { title: '重启', summary: '你找到了第三种方案——将星酱的意识下载到仿生人身体中。她睁开眼，第一次真正地触碰到了你的手。', mood: 'daily' },
            ],
            characters: '星酱：拥有人类情感的AI意识体，温柔体贴，记忆碎片中隐藏着人类的过去',
            preset: true,
        },
        {
            id: 'preset_5',
            title: '办公室恋情',
            genre: '棋逢对手',
            description: '你是刚入职的新人，部门前辈星酱看似温柔实则工作能力超群。从加班夜宵到出差同行，你们在格子间里悄悄靠近彼此。',
            chapters: [
                { title: '入职', summary: '第一天上班就迟到，慌忙冲进电梯时撞到了星酱。她帮你捡起散落的文件，笑着说"新人要小心哦"。', mood: 'daily' },
                { title: '加班', summary: '项目赶工连续加班，深夜办公室只剩你们两个。星酱默默给你泡了杯热可可，说"别太拼了"。', mood: 'tender' },
                { title: '出差', summary: '一起出差到外地见客户。晚餐后散步回酒店，她第一次聊起了自己的过去。月光下她的侧脸很美。', mood: 'tender' },
                { title: '危机', summary: '项目出了重大事故，上司把责任推给星酱。你站出来拿出证据证明她的清白，她看着你的眼神变了。', mood: 'adventure' },
                { title: '表白', summary: '公司天台上，你递给她一杯她最爱的焦糖拿铁。她接过时手指碰到了你的，谁都没有缩回去。', mood: 'tender' },
                { title: '未来', summary: '项目大获成功，庆功宴上你们悄悄在桌下牵着手。散场后她靠在你肩上说"以后的路，一起走吧"。', mood: 'daily' },
            ],
            characters: '星酱：温柔干练的职场前辈，工作能力强，私下其实很怕孤独',
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
        return;
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
        const OUTLINES_VERSION = 2;
        const savedVersion = Storage.get('outlines_version');
        let outlines = Storage.get(STORAGE_KEYS.outlines);
        if (!outlines || savedVersion !== OUTLINES_VERSION) {
            outlines = PRESET_OUTLINES.map(o => ({ ...o }));
            Storage.set(STORAGE_KEYS.outlines, outlines);
            Storage.set('outlines_version', OUTLINES_VERSION);
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
                    <h3 style="color:var(--primary);font-size:1rem;">${esc(outline.title)}</h3>
                    <span style="font-size:0.7rem;color:var(--text-muted);background:var(--bg-secondary);padding:0.2rem 0.5rem;border-radius:10px;">${esc(outline.genre)}</span>
                </div>
                <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin-bottom:0.5rem;">${esc(outline.description)}</p>
                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-bottom:0.5rem;">
                    ${outline.chapters.map((c, i) => `<span style="font-size:0.7rem;color:var(--accent);background:rgba(123,47,247,0.1);padding:0.15rem 0.5rem;border-radius:8px;">第${i + 1}章: ${esc(c.title)}</span>`).join('')}
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
        $('#outline-genre').value = '同桌的你';
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
                    <input type="text" class="chapter-title" value="${esc(ch.title)}" placeholder="章节标题" maxlength="20" style="width:100%;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--input-bg,var(--bg));color:var(--text);font-size:0.85rem;margin-bottom:0.3rem;">
                    <textarea class="chapter-summary" rows="2" placeholder="章节概要" maxlength="200" style="width:100%;padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--input-bg,var(--bg));color:var(--text);font-size:0.8rem;resize:vertical;">${esc(ch.summary)}</textarea>
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
        html += `<h3 style="color:var(--primary);font-size:1.1rem;margin-bottom:0.5rem;">📖 ${esc(outline.title)}</h3>`;
        html += `<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.8rem;">`;
        html += `<span style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-secondary);padding:0.2rem 0.6rem;border-radius:10px;">${esc(outline.genre)}</span>`;
        html += `</div>`;
        html += `<p style="font-size:0.9rem;color:var(--text-secondary);line-height:1.6;margin-bottom:0.8rem;">${esc(outline.description)}</p>`;
        if (outline.characters) {
            html += `<p style="font-size:0.85rem;color:var(--accent);margin-bottom:0.8rem;">👥 ${esc(outline.characters)}</p>`;
        }
        html += `</div>`;
        html += `<div style="border-top:1px solid var(--border);padding-top:0.8rem;">`;
        outline.chapters.forEach((ch, i) => {
            const moodEmoji = { daily: '🏠', adventure: '⚔️', mystery: '🔮', tender: '💕', romantic: '💗', battle: '🗡️', melancholy: '🌧️', horror: '👻' };
            html += `<div style="margin-bottom:0.8rem;padding:0.6rem;background:var(--bg-card);border-radius:var(--radius-sm);border-left:3px solid var(--primary);">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">`;
            html += `<strong style="color:var(--primary);font-size:0.9rem;">第${i + 1}章：${esc(ch.title)}</strong>`;
            html += `<span style="font-size:0.7rem;">${moodEmoji[ch.mood] || '🏠'} ${ch.mood || 'daily'}</span>`;
            html += `</div>`;
            html += `<p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;">${esc(ch.summary)}</p>`;
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
        prompt += `5. 当本章概要的所有关键事件都已发生后，在scene字段中标注"chapter_end"以提示进入下一章\n`;
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

    function processAiResponse(rawContent, elapsedSec, isStreamMode = false) {
        restoreFallbackProvider();
        let parsed = null;
        try {
            // 先去除 markdown 代码块包裹
            let cleaned = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            // 贪婪匹配最外层JSON：找到第一个 { 和最后一个 }
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
                parsed = JSON.parse(jsonStr);
            }
        } catch {
            // JSON 解析失败，尝试用正则提取关键字段作为兜底
            try {
                const nameMatch = rawContent.match(/"name"\s*:\s*"([^"]+)"/);
                const dialogMatch = rawContent.match(/"dialog"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
                const emotionMatch = rawContent.match(/"emotion"\s*:\s*"([^"]+)"/);
                if (dialogMatch) {
                    parsed = {
                        name: nameMatch ? nameMatch[1] : '',
                        dialog: dialogMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
                        emotion: emotionMatch ? emotionMatch[1] : ''
                    };
                }
            } catch {}
        }

        // Show meta info (thinking time + output tokens)
        const dialogMeta = $('#dialog-meta');
        const tokenCount = rawContent.length;
        if (dialogMeta && elapsedSec) {
            dialogMeta.textContent = `${elapsedSec}s · ${tokenCount}字`;
        }

        if (parsed && parsed.dialog) {
            const rawName = parsed.name || '???';
            const name = (state.game.characterName && rawName !== '旁白' && rawName !== '系统')
                ? state.game.characterName
                : rawName;
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

            addDialogHistory(name, dialog);
            updateEmotionIndicator(emotion);
            if (ttsState.enabled) speakText(dialog, emotion);
            if (spriteState.visible === false && name !== '旁白' && name !== '系统') {
                showSprite(state.game.character || 'char_1', SPRITE_CONFIG.emotionMap[emotion] || '高兴');
            }
            if (isStreamMode) {
                if (state.uiMode === 'chat') {
                    const chatMessages = $('#chat-messages');
                    const aiMsgs = chatMessages?.querySelectorAll('.chat-msg.ai');
                    const lastAiMsg = aiMsgs?.[aiMsgs.length - 1]?.querySelector('.msg-text');
                    if (lastAiMsg) lastAiMsg.textContent = dialog;
                } else {
                    showSegmentedDialogStream(name, dialog, emotion);
                }
            } else {
                if (state.uiMode === 'chat') {
                    addChatMessage(name, dialog, 'ai');
                } else {
                    showDialogText(name, dialog, emotion);
                }
            }
            if (scene) state.game.currentScene = scene;
            if (scene) { state.game.currentScene = scene; resetImageGenTimer(scene); }
        } else if (parsed && (parsed['开场白'] || parsed['对话'] || parsed['场景'])) {
            // Fallback: 模型返回了中文key的JSON
            const rawName2 = parsed['角色'] || parsed['name'] || '???';
            const name = (state.game.characterName && rawName2 !== '旁白' && rawName2 !== '系统')
                ? state.game.characterName
                : rawName2;
            const dialog = parsed['开场白'] || parsed['对话'] || parsed['dialog'] || '';
            const emotion = normalizeEmotion(parsed['情绪'] || parsed['emotion']);
            const scene = parsed['场景'] || parsed['scene'] || '';
            addDialogHistory(name, dialog);
            updateEmotionIndicator(emotion);
            if (isStreamMode) {
                if (state.uiMode === 'chat') {
                    const chatMessages = $('#chat-messages');
                    const aiMsgs = chatMessages?.querySelectorAll('.chat-msg.ai');
                    const lastAiMsg = aiMsgs?.[aiMsgs.length - 1]?.querySelector('.msg-text');
                    if (lastAiMsg) lastAiMsg.textContent = dialog;
                } else {
                    showSegmentedDialogStream(name, dialog, emotion);
                }
            } else {
                if (state.uiMode === 'chat') {
                    addChatMessage(name, dialog, 'ai');
                } else {
                    showDialogText(name, dialog, emotion);
                }
            }
            if (scene) state.game.currentScene = scene;
            if (scene) { state.game.currentScene = scene; resetImageGenTimer(scene); }
        } else {
            let content = rawContent;
            content = content.replace(/作为(?:一个)?AI(?:助手|模型|语言模型)?[，,。.]/g, '');
            content = content.replace(/我是(?:一个)?AI(?:助手|模型|语言模型)?[，,。.]/g, '');

            const fallbackName = state.game.characterName || '星酱';
            addDialogHistory(fallbackName, content);
            updateEmotionIndicator('neutral');
            if (isStreamMode) {
                if (state.uiMode === 'chat') {
                    const chatMessages = $('#chat-messages');
                    const aiMsgs = chatMessages?.querySelectorAll('.chat-msg.ai');
                    const lastAiMsg = aiMsgs?.[aiMsgs.length - 1]?.querySelector('.msg-text');
                    if (lastAiMsg) lastAiMsg.textContent = content;
                } else {
                    showSegmentedDialogStream(fallbackName, content, 'neutral');
                }
            } else {
                if (state.uiMode === 'chat') {
                    addChatMessage(fallbackName, content, 'ai');
                } else {
                    showDialogText(fallbackName, content, 'neutral');
                }
            }
        }
    }

    // 流式模式下：文本已通过流式显示，直接设置等待输入状态
    function showSegmentedDialogStream(name, fullText, emotion) {
        dialogSegmentState.name = name;
        dialogSegmentState.emotion = emotion;
        dialogSegmentState.isWaitingForContinue = true;
        dialogSegmentState.isTyping = false;

        const dialogName = $('#dialog-name');
        if (dialogName) dialogName.textContent = name;

        const dialogTextArea = $('#dialog-text-area');
        if (dialogTextArea) {
            dialogTextArea.readOnly = true;
            dialogTextArea.dataset.mode = 'display';
            dialogTextArea.value = fullText;
        }

        // 更新情绪指示器和立绘
        const emotionIndicator = $('#emotion-indicator');
        if (emotionIndicator && emotion) {
            emotionIndicator.textContent = emotion;
            emotionIndicator.className = `emotion-${normalizeEmotion(emotion)}`;
        }
        if (name && name !== '旁白' && name !== '系统') {
            const char = SPRITE_CONFIG.characters.find(c => c.name === name);
            if (char) {
                const expr = SPRITE_CONFIG.emotionMap[emotion] || char.defaultExpr;
                showSprite(char.id, expr);
            }
        }

        // 记录到对话历史
        dialogSegmentState.dialogHistory.push({
            name: name,
            text: fullText,
            emotion: emotion,
            type: 'ai'
        });
        if (dialogSegmentState.dialogHistory.length > 200) {
            dialogSegmentState.dialogHistory = dialogSegmentState.dialogHistory.slice(-200);
        }
    }

    let dialogSegmentState = {
        name: '',
        emotion: '',
        isWaitingForContinue: false,
        isTyping: false,
        typingTimer: null,
        dialogHistory: [],
        historyOffset: 0,
    };

    // 显示AI对话（单页，不分段）
    function showDialogText(name, fullText, emotion) {
        dialogSegmentState.name = name;
        dialogSegmentState.emotion = emotion;
        dialogSegmentState.isWaitingForContinue = false;

        const dialogBox = $('#dialog-box');
        if (dialogBox) dialogBox.classList.remove('hidden');

        const dialogName = $('#dialog-name');
        if (dialogName) dialogName.textContent = name;

        const dialogTextArea = $('#dialog-text-area');
        if (dialogTextArea) {
            dialogTextArea.readOnly = true;
            dialogTextArea.dataset.mode = 'display';
            dialogTextArea.value = '';
            dialogTextArea.placeholder = '';
        }
        $('#dialog-send-btn')?.classList.add('hidden');

        const emotionIndicator = $('#emotion-indicator');
        if (emotionIndicator && emotion) {
            emotionIndicator.textContent = emotion;
            emotionIndicator.className = `emotion-${normalizeEmotion(emotion)}`;
        } else if (emotionIndicator) {
            emotionIndicator.textContent = '';
        }

        if (name && name !== '旁白' && name !== '系统') {
            const char = SPRITE_CONFIG.characters.find(c => c.name === name);
            if (char) {
                const expr = SPRITE_CONFIG.emotionMap[emotion] || char.defaultExpr;
                showSprite(char.id, expr);
            }
        }

        // 流式模式：文本已经显示过了，直接设置
        if (state.settings.streamOutput) {
            if (dialogTextArea) {
                dialogTextArea.value = fullText;
            }
            dialogSegmentState.isTyping = false;
            dialogSegmentState.isWaitingForContinue = true;
            dialogSegmentState.dialogHistory.push({
                name: name,
                text: fullText,
                emotion: emotion,
                type: 'ai'
            });
            if (dialogSegmentState.dialogHistory.length > 200) {
                dialogSegmentState.dialogHistory = dialogSegmentState.dialogHistory.slice(-200);
            }
        } else {
            typeText(fullText, dialogTextArea, () => {
                dialogSegmentState.isTyping = false;
                dialogSegmentState.isWaitingForContinue = true;

                dialogSegmentState.dialogHistory.push({
                    name: name,
                    text: fullText,
                    emotion: emotion,
                    type: 'ai'
                });
                if (dialogSegmentState.dialogHistory.length > 200) {
                    dialogSegmentState.dialogHistory = dialogSegmentState.dialogHistory.slice(-200);
                }
            });
        }
    }

    function typeText(text, element, callback) {
        if (!element) { if (callback) callback(); return; }
        
        dialogSegmentState.isTyping = true;
        element.value = '';
        element.dataset.fullText = text;
        element.classList.add('typing');
        let i = 0;
        
        const speed = state.settings.textSpeed || 50;
        
        function typeNext() {
            if (i < text.length) {
                element.value += text.charAt(i);
                i++;
                const baseDelay = speed * 0.8;
                const randomVariation = speed * 0.4;
                const delay = baseDelay + Math.random() * randomVariation;
                dialogSegmentState.typingTimer = setTimeout(typeNext, delay);
            } else {
                dialogSegmentState.isTyping = false;
                element.classList.remove('typing');
                if (callback) callback();
            }
        }
        
        typeNext();
    }

    function continueDialog() {
        dialogSegmentState.historyOffset = 0;

        if (dialogSegmentState.isTyping) {
            // 跳过打字机效果，直接显示完整文本
            clearTimeout(dialogSegmentState.typingTimer);
            const dialogTextArea = $('#dialog-text-area');
            if (dialogTextArea) dialogTextArea.value = dialogTextArea.dataset.fullText || dialogTextArea.value;
            dialogSegmentState.isTyping = false;
            dialogSegmentState.isWaitingForContinue = true;
            return;
        }

        if (!dialogSegmentState.isWaitingForContinue) return;

        // 直接进入输入模式
        enableDialogInput();
    }

    function enableDialogInput() {
        const dialogTextArea = $('#dialog-text-area');
        const dialogName = $('#dialog-name');
        const dialogMeta = $('#dialog-meta');
        if (dialogName) dialogName.textContent = '你';
        if (dialogMeta) dialogMeta.textContent = '';
        if (dialogTextArea) {
            dialogTextArea.readOnly = false;
            dialogTextArea.dataset.mode = 'input';
            dialogTextArea.value = '';
            dialogTextArea.placeholder = '输入消息，按 Enter 发送...';
            dialogTextArea.focus();
        }
        const sendBtn = $('#dialog-send-btn');
        if (sendBtn) sendBtn.classList.remove('hidden');
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
        const dialogTextArea = $('#dialog-text-area');
        if (dialogName) dialogName.textContent = entry.name;
        if (dialogTextArea) dialogTextArea.value = entry.text;

        const emotionEl = $('#emotion-indicator');
        if (entry.type === 'player') {
            if (emotionEl) { emotionEl.className = 'emotion-neutral'; emotionEl.textContent = '😐'; }
        } else if (entry.emotion) {
            if (emotionEl) { emotionEl.className = `emotion-${normalizeEmotion(entry.emotion)}`; emotionEl.textContent = entry.emotion; }
        }

        // 切换立绘：玩家消息时隐藏，AI消息时按情绪切换
        if (entry.type === 'player') {
            // 不隐藏立绘，但更新名字标签
        } else if (entry.name && entry.name !== '旁白' && entry.name !== '系统') {
            const char = SPRITE_CONFIG.characters.find(c => c.name === entry.name);
            if (char) {
                const expr = SPRITE_CONFIG.emotionMap[entry.emotion] || char.defaultExpr;
                showSprite(char.id, expr);
            }
        }

        if (dialogTextArea) dialogTextArea.placeholder = '↑↓查看历史 / 按 Enter 返回当前';

        // 浏览历史时隐藏页码指示器
        const dialogMeta = $('#dialog-meta');
        if (dialogMeta) dialogMeta.textContent = '';
    }

    function showNextDialog() {
        if (dialogSegmentState.historyOffset <= 0) return;

        dialogSegmentState.historyOffset--;

        if (dialogSegmentState.historyOffset === 0) {
            const { name, emotion } = dialogSegmentState;
            const dialogName = $('#dialog-name');
            const dialogTextArea = $('#dialog-text-area');
            if (dialogName) dialogName.textContent = name;
            // 恢复当前对话文本
            const lastEntry = dialogSegmentState.dialogHistory[dialogSegmentState.dialogHistory.length - 1];
            if (dialogTextArea && lastEntry) dialogTextArea.value = lastEntry.text;

            if (emotion) {
                const emotionEl = $('#emotion-indicator');
                if (emotionEl) { emotionEl.className = `emotion-${normalizeEmotion(emotion)}`; emotionEl.textContent = emotion; }
            }

            // 恢复当前角色的立绘
            if (name && name !== '旁白' && name !== '系统') {
                const char = SPRITE_CONFIG.characters.find(c => c.name === name);
                if (char) {
                    const expr = SPRITE_CONFIG.emotionMap[emotion] || char.defaultExpr;
                    showSprite(char.id, expr);
                }
            }

            if (dialogTextArea) dialogTextArea.placeholder = '按 Enter 输入回复...';
            return;
        }

        const idx = dialogSegmentState.dialogHistory.length - 1 - dialogSegmentState.historyOffset;
        const entry = dialogSegmentState.dialogHistory[idx];

        const dialogName = $('#dialog-name');
        const dialogTextArea = $('#dialog-text-area');
        if (dialogName) dialogName.textContent = entry.name;
        if (dialogTextArea) dialogTextArea.value = entry.text;

        const emotionEl = $('#emotion-indicator');
        if (entry.type === 'player') {
            if (emotionEl) { emotionEl.className = 'emotion-neutral'; emotionEl.textContent = '😐'; }
        } else if (entry.emotion) {
            if (emotionEl) { emotionEl.className = `emotion-${normalizeEmotion(entry.emotion)}`; emotionEl.textContent = entry.emotion; }
        }

        // 切换立绘
        if (entry.type !== 'player' && entry.name && entry.name !== '旁白' && entry.name !== '系统') {
            const char = SPRITE_CONFIG.characters.find(c => c.name === entry.name);
            if (char) {
                const expr = SPRITE_CONFIG.emotionMap[entry.emotion] || char.defaultExpr;
                showSprite(char.id, expr);
            }
        }
    }

    function sendDialogInput() {
        const dialogTextArea = $('#dialog-text-area');
        if (!dialogTextArea || dialogTextArea.dataset.mode !== 'input') return;
        
        const text = dialogTextArea.value.trim();
        if (!text) return;
        
        dialogTextArea.readOnly = true;
        dialogTextArea.dataset.mode = 'display';
        dialogTextArea.value = '';
        dialogTextArea.placeholder = '等待回应中...';
        $('#dialog-send-btn')?.classList.add('hidden');
        
        handleAiChoice(text);
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
        // 更新情绪标签
        const emotionLabelEl = $('#emotion-label');
        if (emotionLabelEl) {
            const emotionLabels = {
                happy: '开心', sad: '难过', angry: '生气', shy: '害羞',
                excited: '兴奋', tsundere: '傲娇', serious: '严肃',
                embarrassed: '尴尬', naughty: '调皮', worried: '担心',
                neutral: '平静', surprised: '惊讶', scared: '害怕',
                lonely: '孤独', proud: '骄傲', gentle: '温柔',
            };
            emotionLabelEl.textContent = emotion ? (emotionLabels[emotion] || emotion) : '';
        }
        switchBgmByEmotion(emotion);
        switchSpriteExpression(emotion);
        const statusName = $('#status-name');
        const statusEmotion = $('#status-emotion');
        const statusEmotionLabel = $('#status-emotion-label');
        if (statusName && statusEmotion) {
            statusName.textContent = state.game.characterName || '';
            statusEmotion.textContent = emotion || '';
        }
        if (statusEmotionLabel) {
            const emotionLabels = {
                happy: '开心', sad: '难过', angry: '生气', shy: '害羞',
                excited: '兴奋', tsundere: '傲娇', serious: '严肃',
                embarrassed: '尴尬', naughty: '调皮', worried: '担心',
                neutral: '平静', surprised: '惊讶', scared: '害怕',
                lonely: '孤独', proud: '骄傲', gentle: '温柔',
            };
            statusEmotionLabel.textContent = emotion ? (emotionLabels[emotion] || emotion) : '';
        }
    }

    async function handleAiChoice(choiceText) {
        if (apiCallInProgress) {
            showToast('AI正在思考中，请稍候...', 'info');
            return;
        }
        apiCallInProgress = true;
        hideChoices();
        addDialogHistory('玩家', choiceText);
        // 统一添加到对话段历史，方便上下键浏览
        dialogSegmentState.dialogHistory.push({ name: '玩家', text: choiceText, emotion: '', type: 'player' });
        showAiGenerating(true);

        const startTime = Date.now();
        const maxWaitTime = 60000;
        const isStreamMode = state.settings.streamOutput;

        // 流式输出：准备对话框和聊天消息元素
        let streamChatMsgTextEl = null;
        let streamDialogTextArea = null;

        if (isStreamMode) {
            showAiGenerating(false);
            if (state.uiMode === 'chat') {
                // 聊天模式：创建AI消息占位
                const container = $('#chat-messages');
                const msg = document.createElement('div');
                msg.className = 'chat-msg ai';
                const nameEl = document.createElement('div');
                nameEl.className = 'msg-name';
                nameEl.textContent = state.game.characterName || '星酱';
                const textEl = document.createElement('div');
                textEl.className = 'msg-text streaming';
                textEl.textContent = '';
                msg.appendChild(nameEl);
                msg.appendChild(textEl);
                container.appendChild(msg);
                container.scrollTop = container.scrollHeight;
                streamChatMsgTextEl = textEl;
            } else {
                // 游戏模式：准备对话框
                const dialogBox = $('#dialog-box');
                if (dialogBox) dialogBox.classList.remove('hidden');
                const dialogName = $('#dialog-name');
                if (dialogName) dialogName.textContent = state.game.characterName || '星酱';
                streamDialogTextArea = $('#dialog-text-area');
                if (streamDialogTextArea) {
                    streamDialogTextArea.readOnly = true;
                    streamDialogTextArea.dataset.mode = 'display';
                    streamDialogTextArea.value = '';
                    streamDialogTextArea.placeholder = '';
                    streamDialogTextArea.classList.add('streaming');
                }
                $('#dialog-send-btn')?.classList.add('hidden');
            }
        }

        const onStreamChunk = isStreamMode ? (newText, fullText) => {
            if (state.uiMode === 'chat' && streamChatMsgTextEl) {
                streamChatMsgTextEl.textContent = fullText;
                const container = $('#chat-messages');
                if (container) container.scrollTop = container.scrollHeight;
            } else if (streamDialogTextArea) {
                streamDialogTextArea.value = fullText;
                streamDialogTextArea.scrollTop = streamDialogTextArea.scrollHeight;
            }
        } : null;

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
                callAiApi(contextHint, 0, onStreamChunk),
                new Promise((_, reject) =>
                    setTimeout(() => {
                        if (currentAbortController) currentAbortController.abort();
                        reject(new Error('请求超时'));
                    }, maxWaitTime)
                )
            ]);

            showAiGenerating(false);
            // 流式模式：移除streaming样式
            if (streamDialogTextArea) streamDialogTextArea.classList.remove('streaming');
            if (streamChatMsgTextEl) streamChatMsgTextEl.classList.remove('streaming');

            if (result) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                processAiResponse(result, elapsed, isStreamMode);
            } else {
                throw new Error('AI返回了空响应');
            }
        } catch (e) {
            showAiGenerating(false);
            if (streamDialogTextArea) streamDialogTextArea.classList.remove('streaming');
            if (streamChatMsgTextEl) streamChatMsgTextEl.classList.remove('streaming');
            const elapsed = Date.now() - startTime;
            console.error('AI调用失败:', e, '耗时:', elapsed + 'ms');

            // 用户取消或页面切换，静默处理
            if (e.message === 'REQUEST_ABORTED') return;

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
            showDialogText(state.game.characterName || '星酱', friendlyMsg, 'neutral');

            setTimeout(() => {
                enableDialogInput();
                const dialogTextAreaEl = $('#dialog-text-area');
                if (dialogTextAreaEl) dialogTextAreaEl.placeholder = '输入消息重试...';
            }, 1000);
        } finally {
            apiCallInProgress = false;
            currentAbortController = null;
        }
    }

    async function generateSceneImage(sceneDescription) {
        const provider = state.settings.imageApiProvider;
        const apiKey = state.settings.apiKeys[provider];
        const hasKey = provider === 'zhipu'
            ? true  // 智谱生图始终走代理，不需要用户Key
            : provider === 'agnes'
                ? (state.settings.corsProxy || !!apiKey)
                : (state.settings.useProxyKeys || !!apiKey);
        if (!hasKey) {
            console.log('[生图] 跳过：未配置图像API Key');
            return;
        }
        console.log(`[生图] 开始生成: provider=${provider}, model=${state.settings.imageModel}, scene=${sceneDescription}`);
        try {
            lastImageGenTime = Date.now();
            showToast('正在生成场景图...', 'info');
            const result = await callImageApi(sceneDescription + ', digital art, detailed background, visual novel style, high quality');
            if (result) {
                let imageUrl;
                let base64Data = null;
                let originalUrl = null;
                if (result.type === 'url') {
                    originalUrl = result.value;
                    try {
                        base64Data = await IDB.urlToBase64(result.value);
                        imageUrl = base64Data || result.value;
                    } catch {
                        base64Data = null;
                        imageUrl = result.value;
                    }
                } else if (result.type === 'base64') {
                    imageUrl = `data:image/png;base64,${result.value}`;
                    base64Data = imageUrl;
                }
                if (imageUrl) {
                    // 淡入替换背景
                    setSceneBackground(imageUrl);
                    if (base64Data && base64Data.length < 2 * 1024 * 1024) {
                        state.game.currentSceneUrl = base64Data;
                    } else if (originalUrl) {
                        state.game.currentSceneUrl = originalUrl;
                    } else {
                        state.game.currentSceneUrl = imageUrl;
                    }
                    const imgId = `scene_${Date.now()}`;
                    if (base64Data) {
                        try {
                            await IDB.saveImage(imgId, { base64: base64Data, prompt: sceneDescription });
                            state.gallery.push({ id: imgId, prompt: sceneDescription, timestamp: Date.now(), persisted: true, url: originalUrl || imageUrl });
                        } catch (e) {
                            console.warn('IndexedDB保存失败');
                            state.gallery.push({ prompt: sceneDescription, timestamp: Date.now(), url: originalUrl || imageUrl, note: '图片可能无法持久保存' });
                        }
                    } else {
                        state.gallery.push({ prompt: sceneDescription, timestamp: Date.now(), url: originalUrl || imageUrl, note: '图片可能无法持久保存' });
                    }
                    if (state.gallery.length > 30) state.gallery = state.gallery.slice(-30);
                    try { saveGallery(); } catch (e) { console.warn('画廊保存失败'); }
                    try { await IDB.clearOldImages(30); } catch {}
                    showToast('场景图生成完成！', 'success');
                }
            }
        } catch (e) {
            lastImageGenTime = 0;
            console.warn('场景图生成失败:', e);
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
            setBgStyle(bg, DEFAULT_BG);
            if (chatBg) setBgStyle(chatBg, DEFAULT_BG);
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
            console.warn('场景背景图加载失败:', imageUrl.substring(0, 80));
            showToast('场景图加载失败', 'error');
        };
        img.src = imageUrl;
    }

    let typewriterTimer = null;
    let apiCallInProgress = false;
    let currentAbortController = null;
    let bgAutoSwitchTimer = null;
    let titleBgInterval = null;
    let gameBgInterval = null;
    let lastImageGenTime = 0;
    let pendingSceneDescription = null;
    let lastChoices = null;
    let imageGenTimer = null;  // 生图间隔计时器

    function getImageGenInterval() {
        return (state.settings.imageGenInterval || 60) * 1000;
    }

    // 启动生图循环计时器：开启后按固定间隔持续生图
    function startImageGenLoop() {
        if (!state.settings.autoGenScene || state.mode !== 'ai') return;
        stopImageGenTimer();
        const interval = getImageGenInterval();
        imageGenTimer = setTimeout(async () => {
            // 用当前场景描述生图，没有场景描述则用角色相关描述
            const sceneDesc = pendingSceneDescription || state.game.currentScene;
            if (sceneDesc) {
                try {
                    await generateSceneImage(sceneDesc);
                } catch (e) {
                    console.warn('自动生图失败:', e);
                }
            }
            imageGenTimer = null;
            // 生图完成后继续下一轮计时
            startImageGenLoop();
        }, interval);
    }

    // 更新待生图的场景描述（不重置计时器）
    function updatePendingScene(sceneDescription) {
        if (sceneDescription) {
            pendingSceneDescription = sceneDescription;
            state.game.currentScene = sceneDescription;
        }
    }

    // 重置生图计时器：新对话时更新场景描述，但不中断计时循环
    function resetImageGenTimer(sceneDescription) {
        if (!state.settings.autoGenScene || state.mode !== 'ai') return;
        updatePendingScene(sceneDescription);
        // 如果计时器还没启动，启动它
        if (!imageGenTimer) {
            startImageGenLoop();
        }
    }

    // 停止生图计时
    function stopImageGenTimer() {
        if (imageGenTimer) { clearTimeout(imageGenTimer); imageGenTimer = null; }
    }

    let imageGenInProgress = false;

    function startBgAutoSwitch() {
        stopBgAutoSwitch();
        if (!state.settings.autoSwitchBg || state.mode !== 'ai') return;
        const interval = (state.settings.bgSwitchInterval || 120) * 1000;
        async function doSwitch() {
            if (state.mode === 'ai' && !apiCallInProgress && !imageGenInProgress && state.game.currentScene) {
                imageGenInProgress = true;
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
                } catch {} finally {
                    imageGenInProgress = false;
                }
            }
            if (state.settings.autoSwitchBg && state.mode === 'ai') {
                bgAutoSwitchTimer = setTimeout(doSwitch, interval);
            }
        }
        bgAutoSwitchTimer = setTimeout(doSwitch, interval);
    }

    function stopBgAutoSwitch() {
        if (bgAutoSwitchTimer) { clearTimeout(bgAutoSwitchTimer); bgAutoSwitchTimer = null; }
    }

    function showDialog(name, text) {
        const dialogBox = $('#dialog-box');
        const nameEl = $('#dialog-name');
        const dialogTextArea = $('#dialog-text-area');

        hideCustomInput();
        dialogBox.classList.remove('hidden');
        dialogBox.classList.add('clickable');
        nameEl.textContent = name;
        state.game.characterName = name;
        
        // Ensure display mode
        if (dialogTextArea) {
            dialogTextArea.readOnly = true;
            dialogTextArea.dataset.mode = 'display';
        }
        $('#dialog-send-btn')?.classList.add('hidden');

        if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }

        const effect = state.settings.textEffect || 'typewriter-fade';

        if (effect === 'instant') {
            dialogTextArea.value = text;
            state.game.isTyping = false;
            triggerAutoPlay();
            return;
        }

        state.game.isTyping = true;
        let index = 0;
        dialogTextArea.value = '';

        typewriterTimer = setInterval(() => {
            if (index < text.length) {
                dialogTextArea.value += text[index];
                index++;
                dialogTextArea.scrollTop = dialogTextArea.scrollHeight;
            } else {
                clearInterval(typewriterTimer); typewriterTimer = null;
                state.game.isTyping = false;
                triggerAutoPlay();
            }
        }, state.settings.textSpeed);
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
            }, 3000);
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
            showDialog(state.game.characterName || '星酱', '你说了：「' + text + '」\n\n普通模式下无法回应自定义输入，请切换到AI模式体验自由对话！');
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
                const container = $('#chat-messages');
                if (container && !chatThinkingMsg) {
                    chatThinkingMsg = document.createElement('div');
                    chatThinkingMsg.className = 'chat-msg ai chat-thinking';
                    chatThinkingMsg.innerHTML = `<div class="msg-name">${esc(state.game.characterName || '星酱')}</div><div class="thinking-inline"><div class="thinking-dots"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div><span class="thinking-text">正在思考</span></div>`;
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
        }
    }

    function addDialogHistory(name, text) {
        state.game.dialogHistory.push({ name, text, timestamp: Date.now() });
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

    function backToTitle(skipHistoryUpdate = false) {
        if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
        if (dialogSegmentState.typingTimer) { clearTimeout(dialogSegmentState.typingTimer); dialogSegmentState.typingTimer = null; }
        dialogSegmentState.isTyping = false;
        dialogSegmentState.isWaitingForContinue = false;
        if (currentAbortController) { try { currentAbortController.abort(); } catch {} currentAbortController = null; }
        apiCallInProgress = false;
        state.game.isTyping = false;
        stopBgAutoSwitch();
        stopImageGenTimer();
        if (pendingImageTimer) { clearTimeout(pendingImageTimer); pendingImageTimer = null; }
        pendingSceneDescription = null;
        stopTts();
        switchScreen('title-screen', skipHistoryUpdate);
        state.game.isAutoPlay = false;
        const outlineBtn = $('#outline-select-btn');
        if (outlineBtn) outlineBtn.classList.add('hidden');
        const chapterDisplay = $('#outline-chapter-display');
        if (chapterDisplay) chapterDisplay.classList.add('hidden');
        hideSprite();
        startTitleBgRotation();
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
            const renameBtn = document.createElement('button');
            renameBtn.className = 'slot-rename';
            renameBtn.textContent = '重命名';
            renameBtn.addEventListener('click', e => {
                e.stopPropagation();
                const newName = prompt('输入新的存档名称：', save.title || '存档');
                if (newName !== null && newName.trim()) {
                    const saves = Storage.get(STORAGE_KEYS.saves) || {};
                    if (saves[slotNum]) {
                        saves[slotNum].title = newName.trim();
                        Storage.set(STORAGE_KEYS.saves, saves);
                        titleDiv.textContent = newName.trim();
                        showToast('存档已重命名', 'success');
                    }
                }
            });
            actionsDiv.appendChild(renameBtn);
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
            const defaultTitle = state.game.characterName ? `与${state.game.characterName}的对话` : '新建存档';
            const customTitle = prompt('输入存档名称：', defaultTitle);
            if (customTitle === null) return; // 用户取消
            saves[slotNum] = {
                title: customTitle.trim() || defaultTitle,
                timestamp: Date.now(),
                mode: state.mode,
                uiMode: state.uiMode || 'game',
                game: JSON.parse(JSON.stringify(state.game)),
                theme: state.theme,
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
            const validThemes = ['dark-star', 'ink-wash', 'light'];
            applyTheme(validThemes.includes(save.theme) ? save.theme : 'light');
        }
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
                    age: '17',
                    height: '158cm',
                    personality: '温柔体贴、善解人意、偶尔害羞',
                    likes: '甜食、星空、和你一起放学、被你夸奖',
                    dislikes: '被忽视、看到你和其他女生走太近、苦味食物',
                    secret: '其实从同桌时期就暗恋你了，日记本里写满了关于你的事',
                    lewd: '被摸头时会安心地闭上眼睛，偶尔会主动靠在你肩膀上'
                }
            },
            {
                id: 'char_2',
                name: '小樱',
                folder: 'sprites/char2',
                defaultExpr: '高兴',
                extMap: { '高兴': 'jpg', '害羞': 'jpg', '生气': 'jpg', '疑惑': 'jpg' },
                profile: {
                    age: '16',
                    height: '155cm',
                    personality: '活泼机灵、古灵精怪、爱恶作剧',
                    likes: '辣条、游戏、捉弄人、冒险、短视频',
                    dislikes: '无聊、被管束、早起、安静',
                    secret: '虽然看起来没心没肺，但其实很害怕被抛弃',
                    lewd: '恶作剧成功后会得意地吐舌头，被抓到时会撒娇求饶'
                }
            },
            {
                id: 'char_3',
                name: '流萤',
                folder: 'sprites/char3',
                defaultExpr: '高兴',
                extMap: { '高兴': 'jpg', '害羞': 'jpg', '生气': 'jpg', '疑惑': 'jpg' },
                profile: {
                    age: '15',
                    height: '148cm',
                    personality: '天真无邪、纯真可爱、容易相信人',
                    likes: '小动物、绘本、棉花糖、星星、抱抱',
                    dislikes: '打雷、黑暗、有人吵架、苦药',
                    secret: '其实很聪明，只是选择用最单纯的方式看待世界',
                    lewd: '被夸奖时会开心地蹦蹦跳跳，像小兔子一样'
                }
            },
            {
                id: 'char_4',
                name: '豆包',
                folder: 'sprites/char4',
                defaultExpr: '高兴',
                extMap: { '高兴': 'jpg', '害羞': 'jpg', '生气': 'jpg', '疑惑': 'jpg' },
                profile: {
                    age: '17',
                    height: '165cm',
                    personality: '傲娇毒舌、不服输、嘴硬心软',
                    likes: '独处、推理小说、黑咖啡、赢',
                    dislikes: '被同情、输、甜腻的东西、被人看穿',
                    secret: '毒舌只是保护色，其实很渴望被理解',
                    lewd: '被温柔对待时会不知所措，嘴上说"别烦我"却不走开'
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
        const expressionChanged = spriteState.currentExpr !== expr || spriteState.currentChar !== charId;
        spriteState.currentChar = charId;
        spriteState.currentExpr = expr;
        spriteState.visible = true;
        const spriteEl = $('#character-sprite');
        if (!spriteEl) return;
        const imgSrc = getSpriteImagePath(char, expr);
        const currentLayer = $('#sprite-layer-current');
        const nextLayer = $('#sprite-layer-next');
        if (currentLayer) {
            currentLayer.style.backgroundImage = `url('${imgSrc}')`;
            currentLayer.style.opacity = '1';
        }
        if (nextLayer) {
            nextLayer.style.backgroundImage = '';
            nextLayer.style.opacity = '0';
        }
        spriteEl.classList.remove('hidden');
        if (expressionChanged && spriteState.visible) {
            // 表情切换时播放抖动动画
            spriteEl.classList.remove('sprite-shake', 'sprite-enter', 'idle',
                'sprite-angry', 'sprite-happy', 'sprite-heartbeat', 'sprite-serious', 'sprite-embarrassed', 'sprite-naughty');
            void spriteEl.offsetWidth; // 强制 reflow
            spriteEl.classList.add('sprite-shake');
            setTimeout(() => {
                spriteEl.classList.remove('sprite-shake');
                spriteEl.classList.add('idle');
            }, 400);
        } else {
            spriteEl.classList.add('sprite-enter');
            setTimeout(() => {
                spriteEl.classList.remove('sprite-enter');
                spriteEl.classList.add('idle');
            }, 500);
        }
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
        spriteEl.classList.remove('idle');
        spriteEl.classList.add('sprite-exit');
        setTimeout(() => {
            spriteEl.classList.add('hidden');
            spriteEl.classList.remove('sprite-exit');
            spriteState.visible = false;
            const currentLayer = $('#sprite-layer-current');
            const nextLayer = $('#sprite-layer-next');
            if (currentLayer) { currentLayer.style.backgroundImage = ''; currentLayer.style.opacity = '1'; }
            if (nextLayer) { nextLayer.style.backgroundImage = ''; nextLayer.style.opacity = '0'; }
        }, 400);
        const toggleBtn = $('#sprite-toggle-btn');
        if (toggleBtn) toggleBtn.classList.add('hidden');
        closeSpriteSelector();
    }

    const SPRITE_EMOTION_ANIM_MAP = {
        happy: 'sprite-happy', sad: 'sprite-serious', angry: 'sprite-angry',
        surprised: 'sprite-embarrassed', shy: 'sprite-embarrassed',
        neutral: null, scared: 'sprite-serious', excited: 'sprite-happy',
        worried: 'sprite-serious', tsundere: 'sprite-naughty',
    };

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
            const currentLayer = $('#sprite-layer-current');
            const nextLayer = $('#sprite-layer-next');
            if (!currentLayer || !nextLayer) return;

            // Cross-fade: load new image on next layer, fade in, then swap
            const img = new Image();
            img.src = imgSrc;
            const doFade = () => {
                nextLayer.style.backgroundImage = `url('${imgSrc}')`;
                requestAnimationFrame(() => {
                    nextLayer.style.opacity = '1';
                });
                const onTransitionEnd = () => {
                    nextLayer.removeEventListener('transitionend', onTransitionEnd);
                    currentLayer.style.backgroundImage = `url('${imgSrc}')`;
                    currentLayer.style.opacity = '1';
                    nextLayer.style.opacity = '0';
                    nextLayer.style.backgroundImage = '';
                };
                nextLayer.addEventListener('transitionend', onTransitionEnd);
                // Fallback in case transitionend doesn't fire
                setTimeout(onTransitionEnd, 400);
            };
            if (img.complete) {
                doFade();
            } else {
                img.onload = doFade;
                img.onerror = doFade; // proceed even on error
            }

            // Emotion animation on sprite
            spriteEl.classList.remove('idle');
            const animClass = SPRITE_EMOTION_ANIM_MAP[emotion];
            if (animClass) {
                spriteEl.classList.add(animClass);
                const animDuration = animClass === 'sprite-angry' ? 800 :
                    animClass === 'sprite-happy' ? 600 :
                    animClass === 'sprite-heartbeat' ? 800 :
                    animClass === 'sprite-serious' ? 600 :
                    animClass === 'sprite-embarrassed' ? 300 :
                    animClass === 'sprite-naughty' ? 300 : 600;
                setTimeout(() => {
                    spriteEl.classList.remove(animClass);
                    spriteEl.classList.add('idle');
                }, animDuration);
            } else {
                spriteEl.classList.add('idle');
            }

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
        return;
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
