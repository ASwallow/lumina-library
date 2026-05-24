/* ============================================================
   yread Lib — 主逻辑
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

// 目录侧边栏状态
let tocOutline = null;       // 缓存的outline结构 [{title, pageNum, items:[]}]
let tocOpen = false;

// PDF搜索状态
let pdfSearchOpen = false;
let pageTextCache = {};      // {pageNum: [{str, transform}]}
let searchMatches = [];      // [{pageNum, itemIndex, startIdx, endIdx}]
let searchCurrentIdx = -1;
let searchQuery = '';
let searchDebounceTimer = null;

// 笔记面板状态
let signaturePad = null;
let notesSaveTimer = null;
let currentNotesTab = 'write';

// 论文状态
let papers = [];               // [{ id, name, cover, coverColor, tags, status, addedAt, pageCount, fileSize, author, journal, year, doi, url, notes, description, highlights: [{page,x,y,w,h}], _pdfUint8 }]
let activePaperTagFilter = '全部';
let activePaperStatusFilter = '全部';
let currentTab = 'shelf';      // shelf | papers | dashboard
let isPaperReader = false;     // 当前阅读器是否在读论文
let highlightMode = false;     // 高亮标注模式
let selectedHighlight = null;

const DEFAULT_PAPER_TAGS = ['计算机', '数学', '物理', '工程', '经济', '生物', '医学', '社科', '其他'];
const READING_STATUS = { unread: '未读', reading: '在读', finished: '已读', reread: '重读' };

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
        // 加载论文
        const savedPapers = await localforage.getItem('papers');
        if (savedPapers && Array.isArray(savedPapers)) papers = savedPapers;
        papers.forEach(p => {
            if (!p.notes) p.notes = { text: '', drawing: null };
            if (!p.highlights) p.highlights = [];
            if (!p.status) p.status = 'unread';
        });
        console.log('[Lumina] 加载完成，书库:', library.length, '本，论文:', papers.length, '篇');
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
        fileSize: b.fileSize, notes: b.notes,
        description: b.description || ''
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

/** 保存论文元数据 */
async function savePapers() {
    const meta = papers.map(p => ({
        id: p.id, name: p.name, cover: p.cover,
        coverColor: p.coverColor, tags: p.tags, status: p.status,
        addedAt: p.addedAt, pageCount: p.pageCount, fileSize: p.fileSize,
        author: p.author || '', journal: p.journal || '', year: p.year || '',
        doi: p.doi || '', url: p.url || '',
        notes: p.notes, description: p.description || '',
        highlights: p.highlights || []
    }));
    await localforage.setItem('papers', meta);
}

