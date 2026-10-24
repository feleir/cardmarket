// Toolbar button: open the optimizer on the current Cardmarket tab, or open
// Cardmarket's wants lists if the tab is somewhere else.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !/^https:\/\/www\.cardmarket\.com\//.test(tab.url)) {
    chrome.tabs.create({ url: 'https://www.cardmarket.com/en/Magic/Wants' });
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => window.__cmoptMount && window.__cmoptMount(),
  });
});
