import type { PlasmoCSConfig } from "plasmo"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false
}

const CAPTURE_DELAY_MS = 900
const MAX_MARKDOWN_CHARS = 120_000
const MAX_STRUCTURED_SECTION_CHARS = 50_000
const MAX_TABLES = 25
const MAX_TABLE_ROWS = 80
const MAX_SVG_ITEMS = 30
const MAX_RECT_ITEMS = 40
const URL_CHECK_INTERVAL_MS = 1000
const HYDRATION_WATCH_MS = 12_000

let lastCapturedUrl = ""
let lastCapturedMarkdownLength = 0
let captureTimer: number | undefined
let watchHydrationUntil = Date.now() + HYDRATION_WATCH_MS

export default function GoblinCaptureContentScript() {
  return null
}

function isExtensionContextValid() {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

function normalizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    if (!["http:", "https:"].includes(url.protocol)) return null
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function cleanText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim()
}

function escapeMarkdownCell(value: string) {
  return cleanText(value).replace(/\|/g, "\\|")
}

function truncateText(value: string, maxLength = 240) {
  const cleaned = cleanText(value)
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned
}

function isLikelyDocsPage() {
  const text = document.body?.innerText || ""
  const hasEnoughText = text.replace(/\s+/g, " ").trim().length > 800
  const hasArticleShell = Boolean(document.querySelector("main, article, [role='main'], .markdown, .md-content, .docs-content"))
  return hasEnoughText && hasArticleShell
}

function getPrimaryContentRoot(doc: Document = document) {
  return doc.querySelector("main, article, [role='main'], .markdown, .md-content, .docs-content") || doc.body
}

function tableToMarkdown(table: HTMLTableElement, index: number) {
  const rows = Array.from(table.querySelectorAll("tr")).slice(0, MAX_TABLE_ROWS)
  const matrix = rows
    .map((row) => {
      return Array.from(row.querySelectorAll<HTMLElement>("th, td"))
        .map((cell) => escapeMarkdownCell(cell.innerText || cell.textContent || ""))
    })
    .filter((row) => row.some(Boolean))

  if (matrix.length === 0) return ""

  const maxColumns = Math.max(...matrix.map((row) => row.length))
  const normalizedRows = matrix.map((row) => {
    return Array.from({ length: maxColumns }, (_, cellIndex) => row[cellIndex] || "")
  })

  const caption = cleanText(table.caption?.innerText || table.getAttribute("aria-label") || table.getAttribute("summary"))
  const hasHeader = table.querySelector("th") !== null
  const header = hasHeader
    ? normalizedRows[0]
    : normalizedRows[0].map((_, cellIndex) => `Column ${cellIndex + 1}`)
  const body = hasHeader ? normalizedRows.slice(1) : normalizedRows
  const limitedNotice = rows.length >= MAX_TABLE_ROWS ? `\n\n_Note: table truncated to first ${MAX_TABLE_ROWS} rows._` : ""

  return [
    `### Table ${index + 1}${caption ? `: ${caption}` : ""}`,
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
    limitedNotice
  ].join("\n").trim()
}