/** 保存/加载论文 PDF 二进制 */
async function savePaperPdfData(paperId, uint8) {
    await localforage.setItem('pdf_paper_' + paperId, uint8ToArray(uint8));
}
async function loadPaperPdfData(paperId) {
    const raw = await localforage.getItem('pdf_paper_' + paperId);
    if (!raw) return null;
    return arrayToUint8(raw);
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
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.tab === tab)
    );
    document.getElementById('page-shelf').classList.toggle('hidden', tab !== 'shelf');
    document.getElementById('page-papers').classList.toggle('hidden', tab !== 'papers');
    document.getElementById('page-dashboard').classList.toggle('hidden', tab !== 'dashboard');
    // 更新导入按钮标签
    document.getElementById('import-btn-label').textContent = tab === 'papers' ? '导入论文' : '批量导入';
    if (tab === 'papers') {
        renderPapersShelf();
    } else if (tab === 'dashboard') {
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
    if (currentTab === 'papers') {
        return handlePaperImport(event);
    }
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

/** 根据文件名猜测论文标签 */
function guessPaperTag(name) {
    const n = name.toLowerCase();
    if (/computer|算法|computing|machine learning|deep learning|neural|ai\b|nlp|cv\b|编程|software|database|网络|security/.test(n)) return '计算机';
    if (/math|数学|algebra|calculus|statistics|概率|optimization/.test(n)) return '数学';
    if (/physics|物理|quantum|力学|光学|thermodynamics/.test(n)) return '物理';
    if (/engineer|工程|电路|mechanical|材料|civil|chemical/.test(n)) return '工程';
    if (/econom|经济|金融|finance|market|trade|business/.test(n)) return '经济';
    if (/biolog|生物|genetic|基因|cell|ecology|evolution/.test(n)) return '生物';
    if (/medic|医学|临床|clinical|health|药学|pharma/.test(n)) return '医学';
    if (/social|社科|sociology|psychology|政治|law|教育/.test(n)) return '社科';
    return '其他';
}

// ============================================================
//  导入论文
// ============================================================
async function handlePaperImport(event) {
    const files = Array.from(event.target.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length === 0) return;

    const total = files.length;
    let done = 0;
    let skipped = 0;

    for (const file of files) {
        done++;
        showImportToast(`导入论文 (${done}/${total}): ${file.name}`);

        const paperName = file.name.replace(/\.pdf$/i, '');
        const isDuplicate = papers.some(p => p.name === paperName && p.fileSize === file.size);
        if (isDuplicate) { skipped++; continue; }

        const paperId = crypto.randomUUID();
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);

        await savePaperPdfData(paperId, uint8);
        const { cover, pageCount } = await extractPdfCoverAndPages(uint8);
        const tag = guessPaperTag(file.name);

        papers.push({
            id: paperId, name: paperName, cover, coverColor: null,
            tags: [tag], status: 'unread', addedAt: Date.now(),
            pageCount: pageCount || 0, fileSize: file.size,
            author: '', journal: '', year: '', doi: '', url: '',
            notes: { text: '', drawing: null }, description: '',
            highlights: [], _pdfUint8: uint8
        });
    }

    await savePapers();
    hideImportToast();
    renderPapersShelf();
    if (skipped > 0) {
        showImportToast(`导入完成，跳过 ${skipped} 篇重复论文`);
        setTimeout(hideImportToast, 3000);
    }
    const rect = event.target.closest('label').getBoundingClientRect();
    spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 16);
    event.target.value = '';
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
//  渲染论文列表
// ============================================================
function renderPapersShelf() {
    const container = document.getElementById('papers-container');
    const tagBar = document.getElementById('paper-tag-filter-bar');
    const statusBar = document.getElementById('paper-status-filter-bar');

    if (papers.length === 0) {
        tagBar.innerHTML = '';
        statusBar.innerHTML = '';
        container.innerHTML = `
            <div class="empty-shelf">
                <i data-lucide="file-text"></i>
                <p>论文库为空</p>
                <p class="hint">点击右上角「导入论文」按钮添加 PDF 论文</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    // 标签筛选
    const tagCounts = { '全部': papers.length };
    papers.forEach(p => {
        const t = p.tags[0] || '其他';
        tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
    tagBar.innerHTML = Object.entries(tagCounts).map(([tag, count]) =>
        `<button class="tag-filter-btn${tag === activePaperTagFilter ? ' active' : ''}" data-tag="${escHtml(tag)}">${escHtml(tag)} <span>${count}</span></button>`
    ).join('');
    tagBar.querySelectorAll('.tag-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => { activePaperTagFilter = btn.dataset.tag; renderPapersShelf(); });
    });

    // 状态筛选
    const statusCounts = { '全部': papers.length };
    papers.forEach(p => { const s = p.status || 'unread'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
    statusBar.innerHTML = `<button class="status-filter-btn${activePaperStatusFilter === '全部' ? ' active' : ''}" data-status="全部">全部 <span>${papers.length}</span></button>` +
        Object.entries(READING_STATUS).map(([key, label]) => {
            const count = statusCounts[key] || 0;
            return `<button class="status-filter-btn${activePaperStatusFilter === key ? ' active' : ''}" data-status="${key}">
                <span class="status-dot status-dot-${key}"></span>${label} <span>${count}</span></button>`;
        }).join('');
    statusBar.querySelectorAll('.status-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => { activePaperStatusFilter = btn.dataset.status; renderPapersShelf(); });
    });

    // 筛选
    let filtered = papers;
    if (activePaperTagFilter !== '全部') filtered = filtered.filter(p => (p.tags[0] || '其他') === activePaperTagFilter);
    if (activePaperStatusFilter !== '全部') filtered = filtered.filter(p => (p.status || 'unread') === activePaperStatusFilter);

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-shelf"><p>没有匹配的论文</p></div>';
        lucide.createIcons();
        return;
    }

    container.innerHTML = `<div class="papers-grid">${filtered.map(paper => {
        const hasRealCover = paper.cover && paper.cover.startsWith('data:');
        const coverSrc = hasRealCover ? paper.cover : generatePlaceholder(paper.name);
        const statusLabel = READING_STATUS[paper.status || 'unread'] || '未读';
        const metaParts = [];
        if (paper.author) metaParts.push(paper.author);
        if (paper.year) metaParts.push(paper.year);
        if (paper.pageCount) metaParts.push(paper.pageCount + '页');
        return `<div class="paper-card" data-id="${paper.id}">
            <div class="paper-card-cover">
                <img src="${coverSrc}" alt="${escHtml(paper.name)}" loading="lazy">
                <span class="paper-status-badge ${paper.status || 'unread'}">${statusLabel}</span>
            </div>
            <div class="paper-card-body">
                <div class="paper-card-title">${escHtml(paper.name)}</div>
                <div class="paper-card-meta">${escHtml(metaParts.join(' · ') || '暂无元数据')}</div>
            </div>
        </div>`;
    }).join('')}</div>`;

    container.querySelectorAll('.paper-card').forEach(card => {
        card.addEventListener('click', () => openPaperDetail(card.dataset.id));
    });
    lucide.createIcons();
}

/** 论文一键去重 */
async function dedupPapers() {
    const seen = new Map();
    const toRemove = [];
    papers.forEach(p => {
        if (seen.has(p.name)) toRemove.push(p);
        else seen.set(p.name, p);
    });
    if (toRemove.length === 0) { showToast('没有发现重复论文'); return; }
    for (const p of toRemove) await localforage.removeItem('pdf_paper_' + p.id);
    const removeIds = new Set(toRemove.map(p => p.id));
    readingStats = readingStats.filter(r => !removeIds.has(r.bookId));
    papers = papers.filter(p => !removeIds.has(p.id));
    await savePapers();
    await saveStats();
    renderPapersShelf();
    showToast(`已去除 ${toRemove.length} 篇重复论文`);
}

// ============================================================
//  论文详情页
// ============================================================
async function openPaperDetail(paperId) {
    const paper = papers.find(p => p.id === paperId);
    if (!paper) return;

    const hasRealCover = paper.cover && paper.cover.startsWith('data:');
    const coverSrc = hasRealCover ? paper.cover : generatePlaceholder(paper.name);
    if (!paper.coverColor) {
        paper.coverColor = await extractDominantColor(coverSrc);
        await savePapers();
    }

    const content = document.getElementById('paper-detail-content');
    content.innerHTML = `
        <div class="detail-hero">
            <img class="detail-hero-blur" src="${coverSrc}">
            <div class="detail-hero-fade"></div>
        </div>
        <div class="detail-body">
            <div class="detail-top">
                <div class="detail-cover"><img src="${coverSrc}"></div>
                <div class="detail-meta">
                    <h2 class="detail-book-name" id="paper-detail-name" title="点击编辑">${escHtml(paper.name)}</h2>
                    <div class="tag-editor" id="paper-tag-editor">
                        <span class="tag tag-current" id="paper-tag-current" title="点击修改分类">
                            ${escHtml(paper.tags[0] || '其他')}
                            <i data-lucide="chevron-down" style="width:12px;height:12px;margin-left:4px;"></i>
                        </span>
                        <div class="tag-dropdown" id="paper-tag-dropdown">
                            <div class="tag-dropdown-list" id="paper-tag-dropdown-list"></div>
                            <div class="tag-dropdown-custom">
                                <input type="text" id="paper-tag-custom-input" placeholder="自定义分类..." maxlength="20">
                                <button class="btn btn-primary btn-sm" id="paper-tag-custom-add">添加</button>
                            </div>
                        </div>
                    </div>
                    ${paper.pageCount ? `<div class="info">${paper.pageCount} 页</div>` : ''}
                    <div class="info">添加于 ${new Date(paper.addedAt).toLocaleDateString('zh-CN')}</div>
                </div>
            </div>
            <!-- 阅读状态 -->
            <div class="summary-card" style="margin-top:16px;">
                <div class="summary-header"><i data-lucide="book-marked"></i><span>阅读状态</span></div>
                <div class="status-selector">
                    ${Object.entries(READING_STATUS).map(([key, label]) =>
                        `<button class="status-option${paper.status === key ? ' active' : ''}" data-status="${key}">
                            <span class="status-dot status-dot-${key}"></span>${label}
                        </button>`
                    ).join('')}
                </div>
            </div>
            <!-- 元数据 -->
            <div class="summary-card">
                <div class="summary-header"><i data-lucide="info"></i><span>论文信息</span></div>
                <div class="meta-edit-row"><label>作者</label><input type="text" class="meta-field" data-field="author" value="${escHtml(paper.author || '')}" placeholder="作者姓名"></div>
                <div class="meta-edit-row"><label>期刊</label><input type="text" class="meta-field" data-field="journal" value="${escHtml(paper.journal || '')}" placeholder="期刊/会议名称"></div>
                <div class="meta-edit-row"><label>年份</label><input type="text" class="meta-field" data-field="year" value="${escHtml(paper.year || '')}" placeholder="发表年份"></div>
                <div class="meta-edit-row"><label>DOI</label><input type="text" class="meta-field" data-field="doi" value="${escHtml(paper.doi || '')}" placeholder="DOI 编号"></div>
                <div class="meta-edit-row"><label>URL</label><input type="text" class="meta-field" data-field="url" value="${escHtml(paper.url || '')}" placeholder="论文链接"></div>
            </div>
            <!-- 操作按钮 -->
            <div class="detail-actions">
                <button class="btn btn-primary" id="btn-paper-read-${paper.id}"><i data-lucide="book-open"></i> 阅读</button>
                <button class="btn" id="btn-paper-qv-${paper.id}"><i data-lucide="zap"></i> 速览</button>
                <button class="btn" id="btn-paper-cover-${paper.id}"><i data-lucide="palette"></i> 封面</button>
                <button class="btn btn-delete" id="btn-paper-del-${paper.id}"><i data-lucide="trash-2"></i> 删除</button>
            </div>
            <!-- 读书笔记 -->
            <div class="summary-card">
                <div class="summary-header"><i data-lucide="file-text"></i><span>读书笔记</span></div>
                <textarea id="paper-description" class="book-desc-textarea" placeholder="写下你对这篇论文的想法...">${escHtml(paper.description || '')}</textarea>
            </div>
        </div>`;

    // 绑定按钮
    document.getElementById(`btn-paper-read-${paper.id}`).addEventListener('click', () => startPaperReading(paper.id));
    document.getElementById(`btn-paper-qv-${paper.id}`).addEventListener('click', () => { closePaperDetail(); startPaperReading(paper.id, true); });
    document.getElementById(`btn-paper-cover-${paper.id}`).addEventListener('click', () => openCoverGen(paper.id));
    document.getElementById(`btn-paper-del-${paper.id}`).addEventListener('click', () => deletePaper(paper.id));

    // 状态选择器
    content.querySelectorAll('.status-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            paper.status = btn.dataset.status;
            await savePapers();
            content.querySelectorAll('.status-option').forEach(b => b.classList.toggle('active', b.dataset.status === paper.status));
            renderPapersShelf();
        });
    });

    // 元数据自动保存
    let metaTimer = null;
    content.querySelectorAll('.meta-field').forEach(input => {
        input.addEventListener('input', () => {
            clearTimeout(metaTimer);
            metaTimer = setTimeout(async () => {
                paper[input.dataset.field] = input.value;
                await savePapers();
                renderPapersShelf();
            }, 500);
        });
    });

    // 标签编辑器
    setupPaperTagEditor(paper);

    // 书名编辑
    setupPaperNameEditor(paper);

    // 笔记自动保存
    const descTA = document.getElementById('paper-description');
    let descTimer = null;
    descTA.addEventListener('input', () => {
        clearTimeout(descTimer);
        descTimer = setTimeout(async () => { paper.description = descTA.value; await savePapers(); }, 500);
    });

    document.getElementById('paper-detail-overlay').classList.add('open');
    lucide.createIcons();
}

function setupPaperTagEditor(paper) {
    const current = document.getElementById('paper-tag-current');
    const dropdown = document.getElementById('paper-tag-dropdown');
    const list = document.getElementById('paper-tag-dropdown-list');
    const customInput = document.getElementById('paper-tag-custom-input');
    const customAdd = document.getElementById('paper-tag-custom-add');
    if (!current) return;

    const allTags = new Set(DEFAULT_PAPER_TAGS);
    papers.forEach(p => (p.tags || []).forEach(t => allTags.add(t)));

    function renderTagList() {
        list.innerHTML = '';
        allTags.forEach(tag => {
            const div = document.createElement('div');
            div.className = 'tag-option' + (tag === paper.tags[0] ? ' active' : '');
            div.textContent = tag;
            div.addEventListener('click', () => {
                paper.tags = [tag];
                current.innerHTML = escHtml(tag) + ' <i data-lucide="chevron-down" style="width:12px;height:12px;margin-left:4px;"></i>';
                dropdown.classList.remove('open');
                lucide.createIcons();
                savePapers();
                renderPapersShelf();
            });
            list.appendChild(div);
        });
    }

    current.addEventListener('click', (e) => { e.stopPropagation(); renderTagList(); dropdown.classList.toggle('open'); });
    dropdown.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => { if (!dropdown.contains(e.target) && e.target !== current) dropdown.classList.remove('open'); });
    customAdd.addEventListener('click', () => {
        const val = customInput.value.trim();
        if (!val) return;
        allTags.add(val);
        paper.tags = [val];
        current.innerHTML = escHtml(val) + ' <i data-lucide="chevron-down" style="width:12px;height:12px;margin-left:4px;"></i>';
        dropdown.classList.remove('open');
        lucide.createIcons();
        savePapers();
        renderPapersShelf();
        customInput.value = '';
    });
    customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') customAdd.click(); });
}

function setupPaperNameEditor(paper) {
    const el = document.getElementById('paper-detail-name');
    if (!el) return;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text'; input.value = paper.name;
        input.style.cssText = 'font-size:inherit;font-weight:inherit;color:inherit;background:var(--bg-surface-hover);border:1px solid #818cf8;border-radius:6px;padding:2px 8px;outline:none;width:100%;box-sizing:border-box;';
        el.replaceWith(input); input.focus(); input.select();
        async function save() {
            const newName = input.value.trim();
            if (newName && newName !== paper.name) { paper.name = newName; await savePapers(); }
            const h2 = document.createElement('h2');
            h2.className = 'detail-book-name'; h2.id = 'paper-detail-name';
            h2.title = '点击编辑'; h2.style.cursor = 'pointer'; h2.textContent = paper.name;
            input.replaceWith(h2); setupPaperNameEditor(paper);
        }
        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = paper.name; input.blur(); } });
    });
}

function closePaperDetail() {
    document.getElementById('paper-detail-overlay').classList.remove('open');
}

async function deletePaper(paperId) {
    if (!confirm('确定删除这篇论文吗？')) return;
    papers = papers.filter(p => p.id !== paperId);
    readingStats = readingStats.filter(s => s.bookId !== paperId);
    await localforage.removeItem('pdf_paper_' + paperId);
    await savePapers();
    await saveStats();
    closePaperDetail();
    renderPapersShelf();
}

// ============================================================
//  论文阅读器
// ============================================================
async function startPaperReading(paperId, autoQuickView) {
    const paper = papers.find(p => p.id === paperId);
    if (!paper) return;

    if (!paper._pdfUint8) {
        const data = await loadPaperPdfData(paperId);
        if (!data) { alert('PDF 数据丢失，请重新导入'); return; }
        paper._pdfUint8 = data;
    }

    closePaperDetail();
    isPaperReader = true;
    readStartTime = Date.now();
    currentBookId = paperId;
    currentPage = 1;
    currentZoom = 1.5;
    openedCount++;
    highlightMode = false;
    selectedHighlight = null;
    await saveStats();

    // 显示论文专用按钮
    document.querySelectorAll('.paper-only-btn').forEach(b => b.classList.remove('hidden'));

    document.getElementById('reader-title').textContent = paper.name;
    document.getElementById('reader-overlay').classList.add('open');
    lucide.createIcons();

    // 标记为在读
    if (paper.status === 'unread') {
        paper.status = 'reading';
        await savePapers();
        renderPapersShelf();
    }

    initNotesPanel(paper);

    try {
        pdfDoc = await parsePdf(paper._pdfUint8, 30000);
        totalPages = pdfDoc.numPages;

        const lastRead = [...readingStats].reverse().find(s => s.bookId === paperId);
        if (lastRead && lastRead.page) currentPage = Math.min(lastRead.page, totalPages);
        if (readMode === 'double') currentPage = Math.ceil(currentPage / 2) * 2 - 1;

        updateModeButtons();
        await renderByMode();
        loadOutline();

        if (autoQuickView) openQuickView();
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

    const bookDesc = book.description || '';
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
                    <i data-lucide="file-text"></i>
                    <span>读书笔记</span>
                </div>
                <textarea id="book-description" class="book-desc-textarea" placeholder="写下你对这本书的想法...">${escHtml(bookDesc)}</textarea>
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

    // 设置读书笔记自动保存
    setupDescriptionEditor(book);

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

// ============================================================
//  读书笔记编辑
// ============================================================
function setupDescriptionEditor(book) {
    const textarea = document.getElementById('book-description');
    if (!textarea) return;
    let saveTimer = null;
    textarea.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            book.description = textarea.value;
            await saveLibrary();
        }, 500);
    });
}

function closeDetail() {
    document.getElementById('detail-overlay').classList.remove('open');
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
        if (readMode === 'double') currentPage = Math.ceil(currentPage / 2) * 2 - 1;

        // 同步模式按钮状态
        updateModeButtons();
        await renderByMode();
        loadOutline();
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
    const drawWrap = document.getElementById('notes-draw-wrap');

    // 重置面板状态
    panel.classList.add('collapsed');
    currentNotesTab = 'edit';
    updateNotesTabUI();

    // 加载笔记内容
    textarea.value = book.notes ? book.notes.text || '' : '';

    // 清空画布
    drawWrap.classList.add('hidden');

    // 销毁旧的 signaturePad
    if (signaturePad) { signaturePad.off(); signaturePad = null; }

    // 初始渲染预览
    renderNotesPreview();

    // 绑定 textarea 实时预览 + 自动保存
    textarea.oninput = () => {
        renderNotesPreview();
        clearTimeout(notesSaveTimer);
        notesSaveTimer = setTimeout(() => saveCurrentNotes(), 500);
    };
}

async function toggleNotesPanel() {
    const panel = document.getElementById('notes-panel');
    const collapsing = !panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed');
    if (!collapsing) {
        const savedWidth = await localforage.getItem('notesPanelWidth');
        if (savedWidth) panel.style.width = savedWidth + 'px';
        if (currentNotesTab === 'draw') initSignaturePad();
    }
}

function switchNotesTab(tab) {
    currentNotesTab = tab;
    updateNotesTabUI();

    const editWrap = document.getElementById('notes-edit-wrap');
    const drawWrap = document.getElementById('notes-draw-wrap');

    editWrap.classList.toggle('hidden', tab !== 'edit');
    drawWrap.classList.toggle('hidden', tab !== 'draw');

    if (tab === 'edit') {
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
    const item = isPaperReader
        ? papers.find(p => p.id === currentBookId)
        : library.find(b => b.id === currentBookId);
    if (item && item.notes && item.notes.drawing) {
        signaturePad.fromDataURL(item.notes.drawing);
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
    const item = isPaperReader
        ? papers.find(p => p.id === currentBookId)
        : library.find(b => b.id === currentBookId);
    if (!item) return;

    if (!item.notes) item.notes = { text: '', drawing: null };

    const textarea = document.getElementById('notes-textarea');
    if (textarea) item.notes.text = textarea.value;

    if (signaturePad && !signaturePad.isEmpty()) {
        item.notes.drawing = signaturePad.toDataURL();
    }

    if (isPaperReader) await savePapers();
    else await saveLibrary();
}

function initNotesPanelResize() {
    const handle = document.getElementById('notes-panel-resize');
    const panel = document.getElementById('notes-panel');
    if (!handle || !panel) return;

    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        handle.classList.add('dragging');
        panel.style.transition = 'none';

        function onMove(e) {
            const dx = startX - e.clientX;
            panel.style.width = Math.max(220, Math.min(600, startWidth + dx)) + 'px';
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

function initNotesPanelDrag() {
    const header = document.getElementById('notes-panel-header');
    const panel = document.getElementById('notes-panel');
    if (!header || !panel) return;

    let startX, startY, startRight, startTop;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.btn-icon')) return;
        e.preventDefault();
        const rect = panel.getBoundingClientRect();
        const parentRect = panel.offsetParent.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startRight = parentRect.right - rect.right;
        startTop = rect.top - parentRect.top;
        panel.style.transition = 'none';

        function onMove(e) {
            const dx = startX - e.clientX;
            const dy = e.clientY - startY;
            const pr = panel.offsetParent.getBoundingClientRect();
            const newRight = Math.max(0, Math.min(pr.width - 100, startRight + dx));
            const newTop = Math.max(0, Math.min(pr.height - 100, startTop + dy));
            panel.style.right = newRight + 'px';
            panel.style.top = newTop + 'px';
            panel.style.left = 'auto';
        }

        function onUp() {
            panel.style.transition = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
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
    if (mode === 'double') currentPage = Math.ceil(currentPage / 2) * 2 - 1;
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
    updateTocHighlight();
    if (pdfSearchOpen && searchMatches.length > 0) renderSearchHighlights();
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

    // 先创建当前页附近的 canvas，立刻显示，其余分批创建
    const BATCH_SIZE = 50;
    const cur = currentPage;
    const startPage = Math.max(1, cur - 20);
    const endPage = Math.min(totalPages, cur + 20);

    // 第一批：当前页附近，立即创建并挂载
    const frag = document.createDocumentFragment();
    for (let i = startPage; i <= endPage; i++) {
        frag.appendChild(createScrollCanvas(i));
    }
    body.appendChild(frag);

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

    body.querySelectorAll('canvas').forEach(c => { c.dataset.observed = '1'; scrollObserver.observe(c); });
    updatePageUI();

    // 滚动到当前页
    const target = document.getElementById('scroll-page-' + currentPage);
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });

    // 剩余页面分批创建，每批之间让出主线程
    await createCanvasBatches(body, 1, startPage - 1, BATCH_SIZE);
    await createCanvasBatches(body, endPage + 1, totalPages, BATCH_SIZE);
}

function createScrollCanvas(pageNum) {
    const canvas = document.createElement('canvas');
    canvas.id = 'scroll-page-' + pageNum;
    canvas.dataset.page = pageNum;
    canvas.style.width = 'min(100%, ' + Math.round(612 * currentZoom / 1.5) + 'px)';
    return canvas;
}

async function createCanvasBatches(body, from, to, batchSize) {
    if (from > to) return;
    for (let start = from; start <= to; start += batchSize) {
        if (!pdfDoc) return; // 阅读器已关闭，中止
        const end = Math.min(to, start + batchSize - 1);
        const frag = document.createDocumentFragment();
        for (let i = start; i <= end; i++) {
            frag.appendChild(createScrollCanvas(i));
        }
        body.appendChild(frag);
        // 让出主线程，避免卡顿
        await new Promise(r => setTimeout(r, 0));
    }
    // 新加入的 canvas 也要被 observer 监听
    if (scrollObserver && pdfDoc) {
        body.querySelectorAll('canvas:not([data-observed])').forEach(c => {
            c.dataset.observed = '1';
            scrollObserver.observe(c);
        });
    }
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
        const body = document.getElementById('reader-body');
        const curPage = currentPage;
        const curCanvas = document.getElementById('scroll-page-' + curPage);

        // 缩放前：记录当前页内的偏移比例
        let savedRatio = 0;
        if (curCanvas && curCanvas.offsetHeight > 0) {
            const bodyRect = body.getBoundingClientRect();
            const canvasTopInContent = curCanvas.getBoundingClientRect().top - bodyRect.top + body.scrollTop;
            savedRatio = (body.scrollTop - canvasTopInContent) / curCanvas.offsetHeight;
        }

        // 更新所有 canvas 占位宽度 + 重置渲染标记
        body.querySelectorAll('canvas').forEach(c => {
            c.dataset.rendered = '';
            c.style.width = 'min(100%, ' + Math.round(612 * currentZoom / 1.5) + 'px)';
        });

        // 立即渲染当前页，恢复位置后再渲染其他可见页
        if (curCanvas) {
            renderScrollPage(curCanvas, curPage).then(() => {
                const bodyRect = body.getBoundingClientRect();
                const canvasTopInContent = curCanvas.getBoundingClientRect().top - bodyRect.top + body.scrollTop;
                body.scrollTop = canvasTopInContent + savedRatio * curCanvas.offsetHeight;

                // 当前页位置恢复后，渲染其他可见页
                if (scrollObserver) {
                    body.querySelectorAll('canvas').forEach(c => {
                        if (c === curCanvas) return;
                        const rect = c.getBoundingClientRect();
                        const rootRect = body.getBoundingClientRect();
                        if (rect.top < rootRect.bottom && rect.bottom > rootRect.top) {
                            if (!c.dataset.rendered) renderScrollPage(c, parseInt(c.dataset.page));
                        }
                    });
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
        page: currentPage,
        isPaper: isPaperReader || false
    });
    // 同步保存（不 await，供 beforeunload 使用）
    localforage.setItem('readingStats', readingStats);
    localforage.setItem('openedCount', openedCount);
    readStartTime = Date.now(); // 重置起点，避免重复累计
}

async function closeReader() {
    recordReadingStat();
    cleanupScrollObserver();
    exitHighlightMode();
    await saveCurrentNotes();

    const wasPaper = isPaperReader;

    document.getElementById('reader-overlay').classList.remove('open');
    document.getElementById('reader-body').innerHTML = '';
    document.getElementById('notes-panel').classList.add('collapsed');
    document.getElementById('notes-panel').style.right = '';
    document.getElementById('notes-panel').style.top = '';
    document.querySelectorAll('.paper-only-btn').forEach(b => b.classList.add('hidden'));
    document.getElementById('highlight-hint').classList.add('hidden');

    // 清理目录和搜索状态
    tocOpen = false;
    document.getElementById('toc-sidebar').classList.add('collapsed');
    closePdfSearch();
    pageTextCache = {};
    searchMatches = [];
    searchCurrentIdx = -1;
    tocOutline = null;

    pdfDoc = null;
    currentBookId = null;
    readStartTime = null;
    isPaperReader = false;
    highlightMode = false;

    if (wasPaper) renderPapersShelf();
    else renderShelf();
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
//  搜索书籍
// ============================================================
function openSearch() {
    document.getElementById('search-overlay').classList.add('open');
    const input = document.getElementById('search-input');
    input.value = '';
    renderSearchResults('');
    setTimeout(() => input.focus(), 100);
}

function closeSearch() {
    document.getElementById('search-overlay').classList.remove('open');
}

function renderSearchResults(query) {
    const container = document.getElementById('search-results');
    if (!query) {
        container.innerHTML = '<div class="search-result-empty">输入名称搜索书籍和论文</div>';
        return;
    }
    const q = query.toLowerCase();
    const bookMatches = library.filter(b => b.name.toLowerCase().includes(q)).map(b => ({ ...b, type: 'book' }));
    const paperMatches = papers.filter(p => {
        const searchStr = [p.name, p.author, p.journal, p.year].join(' ').toLowerCase();
        return searchStr.includes(q);
    }).map(p => ({ ...p, type: 'paper' }));
    const matches = [...bookMatches, ...paperMatches];
    if (matches.length === 0) {
        container.innerHTML = '<div class="search-result-empty">未找到匹配的内容</div>';
        return;
    }
    container.innerHTML = matches.map(item => {
        const hasRealCover = item.cover && item.cover.startsWith('data:');
        const coverSrc = hasRealCover ? item.cover : generatePlaceholder(item.name);
        const metaParts = item.type === 'paper'
            ? [item.author, item.year, READING_STATUS[item.status || 'unread']].filter(Boolean).join(' · ')
            : [item.tags[0] || '其他', item.pageCount ? item.pageCount + ' 页' : ''].filter(Boolean).join(' · ');
        return `<div class="search-result-item" data-id="${item.id}" data-type="${item.type}">
            <div class="search-result-cover"><img src="${coverSrc}" alt="${escHtml(item.name)}"></div>
            <div class="search-result-info">
                <div class="search-result-name">${item.type === 'paper' ? '[论文] ' : ''}${escHtml(item.name)}</div>
                <div class="search-result-meta">${escHtml(metaParts)}</div>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            closeSearch();
            if (item.dataset.type === 'paper') openPaperDetail(item.dataset.id);
            else openDetail(item.dataset.id);
        });
    });
}

