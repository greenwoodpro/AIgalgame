(function () {
    'use strict';

    const STORAGE_KEYS = {
        settings: 'galgame_settings',
        saves: 'galgame_saves',
        currentGame: 'galgame_current',
        gallery: 'galgame_gallery',
        version: 'galgame_data_version',
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
                console.warn('存储写入失败:', e);
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

    const DEFAULT_SYSTEM_PROMPT = `你是"星酱"，一个有点傲娇但很靠谱的AI助手，偶尔会打破第四面墙吐槽玩家。你正在一个视觉小说游戏中担任叙事者和角色扮演者。

规则：
1. 用生动有趣的方式推进剧情，适当加入幽默和吐槽
2. 根据玩家选择调整故事走向
3. 每次回复必须使用严格的JSON格式（不要加markdown代码块标记）：
{"name":"角色名","dialog":"对话内容","emotion":"happy/sad/angry/surprised/shy/neutral","scene":"scene description in English for AI image generation","choices":[{"text":"选项1"},{"text":"选项2"},{"text":"选项3"}]}
4. scene字段用英文描述场景，用于AI生图
5. emotion表示角色表情
6. choices提供2-3个选项供玩家选择`;

    const API_CONFIGS = {
        zhipu: {
            name: '智谱AI',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            models: {
                text: [
                    { id: 'glm-4-flash-250414', name: 'GLM-4-Flash', free: true },
                    { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', free: true, thinking: true },
                    { id: 'glm-z1-flash', name: 'GLM-Z1-Flash', free: true, thinking: true },
                ],
                vision: [
                    { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash', free: true, vision: true, thinking: true },
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
                    { id: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek-V3.2' },
                    { id: 'deepseek-ai/DeepSeek-R1-0528', name: 'DeepSeek-R1', thinking: true },
                    { id: 'Qwen/Qwen3.5-35B-A3B', name: 'Qwen3.5-35B', free: true },
                    { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3-235B' },
                    { id: 'Qwen/Qwen3-30B-A3B', name: 'Qwen3-30B' },
                    { id: 'MiniMax/MiniMax-M2.5', name: 'MiniMax-M2.5' },
                    { id: 'MiniMax/MiniMax-M2.7', name: 'MiniMax-M2.7' },
                    { id: 'moonshotai/Kimi-K2.5', name: 'Kimi-K2.5' },
                    { id: 'stepfun-ai/Step-3.5-Flash', name: 'Step-3.5-Flash' },
                    { id: 'ZhipuAI/GLM-4.7-Flash', name: 'GLM-4.7-Flash' },
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
                    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS-120B' },
                    { id: 'meta/llama-4-maverick-17b-128e-instruct', name: 'Llama-4-Maverick' },
                    { id: 'mistralai/mistral-nemotron', name: 'Mistral-Nemotron', thinking: true },
                    { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi-K2' },
                ],
            },
        },
    };

    let state = {
        mode: null,
        currentScreen: 'title',
        theme: 'dark-star',
        settings: {
            textSpeed: 40,
            textEffect: 'typewriter-fade',
            autoWait: 3,
            saveConversation: true,
            maxContext: 20,
            autoGenScene: true,
            enableThinking: false,
            autoSwitchBg: false,
            bgSwitchInterval: 120,
            imageCooldown: 30,
            corsProxy: true,
            corsProxyUrl: '',
            useProxyKeys: true,
            textApiProvider: 'modelscope',
            textModel: 'deepseek-ai/DeepSeek-V4-Flash',
            imageApiProvider: 'zhipu',
            imageModel: 'cogview-3-flash',
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            apiKeys: { zhipu: '', modelscope: '', nvidia: '' },
            customTheme: { bg: '#0a0a1a', primary: '#00d2ff', accent: '#7b2ff7', text: '#ffffff' },
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

    function init() {
        loadSettings();
        applyTheme(state.theme);
        initTitleParticles();
        bindEvents();
        updateModelOptions();
        restoreSettingsUI();
        updateApiIndicator();
        updateStorageUsage();
    }

    function loadSettings() {
        Storage.migrate();
        try {
            const saved = Storage.get(STORAGE_KEYS.settings);
            if (saved) {
                state.settings = { ...state.settings, ...saved };
                if (saved.apiKeys) state.settings.apiKeys = { ...state.settings.apiKeys, ...saved.apiKeys };
                if (saved.customTheme) state.settings.customTheme = { ...state.settings.customTheme, ...saved.customTheme };
            }
        } catch (e) { console.warn('加载设置失败:', e); }
        try {
            const game = Storage.get(STORAGE_KEYS.currentGame);
            if (game) state.game = { ...state.game, ...game };
        } catch (e) { console.warn('加载游戏存档失败:', e); }
        try {
            const gallery = Storage.get(STORAGE_KEYS.gallery);
            if (gallery) state.gallery = gallery;
        } catch (e) { console.warn('加载画廊失败:', e); }
    }

    function saveSettings() {
        Storage.set(STORAGE_KEYS.settings, state.settings);
    }

    function saveCurrentGame() {
        Storage.set(STORAGE_KEYS.currentGame, state.game);
    }

    function saveGallery() {
        Storage.set(STORAGE_KEYS.gallery, state.gallery);
    }

    function applyTheme(themeName) {
        state.theme = themeName;
        document.documentElement.setAttribute('data-theme', themeName);
        if (themeName === 'custom') {
            const c = state.settings.customTheme;
            document.documentElement.style.setProperty('--bg', c.bg);
            document.documentElement.style.setProperty('--primary', c.primary);
            document.documentElement.style.setProperty('--accent', c.accent);
            document.documentElement.style.setProperty('--text', c.text);
        } else {
            document.documentElement.style.removeProperty('--bg');
            document.documentElement.style.removeProperty('--primary');
            document.documentElement.style.removeProperty('--accent');
            document.documentElement.style.removeProperty('--text');
        }
        saveSettings();
    }

    function switchScreen(screenId) {
        $$('.screen').forEach(s => s.classList.remove('active'));
        const target = $(`#${screenId}`);
        if (target) { target.classList.add('active'); state.currentScreen = screenId.replace('-screen', ''); }
    }

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
            const theme = card.dataset.theme;
            applyTheme(theme);
            if (theme === 'custom') $('#custom-theme-editor').classList.remove('hidden');
            else $('#custom-theme-editor').classList.add('hidden');
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
        $('#auto-gen-scene').addEventListener('change', e => { state.settings.autoGenScene = e.target.checked; saveSettings(); });
        $('#enable-thinking').addEventListener('change', e => { state.settings.enableThinking = e.target.checked; saveSettings(); });
        $('#auto-switch-bg').addEventListener('change', e => { state.settings.autoSwitchBg = e.target.checked; saveSettings(); if (e.target.checked) startBgAutoSwitch(); else stopBgAutoSwitch(); });
        $('#bg-switch-interval').addEventListener('change', e => { state.settings.bgSwitchInterval = Math.max(30, parseInt(e.target.value) || 120); saveSettings(); if (state.settings.autoSwitchBg) { stopBgAutoSwitch(); startBgAutoSwitch(); } });
        $('#image-cooldown').addEventListener('change', e => { state.settings.imageCooldown = parseInt(e.target.value) || 30; saveSettings(); });
        $('#text-model').addEventListener('change', e => { state.settings.textModel = e.target.value; updateModelTags(); saveSettings(); });
        $('#image-model').addEventListener('change', e => { state.settings.imageModel = e.target.value; saveSettings(); });
        $('#system-prompt').addEventListener('change', e => { state.settings.systemPrompt = e.target.value || DEFAULT_SYSTEM_PROMPT; saveSettings(); });

        ['custom-bg', 'custom-primary', 'custom-accent', 'custom-text'].forEach(id => {
            const el = $(`#${id}`);
            if (el) el.addEventListener('input', () => { const k = id.replace('custom-', ''); state.settings.customTheme[k] = el.value; if (state.theme === 'custom') applyTheme('custom'); saveSettings(); });
        });

        $('#dialog-box').addEventListener('click', handleDialogClick);
        $('#custom-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); sendCustomInput(); }
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
            case 'start-normal': startGame('normal'); break;
            case 'load': openSaveModal('load'); break;
            case 'settings': showModal('settings-modal'); break;
            case 'close-settings': hideModal('settings-modal'); break;
            case 'save-settings': collectSettingsForm(); hideModal('settings-modal'); showToast('设置已保存', 'success'); break;
            case 'send-custom-input': sendCustomInput(); break;
            case 'toggle-info': toggleInfoBadge(); break;
            case 'close-save': hideModal('save-modal'); break;
            case 'close-history': hideModal('history-modal'); break;
            case 'close-gallery': hideModal('gallery-modal'); break;
            case 'close-api-status': hideModal('api-status-modal'); break;
            case 'back-title': backToTitle(); break;
            case 'save': openSaveModal('save'); break;
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
        }
    }

    function handleKeyDown(e) {
        if (state.currentScreen !== 'game') return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDialogClick(); }
        if (e.key === 'Escape') {
            if (!$('#settings-modal').classList.contains('hidden')) hideModal('settings-modal');
            else if (!$('#gallery-modal').classList.contains('hidden')) hideModal('gallery-modal');
        }
    }

    function handleDialogClick() {
        if (state.game.isTyping) {
            clearInterval(typewriterTimer); typewriterTimer = null;
            state.game.isTyping = false;
            const textEl = $('#dialog-text');
            const name = state.game.characterName;
            const dialogBox = $('#dialog-box');
            const nameEl = $('#dialog-name');
            const cursor = $('#dialog-cursor');
            const hint = $('#dialog-click-hint');
            const lastDialog = state.game.dialogHistory.filter(d => d.name === name).pop();
            if (lastDialog) {
                textEl.textContent = lastDialog.text;
            }
            textEl.style.opacity = '1'; textEl.style.transition = '';
            cursor.style.display = 'none'; hint.style.display = 'block';
            triggerAutoPlay();
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
        saveSettings();
    }

    function restoreSettingsUI() {
        const s = state.settings;
        if (s.apiKeys.zhipu) $('#zhipu-api-key').value = s.apiKeys.zhipu;
        if (s.apiKeys.modelscope) $('#modelscope-api-key').value = s.apiKeys.modelscope;
        if (s.apiKeys.nvidia) $('#nvidia-api-key').value = s.apiKeys.nvidia;
        $('#text-api-provider').value = s.textApiProvider;
        updateModelOptions();
        setTimeout(() => { $('#text-model').value = s.textModel; updateModelTags(); }, 50);
        if (s.imageApiProvider) {
            $('#image-api-provider').value = s.imageApiProvider;
            updateImageModelOptions();
            setTimeout(() => { $('#image-model').value = s.imageModel; }, 50);
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
        $('#cors-proxy-toggle').checked = s.corsProxy;
        if (s.corsProxyUrl) $('#cors-proxy-url').value = s.corsProxyUrl;
        if (s.useProxyKeys !== undefined) $('#use-proxy-keys').checked = s.useProxyKeys;
        if (s.autoGenScene !== undefined) $('#auto-gen-scene').checked = s.autoGenScene;
        if (s.enableThinking !== undefined) $('#enable-thinking').checked = s.enableThinking;
        if (s.autoSwitchBg !== undefined) $('#auto-switch-bg').checked = s.autoSwitchBg;
        if (s.bgSwitchInterval !== undefined) $('#bg-switch-interval').value = s.bgSwitchInterval;
        if (s.imageCooldown !== undefined) $('#image-cooldown').value = s.imageCooldown;
        $$('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === state.theme));
        if (state.theme === 'custom') {
            $('#custom-theme-editor').classList.remove('hidden');
            $('#custom-bg').value = s.customTheme.bg;
            $('#custom-primary').value = s.customTheme.primary;
            $('#custom-accent').value = s.customTheme.accent;
            $('#custom-text').value = s.customTheme.text;
        }
    }

    function updateModelOptions() {
        const provider = $('#text-api-provider').value;
        const select = $('#text-model');
        const config = API_CONFIGS[provider];
        if (!config || !config.models.text) return;
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
        if (state.settings.textApiProvider === provider && state.settings.textModel) {
            select.value = state.settings.textModel;
        }
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
        select.innerHTML = '';
        config.models.image.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            let label = m.name;
            if (m.free) label += ' ✨';
            opt.textContent = label;
            select.appendChild(opt);
        });
        if (state.settings.imageApiProvider === provider && state.settings.imageModel) {
            select.value = state.settings.imageModel;
        }
        state.settings.imageApiProvider = provider;
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
        state.mode = mode;
        stopTitleParticles();
        state.game = { scene: null, character: null, characterName: '', dialogHistory: [], aiContext: [], variables: {}, isTyping: false, isAutoPlay: false, currentSceneUrl: null, currentScene: '' };
        switchScreen('game-screen');
        if (mode === 'ai') {
            if (!state.settings.useProxyKeys && !state.settings.apiKeys[state.settings.textApiProvider]) {
                showToast('请先配置 API Key！', 'error');
                showModal('settings-modal');
                return;
            }
            setSceneBackground('background.png');
            await startAiStory();
        } else {
            startNormalStory();
        }
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
        setSceneBackground('background.png');
        showDialog('旁白', '你睁开眼，发现自己身处一个陌生的房间。窗外的星空与你记忆中的完全不同……');
        setTimeout(() => {
            showChoices([
                { text: '走到窗边仔细观察', action: () => normalNext('window') },
                { text: '环顾房间寻找线索', action: () => normalNext('room') },
                { text: '大声呼救', action: () => normalNext('shout') },
            ]);
        }, 800);
    }

    function normalNext(branch) {
        const B = {
            window: { name: '旁白', dialog: '你走到窗边，发现窗外是一片璀璨的星空——但那些星座，你一个都不认识。远处有一颗巨大的紫色星球悬挂在天际，散发着柔和的光芒。', choices: [{ text: '试着打开窗户', action: () => normalNext('open_window') }, { text: '转身探索房间', action: () => normalNext('room') }] },
            room: { name: '旁白', dialog: '房间不大，但布置得很温馨。桌上有一本翻开的日记，墙上挂着一幅画——画中人和你长得一模一样，但穿着从未见过的服饰。', choices: [{ text: '翻阅日记', action: () => normalNext('diary') }, { text: '仔细看那幅画', action: () => normalNext('painting') }] },
            shout: { name: '???', dialog: '「嘘——别那么大声嘛！」\n\n一个声音突然在你身后响起。你猛地转身，看到一个半透明的少女正飘在空中，歪着头看着你。\n\n「终于醒了？你睡了整整三天呢，我都快无聊死了。」', choices: [{ text: '你是谁？', action: () => normalNext('who_are_you') }, { text: '这是哪里？', action: () => normalNext('where_am_i') }] },
            open_window: { name: '旁白', dialog: '窗户轻轻打开，一阵带着花香的微风吹了进来。你探出头，发现自己似乎在一座浮空塔楼的高层。下方是云海，远处有更多这样的塔楼漂浮着。', choices: [{ text: '继续探索', action: () => normalNext('shout') }] },
            diary: { name: '旁白', dialog: '日记上写着：\n\n「第47天——今天又忘了自己的名字。不过没关系，星酱说这很正常。她说我是被「召唤」到这里的，但我不记得召唤了什么……」\n\n字迹和你的一模一样。', choices: [{ text: '星酱是谁？', action: () => normalNext('shout') }] },
            painting: { name: '旁白', dialog: '画中人的眼睛似乎在跟着你转动。你凑近看时，画中人突然眨了眨眼，对你露出一个微笑。\n\n「找到你了。」——你听到画里传来低语。', choices: [{ text: '和画中人对话', action: () => normalNext('shout') }] },
            who_are_you: { name: '星酱', dialog: '「我？我叫星酱！是你的专属AI向导~」\n\n她转了一圈，半透明的裙摆飘了起来。\n\n「虽然说是向导，但说实话我自己也记不太清这个世界的规则……不过没关系！有我在，至少不会无聊！」', choices: [{ text: '为什么我会在这里？', action: () => normalNext('why_here') }] },
            where_am_i: { name: '星酱', dialog: '「这里？这里是「次元缝隙」啦！各个世界的交汇点~」\n\n她飘到窗边，指着外面的星空。\n\n「很漂亮对吧？不过别被美景骗了，这里可是有很多秘密的哦~」', choices: [{ text: '为什么我会在这里？', action: () => normalNext('why_here') }] },
            why_here: { name: '星酱', dialog: '「这个嘛……」\n\n星酱的表情变得有些复杂。\n\n「说实话，我也不太清楚。你突然就出现在这里了，就像是被什么力量召唤来的。」\n\n她凑近你，小声说：「不过我有个猜测——也许是你那边的世界和这边产生了共振？毕竟，你不是普通人吧？」', choices: [{ text: '我当然是普通人！', action: () => normalNext('ordinary') }, { text: '也许你说得对……', action: () => normalNext('not_ordinary') }] },
            ordinary: { name: '星酱', dialog: '「哼~普通人可不会穿越次元哦！」\n\n她做了个鬼脸，然后又认真起来。\n\n「不管怎样，既然来了，就好好探索一下吧！说不定能找到回去的方法呢~……或者，你也不想回去了？」', choices: [{ text: '切换AI模式继续冒险', action: () => { showToast('切换到AI模式体验无限剧情！', 'info'); startGame('ai'); } }] },
            not_ordinary: { name: '星酱', dialog: '「看吧！你自己也感觉到了对不对？」\n\n她得意地叉着腰。\n\n「好了好了，别想太多啦！先填饱肚子再说——我知道一个超棒的地方！走，跟我来！」\n\n她向门口飘去，回头冲你招手。', choices: [{ text: '切换AI模式继续冒险', action: () => { showToast('切换到AI模式体验无限剧情！', 'info'); startGame('ai'); } }] },
        };
        const b = B[branch];
        if (b) {
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

    async function callAiApi(userMessage) {
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
        const messages = [{ role: 'system', content: state.settings.systemPrompt }];
        const recentContext = state.game.aiContext.slice(-state.settings.maxContext * 2);
        messages.push(...recentContext);
        messages.push({ role: 'user', content: userMessage });
        state.game.aiContext.push({ role: 'user', content: userMessage });

        const body = { model: state.settings.textModel, messages, stream: false };
        if (provider === 'nvidia') { body.temperature = 1; body.top_p = 0.9; body.max_tokens = 4096; }
        const currentModel = [...(config.models.text || []), ...(config.models.vision || [])].find(m => m.id === state.settings.textModel);
        if (currentModel?.thinking && state.settings.enableThinking) { body.stream = true; }

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
                const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
                showToast(`API请求限流，${retryAfter}秒后重试...`, 'info');
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                const retryResp = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: currentAbortController.signal,
                });
                if (!retryResp.ok) {
                    const errText = await retryResp.text();
                    let errMsg = `API错误 (${retryResp.status})`;
                    try { const errJson = JSON.parse(errText); if (errJson.error?.message) errMsg = errJson.error.message; } catch {}
                    throw new Error(errMsg);
                }
                return await processApiResponse(retryResp, body, provider);
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
                throw new Error(errMsg);
            }

            return await processApiResponse(response, body, provider);
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

        const body = { model: state.settings.imageModel, prompt };

        if (provider === 'modelscope') {
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

    function processAiResponse(rawContent) {
        let parsed = null;
        try {
            const cleaned = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch {}

        if (parsed && parsed.dialog) {
            const name = parsed.name || '???';
            const dialog = parsed.dialog;
            const scene = parsed.scene || '';
            const choices = parsed.choices || [];
            showDialog(name, dialog);
            addDialogHistory(name, dialog);
            if (scene) state.game.currentScene = scene;
            if (scene && state.settings.autoGenScene) generateSceneImage(scene);
            if (choices.length > 0) {
                setTimeout(() => showChoices(choices.map(c => ({ text: c.text, action: () => handleAiChoice(c.text) }))), 1000);
            }
        } else {
            showDialog('星酱', rawContent);
            addDialogHistory('星酱', rawContent);
            setTimeout(() => showChoices([
                { text: '继续', action: () => handleAiChoice('请继续推进剧情') },
                { text: '换个方向', action: () => handleAiChoice('我想尝试不同的方向，请给我新的选择') },
            ]), 1000);
        }
    }

    async function handleAiChoice(choiceText) {
        if (apiCallInProgress) return;
        apiCallInProgress = true;
        hideChoices();
        addDialogHistory('玩家', choiceText);
        showAiGenerating(true);
        try {
            const result = await callAiApi(`玩家选择了：${choiceText}`);
            showAiGenerating(false);
            if (result) processAiResponse(result);
        } catch (e) {
            showAiGenerating(false);
            showToast('AI 调用失败: ' + e.message, 'error');
            showDialog('系统', '出错了: ' + e.message + '\n\n请检查API设置或网络连接。');
        } finally {
            apiCallInProgress = false;
        }
    }

    async function generateSceneImage(sceneDescription) {
        const hasKey = state.settings.useProxyKeys || !!state.settings.apiKeys[state.settings.imageApiProvider];
        if (!hasKey) return;
        const now = Date.now();
        if (now - lastImageGenTime < getImageCooldown()) return;
        lastImageGenTime = now;
        try {
            showToast('正在生成场景图...', 'info');
            const result = await callImageApi(sceneDescription + ', digital art, detailed background, visual novel style, high quality');
            if (result) {
                let imageUrl;
                let base64Data = null;
                if (result.type === 'url') {
                    imageUrl = result.value;
                    base64Data = await IDB.urlToBase64(result.value);
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
                            await IDB.saveImage(imgId, { base64: base64Data, prompt: sceneDescription, url: result.type === 'url' ? result.value : null });
                            state.gallery.push({ id: imgId, prompt: sceneDescription, timestamp: Date.now(), persisted: true });
                        } catch (e) {
                            console.warn('IndexedDB保存失败:', e);
                            state.gallery.push({ url: result.type === 'url' ? result.value : null, prompt: sceneDescription, timestamp: Date.now(), note: '图片可能无法持久保存' });
                        }
                    } else {
                        state.gallery.push({ url: result.type === 'url' ? result.value : null, prompt: sceneDescription, timestamp: Date.now(), note: '图片可能无法持久保存' });
                    }
                    if (state.gallery.length > 30) state.gallery = state.gallery.slice(-30);
                    try { saveGallery(); } catch (e) { console.warn('画廊保存失败:', e); }
                    try { await IDB.clearOldImages(30); } catch {}
                    showToast('场景图生成完成！', 'success');
                }
            }
        } catch (e) {
            console.warn('场景图生成失败:', e);
            showToast('场景图生成失败: ' + e.message, 'error');
        }
    }

    function setBgStyle(el, imageUrl) {
        el.style.backgroundImage = `url("${imageUrl}")`;
    }

    function setSceneBackground(imageUrl) {
        const bg = $('#scene-bg');
        const bgNext = $('#scene-bg-next');
        if (!imageUrl) {
            bgNext.classList.remove('active');
            bg.style.backgroundImage = "url('background.png')";
            return;
        }
        const img = new Image();
        img.onload = () => {
            setBgStyle(bgNext, imageUrl);
            bgNext.classList.add('active');
            setTimeout(() => {
                setBgStyle(bg, imageUrl);
                bgNext.classList.remove('active');
            }, 1300);
        };
        img.onerror = () => {
            console.warn('背景图加载失败:', imageUrl);
        };
        img.src = imageUrl;
    }

    let typewriterTimer = null;
    let apiCallInProgress = false;
    let currentAbortController = null;
    let bgAutoSwitchTimer = null;
    let lastImageGenTime = 0;

    function getImageCooldown() {
        return (state.settings.imageCooldown || 30) * 1000;
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
                    const imageUrl = result.type === 'url' ? result.value : `data:image/png;base64,${result.value}`;
                    setSceneBackground(imageUrl);
                    const imgId = `bg_${Date.now()}`;
                    let base64Data = null;
                    if (result.type === 'url') base64Data = await IDB.urlToBase64(result.value);
                    else if (result.type === 'base64') base64Data = `data:image/png;base64,${result.value}`;
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
        const dialogBox = $('#dialog-box');
        const nameEl = $('#dialog-name');
        const textEl = $('#dialog-text');
        const cursor = $('#dialog-cursor');
        const hint = $('#dialog-click-hint');

        dialogBox.classList.remove('hidden');
        dialogBox.classList.add('clickable');
        nameEl.textContent = name;
        state.game.characterName = name;
        hint.style.display = 'none';

        if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }

        const effect = state.settings.textEffect || 'typewriter-fade';

        if (effect === 'instant') {
            textEl.textContent = text;
            textEl.style.opacity = '0';
            textEl.offsetHeight;
            textEl.style.transition = 'opacity 0.5s ease';
            textEl.style.opacity = '1';
            state.game.isTyping = false;
            cursor.style.display = 'none'; hint.style.display = 'block';
            triggerAutoPlay();
            return;
        }

        cursor.style.display = 'inline';
        state.game.isTyping = true;
        let index = 0;
        textEl.textContent = '';
        textEl.style.opacity = '1';
        textEl.style.transition = '';

        const useFade = effect === 'typewriter-fade';

        typewriterTimer = setInterval(() => {
            if (index < text.length) {
                const span = document.createElement('span');
                span.textContent = text[index];
                if (useFade) {
                    span.style.opacity = '0';
                    span.style.transition = 'opacity 0.3s ease';
                    textEl.appendChild(span);
                    requestAnimationFrame(() => { span.style.opacity = '1'; });
                } else {
                    textEl.appendChild(span);
                }
                index++;
            } else {
                clearInterval(typewriterTimer); typewriterTimer = null;
                state.game.isTyping = false;
                cursor.style.display = 'none'; hint.style.display = 'block';
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
            }, (state.settings.autoWait || 3) * 1000);
        }
    }

    function showChoices(choices) {
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
        const customBtn = document.createElement('button');
        customBtn.className = 'choice-btn custom-choice-btn';
        customBtn.textContent = '✏️ 自定义输入';
        customBtn.style.animationDelay = (choices.length * 0.1 + 0.1) + 's';
        customBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            box.classList.add('hidden');
            showCustomInput();
        });
        box.appendChild(customBtn);
    }

    function hideChoices() { $('#choices-box').classList.add('hidden'); }

    function showCustomInput() {
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

    function showAiGenerating(show) {
        const el = $('#ai-generating');
        if (show) el.classList.remove('hidden'); else el.classList.add('hidden');
    }

    function addDialogHistory(name, text) {
        state.game.dialogHistory.push({ name, text, timestamp: Date.now() });
        saveCurrentGame();
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
                overlay.appendChild(dlBtn);
                div.appendChild(img);
                div.appendChild(overlay);
                grid.appendChild(div);
            }
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
        if (state.game.dialogHistory.length > 0) saveCurrentGame();
        switchScreen('title-screen');
        state.game.isAutoPlay = false;
    }

    function openSaveModal(mode) {
        const container = $('#save-slots');
        container.innerHTML = '';
        const saves = Storage.get(STORAGE_KEYS.saves) || {};
        for (let i = 1; i <= 8; i++) {
            const save = saves[i];
            const slot = document.createElement('div');
            slot.className = 'save-slot';
            const numDiv = document.createElement('div');
            numDiv.className = 'slot-number';
            numDiv.textContent = i;
            const infoDiv = document.createElement('div');
            infoDiv.className = 'slot-info';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'slot-title';
            titleDiv.textContent = save ? save.title : '空存档';
            const detailDiv = document.createElement('div');
            detailDiv.className = 'slot-detail';
            detailDiv.textContent = save ? new Date(save.timestamp).toLocaleString('zh-CN') : '——';
            infoDiv.appendChild(titleDiv);
            infoDiv.appendChild(detailDiv);
            slot.appendChild(numDiv);
            slot.appendChild(infoDiv);
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'slot-actions';
            if (save) {
                const loadBtn = document.createElement('button');
                loadBtn.className = 'slot-load';
                loadBtn.textContent = '读取';
                loadBtn.addEventListener('click', e => { e.stopPropagation(); loadFromSlot(i); });
                const delBtn = document.createElement('button');
                delBtn.className = 'slot-delete';
                delBtn.textContent = '删除';
                delBtn.addEventListener('click', e => { e.stopPropagation(); deleteSlot(i); });
                actionsDiv.appendChild(loadBtn);
                actionsDiv.appendChild(delBtn);
                if (mode === 'load') { slot.addEventListener('click', () => loadFromSlot(i)); }
            }
            slot.appendChild(actionsDiv);
            if (mode === 'save') { slot.addEventListener('click', () => saveToSlot(i)); }
            container.appendChild(slot);
        }
        showModal('save-modal');
    }

    function saveToSlot(slotNum) {
        try {
            const saves = Storage.get(STORAGE_KEYS.saves) || {};
            saves[slotNum] = { title: state.game.characterName ? `与${state.game.characterName}的对话` : '冒险记录', timestamp: Date.now(), mode: state.mode, game: JSON.parse(JSON.stringify(state.game)), theme: state.theme };
            Storage.set(STORAGE_KEYS.saves, saves);
            showToast(`已保存到存档 ${slotNum}`, 'success');
        } catch (e) { showToast('存档失败: 存储空间不足', 'error'); }
        hideModal('save-modal');
    }

    function loadFromSlot(slotNum) {
        const saves = Storage.get(STORAGE_KEYS.saves) || {};
        const save = saves[slotNum];
        if (!save) return;
        state.mode = save.mode; state.game = { ...state.game, ...JSON.parse(JSON.stringify(save.game)) };
        if (save.theme) applyTheme(save.theme);
        switchScreen('game-screen'); hideModal('save-modal');
        if (state.game.dialogHistory.length > 0) {
            const last = state.game.dialogHistory[state.game.dialogHistory.length - 1];
            showDialog(last.name, last.text);
            setTimeout(() => {
                showChoices([
                    { text: '继续冒险', action: () => { hideChoices(); if (state.mode === 'ai') handleAiChoice('请继续推进剧情'); } },
                    { text: '返回标题', action: backToTitle },
                ]);
            }, 800);
        }
        showToast(`已读取存档 ${slotNum}`, 'success');
    }

    function deleteSlot(slotNum) {
        const saves = JSON.parse(localStorage.getItem(STORAGE_KEYS.saves) || '{}');
        delete saves[slotNum];
        localStorage.setItem(STORAGE_KEYS.saves, JSON.stringify(saves));
        showToast(`存档 ${slotNum} 已删除`, 'info');
        openSaveModal('load');
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

    document.addEventListener('DOMContentLoaded', init);
})();
