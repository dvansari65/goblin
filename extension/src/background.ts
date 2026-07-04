export {}

const STORAGE_KEY = "goblin_captured_pages_v1"
const MAX_CAPTURED_PAGES = 60
const MAX_TOTAL_MARKDOWN_CHARS = 1_800_000

interface CapturedPage {
  url: string
  host: string
  origin: string
  title: string
  markdown: string
  capturedAt: number
  truncated?: boolean
}

function chromeGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] as T | undefined))
  })
}

function chromeSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(values, () => resolve()))
}

function totalMarkdownChars(pages: CapturedPage[]) {
  return pages.reduce((total, page) => total + page.markdown.length, 0)
}

async function saveCapturedPage(page: CapturedPage) {
  const existing = await chromeGet<CapturedPage[]>(STORAGE_KEY) || []
  const withoutSameUrl = existing.filter((item) => item.url !== page.url)
  const next = [page, ...withoutSameUrl]

  while (next.length > MAX_CAPTURED_PAGES || totalMarkdownChars(next) > MAX_TOTAL_MARKDOWN_CHARS) {
    next.pop()
  }

  await chromeSet({ [STORAGE_KEY]: next })
  chrome.runtime.sendMessage({ action: "GOBLIN_CAPTURED_PAGES_UPDATED", pages: next }).catch(() => {})
}

function enableSidePanelOnActionClick() {
  const sidePanel = (chrome as any).sidePanel
  sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch?.(() => {})
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelOnActionClick()
})

chrome.runtime.onStartup.addListener(() => {
  enableSidePanelOnActionClick()
})

chrome.action.onClicked.addListener(async (tab) => {
  const sidePanel = (chrome as any).sidePanel
  if (!sidePanel?.open) return

  try {
    if (tab.id) {
      await sidePanel.open({ tabId: tab.id })
    } else if (tab.windowId) {
      await sidePanel.open({ windowId: tab.windowId })
    }
  } catch {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "GOBLIN_CAPTURE_NOW" }).catch(() => {})
    }
  }
})

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === "GOBLIN_CAPTURE_PAGE" && request.page) {
    saveCapturedPage(request.page)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to save page" }))
    return true
  }

  if (request?.action === "GOBLIN_GET_CAPTURED_PAGES") {
    chromeGet<CapturedPage[]>(STORAGE_KEY)
      .then((pages) => sendResponse({ ok: true, pages: pages || [] }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to read pages" }))
    return true
  }

  if (request?.action === "GOBLIN_SET_CAPTURED_PAGES") {
    const pages = Array.isArray(request.pages) ? request.pages : []
    chromeSet({ [STORAGE_KEY]: pages })
      .then(() => {
        chrome.runtime.sendMessage({ action: "GOBLIN_CAPTURED_PAGES_UPDATED", pages }).catch(() => {})
        sendResponse({ ok: true })
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to update pages" }))
    return true
  }

  if (request?.action === "GOBLIN_CLEAR_CAPTURED_PAGES") {
    chromeSet({ [STORAGE_KEY]: [] })
      .then(() => {
        chrome.runtime.sendMessage({ action: "GOBLIN_CAPTURED_PAGES_UPDATED", pages: [] }).catch(() => {})
        sendResponse({ ok: true })
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to clear pages" }))
    return true
  }

  return false
})