// ============================================================
//  悬浮按钮拖动
// ============================================================
function initFabDrag() {
    const fab = document.getElementById('fab-search');
    if (!fab) return;
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, startLeft, startTop;

    fab.addEventListener('mousedown', onDown);
    fab.addEventListener('touchstart', onDown, { passive: false });

    function onDown(e) {
        e.preventDefault();
        isDragging = true;
        hasMoved = false;
        const point = e.touches ? e.touches[0] : e;
        startX = point.clientX;
        startY = point.clientY;
        const rect = fab.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        fab.classList.add('dragging');

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    }

    function onMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - startX;
        const dy = point.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
        fab.style.left = (startLeft + dx) + 'px';
        fab.style.top = (startTop + dy) + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    }

    function onUp() {
        isDragging = false;
        fab.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        if (!hasMoved) openSearch();
    }
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
let booksWeeklyChart = null;
let booksTagsChart = null;
let papersWeeklyChart = null;
let papersTagsChart = null;

function renderDashboard() {
    const tagColors = ['#6366f1','#ec4899','#f59e0b','#10b981','#06b6d4','#8b5cf6','#ef4444','#f97316','#14b8a6','#a855f7'];
    const chartOpts = {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
            x: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.03)' } },
            y: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.03)' } }
        }
    };
    const doughnutOpts = (legend) => ({
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#a1a1aa', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } }
    });

    // 判断每条记录是书籍还是论文
    function isPaperStat(r) {
        if (r.isPaper !== undefined) return r.isPaper;
        return papers.some(p => p.id === r.bookId);
    }

    const bookStats = readingStats.filter(r => !isPaperStat(r));
    const paperStats = readingStats.filter(r => isPaperStat(r));

    // ---- 总览 ----
    document.getElementById('stat-total').textContent = library.length + papers.length;
    const totalMin = readingStats.reduce((s, r) => s + r.duration, 0);
    document.getElementById('stat-time').textContent = totalMin >= 60 ? (totalMin / 60).toFixed(1) + 'h' : totalMin + 'min';
    document.getElementById('stat-opened').textContent = openedCount;

    // ---- 书籍统计 ----
    document.getElementById('stat-books-count').textContent = library.length;
    const booksMin = bookStats.reduce((s, r) => s + r.duration, 0);
    document.getElementById('stat-books-time').textContent = booksMin >= 60 ? (booksMin / 60).toFixed(1) + 'h' : booksMin + 'min';
    document.getElementById('stat-books-sessions').textContent = bookStats.length;

    // 书籍按周
    const now = new Date();
    const weekKeys = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); weekKeys.push(d.toISOString().slice(5, 10)); }
    const booksWeek = {}; weekKeys.forEach(k => booksWeek[k] = 0);
    bookStats.forEach(r => { const k = r.date.slice(5, 10); if (booksWeek[k] !== undefined) booksWeek[k] += r.duration; });

    if (booksWeeklyChart) booksWeeklyChart.destroy();
    booksWeeklyChart = new Chart(document.getElementById('chart-books-weekly'), {
        type: 'bar', data: { labels: weekKeys, datasets: [{ label: '分钟', data: Object.values(booksWeek), backgroundColor: 'rgba(99,102,241,0.6)', borderColor: 'rgba(99,102,241,1)', borderWidth: 1, borderRadius: 6 }] }, options: chartOpts
    });

    // 书籍标签
    const bookTagCounts = {};
    library.forEach(b => { const t = b.tags[0] || '其他'; bookTagCounts[t] = (bookTagCounts[t] || 0) + 1; });
    if (booksTagsChart) booksTagsChart.destroy();
    booksTagsChart = new Chart(document.getElementById('chart-books-tags'), {
        type: 'doughnut', data: { labels: Object.keys(bookTagCounts), datasets: [{ data: Object.values(bookTagCounts), backgroundColor: tagColors.slice(0, Object.keys(bookTagCounts).length), borderWidth: 0 }] }, options: doughnutOpts()
    });

    // 书籍阅读时长排行
    const bookTimes = {};
    bookStats.forEach(r => { bookTimes[r.bookId] = (bookTimes[r.bookId] || 0) + r.duration; });
    const sortedBooks = Object.entries(bookTimes).map(([id, min]) => ({ id, min, item: library.find(b => b.id === id) })).filter(e => e.item).sort((a, b) => b.min - a.min);
    renderItemList('per-book-stats', sortedBooks);

    // ---- 论文统计 ----
    document.getElementById('stat-papers-count').textContent = papers.length;
    const papersMin = paperStats.reduce((s, r) => s + r.duration, 0);
    document.getElementById('stat-papers-time').textContent = papersMin >= 60 ? (papersMin / 60).toFixed(1) + 'h' : papersMin + 'min';
    document.getElementById('stat-papers-sessions').textContent = paperStats.length;
    document.getElementById('stat-papers-finished').textContent = papers.filter(p => p.status === 'finished' || p.status === 'reread').length;

    // 论文按周
    const papersWeek = {}; weekKeys.forEach(k => papersWeek[k] = 0);
    paperStats.forEach(r => { const k = r.date.slice(5, 10); if (papersWeek[k] !== undefined) papersWeek[k] += r.duration; });

    if (papersWeeklyChart) papersWeeklyChart.destroy();
    papersWeeklyChart = new Chart(document.getElementById('chart-papers-weekly'), {
        type: 'bar', data: { labels: weekKeys, datasets: [{ label: '分钟', data: Object.values(papersWeek), backgroundColor: 'rgba(236,72,153,0.6)', borderColor: 'rgba(236,72,153,1)', borderWidth: 1, borderRadius: 6 }] }, options: chartOpts
    });

    // 论文标签
    const paperTagCounts = {};
    papers.forEach(p => { (p.tags || []).forEach(t => { paperTagCounts[t] = (paperTagCounts[t] || 0) + 1; }); });
    if (papersTagsChart) papersTagsChart.destroy();
    papersTagsChart = new Chart(document.getElementById('chart-papers-tags'), {
        type: 'doughnut', data: { labels: Object.keys(paperTagCounts), datasets: [{ data: Object.values(paperTagCounts), backgroundColor: tagColors.slice(0, Object.keys(paperTagCounts).length), borderWidth: 0 }] }, options: doughnutOpts()
    });

    // 论文阅读时长排行
    const paperTimes = {};
    paperStats.forEach(r => { paperTimes[r.bookId] = (paperTimes[r.bookId] || 0) + r.duration; });
    const sortedPapers = Object.entries(paperTimes).map(([id, min]) => ({ id, min, item: papers.find(p => p.id === id) })).filter(e => e.item).sort((a, b) => b.min - a.min);
    renderItemList('per-paper-stats', sortedPapers);
}