function gridToMarkdown(grid: HTMLElement, index: number) {
  const rows = Array.from(grid.querySelectorAll<HTMLElement>("[role='row']")).slice(0, MAX_TABLE_ROWS)
  const matrix = rows
    .map((row) => {
      return Array.from(row.querySelectorAll<HTMLElement>("[role='columnheader'], [role='rowheader'], [role='cell'], [role='gridcell']"))
        .map((cell) => escapeMarkdownCell(cell.innerText || cell.textContent || cell.getAttribute("aria-label") || ""))
    })
    .filter((row) => row.some(Boolean))

  if (matrix.length === 0) return ""

  const maxColumns = Math.max(...matrix.map((row) => row.length))
  const normalizedRows = matrix.map((row) => Array.from({ length: maxColumns }, (_, cellIndex) => row[cellIndex] || ""))
  const header = normalizedRows[0].map((cell, cellIndex) => cell || `Column ${cellIndex + 1}`)
  const label = cleanText(grid.getAttribute("aria-label"))

  return [
    `### Data Grid ${index + 1}${label ? `: ${label}` : ""}`,
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`)
  ].join("\n").trim()
}

function extractStructuredTables() {
  const root = getPrimaryContentRoot()
  const tableMarkdown = Array.from(root.querySelectorAll<HTMLTableElement>("table"))
    .slice(0, MAX_TABLES)
    .map(tableToMarkdown)
    .filter(Boolean)

  const gridMarkdown = Array.from(root.querySelectorAll<HTMLElement>("[role='table'], [role='grid']"))
    .filter((grid) => !grid.closest("table"))
    .slice(0, MAX_TABLES)
    .map(gridToMarkdown)
    .filter(Boolean)

  const sections = [...tableMarkdown, ...gridMarkdown]
  if (sections.length === 0) return ""

  return `## Structured Tables and Data\n\n${sections.join("\n\n")}`
}

function extractSvgSummaries() {
  const root = getPrimaryContentRoot()
  const summaries = Array.from(root.querySelectorAll<SVGSVGElement>("svg"))
    .slice(0, MAX_SVG_ITEMS)
    .map((svg, index) => {
      const label = cleanText(
        svg.getAttribute("aria-label") ||
        svg.querySelector("title")?.textContent ||
        svg.querySelector("desc")?.textContent
      )
      const textLabels = Array.from(svg.querySelectorAll("text, tspan"))
        .map((node) => truncateText(node.textContent || "", 120))
        .filter(Boolean)
        .slice(0, 40)
      const rects = Array.from(svg.querySelectorAll("rect"))
        .map((rect) => {
          const x = rect.getAttribute("x")
          const y = rect.getAttribute("y")
          const width = rect.getAttribute("width")
          const height = rect.getAttribute("height")
          const fill = rect.getAttribute("fill")
          const aria = rect.getAttribute("aria-label")
          const title = rect.querySelector("title")?.textContent
          const details = [
            aria || title ? `label=${truncateText(aria || title || "", 80)}` : "",
            width ? `width=${width}` : "",
            height ? `height=${height}` : "",
            x ? `x=${x}` : "",
            y ? `y=${y}` : "",
            fill ? `fill=${fill}` : ""
          ].filter(Boolean)
          return details.join(", ")
        })
        .filter(Boolean)
        .slice(0, MAX_RECT_ITEMS)

      if (!label && textLabels.length === 0 && rects.length === 0) return ""

      return [
        `### Diagram ${index + 1}${label ? `: ${label}` : ""}`,
        textLabels.length > 0 ? `Labels: ${textLabels.join(" | ")}` : "",
        rects.length > 0 ? `Rect data:\n${rects.map((rect) => `- ${rect}`).join("\n")}` : ""
      ].filter(Boolean).join("\n\n")
    })
    .filter(Boolean)

  if (summaries.length === 0) return ""
  return `## Diagrams, SVGs, and Graph Data\n\n${summaries.join("\n\n")}`
}

function extractCanvasAndChartLabels() {
  const root = getPrimaryContentRoot()
  const chartNodes = Array.from(root.querySelectorAll<HTMLElement>("canvas, [role='img'], [data-chart], [class*='chart'], [class*='graph']"))
    .map((node, index) => {
      const label = cleanText(
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.getAttribute("data-title") ||
        node.innerText ||
        node.textContent
      )
      if (!label) return ""
      return `- Chart ${index + 1}: ${truncateText(label, 300)}`
    })
    .filter(Boolean)

  if (chartNodes.length === 0) return ""
  return `## Chart and Canvas Labels\n\n${chartNodes.join("\n")}`
}

function extractStructuredPageData() {
  const sections = [
    extractStructuredTables(),
    extractSvgSummaries(),
    extractCanvasAndChartLabels()
  ].filter(Boolean)

  if (sections.length === 0) return ""

  const markdown = sections.join("\n\n")
  return markdown.length > MAX_STRUCTURED_SECTION_CHARS
    ? `${markdown.slice(0, MAX_STRUCTURED_SECTION_CHARS)}\n\n[Structured data truncated by Goblin.]`
    : markdown
}

function extractPageMarkdown() {
  const clonedDocument = document.cloneNode(true) as Document
  clonedDocument.querySelectorAll("script, style, noscript, iframe").forEach((node) => node.remove())

  const article = new Readability(clonedDocument, { charThreshold: 80 }).parse()
  if (!article?.content) return null

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced"
  })
  const articleMarkdown = turndown.turndown(article.content).trim()
  const structuredMarkdown = extractStructuredPageData()
  const markdown = [articleMarkdown, structuredMarkdown].filter(Boolean).join("\n\n---\n\n").trim()
  if (!markdown) return null

  return {
    title: article.title || document.title || "Untitled documentation page",
    markdown: markdown.length > MAX_MARKDOWN_CHARS
      ? `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n[Content truncated by Goblin to keep extension storage healthy.]`
      : markdown,
    truncated: markdown.length > MAX_MARKDOWN_CHARS
  }
}

