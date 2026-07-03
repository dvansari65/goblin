export {}

console.log("Docs AI Extension Background script loaded.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Docs AI Extension installed and ready.");
});

// Listen for clicks on the extension icon in the toolbar
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    // Send a message to the content script in the active tab to toggle the sidebar
    chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_SIDEBAR" }).catch((err) => {
      console.log("Could not send message to tab, maybe content script isn't loaded?", err);
    });
  }
});
