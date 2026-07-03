import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = `
    @keyframes docsai-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }
  `
  return style
}

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false
}

type MessageRole = "user" | "assistant" | "system"

interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
}

interface PageLink {
  url: string
  title: string
  pathSegments: string[]
}

interface TreeNode {
  name: string
  path: string
  link?: PageLink
  children: Record<string, TreeNode>
}

// ─── HELPER: Build URL Path Tree ───────────────────────────────────────────────
function buildTree(links: PageLink[]): TreeNode {
  const root: TreeNode = { name: "Root", path: "", children: {} }

  links.forEach(link => {
    let current = root
    const segments = link.pathSegments
    
    if (segments.length === 0) {
      if (!current.link) current.link = link
      return
    }

    segments.forEach((seg, i) => {
      if (!current.children[seg]) {
        // Format 'native-token-transfers' to 'Native Token Transfers'
        const prettyName = seg.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        current.children[seg] = {
          name: prettyName,
          path: segments.slice(0, i + 1).join('/'),
          children: {}
        }
      }
      current = current.children[seg]
      
      // If it's the last segment of the path, assign the actual page link
      if (i === segments.length - 1) {
        current.link = link
      }
    })
  })

  return root
}

const MIN_WIDTH = 320
const MAX_WIDTH = 800
const DEFAULT_WIDTH = 420

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function DocsAISidebar() {
  const [isOpen, setIsOpen] = useState(false)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [contextExtracted, setContextExtracted] = useState(false)
  const [pageTitle, setPageTitle] = useState("")
  
  // New state for multi-page extraction
  const [availableLinks, setAvailableLinks] = useState<PageLink[]>([])
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set())
  const [linkSearch, setLinkSearch] = useState("")

  const sidebarRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(DEFAULT_WIDTH)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    const messageListener = (request: any, _sender: any, sendResponse: any) => {
      if (request.action === "TOGGLE_SIDEBAR") {
        setIsOpen((prev) => !prev)
        sendResponse({ success: true })
      }
    }
    chrome.runtime.onMessage.addListener(messageListener)
    return () => chrome.runtime.onMessage.removeListener(messageListener)
  }, [])

  // Link Scanner: Runs when sidebar opens and links are empty
  useEffect(() => {
    if (isOpen && availableLinks.length === 0) {
      const anchors = Array.from(document.querySelectorAll("a"))
      const currentUrl = window.location.href.split('#')[0]
      const origin = window.location.origin
      const currentSegments = new URL(currentUrl).pathname.split('/').filter(Boolean)

      const uniqueLinks = new Map<string, PageLink>()
      uniqueLinks.set(currentUrl, { url: currentUrl, title: document.title || "Current Page", pathSegments: currentSegments })

      anchors.forEach(a => {
        try {
          const url = new URL(a.href)
          if (url.origin === origin && url.protocol.startsWith('http')) {
            const cleanUrl = url.origin + url.pathname + url.search 
            let title = a.innerText.trim()
            if (!title) title = a.title?.trim()
            
            if (cleanUrl && title && title.length > 2 && cleanUrl !== currentUrl) {
              if (!uniqueLinks.has(cleanUrl)) {
                const segments = url.pathname.split('/').filter(Boolean)
                uniqueLinks.set(cleanUrl, { url: cleanUrl, title, pathSegments: segments })
              }
            }
          }
        } catch (e) {}
      })

      const parsedLinks = Array.from(uniqueLinks.values())
      setAvailableLinks(parsedLinks)
      setSelectedUrls(new Set([currentUrl]))
    }
  }, [isOpen, availableLinks.length])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width
  }, [width])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const delta = startXRef.current - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta))
      setWidth(newWidth)
    }
    const onMouseUp = () => setIsResizing(false)

    if (isResizing) {
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    }
    return () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [isResizing])

  const handleTextareaInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const extractSelectedContext = async () => {
    if (selectedUrls.size === 0) return
    setIsLoading(true)
    setContextExtracted(false)
    
    try {
      const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
      let totalMarkdown = ""
      let extractedTitles: string[] = []
      let totalChars = 0
      const currentUrl = window.location.href.split('#')[0]

      for (const url of Array.from(selectedUrls)) {
        let docToParse: Document
        if (url === currentUrl) {
          docToParse = document.cloneNode(true) as Document
        } else {
          const res = await fetch(url)
          const html = await res.text()
          const parser = new DOMParser()
          docToParse = parser.parseFromString(html, 'text/html')
        }

        const reader = new Readability(docToParse)
        const article = reader.parse()

        if (article) {
          const md = turndownService.turndown(article.content)
          totalMarkdown += `\n\n# Source: ${article.title || url}\nURL: ${url}\n\n${md}`
          totalChars += md.length
          extractedTitles.push(article.title || url)
        }
      }

      setContextExtracted(true)
      setPageTitle(`${extractedTitles.length} pages extracted`)

      const systemMsg: Message = {
        id: crypto.randomUUID(),
        role: "system",
        content: `✅ Context extracted from **${extractedTitles.length} pages**\n\n${totalChars.toLocaleString()} characters ready. Ask me anything about how to integrate or use this library.`,
        timestamp: new Date()
      }
      setMessages([systemMsg])
    } catch (err: any) {
      setMessages([{ id: crypto.randomUUID(), role: "system", content: `❌ Error extracting pages: ${err.message}`, timestamp: new Date() }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = () => {
    const text = inputValue.trim()
    if (!text || isLoading) return

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date() }])
    setInputValue("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"

    setIsLoading(true)
    setTimeout(() => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "🚧 AI response coming soon — backend integration is the next step! I will use the extracted multi-page context to answer your question precisely.", timestamp: new Date() }])
      setIsLoading(false)
    }, 800)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const toggleLinkSelection = (url: string, checked: boolean) => {
    const newSet = new Set(selectedUrls)
    if (checked) newSet.add(url)
    else newSet.delete(url)
    setSelectedUrls(newSet)
  }

  const filteredLinks = useMemo(() => {
    return availableLinks.filter(l => l.title.toLowerCase().includes(linkSearch.toLowerCase()) || l.url.toLowerCase().includes(linkSearch.toLowerCase()))
  }, [availableLinks, linkSearch])

  const treeData = useMemo(() => buildTree(filteredLinks), [filteredLinks])

  if (!isOpen) return null

  const styles: Record<string, React.CSSProperties> = {
    overlay: {
      position: "fixed", top: 0, right: 0, height: "100vh", width: `${width}px`,
      zIndex: 2147483647, display: "flex", flexDirection: "row", pointerEvents: "all",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", boxSizing: "border-box"
    },
    resizeHandle: {
      width: "4px", height: "100%", cursor: "col-resize",
      backgroundColor: isResizing ? "#2f81f7" : "transparent", transition: "background-color 0.15s ease",
      flexShrink: 0, position: "relative"
    },
    resizeHandleInner: {
      position: "absolute", top: "50%", left: "-2px", transform: "translateY(-50%)",
      width: "4px", height: "48px", borderRadius: "2px", backgroundColor: "#30363d"
    },
    panel: {
      flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0d1117",
      borderLeft: "1px solid #21262d", boxShadow: "-8px 0 32px rgba(0,0,0,0.6)", overflow: "hidden"
    },
    header: {
      padding: "0 16px", height: "56px", borderBottom: "1px solid #21262d",
      display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#0d1117", flexShrink: 0
    },
    headerLeft: { display: "flex", alignItems: "center", gap: "10px" },
    logo: {
      width: "28px", height: "28px", borderRadius: "6px", background: "linear-gradient(135deg, #2f81f7 0%, #388bfd 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "700", color: "#fff"
    },
    headerTitle: { fontSize: "14px", fontWeight: "600", color: "#e6edf3", margin: 0 },
    headerBadge: {
      fontSize: "10px", fontWeight: "600", color: "#2f81f7", backgroundColor: "rgba(47,129,247,0.15)",
      border: "1px solid rgba(47,129,247,0.3)", borderRadius: "4px", padding: "1px 6px", textTransform: "uppercase" as const
    },
    closeBtn: {
      background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "16px",
      padding: "4px", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center"
    },
    contextBar: {
      padding: "8px 16px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center",
      justifyContent: "space-between", backgroundColor: "#161b22", flexShrink: 0
    },
    contextLabel: { fontSize: "12px", color: "#8b949e", display: "flex", alignItems: "center", gap: "6px" },
    contextDot: { width: "6px", height: "6px", borderRadius: "50%", backgroundColor: contextExtracted ? "#3fb950" : "#f85149", flexShrink: 0 },
    messages: { flex: 1, overflowY: "auto" as const, padding: "16px", display: "flex", flexDirection: "column", gap: "16px" },
    emptyState: {
      flex: 1, display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0"
    },
    emptyTitle: { fontSize: "15px", fontWeight: "600", color: "#e6edf3", margin: "0 0 4px 0" },
    emptyDesc: { fontSize: "13px", color: "#8b949e", margin: 0, lineHeight: "1.5" },
    linkSearchInput: {
      width: "100%", padding: "8px 12px", backgroundColor: "#161b22", border: "1px solid #30363d",
      borderRadius: "6px", color: "#c9d1d9", fontSize: "13px", outline: "none", boxSizing: "border-box"
    },
    linkList: {
      flex: 1, overflowY: "auto" as const, border: "1px solid #30363d", borderRadius: "6px",
      backgroundColor: "#161b22", padding: "12px 12px"
    },
    extractBtn: {
      backgroundColor: "#238636", color: "#fff", border: "1px solid rgba(240, 246, 252, 0.1)",
      borderRadius: "6px", padding: "10px 16px", fontSize: "14px", fontWeight: "500",
      cursor: isLoading || selectedUrls.size === 0 ? "not-allowed" : "pointer",
      opacity: isLoading || selectedUrls.size === 0 ? 0.6 : 1, width: "100%", transition: "opacity 0.2s ease",
      flexShrink: 0
    },
    inputArea: { padding: "12px 16px 16px", borderTop: "1px solid #21262d", backgroundColor: "#0d1117", flexShrink: 0 },
    inputWrapper: {
      backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "10px",
      display: "flex", flexDirection: "column", overflow: "hidden"
    },
    textarea: {
      background: "transparent", border: "none", outline: "none", color: "#e6edf3", fontSize: "13.5px",
      lineHeight: "1.6", padding: "10px 14px 6px", resize: "none" as const, fontFamily: "inherit", minHeight: "40px"
    },
    inputActions: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 8px" },
    inputHint: { fontSize: "11px", color: "#484f58" },
    sendBtn: {
      width: "28px", height: "28px", borderRadius: "6px", border: "none",
      background: "linear-gradient(135deg, #2f81f7 0%, #388bfd 100%)", color: "#fff",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px"
    },
    sendBtnDisabled: { opacity: 0.4, cursor: "not-allowed" as const }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={styles.overlay} ref={sidebarRef}>
        <div ref={resizeRef} style={styles.resizeHandle} onMouseDown={onMouseDown} title="Drag to resize">
          <div style={styles.resizeHandleInner} />
        </div>

        <div style={styles.panel}>
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.logo}>AI</div>
              <span style={styles.headerTitle}>Docs Copilot</span>
              <span style={styles.headerBadge}>Beta</span>
            </div>
            <button style={styles.closeBtn} onClick={() => setIsOpen(false)} title="Close sidebar">✕</button>
          </div>

          {/* Context Status Bar */}
          <div style={styles.contextBar}>
            <span style={styles.contextLabel}>
              <span style={styles.contextDot} />
              {contextExtracted ? `Context: ${pageTitle}` : "No context extracted yet"}
            </span>
            {contextExtracted && (
              <button 
                onClick={() => { setMessages([]); setContextExtracted(false); }} 
                style={{ background: "transparent", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", cursor: "pointer" }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Messages or Setup State */}
          <div style={styles.messages} className="docsai-messages">
            {messages.length === 0 ? (
              <div style={styles.emptyState}>
                <div>
                  <h3 style={styles.emptyTitle}>Select Docs to Extract</h3>
                  <p style={styles.emptyDesc}>Choose the exact pages you want the AI to read.</p>
                </div>
                
                <input 
                  type="text" 
                  placeholder="Search docs categories..." 
                  value={linkSearch} 
                  onChange={(e) => setLinkSearch(e.target.value)}
                  style={styles.linkSearchInput}
                />
                
                <div style={styles.linkList} className="docsai-messages">
                  {filteredLinks.length === 0 ? (
                    <div style={{ padding: "12px", color: "#8b949e", fontSize: "12px", textAlign: "center" }}>No internal links found on this page.</div>
                  ) : (
                    <TreeView node={treeData} level={0} selectedUrls={selectedUrls} toggleSelection={toggleLinkSelection} />
                  )}
                </div>
                
                <button 
                  style={styles.extractBtn}
                  onClick={extractSelectedContext}
                  disabled={isLoading || selectedUrls.size === 0}
                >
                  {isLoading ? "Extracting Pages..." : `Extract ${selectedUrls.size} Selected Pages`}
                </button>
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))
            )}

            {isLoading && messages.length > 0 && (
              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "linear-gradient(135deg,#2f81f7,#388bfd)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>✨</div>
                <div style={{ backgroundColor: "#161b22", border: "1px solid #21262d", borderRadius: "10px", padding: "10px 14px", display: "flex", gap: "4px", alignItems: "center" }}>
                  <Dot delay="0s" />
                  <Dot delay="0.2s" />
                  <Dot delay="0.4s" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div style={styles.inputArea}>
            <div style={styles.inputWrapper}>
              <textarea
                ref={textareaRef}
                style={styles.textarea}
                placeholder={contextExtracted ? "Ask about these docs… (Shift+Enter for newline)" : "Select and extract pages first…"}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onInput={handleTextareaInput}
                onKeyDown={handleKeyDown}
                disabled={!contextExtracted}
                rows={1}
              />
              <div style={styles.inputActions}>
                <span style={styles.inputHint}>⏎ Send · ⇧⏎ Newline</span>
                <button
                  style={{
                    ...styles.sendBtn,
                    ...(!inputValue.trim() || !contextExtracted || isLoading ? styles.sendBtnDisabled : {})
                  }}
                  onClick={handleSend}
                  disabled={!inputValue.trim() || !contextExtracted || isLoading}
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TreeView({ node, level, selectedUrls, toggleSelection }: { node: TreeNode, level: number, selectedUrls: Set<string>, toggleSelection: (url: string, checked: boolean) => void }) {
  const [isExpanded, setIsExpanded] = useState(level < 2)
  const hasChildren = Object.keys(node.children).length > 0
  
  if (level === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {Object.values(node.children).map(child => (
          <TreeView key={child.path} node={child} level={level + 1} selectedUrls={selectedUrls} toggleSelection={toggleSelection} />
        ))}
      </div>
    )
  }

  return (
    <div style={{ paddingLeft: level === 1 ? 0 : 16, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {hasChildren ? (
          <span onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer', color: '#8b949e', fontSize: "10px", width: "12px", textAlign: 'center', userSelect: "none" }}>
            {isExpanded ? '▼' : '▶'}
          </span>
        ) : (
          <span style={{ width: "12px" }} />
        )}
        
        {node.link ? (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: "#c9d1d9", fontSize: "13px" }}>
            <input 
              type="checkbox" 
              style={{ cursor: "pointer", margin: 0 }}
              checked={selectedUrls.has(node.link.url)}
              onChange={(e) => toggleSelection(node.link!.url, e.target.checked)}
            />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "260px" }} title={node.link.title}>
              {node.link.title}
            </span>
          </label>
        ) : (
          <span 
            style={{ fontSize: "13px", fontWeight: "600", color: "#8b949e", cursor: hasChildren ? 'pointer' : 'default', userSelect: "none" }} 
            onClick={() => hasChildren && setIsExpanded(!isExpanded)}
          >
            {node.name}
          </span>
        )}
      </div>
      
      {isExpanded && hasChildren && (
        <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid #30363d", marginLeft: "5px", paddingLeft: "11px", marginTop: "4px", gap: "2px" }}>
          {Object.values(node.children).map(child => (
            <TreeView key={child.path} node={child} level={level + 1} selectedUrls={selectedUrls} toggleSelection={toggleSelection} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user"
  const isSystem = message.role === "system"

  if (isSystem) {
    return (
      <div style={{ padding: "10px 14px", backgroundColor: "rgba(56,139,253,0.08)", border: "1px solid rgba(56,139,253,0.2)", borderRadius: "8px", fontSize: "13px", color: "#79c0ff", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
        {message.content}
      </div>
    )
  }

  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexDirection: isUser ? "row-reverse" : "row" }}>
      <div style={{ width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", background: isUser ? "linear-gradient(135deg,#8957e5,#a371f7)" : "linear-gradient(135deg,#2f81f7,#388bfd)" }}>
        {isUser ? "U" : "✨"}
      </div>
      <div style={{ backgroundColor: isUser ? "rgba(137,87,229,0.15)" : "#161b22", border: `1px solid ${isUser ? "rgba(137,87,229,0.3)" : "#21262d"}`, borderRadius: "10px", padding: "10px 14px", fontSize: "13.5px", color: "#e6edf3", lineHeight: "1.65", maxWidth: "85%", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {message.content}
      </div>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#8b949e", display: "inline-block", animation: "docsai-bounce 1.2s infinite ease-in-out", animationDelay: delay }} />
  )
}