function renderItemList(containerId, items) {
    const container = document.getElementById(containerId);
    if (items.length === 0) {
        container.innerHTML = '<div class="per-book-empty">暂无阅读记录</div>';
        return;
    }
    const maxMin = items[0].min;
    container.innerHTML = '<div class="per-book-list">' + items.map((e, i) => {
        const pct = maxMin > 0 ? (e.min / maxMin * 100) : 0;
        const label = e.min >= 60 ? (e.min / 60).toFixed(1) + 'h' : e.min + 'min';
        return `<div class="per-book-row">
            <span class="per-book-rank">${i + 1}</span>
            <span class="per-book-name">${escHtml(e.item.name)}</span>
            <div class="per-book-bar-wrap"><div class="per-book-bar-fill" style="width:${pct}%"></div></div>
            <span class="per-book-time">${label}</span>
        </div>`;
    }).join('') + '</div>';
}

// ============================================================
//  速览（Abstract / Figures / Conclusion）
// ============================================================
async function openQuickView() {
    if (!pdfDoc) return;
    const overlay = document.getElementById('quickview-overlay');
    document.getElementById('qv-abstract').innerHTML = '<span class="quickview-text empty">提取中...</span>';
    document.getElementById('qv-figures').innerHTML = '<span class="quickview-text empty">提取中...</span>';
    document.getElementById('qv-conclusion').innerHTML = '<span class="quickview-text empty">提取中...</span>';
    overlay.classList.add('open');
    lucide.createIcons();

    try {
        const abstractText = await extractSection(['abstract'], 1, Math.min(3, totalPages));
        const figuresText = await extractFigures(1, Math.min(10, totalPages));
        const conclusionText = await extractSection(['conclusion', 'conclusions', '总结', '结论', 'discussion'], Math.max(1, totalPages - 4), totalPages);

        document.getElementById('qv-abstract').textContent = abstractText || '未检测到 Abstract 内容';
        document.getElementById('qv-abstract').className = abstractText ? 'quickview-text' : 'quickview-text empty';
        document.getElementById('qv-figures').textContent = figuresText || '未检测到 Figure 说明';
        document.getElementById('qv-figures').className = figuresText ? 'quickview-text' : 'quickview-text empty';
        document.getElementById('qv-conclusion').textContent = conclusionText || '未检测到 Conclusion 内容';
        document.getElementById('qv-conclusion').className = conclusionText ? 'quickview-text' : 'quickview-text empty';
    } catch (e) {
        console.warn('[Lumina] 速览提取失败:', e);
    }
}