function sendCapture() {
  if (!isExtensionContextValid()) return

  const normalizedUrl = normalizeUrl(window.location.href)
  if (!normalizedUrl || !isLikelyDocsPage()) return

  const extracted = extractPageMarkdown()
  if (!extracted) return
  if (normalizedUrl === lastCapturedUrl && extracted.markdown.length <= lastCapturedMarkdownLength * 1.15) return

  lastCapturedUrl = normalizedUrl
  lastCapturedMarkdownLength = extracted.markdown.length
  try {
    chrome.runtime.sendMessage({
      action: "GOBLIN_CAPTURE_PAGE",
      page: {
        url: normalizedUrl,
        host: window.location.host,
        origin: window.location.origin,
        title: extracted.title,
        markdown: extracted.markdown,
        capturedAt: Date.now(),
        truncated: extracted.truncated
      }
    }).catch(() => {
      lastCapturedUrl = ""
      lastCapturedMarkdownLength = 0
    })
  } catch {
    lastCapturedUrl = ""
    lastCapturedMarkdownLength = 0
  }
}

function scheduleCapture() {
  watchHydrationUntil = Date.now() + HYDRATION_WATCH_MS
  if (captureTimer) window.clearTimeout(captureTimer)
  captureTimer = window.setTimeout(sendCapture, CAPTURE_DELAY_MS)
}

function scheduleHydrationCapture() {
  if (Date.now() > watchHydrationUntil) return
  if (captureTimer) window.clearTimeout(captureTimer)
  captureTimer = window.setTimeout(sendCapture, CAPTURE_DELAY_MS)
}

function patchHistoryMethod(name: "pushState" | "replaceState") {
  const original = history[name]
  history[name] = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args as any)
    window.dispatchEvent(new Event("goblin-location-change"))
    return result
  } as typeof history[typeof name]
}

patchHistoryMethod("pushState")
patchHistoryMethod("replaceState")

window.addEventListener("popstate", scheduleCapture)
window.addEventListener("goblin-location-change", scheduleCapture)
window.addEventListener("load", scheduleCapture)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleCapture()
})

if (isExtensionContextValid()) {
  try {
    chrome.runtime.onMessage.addListener((request) => {
      if (request?.action === "GOBLIN_CAPTURE_NOW") {
        lastCapturedUrl = ""
        lastCapturedMarkdownLength = 0
        scheduleCapture()
      }
    })
  } catch {}
}

const observer = new MutationObserver(() => scheduleHydrationCapture())
if (document.documentElement) {
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  })
}

let lastSeenUrl = window.location.href
window.setInterval(() => {
  if (window.location.href === lastSeenUrl) return
  lastSeenUrl = window.location.href
  scheduleCapture()
}, URL_CHECK_INTERVAL_MS)

scheduleCapture()
