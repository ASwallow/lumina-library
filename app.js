/* ============================================================
   Lumina Library — 主逻辑
   ============================================================ */

// ---- 检测存储驱动 ----
let STORAGE_DRIVER = null;

async function initStorage() {
    // 按优先级尝试驱动
    const drivers = [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE];
    for (const driver of drivers) {
        try {
            localforage.config({ name: 'LuminaLibrary', storeName: 'books', driver: driver });
            await localforage.setItem('_test', 1);
            await localforage.removeItem('_test');
            STORAGE_DRIVER = driver;
            console.log('[Lumina] 存储驱动:', driver);
            return;
        } catch (e) {
            console.warn('[Lumina] 驱动不可用:', driver, e);
        }
    }
    console.error('[Lumina] 无可用存储驱动！');
}

/** 安全存储：拷贝 Uint8Array 内容，避免 ArrayBuffer 被 detach 导致崩溃 */
function uint8ToArray(uint8) {
    return Array.from(uint8);
}
function arrayToUint8(arr) {
    return new Uint8Array(arr);
}

// ---- 推荐语库（52条） ----
const QUOTES = [
    "书是一面镜子，你看见的，只是自己的倒影。",
    "没有一艘船能像一本书，带我们遨游远方。",
    "阅读是一种旅行，不需要护照。",
    "书籍是沉默的老师，却最雄辩。",
    "一个人的阅读史，就是他的精神成长史。",
    "读书不是为了雄辩和驳斥，而是为了思考和权衡。",
    "书中自有千钟粟，书中自有黄金屋，书中自有颜如玉。",
    "读一本好书，就是和一位高尚的人对话。",
    "书籍是造就灵魂的工具。",
    "每一本书都是一个用黑字印在白纸上的灵魂。",
    "光阴给我们经验，读书给我们知识。",
    "读书破万卷，下笔如有神。",
    "书山有路勤为径，学海无涯苦作舟。",
    "书籍是人类进步的阶梯。",
    "读书百遍，其义自见。",
    "书犹药也，善读之可以医愚。",
    "腹有诗书气自华。",
    "问渠那得清如许？为有源头活水来。",
    "旧书不厌百回读，熟读深思子自知。",
    "读书之乐乐何如？绿满窗前草不除。",
    "立身以立学为先，立学以读书为本。",
    "发奋识遍天下字，立志读尽人间书。",
    "鸟欲高飞先振翅，人求上进先读书。",
    "好书是伟大心灵的富贵血脉。",
    "书籍是屹立在时间的汪洋大海中的灯塔。",
    "书是人类的精神食粮。",
    "书籍是培植智慧的工具。",
    "书——这是这一代对另一代精神上的遗训。",
    "读书使人充实，思考使人深邃。",
    "读书是易事，思索是难事。",
    "不读书的人，思想就会停止。",
    "读一切好书，就是和许多高尚的人谈话。",
    "书是我们时代的生命。",
    "好的书籍是最贵重的珍宝。",
    "书籍使人们成为宇宙的主人。",
    "书是思想的产儿。",
    "读书是在别人思想的帮助下，建立起自己的思想。",
    "读书不要贪多，而是要多加思索。",
    "读书患不多，思义患不明。",
    "业精于勤荒于嬉，行成于思毁于随。",
    "三更灯火五更鸡，正是男儿读书时。",
    "书卷多情似故人，晨昏忧乐每相亲。",
    "书到用时方恨少，事非经过不知难。",
    "黑发不知勤学早，白首方悔读书迟。",
    "知之者不如好之者，好之者不如乐之者。",
    "学而不思则罔，思而不学则殆。",
    "千里之行，始于足下。",
    "吾生也有涯，而知也无涯。",
    "三人行，必有我师焉。",
    "玉不琢，不成器；人不学，不知道。",
    "知之为知之，不知为不知，是知也。"
];

// ============================================================
//  全局状态
// ============================================================
localforage.config({ name: 'LuminaLibrary', storeName: 'books' });

let library = [];        // [{ id, name, cover, coverColor, tags, addedAt, pageCount, notes: {text,drawing}, _pdfUint8 (运行时) }]
let readingStats = [];   // [{ bookId, date, duration, page }]
let openedCount = 0;
let currentBookId = null;
let currentCoverBookId = null;
let activeTagFilter = '全部';
let bookNameFontSize = 24; // 书名字号，可调

// 阅读器状态
let pdfDoc = null;
let currentPage = 1;
let totalPages = 1;
let currentZoom = 1.5;
let readStartTime = null;
let readMode = 'single';  // single | double | scroll
let scrollObserver = null; // IntersectionObserver for scroll mode

// 笔记面板状态
let signaturePad = null;
let notesSaveTimer = null;
let currentNotesTab = 'write';

// ============================================================
//  数据持久化
// ============================================================
async function loadState() {
    try {
        const saved = await localforage.getItem('library');
        if (saved && Array.isArray(saved)) library = saved;
        // 兼容旧数据：初始化 notes 字段
        library.forEach(b => {
            if (!b.notes) b.notes = { text: '', drawing: null };
        });
        const stats = await localforage.getItem('readingStats');
        if (stats) readingStats = stats;
        const oc = await localforage.getItem('openedCount');
        if (oc) openedCount = oc;
        // 恢复主题
        const theme = await localforage.getItem('theme');
        if (theme === 'light') applyTheme('light');
        // 恢复阅读模式
        const mode = await localforage.getItem('readMode');
        if (mode) readMode = mode;
        // 恢复书名字号
        const fs = await localforage.getItem('bookNameFontSize');
        if (fs) bookNameFontSize = fs;
        console.log('[Lumina] 加载完成，书库:', library.length, '本');
    } catch (e) {
        console.error('[Lumina] 加载失败:', e);
    }
}

// ============================================================
//  主题切换
// ============================================================
function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        const icon = document.getElementById('theme-icon');
        icon.setAttribute('data-lucide', 'moon');
        lucide.createIcons();
    } else {
        document.body.classList.remove('light-theme');
        const icon = document.getElementById('theme-icon');
        icon.setAttribute('data-lucide', 'sun');
        lucide.createIcons();
    }
}

function toggleTheme() {
    const isLight = document.body.classList.contains('light-theme');
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    localforage.setItem('theme', next);
}

/** 保存书库元数据 */
async function saveLibrary() {
    const meta = library.map(b => ({
        id: b.id, name: b.name, cover: b.cover,
        coverColor: b.coverColor, tags: b.tags,
        addedAt: b.addedAt, pageCount: b.pageCount,
        fileSize: b.fileSize, notes: b.notes
    }));
    await localforage.setItem('library', meta);
}

/** 保存单本书的 PDF 二进制 */
async function savePdfData(bookId, uint8) {
    await localforage.setItem('pdf_' + bookId, uint8ToArray(uint8));
}

/** 加载单本书的 PDF 二进制 */
async function loadPdfData(bookId) {
    const raw = await localforage.getItem('pdf_' + bookId);
    if (!raw) return null;
    return arrayToUint8(raw);
}