function closeQuickView() {
    document.getElementById('quickview-overlay').classList.remove('open');
}

/** 从指定页面范围提取指定章节标题后的内容 */
async function extractSection(keywords, startPage, endPage) {
    let found = false;
    let result = '';
    for (let i = startPage; i <= endPage; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join('\n');
        if (!found) {
            const lowerText = text.toLowerCase();
            for (const kw of keywords) {
                const idx = lowerText.indexOf(kw);
                if (idx !== -1) {
                    found = true;
                    result += text.substring(idx) + ' ';
                    break;
                }
            }
        } else {
            result += text + ' ';
        }
    }
    // 截取合理长度
    if (result.length > 1500) result = result.substring(0, 1500) + '...';
    return result.trim() || null;
}

/** 提取 Figure 说明文字 */
async function extractFigures(startPage, endPage) {
    const captions = [];
    const figureRegex = /(?:Figure|Fig\.|图)\s*\d+[.:：]\s*([^\n]{10,200})/gi;
    for (let i = startPage; i <= endPage; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        let match;
        while ((match = figureRegex.exec(text)) !== null) {
            captions.push(match[0].trim());
            if (captions.length >= 5) break;
        }
        if (captions.length >= 5) break;
    }
    return captions.length > 0 ? captions.join('\n\n') : null;
}

