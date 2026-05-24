# CLAUDE.md — yread Lib (Lumina Library) 开发备忘

## 项目概览

Tauri 2 桌面 PDF 阅读器 + 论文管理工具，中文 UI。

- **仓库**: https://github.com/ASwallow/yread-lib.git
- **前端**: 纯 vanilla HTML/CSS/JS，无框架无构建，所有逻辑在 `app.js`（~3100行）
- **后端**: Rust/Tauri 壳（`src-tauri/src/main.rs`，含 `save_file`/`get_exe_dir` 自定义命令）
- **本地库**: PDF.js（解析+渲染）、localforage（IndexedDB 持久化）、Chart.js、marked.js、KaTeX、SignaturePad、Lucide Icons

## 关键文件

| 文件 | 说明 |
|------|------|
| `app.js` | 全部应用逻辑 |
| `index.html` | UI 结构 |
| `style.css` | 样式 |
| `src-tauri/src/main.rs` | Tauri 入口，仅 `tauri::Builder::default().run(...)` |
| `src-tauri/tauri.conf.json` | Tauri 配置，`frontendDist: "../dist"` |
| `build.bat` | 唯一打包脚本（见下方） |
| `lib/` | 前端第三方库（PDF.js、localforage、KaTeX 等，无 npm） |

## 打包方式（重要）

**唯一正确的打包方法**：运行 `build.bat`（或等效命令）

```
build.bat 流程：
1. 复制 index.html / style.css / app.js / lib/ → dist/
2. npx tauri build
```

- **不要**用 `cargo tauri build`（项目用的是 npm `@tauri-apps/cli`）
- 产物在 `src-tauri/target/release/bundle/nsis/`
- 用户要求把安装包和 exe 复制到 `release/` 目录

## 阅读器架构

三种阅读模式，由 `readMode` 状态控制：

- **single** — 单页，每次渲染一页 canvas
- **double** — 双页，左右排列渲染到一个 canvas
- **scroll** — 滚动模式，所有页面纵向排列，IntersectionObserver 懒渲染

### 滚动模式关键逻辑

- `renderScrollMode()`: 创建所有页面的 canvas 占位元素，IntersectionObserver 监听进入视口的 canvas 并触发 `renderScrollPage()`
- `applyZoom()`: 缩放时更新 canvas CSS 宽度，重置 `data-rendered` 标记，触发可见页重渲染
- `renderScrollPage()`: 获取 PDF 页面 → 创建 viewport → 渲染到 canvas → 渲染后清除 `style.width`（用 intrinsic 尺寸）

### 关键状态变量

```javascript
pdfDoc          // PDF.js document 对象
currentPage     // 当前页码（1-based）
totalPages      // 总页数
currentZoom     // 缩放比（默认1.5，范围0.75-3.0，步长0.25）
readMode        // 'single' | 'double' | 'scroll'
scrollObserver  // IntersectionObserver 实例
```

## 数据存储

- **驱动**: localforage，按优先级尝试 IndexedDB → WebSQL → localStorage
- **PDF 二进制**: `localforage.setItem('pdf_<bookId>', array)` / `'pdf_<paperId>'`
- **元数据**: `library[]`（书籍）、`papers[]`（论文）、`readingStats[]`（阅读记录）
- **注意**: PDF 数据以 Array 形式存储（见 `uint8ToArray` / `arrayToUint8`），避免 ArrayBuffer detach

## 前端资源无构建

所有第三方库直接以 `<script>` 引入 `lib/` 目录下的 min 文件，无 npm/webpack/vite。修改 `app.js` 后直接生效（dev 模式下）。

## 发布流程（每次 git push 前必做）

1. **更新 README.md** — 在 `## 更新日志` 下新增本次修改条目
2. **版本号 +1** — 第三位版本号（patch）加一，需同时更新以下位置：
   - `src-tauri/tauri.conf.json` → `"version": "x.y.z"`
   - `package.json` → `"version": "x.y.z"`
3. **重新打包** — 运行 `build.bat`
4. **复制到 release/** — 每次做完更新，必须将安装包（`.nsis`）和应用（`.exe`）复制到 `proj_ebook/release/` 目录（产物来源：`src-tauri/target/release/bundle/nsis/`）。**即使只是更新 README 也要重新打包并更新 release/，确保 release/ 中的产物始终与最新代码一致。**
5. **git commit + push**（包含 release/ 中的产物更新）

## 需求来源

- **README.md 的 `## TODO` 列表中的条目等同于正式需求**，每次开发会话应优先处理 TODO 中的项目，完成后从 TODO 中移除并写入更新日志。

## 常见陷阱

1. **修改 `app.js` 后需要运行 `build.bat` 重新打包**，exe 中嵌入的是 `dist/` 的内容
2. **滚动模式的 canvas 是 CSS 尺寸 + intrinsic 尺寸两套**：未渲染时用 CSS width（高度默认150px），渲染后用 canvas.width/height 并清除 style.width
3. **`renderScrollPage` 是异步的**：设置 canvas intrinsic 尺寸和渲染都是 async 操作
4. **IntersectionObserver 的 root 是 `reader-body`（`reader-scroll` class）**，不是 window