async function saveStats() {
    await localforage.setItem('readingStats', readingStats);
    await localforage.setItem('openedCount', openedCount);
}

// ============================================================
//  工具函数
// ============================================================
function escHtml(s) {
    return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
}

/** 文字自动换行，返回行数组 */
function wrapText(ctx, text, maxW) {
    const chars = text.split('');
    const lines = [];
    let line = '';
    for (const ch of chars) {
        if (ctx.measureText(line + ch).width > maxW && line) {
            lines.push(line);
            line = ch;
        } else {
            line += ch;
        }
    }
    if (line) lines.push(line);
    return lines.slice(0, 5);
}

/** 粒子爆炸动画 */
function spawnParticles(x, y, count) {
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = 4 + Math.random() * 8;
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 80;
        p.style.cssText = `
            left:${x}px; top:${y}px;
            width:${size}px; height:${size}px;
            background:hsl(${Math.random() * 360}, 80%, 60%);
            --tx:${Math.cos(angle) * dist}px;
            --ty:${Math.sin(angle) * dist}px;
        `;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1000);
    }
}

// ============================================================
//  页面切换
// ============================================================
function switchTab(tab) {
    document.querySelectorAll('.nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.tab === tab)
    );
    document.getElementById('page-shelf').classList.toggle('hidden', tab !== 'shelf');
    document.getElementById('page-dashboard').classList.toggle('hidden', tab !== 'dashboard');
    if (tab === 'dashboard') {
        try { renderDashboard(); } catch (e) {
            console.error('[Lumina] 统计渲染失败:', e);
        }
    }
}

// ============================================================
//  导入 PDF
// ============================================================
/** 显示/隐藏导入进度提示 */
function showImportToast(text) {
    const toast = document.getElementById('import-toast');
    document.getElementById('import-toast-text').textContent = text;
    toast.classList.add('show');
}
function hideImportToast() {
    document.getElementById('import-toast').classList.remove('show');
}

async function handleImport(event) {
    const files = Array.from(event.target.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length === 0) return;

    const total = files.length;
    let done = 0;
    let skipped = 0;

    for (const file of files) {
        done++;
        showImportToast(`导入中 (${done}/${total}): ${file.name}`);

        const bookName = file.name.replace(/\.pdf$/i, '');

        // 自动去重：书名 + 文件大小 相同则跳过
        const isDuplicate = library.some(b => b.name === bookName && b.fileSize === file.size);
        if (isDuplicate) {
            skipped++;
            console.log('[Lumina] 跳过重复:', file.name);
            continue;
        }

        const bookId = crypto.randomUUID();
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);

        console.log('[Lumina] 导入:', file.name, '大小:', uint8.length, '字节');

        // 先存档，再解析封面
        await savePdfData(bookId, uint8);

        // 提取封面和页数
        const { cover, pageCount } = await extractPdfCoverAndPages(uint8);

        const tag = guessTag(file.name);
        const book = {
            id: bookId,
            name: bookName,
            cover: cover,
            coverColor: null,
            tags: [tag],
            addedAt: Date.now(),
            pageCount: pageCount || 0,
            fileSize: file.size,
            _pdfUint8: uint8
        };

        library.push(book);
    }

    await saveLibrary();

    hideImportToast();
    renderShelf();
    if (skipped > 0) {
        showImportToast(`导入完成，跳过 ${skipped} 本重复书籍`);
        setTimeout(hideImportToast, 3000);
    }
    console.log('[Lumina] 批量导入完成，共', total, '本，跳过重复', skipped, '本，书库:', library.length, '本');

    // 粒子效果
    const rect = event.target.closest('label').getBoundingClientRect();
    spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 16);
    event.target.value = '';
}

/** 一键去重：同名书籍只保留最先导入的一本 */
async function dedupLibrary() {
    const seen = new Map();
    const toRemove = [];

    library.forEach(b => {
        const key = b.name;
        if (seen.has(key)) {
            toRemove.push(b);
        } else {
            seen.set(key, b);
        }
    });

    if (toRemove.length === 0) {
        showToast('没有发现重复书籍');
        return;
    }

    // 删除重复书籍的 PDF 数据
    for (const book of toRemove) {
        await localforage.removeItem('pdf_' + book.id);
    }

    // 清理相关的阅读统计
    const removeIds = new Set(toRemove.map(b => b.id));
    readingStats = readingStats.filter(r => !removeIds.has(r.bookId));
    await saveStats();

    // 更新书库
    library = library.filter(b => !removeIds.has(b.id));
    await saveLibrary();

    renderShelf();
    showToast(`已去除 ${toRemove.length} 本重复书籍`);
    console.log('[Lumina] 去重完成，移除', toRemove.length, '本，剩余:', library.length, '本');
}

function showToast(msg) {
    const p = document.createElement('div');
    p.className = 'import-toast show';
    p.innerHTML = `<span>${escHtml(msg)}</span>`;
    document.body.appendChild(p);
    setTimeout(() => p.classList.remove('show'), 2000);
    setTimeout(() => p.remove(), 2500);
}

/** 带超时的 Promise 包装 */
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`超时: ${label} (${ms}ms)`)), ms)
        )
    ]);
}

/** 通用 PDF 解析：先尝试 Worker，失败/超时回退到主线程 */
async function parsePdf(uint8, timeoutMs) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    // 每次传给 Worker 前拷贝一份，避免 ArrayBuffer 被 detach 后原始数据不可用
    const copy = new Uint8Array(uint8);
    try {
        return await withTimeout(
            pdfjsLib.getDocument({ data: copy }).promise,
            timeoutMs,
            'Worker 解析'
        );
    } catch (e) {
        console.warn('[Lumina] Worker 解析失败，回退主线程:', e.message);
        const fallback = new Uint8Array(uint8);
        return await pdfjsLib.getDocument({ data: fallback, disableWorker: true }).promise;
    }
}

/** 从 PDF 第一页生成封面缩略图 + 获取页数 */
async function extractPdfCoverAndPages(uint8) {
    try {
        const pdf = await parsePdf(uint8, 15000);
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        const cover = await new Promise((resolve) => {
            canvas.toBlob(function(blob) {
                if (!blob) { resolve(null); return; }
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            }, 'image/jpeg', 0.7);
        });

        return { cover: cover, pageCount: pdf.numPages };
    } catch (e) {
        console.warn('[Lumina] PDF 封面提取失败:', e);
        return { cover: null, pageCount: 0 };
    }
}

/** 根据文件名猜测标签 */
function guessTag(name) {
    const n = name.toLowerCase();
    if (/programming|python|java|code|rust|go\b|c\+\+|html|css|js|算法|编程|开发/.test(n)) return '技术';
    if (/novel|story|fiction|小说|文学|散文|诗歌/.test(n)) return '文学';
    if (/history|历史/.test(n)) return '历史';
    if (/science|科学|physics|化学|数学/.test(n)) return '科学';
    if (/philosophy|哲学|mind/.test(n)) return '哲学';
    if (/business|商业|经济|金融|管理/.test(n)) return '商业';
    if (/art|艺术|设计|美术/.test(n)) return '艺术';
    return '其他';
}