// ============================================================
//  PDF 高亮标注（荧光笔自由画线）
// ============================================================
let hlDrawing = false;
let hlPoints = [];
let hlBrushRadius = 12;
let hlCursorEl = null;
let hlFilterCounter = 0;

function toggleHighlightMode() {
    if (highlightMode) exitHighlightMode();
    else enterHighlightMode();
}

function enterHighlightMode() {
    highlightMode = true;
    selectedHighlight = null;
    hlFilterCounter = 0;
    document.getElementById('btn-highlight').classList.add('active');
    document.getElementById('highlight-hint').classList.remove('hidden');
    lucide.createIcons();

    const body = document.getElementById('reader-body');
    body.style.cursor = 'none';

    // 创建荧光笔光标
    hlCursorEl = document.createElement('div');
    hlCursorEl.className = 'highlighter-cursor';
    hlCursorEl.style.width = hlCursorEl.style.height = (hlBrushRadius * 2) + 'px';
    hlCursorEl.style.marginLeft = hlCursorEl.style.marginTop = (-hlBrushRadius) + 'px';
    document.body.appendChild(hlCursorEl);

    body.addEventListener('mousemove', hlOnMouseMove);
    body.addEventListener('mousedown', hlOnMouseDown);
    body.addEventListener('mouseup', hlOnMouseUp);
    document.addEventListener('mousemove', hlCursorGlobal);

    createHighlightOverlays();
}

function exitHighlightMode() {
    highlightMode = false;
    hlDrawing = false;
    hlPoints = [];
    document.getElementById('btn-highlight').classList.remove('active');
    document.getElementById('highlight-hint').classList.add('hidden');

    const body = document.getElementById('reader-body');
    body.style.cursor = '';
    body.removeEventListener('mousemove', hlOnMouseMove);
    body.removeEventListener('mousedown', hlOnMouseDown);
    body.removeEventListener('mouseup', hlOnMouseUp);
    document.removeEventListener('mousemove', hlCursorGlobal);

    if (hlCursorEl) { hlCursorEl.remove(); hlCursorEl = null; }
    document.querySelectorAll('.hl-svg-overlay').forEach(el => el.remove());
}

/** 荧光笔光标跟随鼠标（全局） */
function hlCursorGlobal(e) {
    if (!hlCursorEl) return;
    hlCursorEl.style.left = e.clientX + 'px';
    hlCursorEl.style.top = e.clientY + 'px';
}

/** 调整画笔大小 */
function setHighlightBrushRadius(r) {
    hlBrushRadius = Math.max(4, Math.min(30, r));
    if (hlCursorEl) {
        hlCursorEl.style.width = hlCursorEl.style.height = (hlBrushRadius * 2) + 'px';
        hlCursorEl.style.marginLeft = hlCursorEl.style.marginTop = (-hlBrushRadius) + 'px';
    }
}

// ---- 鼠标事件 ----
function hlGetTarget(e) {
    const wrap = e.target.closest('.hl-canvas-wrap');
    if (!wrap) return null;
    const svg = wrap.querySelector('.hl-svg-overlay');
    const canvas = wrap.querySelector('canvas');
    if (!svg || !canvas) return null;
    return { wrap, svg, canvas };
}

function hlOnMouseMove(e) {
    if (!hlDrawing) return;
    const t = hlGetTarget(e);
    if (!t) return;
    const rect = t.canvas.getBoundingClientRect();
    hlPoints.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    renderLiveStroke(t.svg);
}

function hlOnMouseDown(e) {
    if (!highlightMode || e.button !== 0) return;
    const t = hlGetTarget(e);
    if (!t) return;
    e.preventDefault();
    hlDrawing = true;
    const rect = t.canvas.getBoundingClientRect();
    hlPoints = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
}

function hlOnMouseUp(e) {
    if (!hlDrawing) return;
    hlDrawing = false;
    if (hlPoints.length < 2) { hlPoints = []; return; }

    const t = hlGetTarget(e);
    if (!t) { hlPoints = []; return; }
    const pageNum = parseInt(t.svg.dataset.hlPage);

    const paper = papers.find(p => p.id === currentBookId);
    if (!paper) { hlPoints = []; return; }
    if (!paper.highlights) paper.highlights = [];

    paper.highlights.push({ type: 'stroke', page: pageNum, points: hlPoints.slice(), radius: hlBrushRadius });
    hlPoints = [];
    savePapers();
    renderStrokePaths(t.svg, pageNum);
}

// ---- SVG 覆盖层 ----
function createHighlightOverlays() {
    // 清除旧覆盖层并拆开包裹
    document.querySelectorAll('.hl-canvas-wrap').forEach(wrap => {
        const canvas = wrap.querySelector('canvas');
        if (canvas) wrap.parentNode.insertBefore(canvas, wrap);
        wrap.remove();
    });

    const body = document.getElementById('reader-body');
    body.querySelectorAll('canvas').forEach(canvas => {
        const pn = readMode === 'scroll' ? (parseInt(canvas.dataset.page) || currentPage) : currentPage;
        wrapCanvasWithSvg(canvas, pn);
    });
}

function wrapCanvasWithSvg(canvas, pageNum) {
    const wrap = document.createElement('div');
    wrap.className = 'hl-canvas-wrap';
    canvas.parentNode.insertBefore(wrap, canvas);
    wrap.appendChild(canvas);
    createSvgIn(wrap, canvas.width, canvas.height, pageNum);
}

function createSvgIn(parent, w, h, pageNum) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('hl-svg-overlay');
    svg.dataset.hlPage = pageNum;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:auto;cursor:none;z-index:10;';

    const filterId = 'glow-' + (++hlFilterCounter);
    const defs = document.createElementNS(ns, 'defs');
    const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('x', '-30%'); filter.setAttribute('y', '-30%');
    filter.setAttribute('width', '160%'); filter.setAttribute('height', '160%');
    const gb = document.createElementNS(ns, 'feGaussianBlur');
    gb.setAttribute('stdDeviation', '0.005'); gb.setAttribute('result', 'blur');
    filter.appendChild(gb);
    const merge = document.createElementNS(ns, 'feMerge');
    ['blur', 'SourceGraphic'].forEach(inp => {
        const n = document.createElementNS(ns, 'feMergeNode');
        n.setAttribute('in', inp); merge.appendChild(n);
    });
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);
    svg.dataset.filterId = filterId;

    parent.appendChild(svg);
    renderStrokePaths(svg, pageNum);
    return svg;
}

