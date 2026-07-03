<p align="center">
  <img src="extension/assets/logo.svg" alt="Goblin Logo" width="180" />
</p>

<h1 align="center">Goblin</h1>

<p align="center">
  An intelligent browser extension that reads documentation directly and generates<br/>
  <strong>summaries</strong> · <strong>integration guides</strong> · <strong>working code examples</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square" alt="MV3" />
  <img src="https://img.shields.io/badge/Built%20with-Plasmo-8957e5?style=flat-square" alt="Plasmo" />
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
</p>

---

## ✨ Features

- **🎯 Actionable Output**: Goblin synthesizes selected docs into clear integration instructions and production-ready code snippets grounded in the official documentation — zero hallucination.
- **🌲 Hierarchical URL Tree Engine**: Automatically scans all internal links on complex documentation sites and groups them into a clean, collapsible category tree based on URL path structure.
- **🛒 Targeted Section Selection**: Pick exactly which pages the AI reads. No noise, no irrelevant sections.
- **📦 Multi-Page Background Fetching**: Silently fetches selected pages using `fetch()`, extracts main content via **Mozilla Readability**, and converts to Markdown using **TurndownService**.
- **🎨 Elegant Dark Sidebar UI**: A GitHub Copilot-style sidebar injected into your browser tab, with resizable width, smooth micro-animations, and a chat interface.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Extension Framework | [Plasmo](https://docs.plasmo.com/) (MV3) |
| Frontend | React 18, TypeScript |
| Content Extraction | `@mozilla/readability`, `turndown` |

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+
- npm or pnpm

### 1. Install Dependencies
```bash
cd extension
npm install
```

### 2. Run Dev Server
```bash
npm run dev
```
Compiles in real-time. Output goes to `extension/build/chrome-mv3-dev`.

### 3. Load in Chrome
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/build/chrome-mv3-dev` folder

---

## 📖 How to Use

1. Navigate to any documentation page (e.g., `https://docs.wormhole.com/`)
2. Click the **Goblin** icon in your browser toolbar
3. The sidebar opens showing all doc sections organized in a category tree
4. ✅ Check the sections you want to understand
5. Click **Extract Selected Pages**
6. Ask Goblin anything — it will respond using only the exact pages you selected:
   - *"How do I initialize the client?"*
   - *"Give me a code example for token transfer"*
   - *"What are the prerequisites for deployment?"*

---

## 📝 License

MIT
