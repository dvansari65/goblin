import type { PlasmoGetStyle } from "plasmo"

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = `
    @keyframes docsai-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    /* Scrollbar styling for the messages container */
    .docsai-messages::-webkit-scrollbar {
      width: 4px;
    }
    .docsai-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    .docsai-messages::-webkit-scrollbar-thumb {
      background-color: #30363d;
      border-radius: 4px;
    }

    /* Prevent user-select while resizing */
    .docsai-resizing * {
      user-select: none !important;
      cursor: col-resize !important;
    }
  `
  return style
}