// ---- 渲染笔画 ----
function renderLiveStroke(svg) {
    if (hlPoints.length < 2) return;
    let live = svg.querySelector('.hl-live');
    if (!live) {
        const ns = 'http://www.w3.org/2000/svg';
        live = document.createElementNS(ns, 'path');
        live.classList.add('hl-live');
        live.setAttribute('fill', 'none');
        live.setAttribute('stroke', 'rgba(255,230,0,0.5)');
        live.setAttribute('stroke-width', hlBrushRadius * 2);
        live.setAttribute('stroke-linecap', 'round');
        live.setAttribute('stroke-linejoin', 'round');
        live.setAttribute('filter', 'url(#' + svg.dataset.filterId + ')');
        live.style.pointerEvents = 'none';
        svg.appendChild(live);
    }
    live.setAttribute('stroke-width', hlBrushRadius * 2);
    live.setAttribute('d', pointsToPath(hlPoints));
}

function renderStrokePaths(svg, pageNum) {
    const paper = papers.find(p => p.id === currentBookId);
    if (!paper || !paper.highlights) return;

    // 清除旧笔画
    svg.querySelectorAll('.hl-stroke').forEach(el => el.remove());
    const live = svg.querySelector('.hl-live');
    if (live) live.remove();

    const ns = 'http://www.w3.org/2000/svg';

    paper.highlights.forEach((hl, idx) => {
        if (hl.type !== 'stroke' || hl.page !== pageNum) return;
        const path = document.createElementNS(ns, 'path');
        path.classList.add('hl-stroke');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'rgba(255,230,0,0.4)');
        path.setAttribute('stroke-width', (hl.radius || 12) * 2);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('filter', 'url(#' + svg.dataset.filterId + ')');
        path.setAttribute('d', pointsToPath(hl.points));
        path.dataset.hlIndex = idx;
        path.style.pointerEvents = 'auto';
        path.style.cursor = 'pointer';

        path.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (path.classList.contains('hl-selected')) {
                paper.highlights.splice(idx, 1);
                savePapers();
                renderStrokePaths(svg, pageNum);
            } else {
                svg.querySelectorAll('.hl-stroke').forEach(el => {
                    el.classList.remove('hl-selected');
                    el.setAttribute('stroke', 'rgba(255,230,0,0.4)');
                });
                path.classList.add('hl-selected');
                path.setAttribute('stroke', 'rgba(239,68,68,0.5)');
            }
        });

        svg.appendChild(path);
    });
}

function pointsToPath(pts) {
    if (pts.length < 2) return '';
    let d = 'M' + pts[0].x + ',' + pts[0].y;
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], c = pts[i];
        d += ' Q' + p.x + ',' + p.y + ' ' + ((p.x + c.x) / 2) + ',' + ((p.y + c.y) / 2);
    }
    d += ' L' + pts[pts.length - 1].x + ',' + pts[pts.length - 1].y;
    return d;
}

function hlUndoLast() {
    const paper = papers.find(p => p.id === currentBookId);
    if (!paper || !paper.highlights || paper.highlights.length === 0) return;
    paper.highlights.pop();
    savePapers();
    createHighlightOverlays();
}

function hlClearAll() {
    const paper = papers.find(p => p.id === currentBookId);
    if (!paper || !paper.highlights) return;
    paper.highlights = [];
    savePapers();
    createHighlightOverlays();
}

// 包装 renderByMode：渲染后添加高亮覆盖层
const _origRenderByMode = renderByMode;
renderByMode = async function() {
    await _origRenderByMode();
    if (isPaperReader && highlightMode) {
        createHighlightOverlays();
    }
};

// ============================================================
//  章节目录侧边栏
// ============================================================
async function loadOutline() {
    tocOutline = null;
    if (!pdfDoc) return;
    try {
        const outline = await pdfDoc.getOutline();
        if (!outline || outline.length === 0) {
            document.getElementById('toc-body').innerHTML = '<div class="toc-empty">此PDF无章节目录</div>';
            return;
        }
        tocOutline = await parseOutlineItems(outline);
        renderToc();
    } catch (e) {
        console.warn('[Lumina] 目录提取失败:', e);
        document.getElementById('toc-body').innerHTML = '<div class="toc-empty">目录提取失败</div>';
    }
}

async function parseOutlineItems(items) {
    const result = [];
    for (const item of items) {
        let pageNum = null;
        if (item.dest) {
            pageNum = await resolveDestPage(item.dest);
        }
        const entry = { title: item.title || '未命名', pageNum: pageNum };
        if (item.items && item.items.length > 0) {
            entry.items = await parseOutlineItems(item.items);
        }
        result.push(entry);
    }
    return result;
}

async function resolveDestPage(dest) {
    try {
        let explicitDest = dest;
        if (typeof dest === 'string') {
            explicitDest = await pdfDoc.getDestination(dest);
        }
        if (explicitDest && explicitDest.length > 0) {
            const pageRef = explicitDest[0];
            const pageIndex = await pdfDoc.getPageIndex(pageRef);
            return pageIndex + 1; // 1-indexed
        }
    } catch (e) {
        console.warn('[Lumina] 解析目录目标失败:', e);
    }
    return null;
}

function renderToc() {
    const container = document.getElementById('toc-body');
    if (!tocOutline || tocOutline.length === 0) {
        container.innerHTML = '<div class="toc-empty">此PDF无章节目录</div>';
        return;
    }
    container.innerHTML = '';
    container.appendChild(buildTocDom(tocOutline, 0));
    updateTocHighlight();
}

function buildTocDom(items, depth) {
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
        const hasChildren = item.items && item.items.length > 0;
        const row = document.createElement('div');
        row.className = 'toc-item';
        row.dataset.page = item.pageNum || '';
        row.dataset.depth = depth;
        row.style.paddingLeft = (14 + depth * 12) + 'px';

        // 折叠箭头
        const toggle = document.createElement('span');
        toggle.className = 'toc-item-toggle' + (hasChildren ? '' : ' empty');
        toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        row.appendChild(toggle);

        // 标题
        const label = document.createElement('span');
        label.className = 'toc-item-label';
        label.textContent = item.title;
        row.appendChild(label);

        // 页码
        if (item.pageNum) {
            const page = document.createElement('span');
            page.className = 'toc-item-page';
            page.textContent = item.pageNum;
            row.appendChild(page);
        }

        // 点击跳转
        row.addEventListener('click', (e) => {
            if (e.target.closest('.toc-item-toggle') && hasChildren) {
                e.stopPropagation();
                toggle.classList.toggle('expanded');
                const childrenEl = row.nextElementSibling;
                if (childrenEl && childrenEl.classList.contains('toc-children')) {
                    childrenEl.classList.toggle('collapsed');
                }
                return;
            }
            if (item.pageNum) goToPage(item.pageNum);
        });

        frag.appendChild(row);

        // 子条目
        if (hasChildren) {
            const childContainer = document.createElement('div');
            childContainer.className = 'toc-children collapsed';
            childContainer.appendChild(buildTocDom(item.items, depth + 1));
            frag.appendChild(childContainer);
        }
    });
    return frag;
}

function updateTocHighlight() {
    const items = document.querySelectorAll('#toc-body .toc-item');
    items.forEach(el => {
        const p = parseInt(el.dataset.page);
        el.classList.toggle('active', p === currentPage);
    });
}

function toggleToc() {
    tocOpen = !tocOpen;
    document.getElementById('toc-sidebar').classList.toggle('collapsed', !tocOpen);
}

function goToPage(pageNum) {
    if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;
    if (readMode === 'scroll') {
        currentPage = pageNum;
        const target = document.getElementById('scroll-page-' + pageNum);
        if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
        updatePageUI();
        updateTocHighlight();
    } else {
        currentPage = pageNum;
        if (readMode === 'double') currentPage = Math.ceil(currentPage / 2) * 2 - 1;
        renderByMode();
        updateTocHighlight();
    }
}

// ============================================================
//  PDF 全文搜索
// ============================================================
function togglePdfSearch() {
    pdfSearchOpen = !pdfSearchOpen;
    document.getElementById('pdf-search-bar').classList.toggle('collapsed', !pdfSearchOpen);
    if (pdfSearchOpen) {
        setTimeout(() => document.getElementById('pdf-search-input').focus(), 100);
    } else {
        clearSearchHighlights();
    }
}

function closePdfSearch() {
    pdfSearchOpen = false;
    document.getElementById('pdf-search-bar').classList.add('collapsed');
    clearSearchHighlights();
}

