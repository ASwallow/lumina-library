# Lumina Library

一个基于 Tauri v2 的本地 PDF 电子书阅读器，支持书架管理、阅读统计、笔记批注等功能。

## 功能特性

### 书架管理
- **批量导入 PDF** — 支持多选导入，自动去重（书名 + 文件大小）
- **智能标签分类** — 根据文件名自动归类（技术、文学、历史、科学等），支持自定义标签
- **艺术封面生成** — 为无封面的书籍自动生成渐变封面
- **书名字号可调** — 鼠标悬停书本卡片，拖动滑块调整字号（12px ~ 48px）
- **书名可编辑** — 书籍详情页点击书名直接修改
- **一键去重** — 快速清除同名重复书籍

### PDF 阅读器
- **三种阅读模式** — 单页、双页、滚动模式自由切换
- **缩放控制** — 支持页面缩放
- **进度记忆** — 自动记录每本书的阅读进度
- **键盘快捷键** — 左右翻页（←/→ 或 A/D）、缩放（+/-）、关闭（Esc）

### 笔记功能
- **Markdown 编写** — 支持完整的 Markdown 语法
- **数学公式** — 支持 KaTeX 渲染，`$$...$$` 块级公式，`$...$` 行内公式
- **手写批注** — 基于 Signature Pad 的手写画布，支持鼠标和触屏
- **侧边面板** — 阅读时右侧固定笔记面板，可拖拽边缘调整宽度
- **自动保存** — 输入即保存，关闭重开后保留所有笔记

### 阅读统计
- 藏书总数、累计阅读时长、阅读次数
- 按周柱状图展示阅读时长趋势
- 书籍标签分布饼图
- 单本书阅读时长排行

### 其他
- **暗色/亮色主题** — 一键切换
- **今日推荐** — 每次启动随机推荐一本书
- **数据本地存储** — 基于 IndexedDB，无需联网

## 技术栈

- **框架**: Tauri v2 (Rust + WebView2)
- **前端**: 原生 HTML/CSS/JavaScript，无构建工具
- **PDF 渲染**: PDF.js
- **Markdown**: marked.js
- **数学公式**: KaTeX
- **手写**: Signature Pad
- **图表**: Chart.js
- **存储**: localForage (IndexedDB)

## 开发环境

### 前置要求
- Node.js (LTS)
- Rust 编译器 (`rustup`)
- WebView2 (Win11 自带)

### 开发运行
```bash
npm install
npm run dev
```

### 打包
```bash
# 构建前端资源
cp index.html style.css app.js dist/
cp -r lib dist/

# 打包为 Windows 安装包
npm run build
```

产物位于 `src-tauri/target/release/bundle/nsis/`。

## 项目结构

```
├── index.html          # 主页面
├── app.js              # 应用逻辑
├── style.css           # 样式
├── lib/                # 第三方库
│   ├── pdf.min.js          # PDF.js
│   ├── pdf.worker.min.js   # PDF.js Worker
│   ├── marked.min.js       # Markdown 解析
│   ├── katex.min.js        # 数学公式渲染
│   ├── katex.min.css
│   ├── fonts/              # KaTeX 字体
│   ├── signature_pad.min.js # 手写画布
│   ├── chart.umd.min.js    # 图表
│   ├── localforage.min.js  # 本地存储
│   ├── lucide.min.js       # 图标
│   └── tailwind.js         # CSS 工具
├── src-tauri/          # Tauri 后端
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   └── src/
├── release/            # 发布产物
├── dist/               # 前端构建资源
└── package.json
```

## License

MIT
