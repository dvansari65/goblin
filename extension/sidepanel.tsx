import React, { useEffect, useMemo, useRef, useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import goblinLogo from "url:./assets/logo.svg"

interface CapturedPage {
  url: string
  host: string
  origin: string
  title: string
  markdown: string
  capturedAt: number
  truncated?: boolean
}

interface Message {
  id: string
  role: "system" | "assistant"
  content: string
}

interface RuntimeMessageResponse<T> {
  ok?: boolean
  error?: string
  pages?: T
}

const BACKEND_URL = "http://localhost:8787/api/generate"

class BackendRequestError extends Error {
  status: number
  upgradeRequired: boolean

  constructor(message: string, status: number, upgradeRequired = false) {
    super(message)
    this.name = "BackendRequestError"
    this.status = status
    this.upgradeRequired = upgradeRequired
  }
}

function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeMessageResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Extension message failed"))
        return
      }
      resolve(response as T)
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback = Date.now()) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function normalizeCapturedPage(value: unknown): CapturedPage | null {
  if (!isRecord(value)) return null

  const url = asString(value.url)
  const markdown = asString(value.markdown)
  if (!url || !markdown) return null

  return {
    url,
    host: asString(value.host, "unknown host"),
    origin: asString(value.origin),
    title: asString(value.title, url),
    markdown,
    capturedAt: asNumber(value.capturedAt),
    truncated: Boolean(value.truncated)
  }
}

function normalizeCapturedPages(value: unknown): CapturedPage[] {
  return Array.isArray(value)
    ? value.map(normalizeCapturedPage).filter((page): page is CapturedPage => Boolean(page))
    : []
}

function sanitizeMarkdown(value: unknown) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
}

function formatGenerateError(error: unknown) {
  if (error instanceof BackendRequestError) {
    if (error.status === 429) {
      return `Could not generate output.\n\n${error.message}\n\nThis is a backend quota response. For local development, either reset usage with \`POST /api/usage/reset\` or set \`DISABLE_QUOTA=true\` in \`backend/.dev.vars\` and restart Wrangler.`
    }

    return `Could not generate output.\n\nBackend returned HTTP ${error.status}.\n\n${error.message}`
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `Could not reach the backend.\n\nStart it with \`cd backend && npm run dev\`, then try again.\n\n${message}`
  }

  return `Could not generate output.\n\n${message}`
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp))
}

function shortPath(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.pathname === "/" ? parsed.host : parsed.pathname
  } catch {
    return url
  }
}

function combineMarkdown(pages: CapturedPage[]) {
  return pages
    .map((page) => `# Source: ${page.title}\nURL: ${page.url}\nCaptured: ${new Date(page.capturedAt).toISOString()}\n\n${page.markdown}`)
    .join("\n\n---\n\n")
}

