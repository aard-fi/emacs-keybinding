async function getCurrentTheme() {
  if (typeof browser === 'undefined' || !browser.theme) return;
  const theme = await browser.theme.getCurrent();
  chrome.runtime.sendMessage({action: "log", msg: {
    'subsystem': 'theme',
    'level': 'debug',
    'message': `Theme: ${JSON.stringify(theme)}`
  }});
  return theme;
}

function updateTheme(){
  getCurrentTheme();
}

document.addEventListener("DOMContentLoaded", updateTheme);