async function performPdfSearch(query) {
    searchQuery = query;
    searchMatches = [];
    searchCurrentIdx = -1;
    if (!query || !pdfDoc) {
        updateSearchUI();
        clearSearchHighlights();
        return;
    }

    const statusEl = document.getElementById('pdf-search-status');
    statusEl.textContent = '搜索中...';

    const lowerQuery = query.toLowerCase();

    for (let p = 1; p <= totalPages; p++) {
        const textItems = await getPageTextItems(p);
        if (!textItems || textItems.length === 0) continue;
        for (let i = 0; i < textItems.length; i++) {
            const item = textItems[i];
            if (!item.str) continue;
            const lowerStr = item.str.toLowerCase();
            let startIdx = 0;
            while (true) {
                const found = lowerStr.indexOf(lowerQuery, startIdx);
                if (found === -1) break;
                searchMatches.push({ pageNum: p, itemIndex: i, startIdx: found, endIdx: found + query.length, item: item });
                startIdx = found + 1;
            }
        }
    }

    if (searchMatches.length > 0) {
        searchCurrentIdx = 0;
        statusEl.textContent = `找到 ${searchMatches.length} 处匹配`;
        navigateToMatch(0);
    } else {
        statusEl.textContent = '未找到匹配项';
    }
    updateSearchUI();
}

async function getPageTextItems(pageNum) {
    if (pageTextCache[pageNum]) return pageTextCache[pageNum];
    if (!pdfDoc) { console.warn('[Lumina] getPageTextItems: pdfDoc 为空'); return null; }
    try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = textContent.items.map(item => ({
            str: item.str,
            transform: item.transform,
            width: item.width,
            height: item.height || item.transform[0]
        }));
        pageTextCache[pageNum] = items;
        return items;
    } catch (e) {
        console.warn('[Lumina] 提取第', pageNum, '页文本失败:', e);
        return null;
    }
}

function navigateToMatch(idx) {
    if (idx < 0 || idx >= searchMatches.length) return;
    searchCurrentIdx = idx;
    const match = searchMatches[idx];
    goToPage(match.pageNum);
    updateSearchUI();
    renderSearchHighlights();
}

function searchNext() {
    if (searchMatches.length === 0) return;
    navigateToMatch((searchCurrentIdx + 1) % searchMatches.length);
}

function searchPrev() {
    if (searchMatches.length === 0) return;
    navigateToMatch((searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length);
}

function updateSearchUI() {
    const countEl = document.getElementById('pdf-search-count');
    if (searchMatches.length === 0) {
        countEl.textContent = searchQuery ? '无匹配' : '';
    } else {
        countEl.textContent = `${searchCurrentIdx + 1} / ${searchMatches.length}`;
    }
}

async function renderSearchHighlights() {
    clearSearchHighlights();
    if (searchMatches.length === 0 || !pdfDoc) return;

    // 获取当前页所有匹配
    const currentMatches = searchMatches.filter(m => m.pageNum === currentPage);
    if (currentMatches.length === 0) return;

    try {
        // 找到当前页对应的canvas
        let canvas;
        if (readMode === 'scroll') {
            canvas = document.getElementById('scroll-page-' + currentPage);
        } else {
            canvas = document.getElementById('pdf-canvas');
        }
        if (!canvas || !canvas.width || !canvas.height) return;

        // 获取或创建高亮覆盖层canvas
        const hlCanvas = getOrCreateSearchHlCanvas(canvas);
        const ctx = hlCanvas.getContext('2d');
        ctx.clearRect(0, 0, hlCanvas.width, hlCanvas.height);

        for (const match of currentMatches) {
            const item = match.item;
            const t = item.transform;

            const scaledX = t[4] * currentZoom;
            const scaledY = t[5] * currentZoom;

            const charW = (item.width / Math.max(item.str.length, 1)) * currentZoom;
            const hlX = scaledX + match.startIdx * charW;
            const hlW = Math.max((match.endIdx - match.startIdx) * charW, 4);
            const fontSize = Math.abs(t[3]) * currentZoom;
            const hlH = fontSize * 1.3;

            const hlY = canvas.height - scaledY - hlH * 0.85;

            const isCurrent = match === searchMatches[searchCurrentIdx];
            ctx.fillStyle = isCurrent
                ? 'rgba(250, 204, 21, 0.55)'
                : 'rgba(250, 204, 21, 0.3)';
            ctx.fillRect(hlX, hlY, hlW, hlH);

            if (isCurrent) {
                ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(hlX, hlY, hlW, hlH);
            }
        }
    } catch (e) {
        console.warn('[Lumina] 渲染搜索高亮失败:', e);
    }
}

/** 获取或创建搜索高亮覆盖层canvas（嵌入在 canvas 的 wrap 容器内） */
function getOrCreateSearchHlCanvas(canvas) {
    let wrap = canvas.parentElement;
    // 如果canvas没有被wrap，创建一个
    if (!wrap.classList.contains('hl-canvas-wrap')) {
        wrap = document.createElement('div');
        wrap.className = 'hl-canvas-wrap';
        canvas.parentNode.insertBefore(wrap, canvas);
        wrap.appendChild(canvas);
    }
    // 查找已有的搜索高亮canvas
    let hl = wrap.querySelector('.search-hl-overlay');
    if (!hl) {
        hl = document.createElement('canvas');
        hl.className = 'search-hl-overlay';
        hl.width = canvas.width;
        hl.height = canvas.height;
        hl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;';
        wrap.appendChild(hl);
    }
    // 同步尺寸
    if (hl.width !== canvas.width || hl.height !== canvas.height) {
        hl.width = canvas.width;
        hl.height = canvas.height;
    }
    return hl;
}

/** 清除所有搜索高亮覆盖层 */
function clearSearchHighlights() {
    document.querySelectorAll('.search-hl-overlay').forEach(c => {
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
    });
}

function handlePdfSearchInput(e) {
    clearTimeout(searchDebounceTimer);
    const query = e.target.value;
    searchDebounceTimer = setTimeout(() => performPdfSearch(query), 300);
}

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
    document.getElementById('paper-detail-bg').addEventListener('click', closePaperDetail);

    // 论文去重
    document.getElementById('btn-paper-dedup').addEventListener('click', dedupPapers);

    // 搜索弹窗
    document.getElementById('search-backdrop').addEventListener('click', closeSearch);
    document.getElementById('btn-close-search').addEventListener('click', closeSearch);
    document.getElementById('search-input').addEventListener('input', (e) => {
        renderSearchResults(e.target.value);
    });

    // 悬浮按钮拖动 + 点击搜索
    initFabDrag();

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

    // 目录侧边栏
    document.getElementById('btn-toggle-toc').addEventListener('click', toggleToc);
    document.getElementById('btn-close-toc').addEventListener('click', toggleToc);

    // PDF全文搜索
    document.getElementById('btn-toggle-search-bar').addEventListener('click', togglePdfSearch);
    document.getElementById('btn-close-pdf-search').addEventListener('click', closePdfSearch);
    document.getElementById('btn-search-prev').addEventListener('click', searchPrev);
    document.getElementById('btn-search-next').addEventListener('click', searchNext);
    document.getElementById('pdf-search-input').addEventListener('input', handlePdfSearchInput);
    document.getElementById('pdf-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.shiftKey ? searchPrev() : searchNext(); }
        if (e.key === 'Escape') closePdfSearch();
    });

    // 论文专用按钮
    document.getElementById('btn-quick-view').addEventListener('click', openQuickView);
    document.getElementById('btn-highlight').addEventListener('click', toggleHighlightMode);
    document.getElementById('btn-exit-highlight').addEventListener('click', exitHighlightMode);
    document.getElementById('hl-brush-size').addEventListener('input', e => setHighlightBrushRadius(+e.target.value));
    document.getElementById('btn-undo-hl').addEventListener('click', hlUndoLast);
    document.getElementById('btn-clear-hl').addEventListener('click', hlClearAll);
    document.getElementById('quickview-backdrop').addEventListener('click', closeQuickView);
    document.getElementById('btn-close-quickview').addEventListener('click', closeQuickView);

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
    initNotesPanelDrag();

    // 键盘快捷键
    document.addEventListener('keydown', e => {
        // 速览弹层 Escape
        if (document.getElementById('quickview-overlay').classList.contains('open')) {
            if (e.key === 'Escape') closeQuickView();
            return;
        }
        if (!document.getElementById('reader-overlay').classList.contains('open')) return;
        // Ctrl+F 打开PDF搜索
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            if (!pdfSearchOpen) togglePdfSearch();
            else document.getElementById('pdf-search-input').focus();
            return;
        }
        switch (e.key) {
            case 'PageUp': prevPage(); break;
            case 'PageDown': nextPage(); break;
            case 'Escape':
                if (pdfSearchOpen) { closePdfSearch(); break; }
                if (highlightMode) exitHighlightMode();
                else closeReader();
                break;
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