export default function SidePanel() {
  const [pages, setPages] = useState<CapturedPage[]>([])
  const [query, setQuery] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const filteredPages = useMemo(() => {
    const value = query.toLowerCase().trim()
    if (!value) return pages
    return pages.filter((page) => `${page.title} ${page.url} ${page.host}`.toLowerCase().includes(value))
  }, [pages, query])

  useEffect(() => {
    sendRuntimeMessage<{ pages: CapturedPage[] }>({ action: "GOBLIN_GET_CAPTURED_PAGES" })
      .then((response) => setPages(normalizeCapturedPages(response.pages)))
      .catch((error) => {
        setMessages([{ id: crypto.randomUUID(), role: "system", content: `Could not load captured pages: ${error.message}` }])
      })

    const listener = (request: unknown) => {
      if (isRecord(request) && request.action === "GOBLIN_CAPTURED_PAGES_UPDATED") {
        setPages(normalizeCapturedPages(request.pages))
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const updatePages = async (nextPages: CapturedPage[]) => {
    const normalizedPages = normalizeCapturedPages(nextPages)
    setPages(normalizedPages)
    await sendRuntimeMessage({ action: "GOBLIN_SET_CAPTURED_PAGES", pages: normalizedPages })
  }

  const removePage = async (url: string) => {
    await updatePages(pages.filter((page) => page.url !== url))
  }

  const clearPages = async () => {
    setPages([])
    await sendRuntimeMessage({ action: "GOBLIN_CLEAR_CAPTURED_PAGES" })
  }

  const generateOutput = async () => {
    if (pages.length === 0 || isLoading) return

    const assistantId = crypto.randomUUID()
    setIsLoading(true)
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "system",
        content: `Generating from ${pages.length} captured page${pages.length === 1 ? "" : "s"}.`
      },
      {
        id: assistantId,
        role: "assistant",
        content: ""
      }
    ])

    try {
      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: pages.map((page) => page.url),
          markdown: combineMarkdown(pages)
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const errorMessage = isRecord(errorData) && typeof errorData.error === "string"
          ? errorData.error
          : `Backend returned ${response.status}`
        const upgradeRequired = isRecord(errorData) && errorData.upgradeRequired === true
        throw new BackendRequestError(errorMessage, response.status, upgradeRequired)
      }
      if (!response.body) throw new Error("Backend returned no stream")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ""
      let buffer = ""
      let lastUpdate = Date.now()

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (buffer.trim().startsWith("0:")) {
            try {
              const chunk = JSON.parse(buffer.trim().slice(2))
              if (typeof chunk === "string") fullText += chunk
            } catch {}
          }
          setMessages((prev) => prev.map((message) => message.id === assistantId ? { ...message, content: fullText } : message))
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let updated = false
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("0:")) continue
          try {
            const chunk = JSON.parse(trimmed.slice(2))
            if (typeof chunk === "string") {
              fullText += chunk
              updated = true
            }
          } catch {}
        }

        if (updated && Date.now() - lastUpdate > 80) {
          lastUpdate = Date.now()
          setMessages((prev) => prev.map((message) => message.id === assistantId ? { ...message, content: fullText } : message))
        }
      }
    } catch (error: any) {
      setMessages((prev) => prev.map((message) => message.id === assistantId
        ? { ...message, content: formatGenerateError(error) }
        : message
      ))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <img src={goblinLogo} alt="Goblin" style={styles.logo} />
          <div>
            <h1 style={styles.title}>Goblin</h1>
            <p style={styles.subtitle}>Captured docs stay here while you browse.</p>
          </div>
        </div>
      </header>

      <section style={styles.toolbar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search captured pages"
          style={styles.search}
        />
        <button onClick={clearPages} disabled={pages.length === 0 || isLoading} style={styles.secondaryButton}>Clear</button>
      </section>

      <section style={styles.statusBar}>
        <span>{pages.length} captured</span>
        <span>{pages.reduce((total, page) => total + page.markdown.length, 0).toLocaleString()} chars</span>
      </section>

      <section style={styles.pageList}>
        {filteredPages.length === 0 ? (
          <div style={styles.emptyState}>
            Open documentation pages in the browser. Goblin will capture readable pages automatically and keep them here.
          </div>
        ) : (
          filteredPages.map((page) => (
            <article key={page.url} style={styles.pageItem}>
              <div style={styles.pageMain}>
                <h2 style={styles.pageTitle} title={page.title}>{page.title}</h2>
                <p style={styles.pageMeta} title={page.url}>{shortPath(page.url)}</p>
                <p style={styles.pageFoot}>
                  Captured {formatTime(page.capturedAt)}
                  {page.truncated ? " · truncated" : ""}
                </p>
              </div>
              <button onClick={() => removePage(page.url)} disabled={isLoading} style={styles.removeButton}>Remove</button>
            </article>
          ))
        )}
      </section>

      <button
        onClick={generateOutput}
        disabled={pages.length === 0 || isLoading}
        style={{
          ...styles.generateButton,
          opacity: pages.length === 0 || isLoading ? 0.55 : 1,
          cursor: pages.length === 0 || isLoading ? "not-allowed" : "pointer"
        }}
      >
        {isLoading ? "Generating..." : "Create Summary, Integration Guide, and Code"}
      </button>

      <section style={styles.output}>
        {messages.length === 0 ? (
          <div style={styles.emptyOutput}>Generated output will appear here.</div>
        ) : (
          messages.map((message) => (
            <div key={message.id} style={message.role === "system" ? styles.systemMessage : styles.assistantMessage}>
              <SafeMarkdown content={message.content || "Waiting for model stream..."} />
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </section>
    </main>
  )
}

function SafeMarkdown({ content }: { content: string }) {
  const safeContent = sanitizeMarkdown(content)
  const blocks = parseMarkdownBlocks(safeContent)

  return (
    <div style={styles.markdownRoot}>
      {blocks.map((block, index) => renderMarkdownBlock(block, index))}
    </div>
  )
}

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "code"; language: string; code: string }
  | { type: "rule" }

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n")
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const fenceMatch = trimmed.match(/^```(\w+)?/)
    if (fenceMatch) {
      const language = fenceMatch[1] || "text"
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: "code", language, code: codeLines.join("\n") })
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: Math.min(3, headingMatch[1].length) as 1 | 2 | 3,
        text: headingMatch[2]
      })
      index += 1
      continue
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ type: "rule" })
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""))
        index += 1
      }
      blocks.push({ type: "unordered-list", items })
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""))
        index += 1
      }
      blocks.push({ type: "ordered-list", items })
      continue
    }

    const paragraphLines = [trimmed]
    index += 1
    while (index < lines.length) {
      const next = lines[index].trim()
      if (!next || /^```/.test(next) || /^#{1,3}\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next) || /^(-{3,}|\*{3,})$/.test(next)) {
        break
      }
      paragraphLines.push(next)
      index += 1
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") })
  }

  return blocks
}

function renderMarkdownBlock(block: MarkdownBlock, index: number) {
  switch (block.type) {
    case "heading": {
      const style = block.level === 1 ? styles.mdH1 : block.level === 2 ? styles.mdH2 : styles.mdH3
      const HeadingTag = `h${block.level}` as "h1" | "h2" | "h3"
      return <HeadingTag key={index} style={style}>{renderInlineMarkdown(block.text)}</HeadingTag>
    }
    case "unordered-list":
      return <ul key={index} style={styles.mdList}>{block.items.map((item, itemIndex) => <li key={itemIndex} style={styles.mdLi}>{renderInlineMarkdown(item)}</li>)}</ul>
    case "ordered-list":
      return <ol key={index} style={styles.mdList}>{block.items.map((item, itemIndex) => <li key={itemIndex} style={styles.mdLi}>{renderInlineMarkdown(item)}</li>)}</ol>
    case "code":
      return <CodeBlock key={index} language={block.language} code={block.code} />
    case "rule":
      return <hr key={index} style={styles.mdRule} />
    case "paragraph":
    default:
      return <p key={index} style={styles.mdP}>{renderInlineMarkdown(block.text)}</p>
  }
}

function renderInlineMarkdown(text: string) {
  const parts: React.ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))

    const token = match[0]
    const key = `${match.index}-${token}`
    if (token.startsWith("**")) {
      parts.push(<strong key={key} style={styles.inlineStrong}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith("*")) {
      parts.push(<em key={key} style={styles.inlineEm}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith("`")) {
      parts.push(<code key={key} style={styles.inlineCode}>{token.slice(1, -1)}</code>)
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        parts.push(<a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer" style={styles.link}>{linkMatch[1]}</a>)
      } else {
        parts.push(token)
      }
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div style={{ margin: "10px 0" }}>
      <div style={styles.codeHeader}>
        <span>{language}</span>
        <button onClick={() => navigator.clipboard.writeText(code)} style={styles.copyButton}>Copy</button>
      </div>
      <SyntaxHighlighter style={oneDark as any} language={language} PreTag="div" customStyle={styles.codeBlock}>
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    backgroundColor: "#0d1117",
    color: "#c9d1d9",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
    display: "flex",
    flexDirection: "column"
  },
  header: {
    padding: "14px 16px",
    borderBottom: "1px solid #21262d",
    backgroundColor: "#161b22"
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 8,
    flexShrink: 0
  },
  title: {
    margin: 0,
    fontSize: 16,
    color: "#e6edf3",
    lineHeight: 1.2
  },
  subtitle: {
    margin: "3px 0 0",
    color: "#8b949e",
    fontSize: 12,
    lineHeight: 1.35
  },
  toolbar: {
    display: "flex",
    gap: 8,
    padding: "12px 12px 8px"
  },
  search: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#0d1117",
    border: "1px solid #30363d",
    color: "#c9d1d9",
    borderRadius: 6,
    padding: "9px 10px",
    fontSize: 13,
    outline: "none"
  },
  secondaryButton: {
    backgroundColor: "#161b22",
    border: "1px solid #30363d",
    color: "#c9d1d9",
    borderRadius: 6,
    padding: "0 10px",
    fontSize: 12,
    fontWeight: 700
  },
  statusBar: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0 14px 8px",
    color: "#8b949e",
    fontSize: 12
  },
  pageList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "0 12px 12px",
    maxHeight: 280,
    overflowY: "auto",
    borderBottom: "1px solid #21262d"
  },
  emptyState: {
    border: "1px dashed #30363d",
    borderRadius: 8,
    padding: 14,
    color: "#8b949e",
    fontSize: 13,
    lineHeight: 1.5
  },
  pageItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    border: "1px solid #21262d",
    backgroundColor: "#161b22",
    borderRadius: 8
  },
  pageMain: {
    flex: 1,
    minWidth: 0
  },
  pageTitle: {
    margin: 0,
    color: "#e6edf3",
    fontSize: 13,
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  pageMeta: {
    margin: "4px 0 0",
    color: "#8b949e",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  pageFoot: {
    margin: "5px 0 0",
    color: "#6e7681",
    fontSize: 11
  },
  removeButton: {
    backgroundColor: "transparent",
    border: "1px solid #30363d",
    color: "#8b949e",
    borderRadius: 6,
    padding: "4px 7px",
    fontSize: 11,
    cursor: "pointer"
  },
  generateButton: {
    margin: 12,
    backgroundColor: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "11px 12px",
    fontSize: 13,
    fontWeight: 800
  },
  output: {
    flex: 1,
    overflowY: "auto",
    padding: "0 12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10
  },
  emptyOutput: {
    border: "1px solid #21262d",
    borderRadius: 8,
    padding: 14,
    color: "#8b949e",
    fontSize: 13
  },
  systemMessage: {
    border: "1px solid rgba(56,139,253,0.25)",
    backgroundColor: "rgba(56,139,253,0.08)",
    borderRadius: 8,
    padding: "8px 11px",
    color: "#79c0ff",
    fontSize: 13
  },
  assistantMessage: {
    border: "1px solid #21262d",
    backgroundColor: "#161b22",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#c9d1d9",
    fontSize: 13
  },
  markdownRoot: {
    display: "flex",
    flexDirection: "column",
    gap: 0
  },
  mdH1: { fontSize: 16, margin: "12px 0 8px", color: "#e6edf3" },
  mdH2: { fontSize: 14, margin: "12px 0 6px", color: "#e6edf3" },
  mdH3: { fontSize: 13, margin: "10px 0 5px", color: "#a371f7" },
  mdP: { margin: "6px 0", lineHeight: 1.65 },
  mdList: { margin: "6px 0", paddingLeft: 20 },
  mdLi: { margin: "3px 0", lineHeight: 1.55 },
  mdRule: { border: "none", borderTop: "1px solid #30363d", margin: "12px 0" },
  link: { color: "#58a6ff" },
  inlineStrong: { color: "#e6edf3", fontWeight: 700 },
  inlineEm: { color: "#a371f7" },
  codeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1e2736",
    border: "1px solid #30363d",
    borderBottom: "none",
    borderRadius: "8px 8px 0 0",
    padding: "4px 9px",
    color: "#8b949e",
    fontSize: 11
  },
  copyButton: {
    background: "transparent",
    border: "1px solid #30363d",
    borderRadius: 4,
    color: "#8b949e",
    fontSize: 10,
    padding: "2px 7px",
    cursor: "pointer"
  },
  codeBlock: {
    margin: 0,
    borderRadius: "0 0 8px 8px",
    fontSize: 12,
    lineHeight: 1.55
  },
  inlineCode: {
    backgroundColor: "rgba(110,118,129,0.35)",
    borderRadius: 4,
    padding: "2px 5px",
    color: "#e6edf3",
    fontSize: 12
  }
}
