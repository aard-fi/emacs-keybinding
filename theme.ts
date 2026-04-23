async function getCurrentTheme(): Promise<any> {
  if (typeof browser === 'undefined' || !(browser as any).theme) return;
  const theme = await (browser as any).theme.getCurrent();
  chrome.runtime.sendMessage({action: "log", msg: {
    'subsystem': 'theme',
    'level': 'debug',
    'message': `Theme: ${JSON.stringify(theme)}`
  }});
  return theme;
}

function updateTheme(): void {
  getCurrentTheme();
}

document.addEventListener("DOMContentLoaded", updateTheme);
