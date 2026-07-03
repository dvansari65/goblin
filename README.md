# ⚡ Docs Copilot AI (Goblin)

An intelligent, production-grade browser extension that directly extracts, categorizes, and processes hierarchical web documentation to feed accurate context to AI.

---

## ✨ Features

- **🌲 Hierarchical URL Tree Engine**: Automatically scans internal links on complex documentation sites (e.g., Wormhole, Docusaurus, Nextra) and groups them into clean, collapsible accordion categories based on URL path structures.
- **🛒 Context Shopping Cart**: Select precisely which documentation sections or pages the AI should read before asking your questions—eliminating hallucination and information overload.
- **📦 Multi-Page Background Fetching**: Silently fetches HTML across multiple selected links in the background, extracts the main article content via **Mozilla Readability**, and converts it to clean Markdown using **TurndownService**.
- **🎨 GitHub Copilot-Style UI**: A sleek, dark-mode sidebar injected directly into your browser tab with resizable width, live status indicators, and custom micro-animations.

---

## 🛠️ Tech Stack

- **Extension Framework**: [Plasmo](https://docs.plasmo.com/) (Manifest V3)
- **Frontend**: React 18, TypeScript, CSS-in-JS
- **Content Extraction**: `@mozilla/readability`, `turndown`

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
3. A resizable sidebar will open on the right side of the screen displaying all categorized sections of the documentation.
4. Check the boxes next to the pages you want the AI to analyze.
5. Click **Extract Selected Pages** to aggregate the Markdown context.
6. Ask your questions right in the chat interface!

---

## 📝 License

MIT