// ============================================================
//  生成占位封面（渐变 + PDF标识 + 书名）
// ============================================================
function generatePlaceholder(name) {
    const gradients = [
        ['#4f46e5', '#7c3aed'], ['#059669', '#34d399'],
        ['#dc2626', '#f97316'], ['#0891b2', '#06b6d4'],
        ['#9333ea', '#ec4899'], ['#d97706', '#f59e0b'],
        ['#2563eb', '#60a5fa'], ['#be185d', '#f472b6']
    ];
    const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % gradients.length;
    const [c1, c2] = gradients[idx];

    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 440;
    const ctx = canvas.getContext('2d');

    const g = ctx.createLinearGradient(0, 0, 300, 440);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 300, 440);

    // 装饰圆
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(240, 80, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(60, 380, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // PDF 字样
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = 'bold 72px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('PDF', 150, 210);

    // 书名
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px system-ui, sans-serif';
    const lines = wrapText(ctx, name, 240);
    const startY = 290;
    lines.slice(0, 3).forEach((line, i) => {
        ctx.fillText(line, 150, startY + i * 30);
    });

    return canvas.toDataURL('image/jpeg', 0.85);
}

// ============================================================
//  提取封面主色调
// ============================================================
function extractDominantColor(imgSrc) {
    return new Promise(resolve => {
        if (!imgSrc || imgSrc.length < 10) { resolve('#4f46e5'); return; }
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = 1;
                c.height = 1;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0, 1, 1);
                const d = ctx.getImageData(0, 0, 1, 1).data;
                resolve(`rgb(${d[0]},${d[1]},${d[2]})`);
            } catch (e) {
                resolve('#4f46e5');
            }
        };
        img.onerror = () => resolve('#4f46e5');
        img.src = imgSrc;
    });
}

