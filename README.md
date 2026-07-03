# ⚡ Docs Copilot AI (Goblin)

An intelligent, production-grade browser extension that reads complex documentation sites and instantly generates actionable outputs: **comprehensive summaries**, **step-by-step integration guides**, and **working code examples**.

---

## ✨ Core Value & Features

- **🎯 Actionable Output Generation**: Instead of forcing you to manually dig through pages, Docs Copilot synthesizes selected documentation into clear integration instructions and production code snippets showing exactly how to use the library.
- **🌲 Hierarchical URL Tree Engine**: Automatically scans internal links on complex documentation sites (e.g., Wormhole, Docusaurus, Nextra) and groups them into clean, collapsible accordion categories based on URL path structures.
- **🛒 Targeted Section Selection**: Select precisely which documentation categories or pages are relevant to your task, ensuring the AI focuses 100% on what you need to build.
- **📦 Multi-Page Background Processing**: Silently fetches HTML across multiple selected links in the background, extracts the core content via **Mozilla Readability**, and converts it to clean Markdown using **TurndownService**.
- **🎨 GitHub Copilot-Style UI**: A sleek, dark-mode sidebar injected directly into your browser tab with resizable width, live status indicators, and custom micro-animations.

---

## 🛠️ Tech Stack

- **Extension Framework**: [Plasmo](https://docs.plasmo.com/) (Manifest V3)
- **Frontend**: React 18, TypeScript, CSS-in-JS
- **Content Parsing**: `@mozilla/readability`, `turndown`

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm or pnpm

### 1. Install Dependencies
```bash
cd extension
npm install
```

### 2. Run Development Server
```bash
npm run dev
```
This compiles the extension in real-time and outputs the unpacked build to `extension/build/chrome-mv3-dev`.

### 3. Load Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `extension/build/chrome-mv3-dev` folder.

---

## 📖 How to Use

1. Navigate to any documentation page (e.g., `https://docs.wormhole.com/`).
2. Click the **Docs Copilot AI** extension icon in your toolbar.
3. A resizable sidebar will open displaying all categorized sections of the documentation.
4. Check the boxes next to the pages relevant to the feature you want to implement.
5. Click **Extract & Process** to instantly receive:
   - A **concise summary** of the selected modules.
   - **Step-by-step instructions** on how to integrate the library into your project.
   - **Code examples** directly grounded in the official documentation.

---

## 📝 License

MIT