// ============================================================
//  渲染书架
// ============================================================
function renderShelf() {
    const container = document.getElementById('shelf-container');
    const filterBar = document.getElementById('tag-filter-bar');
    const actionsBar = document.getElementById('shelf-actions');

    if (library.length === 0) {
        filterBar.innerHTML = '';
        if (actionsBar) actionsBar.style.display = 'none';
        container.innerHTML = `
            <div class="empty-shelf">
                <i data-lucide="book-open"></i>
                <p>书架空空如也</p>
                <p class="hint">点击右上角「导入」按钮添加 PDF 电子书</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    if (actionsBar) actionsBar.style.display = '';

    // 收集所有标签及其数量
    const tagCounts = { '全部': library.length };
    library.forEach(b => {
        const tag = b.tags[0] || '其他';
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });

    // 渲染标签筛选栏
    let filterHtml = '';
    for (const [tag, count] of Object.entries(tagCounts)) {
        const active = tag === activeTagFilter ? ' active' : '';
        filterHtml += `<button class="tag-filter-btn${active}" data-tag="${escHtml(tag)}">${escHtml(tag)} <span>${count}</span></button>`;
    }
    filterBar.innerHTML = filterHtml;

    filterBar.querySelectorAll('.tag-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeTagFilter = btn.dataset.tag;
            renderShelf();
        });
    });

    // 筛选书籍
    const filtered = activeTagFilter === '全部'
        ? library
        : library.filter(b => (b.tags[0] || '其他') === activeTagFilter);

    // 按标签分组（全部模式下分组，筛选模式下不分组）
    let html = '';
    if (activeTagFilter === '全部') {
        const groups = {};
        filtered.forEach(b => {
            const tag = b.tags[0] || '其他';
            if (!groups[tag]) groups[tag] = [];
            groups[tag].push(b);
        });
        for (const [tag, books] of Object.entries(groups)) {
            html += renderBookGroup(tag, books);
        }
    } else {
        html = renderBookGroup(activeTagFilter, filtered);
    }

    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.book-card').forEach(card => {
        card.addEventListener('click', () => openDetail(card.dataset.id));
    });

    // 绑定字号滑块
    container.querySelectorAll('.font-size-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            e.stopPropagation();
            const val = parseInt(slider.value);
            bookNameFontSize = val;
            container.querySelectorAll('.book-card-name').forEach(name => {
                name.style.fontSize = val + 'px';
            });
        });
        slider.addEventListener('change', async () => {
            await localforage.setItem('bookNameFontSize', bookNameFontSize);
        });
        slider.addEventListener('click', e => e.stopPropagation());
        slider.addEventListener('mousedown', e => e.stopPropagation());
    });

    lucide.createIcons();
}

function renderBookGroup(tag, books) {
    let html = `<div class="shelf-group-label">${escHtml(tag)} <span>(${books.length})</span></div>`;
    html += `<div class="bookshelf">`;
    for (const book of books) {
        const hasRealCover = book.cover && book.cover.startsWith('data:');
        const coverSrc = hasRealCover ? book.cover : generatePlaceholder(book.name);
        html += `
            <div class="book-card" data-id="${book.id}">
                <div class="book-cover">
                    <img src="${coverSrc}" alt="${escHtml(book.name)}" loading="lazy">
                    <div class="book-spine" style="background:linear-gradient(to right, ${book.coverColor || '#4f46e5'}, transparent);"></div>
                    <div class="book-title-overlay">
                        <div class="name">${escHtml(book.name)}</div>
                        ${book.pageCount ? `<div class="pages">${book.pageCount} 页</div>` : ''}
                    </div>
                </div>
                <div class="book-card-name" style="font-size:${bookNameFontSize}px">${escHtml(book.name)}</div>
                <div class="font-size-control" title="拖动调整字号">
                    <span class="font-size-icon">A</span>
                    <input type="range" class="font-size-slider" min="12" max="48" value="${bookNameFontSize}" data-stop-prop="true">
                    <span class="font-size-icon" style="font-size:16px">A</span>
                </div>
            </div>`;
    }
    html += `</div>`;
    return html;
}

// ============================================================
//  书籍详情页
// ============================================================
async function openDetail(bookId) {
    const book = library.find(b => b.id === bookId);
    if (!book) return;

    const hasRealCover = book.cover && book.cover.startsWith('data:');
    const coverSrc = hasRealCover ? book.cover : generatePlaceholder(book.name);

    // 提取封面主色
    if (!book.coverColor) {
        book.coverColor = await extractDominantColor(coverSrc);
        await saveLibrary();
    }

    const summary = generateSummary(book);
    const content = document.getElementById('detail-content');

    content.innerHTML = `
        <div class="detail-hero">
            <img class="detail-hero-blur" src="${coverSrc}">
            <div class="detail-hero-fade"></div>
        </div>
        <div class="detail-body">
            <div class="detail-top">
                <div class="detail-cover">
                    <img src="${coverSrc}">
                </div>
                <div class="detail-meta">
                    <h2 class="detail-book-name" id="detail-book-name" title="点击编辑书名">${escHtml(book.name)}</h2>
                    <div class="tag-editor" id="tag-editor">
                        <span class="tag tag-current" id="tag-current" title="点击修改分类">
                            ${escHtml(book.tags[0] || '其他')}
                            <i data-lucide="chevron-down" style="width:12px;height:12px;margin-left:4px;"></i>
                        </span>
                        <div class="tag-dropdown" id="tag-dropdown">
                            <div class="tag-dropdown-list" id="tag-dropdown-list"></div>
                            <div class="tag-dropdown-custom">
                                <input type="text" id="tag-custom-input" placeholder="自定义分类..." maxlength="20">
                                <button class="btn btn-primary btn-sm" id="tag-custom-add">添加</button>
                            </div>
                        </div>
                    </div>
                    ${book.pageCount ? `<div class="info">${book.pageCount} 页</div>` : ''}
                    <div class="info">添加于 ${new Date(book.addedAt).toLocaleDateString('zh-CN')}</div>
                    ${(() => {
                        const bookMin = readingStats.filter(s => s.bookId === book.id).reduce((s, r) => s + r.duration, 0);
                        return bookMin > 0 ? `<div class="info">已读 ${bookMin >= 60 ? (bookMin / 60).toFixed(1) + ' 小时' : bookMin + ' 分钟'}</div>` : '';
                    })()}
                </div>
            </div>
            <div class="detail-actions">
                <button class="btn btn-primary" id="btn-read-${book.id}">
                    <i data-lucide="book-open"></i> 开始阅读
                </button>
                <button class="btn" id="btn-cover-${book.id}">
                    <i data-lucide="palette"></i> 生成封面
                </button>
                <button class="btn btn-delete" id="btn-del-${book.id}">
                    <i data-lucide="trash-2"></i> 删除
                </button>
            </div>
            <div class="summary-card">
                <div class="summary-header">
                    <i data-lucide="sparkles"></i>
                    <span>智能摘要</span>
                </div>
                <div class="summary-item">
                    <span class="label">核心看点</span>
                    <p>${summary.highlights}</p>
                </div>
                <div class="summary-item">
                    <span class="label">作者意图</span>
                    <p>${summary.intent}</p>
                </div>
                <div class="summary-item">
                    <span class="label">适合人群</span>
                    <p>${summary.audience}</p>
                </div>
            </div>
        </div>`;

    // 绑定按钮
    document.getElementById(`btn-read-${book.id}`).addEventListener('click', () => startReading(book.id));
    document.getElementById(`btn-cover-${book.id}`).addEventListener('click', () => openCoverGen(book.id));
    document.getElementById(`btn-del-${book.id}`).addEventListener('click', () => deleteBook(book.id));

    // 设置标签编辑器
    setupTagEditor(book);

    // 设置书名编辑
    setupBookNameEditor(book);

    document.getElementById('detail-overlay').classList.add('open');
    lucide.createIcons();
}

// ============================================================
//  标签编辑器
// ============================================================
const DEFAULT_TAGS = ['技术', '文学', '历史', '科学', '哲学', '商业', '艺术', '其他'];

function setupTagEditor(book) {
    const current = document.getElementById('tag-current');
    const dropdown = document.getElementById('tag-dropdown');
    const list = document.getElementById('tag-dropdown-list');
    const customInput = document.getElementById('tag-custom-input');
    const customAdd = document.getElementById('tag-custom-add');

    // 收集所有已有的标签
    const allTags = new Set(DEFAULT_TAGS);
    library.forEach(b => (b.tags || []).forEach(t => allTags.add(t)));

    function renderTagList() {
        list.innerHTML = '';
        allTags.forEach(tag => {
            const div = document.createElement('div');
            div.className = 'tag-option' + (tag === book.tags[0] ? ' active' : '');
            div.textContent = tag;
            div.addEventListener('click', () => selectTag(tag));
            list.appendChild(div);
        });
    }

    function selectTag(tag) {
        book.tags = [tag];
        current.innerHTML = escHtml(tag) + ' <i data-lucide="chevron-down" style="width:12px;height:12px;margin-left:4px;"></i>';
        dropdown.classList.remove('open');
        lucide.createIcons();
        saveLibrary();
        renderShelf(); // 更新书架分组
    }

    // 点击当前标签打开/关闭下拉
    current.addEventListener('click', (e) => {
        e.stopPropagation();
        renderTagList();
        dropdown.classList.toggle('open');
    });
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    // 点击其他地方关闭
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== current) {
            dropdown.classList.remove('open');
        }
    });

    // 自定义标签
    customAdd.addEventListener('click', () => {
        const val = customInput.value.trim();
        if (!val) return;
        allTags.add(val);
        selectTag(val);
        customInput.value = '';
    });
    customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') customAdd.click();
    });
}

// ============================================================
//  书名编辑
// ============================================================
function setupBookNameEditor(book) {
    const el = document.getElementById('detail-book-name');
    if (!el) return;

    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = book.name;
        input.className = 'detail-book-name-input';
        input.style.cssText = 'font-size:inherit;font-weight:inherit;color:inherit;background:var(--bg-surface-hover);border:1px solid #818cf8;border-radius:6px;padding:2px 8px;outline:none;width:100%;box-sizing:border-box;';

        el.replaceWith(input);
        input.focus();
        input.select();

        async function save() {
            const newName = input.value.trim();
            if (newName && newName !== book.name) {
                book.name = newName;
                await saveLibrary();
            }
            const h2 = document.createElement('h2');
            h2.className = 'detail-book-name';
            h2.id = 'detail-book-name';
            h2.title = '点击编辑书名';
            h2.style.cursor = 'pointer';
            h2.textContent = book.name;
            input.replaceWith(h2);
            setupBookNameEditor(book);
        }

        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') { input.value = book.name; input.blur(); }
        });
    });
}

function closeDetail() {
    document.getElementById('detail-overlay').classList.remove('open');
}

// ============================================================
//  模拟智能摘要
// ============================================================
function generateSummary(book) {
    const tag = book.tags[0] || '其他';
    const map = {
        '技术': {
            h: '本书系统讲解核心技术概念与实践方法，从基础原理到高级应用层层递进。丰富的示例和设计思路，帮助读者建立扎实的技术体系。',
            i: '作者希望将复杂的技术知识以最清晰的方式传递给读者，降低学习门槛，提升实践能力。',
            a: '软件工程师、计算机专业学生、技术爱好者'
        },
        '文学': {
            h: '作品以细腻的笔触描绘人物内心世界与时代变迁，语言优美而富有韵味。故事在平淡中见深意，在细节中藏哲理。',
            i: '作者试图通过文字探索人性的深处，与读者共同感受生命中的悲欢离合。',
            a: '文学爱好者、写作爱好者、对人文精神有追求的读者'
        },
        '历史': {
            h: '以时间为线索，梳理重大历史事件的因果脉络。以严谨的考证和生动的叙事，还原历史的复杂面貌。',
            i: '以史为鉴，希望读者能从过去的智慧中找到应对当下的答案。',
            a: '历史爱好者、人文社科研究者、喜欢以史为鉴的读者'
        },
        '科学': {
            h: '从自然现象出发，深入浅出地解释科学原理。书中的思考方式和探索精神，值得每一位读者学习。',
            i: '激发读者对自然世界的好奇心，培养科学思维和理性精神。',
            a: '科学爱好者、理工科学生、对世界充满好奇心的人'
        },
        '哲学': {
            h: '探讨人类存在的根本问题，从认识论到价值论层层推进。每一页都蕴含着对生命意义的深刻追问。',
            i: '引导读者进行深度思考，在纷繁复杂的世界中寻找内心的宁静与方向。',
            a: '哲学爱好者、深度思考者、寻求精神指引的读者'
        },
        '商业': {
            h: '剖析商业世界的底层逻辑与发展趋势，提供可操作的方法论。案例丰富，洞察深刻。',
            i: '帮助读者理解商业运作的本质规律，做出更明智的决策。',
            a: '企业管理者、创业者、MBA学生、职场人士'
        },
        '艺术': {
            h: '从审美的角度审视世界，探讨创作、表达与欣赏的艺术。充满灵感与美的享受。',
            i: '唤醒读者内心的审美意识，让生活充满创意与美感。',
            a: '艺术爱好者、设计师、创意工作者'
        }
    };
    const d = map[tag] || { h: '本书内容丰富，值得细细品味。', i: '作者以真诚的笔触记录了独特的视角和思考。', a: '所有热爱阅读的人' };
    return { highlights: d.h, intent: d.i, audience: d.a };
}

// ============================================================
//  PDF 阅读器
// ============================================================
async function startReading(bookId) {
    const book = library.find(b => b.id === bookId);
    if (!book) return;

    // 如果内存中没有 PDF 数据，从 localForage 加载
    if (!book._pdfUint8) {
        const data = await loadPdfData(bookId);
        if (!data) { alert('PDF 数据丢失，请重新导入'); return; }
        book._pdfUint8 = data;
    }

    closeDetail();
    readStartTime = Date.now();
    currentBookId = bookId;
    currentPage = 1;
    currentZoom = 1.5;
    openedCount++;
    await saveStats();

    document.getElementById('reader-title').textContent = book.name;
    document.getElementById('reader-overlay').classList.add('open');
    lucide.createIcons();

    // 初始化笔记面板
    initNotesPanel(book);

    try {
        pdfDoc = await parsePdf(book._pdfUint8, 30000);

        totalPages = pdfDoc.numPages;

        // 恢复到上次阅读页
        const lastRead = [...readingStats].reverse().find(s => s.bookId === bookId);
        if (lastRead && lastRead.page) {
            currentPage = Math.min(lastRead.page, totalPages);
        }

        // 同步模式按钮状态
        updateModeButtons();
        await renderByMode();
    } catch (e) {
        document.getElementById('reader-body').innerHTML = `
            <div class="loading-center" style="flex-direction:column;gap:12px;">
                <i data-lucide="alert-circle" style="width:48px;height:48px;color:#71717a;"></i>
                <p style="color:var(--text-secondary);">PDF 解析失败</p>
                <p style="color:var(--text-tertiary);font-size:13px;">${escHtml(e.message)}</p>
            </div>`;
        lucide.createIcons();
    }
}

// ============================================================
//  笔记面板
// ============================================================
function initNotesPanel(book) {
    const panel = document.getElementById('notes-panel');
    const textarea = document.getElementById('notes-textarea');
    const preview = document.getElementById('notes-preview');
    const drawWrap = document.getElementById('notes-draw-wrap');

    // 重置面板状态
    panel.classList.add('collapsed');
    currentNotesTab = 'write';
    updateNotesTabUI();

    // 加载笔记内容
    textarea.value = book.notes ? book.notes.text || '' : '';

    // 清空预览和画布
    preview.innerHTML = '';
    drawWrap.classList.add('hidden');

    // 销毁旧的 signaturePad
    if (signaturePad) { signaturePad.off(); signaturePad = null; }

    // 绑定 textarea 自动保存
    textarea.oninput = () => {
        clearTimeout(notesSaveTimer);
        notesSaveTimer = setTimeout(() => saveCurrentNotes(), 500);
    };
}

async function toggleNotesPanel() {
    const panel = document.getElementById('notes-panel');
    panel.classList.toggle('collapsed');
    if (!panel.classList.contains('collapsed')) {
        const savedWidth = await localforage.getItem('notesPanelWidth');
        if (savedWidth) panel.style.width = savedWidth + 'px';
        if (currentNotesTab === 'draw') initSignaturePad();
    }
}

function switchNotesTab(tab) {
    currentNotesTab = tab;
    updateNotesTabUI();

    const textarea = document.getElementById('notes-textarea');
    const preview = document.getElementById('notes-preview');
    const drawWrap = document.getElementById('notes-draw-wrap');

    textarea.classList.toggle('hidden', tab !== 'write');
    preview.classList.toggle('hidden', tab !== 'preview');
    drawWrap.classList.toggle('hidden', tab !== 'draw');

    if (tab === 'preview') {
        renderNotesPreview();
    }
    if (tab === 'draw') {
        initSignaturePad();
    }
}

function updateNotesTabUI() {
    document.querySelectorAll('.notes-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.notesTab === currentNotesTab);
    });
}

function renderNotesPreview() {
    const textarea = document.getElementById('notes-textarea');
    const preview = document.getElementById('notes-preview');
    const text = textarea.value;
    if (!text) {
        preview.innerHTML = '<span style="color:var(--text-tertiary);">暂无笔记，在「编写」tab 中输入内容</span>';
        return;
    }

    let html = (typeof marked !== 'undefined') ? marked.parse(text) : escHtml(text);

    // KaTeX 数学公式渲染：先处理 $$...$$ 块级，再处理 $...$ 行内
    if (typeof katex !== 'undefined') {
        html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
            try { return katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false }); }
            catch { return `<code>${escHtml(expr)}</code>`; }
        });
        html = html.replace(/\$([^\$\n]+?)\$/g, (_, expr) => {
            try { return katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false }); }
            catch { return `<code>${escHtml(expr)}</code>`; }
        });
    }

    preview.innerHTML = html;
}

function initSignaturePad() {
    const canvas = document.getElementById('draw-canvas');
    if (!canvas) return;

    // 如果已初始化且有效，不重复创建
    if (signaturePad && signaturePad._canvas === canvas) return;

    // 适配 canvas 尺寸
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height - 44; // 减去 draw-actions 高度

    if (signaturePad) signaturePad.off();
    signaturePad = new SignaturePad(canvas, {
        penColor: document.body.classList.contains('light-theme') ? '#1a1a20' : '#e0e0e6',
        backgroundColor: 'rgba(0,0,0,0)',
        minWidth: 1,
        maxWidth: 3
    });

    // 加载已有的笔迹
    const book = library.find(b => b.id === currentBookId);
    if (book && book.notes && book.notes.drawing) {
        signaturePad.fromDataURL(book.notes.drawing);
    }

    // 笔迹变化时自动保存
    signaturePad.addEventListener('endStroke', () => {
        clearTimeout(notesSaveTimer);
        notesSaveTimer = setTimeout(() => saveCurrentNotes(), 500);
    });

    signaturePad._canvas = canvas;
}

async function saveCurrentNotes() {
    if (!currentBookId) return;
    const book = library.find(b => b.id === currentBookId);
    if (!book) return;

    if (!book.notes) book.notes = { text: '', drawing: null };

    const textarea = document.getElementById('notes-textarea');
    if (textarea) book.notes.text = textarea.value;

    if (signaturePad && !signaturePad.isEmpty()) {
        book.notes.drawing = signaturePad.toDataURL();
    }

    await saveLibrary();
}

function initNotesPanelResize() {
    const handle = document.getElementById('notes-panel-resize');
    const panel = document.getElementById('notes-panel');
    if (!handle || !panel) return;

    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        handle.classList.add('dragging');
        panel.style.transition = 'none';

        function onMove(e) {
            const dx = startX - e.clientX;
            const newWidth = Math.max(220, Math.min(600, startWidth + dx));
            panel.style.width = newWidth + 'px';
        }

        function onUp() {
            handle.classList.remove('dragging');
            panel.style.transition = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            localforage.setItem('notesPanelWidth', panel.offsetWidth);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ============================================================
//  阅读模式切换
// ============================================================
function setReadMode(mode) {
    readMode = mode;
    localforage.setItem('readMode', mode);
    updateModeButtons();
    cleanupScrollObserver();
    renderByMode();
}

function updateModeButtons() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === readMode);
    });
}

async function renderByMode() {
    if (!pdfDoc) return;
    if (readMode === 'single') await renderSinglePage();
    else if (readMode === 'double') await renderDoublePage();
    else if (readMode === 'scroll') await renderScrollMode();
}

function updatePageUI() {
    document.getElementById('page-indicator').textContent = `${currentPage} / ${totalPages}`;
    document.getElementById('zoom-indicator').textContent = `${Math.round(currentZoom / 1.5 * 100)}%`;
    document.getElementById('reader-progress-fill').style.width = `${(currentPage / totalPages) * 100}%`;
}

// ---- 单页模式 ----
async function renderSinglePage() {
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: currentZoom });
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);

    const body = document.getElementById('reader-body');
    body.className = 'reader-body';
    body.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.id = 'pdf-canvas';
    canvas.width = w;
    canvas.height = h;
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    canvas.style.boxShadow = 'var(--shadow-canvas)';
    canvas.style.borderRadius = '4px';
    body.appendChild(canvas);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    canvas.classList.add('page-flip');
    setTimeout(() => canvas.classList.remove('page-flip'), 400);
    updatePageUI();
}

// ---- 双页模式 ----
async function renderDoublePage() {
    const leftPage = currentPage;
    const rightPage = currentPage + 1 <= totalPages ? currentPage + 1 : null;
    const gap = 16;

    const p1 = await pdfDoc.getPage(leftPage);
    const v1 = p1.getViewport({ scale: currentZoom });

    let canvasW, canvasH;
    let canvas;

    const body = document.getElementById('reader-body');
    body.className = 'reader-body';
    body.innerHTML = '';

    if (rightPage) {
        const p2 = await pdfDoc.getPage(rightPage);
        const v2 = p2.getViewport({ scale: currentZoom });
        canvasW = Math.floor(v1.width) + gap + Math.floor(v2.width);
        canvasH = Math.max(Math.floor(v1.height), Math.floor(v2.height));

        canvas = document.createElement('canvas');
        canvas.id = 'pdf-canvas';
        canvas.width = canvasW;
        canvas.height = canvasH;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto';
        canvas.style.boxShadow = 'var(--shadow-canvas)';
        canvas.style.borderRadius = '4px';
        body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = document.body.classList.contains('light-theme') ? '#e0e0e6' : '#1a1a20';
        ctx.fillRect(Math.floor(v1.width), 0, gap, canvasH);

        await p1.render({ canvasContext: ctx, viewport: v1 }).promise;
        ctx.save();
        ctx.translate(Math.floor(v1.width) + gap, 0);
        await p2.render({ canvasContext: ctx, viewport: v2 }).promise;
        ctx.restore();
    } else {
        canvasW = Math.floor(v1.width);
        canvasH = Math.floor(v1.height);

        canvas = document.createElement('canvas');
        canvas.id = 'pdf-canvas';
        canvas.width = canvasW;
        canvas.height = canvasH;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto';
        canvas.style.boxShadow = 'var(--shadow-canvas)';
        canvas.style.borderRadius = '4px';
        body.appendChild(canvas);

        await p1.render({ canvasContext: canvas.getContext('2d'), viewport: v1 }).promise;
    }

    canvas.classList.add('page-flip');
    setTimeout(() => canvas.classList.remove('page-flip'), 400);
    updatePageUI();
}

// ---- 滚动模式 ----
async function renderScrollMode() {
    const body = document.getElementById('reader-body');
    body.className = 'reader-scroll';
    body.innerHTML = '';

    // 创建所有 canvas 占位
    for (let i = 1; i <= totalPages; i++) {
        const canvas = document.createElement('canvas');
        canvas.id = 'scroll-page-' + i;
        canvas.dataset.page = i;
        // 预设 CSS 宽度，让页面撑开；高度由渲染后确定
        canvas.style.width = 'min(100%, ' + Math.round(612 * currentZoom / 1.5) + 'px)';
        body.appendChild(canvas);
    }

    // IntersectionObserver 懒渲染
    cleanupScrollObserver();
    scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const canvas = entry.target;
                const pn = parseInt(canvas.dataset.page);
                if (!canvas.dataset.rendered) renderScrollPage(canvas, pn);
                currentPage = pn;
                updatePageUI();
            }
        });
    }, { root: body, rootMargin: '200px', threshold: 0.01 });

    body.querySelectorAll('canvas').forEach(c => scrollObserver.observe(c));
    updatePageUI();

    // 滚动到当前页
    const target = document.getElementById('scroll-page-' + currentPage);
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
}

async function renderScrollPage(canvas, pageNum) {
    if (canvas.dataset.rendered === '1') return;
    canvas.dataset.rendered = '1';
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: currentZoom });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch (e) {
        canvas.dataset.rendered = '';
        console.warn('渲染第', pageNum, '页失败:', e);
    }
}

function cleanupScrollObserver() {
    if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
}

// ---- 导航 ----
function prevPage() {
    if (readMode === 'scroll') {
        const target = document.getElementById('scroll-page-' + Math.max(1, currentPage - 1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const step = readMode === 'double' ? 2 : 1;
    if (currentPage > 1) { currentPage = Math.max(1, currentPage - step); renderByMode(); }
}
function nextPage() {
    if (readMode === 'scroll') {
        const target = document.getElementById('scroll-page-' + Math.min(totalPages, currentPage + 1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const step = readMode === 'double' ? 2 : 1;
    if (currentPage < totalPages) { currentPage = Math.min(totalPages, currentPage + step); renderByMode(); }
}
function zoomIn() {
    if (currentZoom < 3) { currentZoom += 0.25; applyZoom(); }
}
function zoomOut() {
    if (currentZoom > 0.75) { currentZoom -= 0.25; applyZoom(); }
}
function applyZoom() {
    if (readMode === 'scroll') {
        // 滚动模式：只更新占位宽度 + 重置渲染标记，不立即重渲染
        // IntersectionObserver 会在用户滚动时自动重渲染可见页
        const body = document.getElementById('reader-body');
        body.querySelectorAll('canvas').forEach(c => {
            c.dataset.rendered = '';  // 标记为未渲染
            c.style.width = 'min(100%, ' + Math.round(612 * currentZoom / 1.5) + 'px)';
        });
        // 手动触发当前可见页的 observer
        if (scrollObserver) {
            body.querySelectorAll('canvas').forEach(c => {
                const rect = c.getBoundingClientRect();
                const rootRect = body.getBoundingClientRect();
                if (rect.top < rootRect.bottom && rect.bottom > rootRect.top) {
                    if (!c.dataset.rendered) renderScrollPage(c, parseInt(c.dataset.page));
                }
            });
        }
        updatePageUI();
    } else {
        // 单页/双页模式：直接重渲染
        renderByMode();
    }
}

/** 保存当前阅读进度（供 closeReader 和 beforeunload 调用） */
function recordReadingStat() {
    if (!readStartTime || !currentBookId) return;
    // Math.ceil：即使只读了 30 秒也记为 1 分钟，不丢数据
    const duration = Math.max(1, Math.ceil((Date.now() - readStartTime) / 60000));
    readingStats.push({
        bookId: currentBookId,
        date: new Date().toISOString().slice(0, 10),
        duration,
        page: currentPage
    });
    // 同步保存（不 await，供 beforeunload 使用）
    localforage.setItem('readingStats', readingStats);
    localforage.setItem('openedCount', openedCount);
    readStartTime = Date.now(); // 重置起点，避免重复累计
}

async function closeReader() {
    recordReadingStat();
    cleanupScrollObserver();

    // 保存笔记
    await saveCurrentNotes();

    document.getElementById('reader-overlay').classList.remove('open');
    pdfDoc = null;
    currentBookId = null;
    readStartTime = null;

    renderShelf();
}

// ============================================================
//  删除书籍
// ============================================================
async function deleteBook(bookId) {
    if (!confirm('确定删除这本书吗？')) return;
    library = library.filter(b => b.id !== bookId);
    readingStats = readingStats.filter(s => s.bookId !== bookId);
    await localforage.removeItem('pdf_' + bookId); // 清理 PDF 二进制
    await saveLibrary();
    await saveStats();
    closeDetail();
    renderShelf();
}

// ============================================================
//  今日推荐
// ============================================================
function randomRecommend() {
    if (library.length === 0) {
        alert('书库为空，请先导入书籍');
        return;
    }
    const book = library[Math.floor(Math.random() * library.length)];
    const hasRealCover = book.cover && book.cover.startsWith('data:');
    const coverSrc = hasRealCover ? book.cover : generatePlaceholder(book.name);
    document.getElementById('recommend-cover').innerHTML =
        `<img src="${coverSrc}">`;
    document.getElementById('recommend-title').textContent = book.name;
    document.getElementById('recommend-quote').textContent =
        `"${QUOTES[Math.floor(Math.random() * QUOTES.length)]}"`;
    document.getElementById('recommend-overlay').classList.add('open');
}

function closeRecommend() {
    document.getElementById('recommend-overlay').classList.remove('open');
}

// ============================================================
//  艺术封面生成器（蒙德里安 / 波普风格）
// ============================================================
function openCoverGen(bookId) {
    currentCoverBookId = bookId;
    document.getElementById('cover-gen-modal').classList.add('open');
    generateArtCover();
}

function closeCoverGen() {
    document.getElementById('cover-gen-modal').classList.remove('open');
}

function generateArtCover() {
    const book = library.find(b => b.id === currentCoverBookId);
    if (!book) return;

    const canvas = document.getElementById('cover-canvas');
    const ctx = canvas.getContext('2d');
    const W = 300, H = 440;
    const style = Math.random() > 0.5 ? 0 : 1;

    if (style === 0) {
        // ---- 蒙德里安风格 ----
        ctx.fillStyle = '#f5f0e8';
        ctx.fillRect(0, 0, W, H);

        const colors = ['#c0392b', '#2980b9', '#f1c40f', '#2c3e50', '#e67e22', '#1abc9c', '#8e44ad'];
        const lineW = 3 + Math.random() * 3;
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = lineW;

        const hLines = [], vLines = [];
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
            const y = 40 + Math.random() * (H - 80);
            hLines.push(y);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
            const x = 30 + Math.random() * (W - 60);
            vLines.push(x);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }

        // 随机填色
        const bounds = [0, ...hLines.sort((a, b) => a - b), H];
        const cols = [0, ...vLines.sort((a, b) => a - b), W];
        for (let i = 0; i < bounds.length - 1; i++) {
            for (let j = 0; j < cols.length - 1; j++) {
                if (Math.random() > 0.35) {
                    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
                    ctx.fillRect(
                        cols[j] + lineW, bounds[i] + lineW,
                        cols[j + 1] - cols[j] - lineW * 2,
                        bounds[i + 1] - bounds[i] - lineW * 2
                    );
                }
            }
        }
    } else {
        // ---- 波普艺术风格 ----
        const baseHue = Math.random() * 360;
        ctx.fillStyle = `hsl(${baseHue}, 70%, 50%)`;
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < 30; i++) {
            const x = Math.random() * W;
            const y = Math.random() * H;
            const r = 10 + Math.random() * 50;
            const hue = (Math.random() * 60 + baseHue) % 360;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${hue}, 90%, 60%, 0.6)`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${hue}, 90%, 30%, 0.8)`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // 条纹叠加
        if (Math.random() > 0.5) {
            ctx.globalAlpha = 0.3;
            for (let i = 0; i < H; i += 8) {
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, i, W, 3);
            }
            ctx.globalAlpha = 1;
        }
    }

    // 书名标签
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(20, H - 100, W - 40, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nameLines = wrapText(ctx, book.name, W - 60);
    nameLines.slice(0, 2).forEach((line, i) => {
        ctx.fillText(line, W / 2, H - 70 + (i - (Math.min(nameLines.length, 2) - 1) / 2) * 22);
    });
}

async function applyArtCover() {
    const book = library.find(b => b.id === currentCoverBookId);
    if (!book) return;
    const canvas = document.getElementById('cover-canvas');
    book.cover = canvas.toDataURL('image/jpeg', 0.9);
    book.coverColor = null; // 重置以便重新提取
    await saveLibrary();
    closeCoverGen();
    renderShelf();
    openDetail(book.id);
}

// ============================================================
//  统计仪表盘
// ============================================================
let weeklyChart = null;
let tagsChart = null;

function renderDashboard() {
    // 统计数字
    document.getElementById('stat-total').textContent = library.length;
    const totalMinutes = readingStats.reduce((s, r) => s + r.duration, 0);
    document.getElementById('stat-time').textContent =
        totalMinutes >= 60 ? (totalMinutes / 60).toFixed(1) + 'h' : totalMinutes + 'min';
    document.getElementById('stat-opened').textContent = openedCount;

    // ---- 单本书阅读时长 ----
    const bookTimes = {};
    readingStats.forEach(r => {
        bookTimes[r.bookId] = (bookTimes[r.bookId] || 0) + r.duration;
    });
    // 按时长降序排列
    const sorted = Object.entries(bookTimes)
        .map(([id, min]) => ({ id, min, book: library.find(b => b.id === id) }))
        .filter(e => e.book)
        .sort((a, b) => b.min - a.min);

    const container = document.getElementById('per-book-stats');
    if (sorted.length === 0) {
        container.innerHTML = '<div class="per-book-empty">暂无阅读记录</div>';
    } else {
        const maxMin = sorted[0].min;
        container.innerHTML = '<div class="per-book-list">' + sorted.map((e, i) => {
            const pct = maxMin > 0 ? (e.min / maxMin * 100) : 0;
            const label = e.min >= 60 ? (e.min / 60).toFixed(1) + 'h' : e.min + 'min';
            return `<div class="per-book-row">
                <span class="per-book-rank">${i + 1}</span>
                <span class="per-book-name">${escHtml(e.book.name)}</span>
                <div class="per-book-bar-wrap"><div class="per-book-bar-fill" style="width:${pct}%"></div></div>
                <span class="per-book-time">${label}</span>
            </div>`;
        }).join('') + '</div>';
    }

    // ---- 按周柱状图 ----
    const weekData = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(5, 10); // MM-DD
        weekData[key] = 0;
    }
    readingStats.forEach(r => {
        const key = r.date.slice(5, 10);
        if (weekData[key] !== undefined) weekData[key] += r.duration;
    });

    const ctx1 = document.getElementById('chart-weekly');
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: Object.keys(weekData),
            datasets: [{
                label: '分钟',
                data: Object.values(weekData),
                backgroundColor: 'rgba(99,102,241,0.6)',
                borderColor: 'rgba(99,102,241,1)',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: '#71717a' },
                    grid: { color: 'rgba(255,255,255,0.03)' }
                },
                y: {
                    ticks: { color: '#71717a' },
                    grid: { color: 'rgba(255,255,255,0.03)' }
                }
            }
        }
    });

    // ---- 标签饼图 ----
    const tagCounts = {};
    library.forEach(b => {
        const t = b.tags[0] || '其他';
        tagCounts[t] = (tagCounts[t] || 0) + 1;
    });

    const ctx2 = document.getElementById('chart-tags');
    if (tagsChart) tagsChart.destroy();
    const tagColors = [
        '#6366f1', '#ec4899', '#f59e0b', '#10b981',
        '#06b6d4', '#8b5cf6', '#ef4444'
    ];
    tagsChart = new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: Object.keys(tagCounts),
            datasets: [{
                data: Object.values(tagCounts),
                backgroundColor: tagColors.slice(0, Object.keys(tagCounts).length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#a1a1aa',
                        padding: 16,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                }
            }
        }
    });
}

// ============================================================
//  事件绑定
// ============================================================
function bindEvents() {
    // 主题切换
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // 导航标签切换
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 导入按钮
    document.querySelector('#import-btn input').addEventListener('change', handleImport);

    // 一键去重
    document.getElementById('btn-dedup').addEventListener('click', dedupLibrary);

    // 详情背景点击关闭
    document.getElementById('detail-bg').addEventListener('click', closeDetail);

    // 推荐弹窗
    document.getElementById('fab-recommend').addEventListener('click', randomRecommend);
    document.getElementById('recommend-backdrop').addEventListener('click', closeRecommend);
    document.getElementById('btn-close-recommend').addEventListener('click', closeRecommend);

    // 封面生成器
    document.getElementById('btn-close-cover-gen').addEventListener('click', closeCoverGen);
    document.getElementById('btn-regen-cover').addEventListener('click', generateArtCover);
    document.getElementById('btn-apply-cover').addEventListener('click', applyArtCover);

    // 阅读器
    document.getElementById('btn-close-reader').addEventListener('click', closeReader);
    document.getElementById('btn-prev-page').addEventListener('click', prevPage);
    document.getElementById('btn-next-page').addEventListener('click', nextPage);
    document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
    document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);

    // 阅读模式选择
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setReadMode(btn.dataset.mode));
    });

    // 笔记面板
    document.getElementById('btn-toggle-notes-panel').addEventListener('click', toggleNotesPanel);
    document.getElementById('btn-close-notes-panel').addEventListener('click', toggleNotesPanel);
    document.querySelectorAll('.notes-tab').forEach(btn => {
        btn.addEventListener('click', () => switchNotesTab(btn.dataset.notesTab));
    });
    document.getElementById('btn-clear-draw').addEventListener('click', () => {
        if (signaturePad) { signaturePad.clear(); saveCurrentNotes(); }
    });
    document.getElementById('btn-undo-draw').addEventListener('click', () => {
        if (!signaturePad) return;
        const data = signaturePad.toData();
        if (data.length > 0) { data.pop(); signaturePad.fromData(data); saveCurrentNotes(); }
    });

    // 笔记面板拖拽调整宽度
    initNotesPanelResize();

    // 键盘快捷键
    document.addEventListener('keydown', e => {
        if (!document.getElementById('reader-overlay').classList.contains('open')) return;
        switch (e.key) {
            case 'ArrowLeft': prevPage(); break;
            case 'ArrowRight': nextPage(); break;
            case 'Escape': closeReader(); break;
            case '+': case '=': zoomIn(); break;
            case '-': zoomOut(); break;
        }
    });

    // 关闭浏览器/标签页时保存阅读进度
    window.addEventListener('beforeunload', () => {
        recordReadingStat();
    });
}

// ============================================================
//  初始化
// ============================================================
(async function init() {
    try {
        await initStorage();
        await loadState();
        bindEvents();
        renderShelf();
        lucide.createIcons();
        console.log('[Lumina] 初始化完成，驱动:', STORAGE_DRIVER, '书籍:', library.length);
    } catch (e) {
        console.error('[Lumina] 初始化失败:', e);
        document.getElementById('shelf-container').innerHTML =
            '<div class="empty-shelf"><p>初始化失败，请按 F12 查看控制台</p><p class="hint">' + escHtml(e.message) + '</p></div>';
    }
})();