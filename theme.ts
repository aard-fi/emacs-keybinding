function isDark(color: string): boolean {
  let r = 0, g = 0, b = 0;
  const rgb = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgb) {
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
  } else {
    const hex = color.replace('#', '');
    if (hex.length !== 6) return false;
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

async function applyTheme(): Promise<void> {
  const root = document.documentElement;
  let dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const ff = typeof (globalThis as any).browser !== 'undefined'
    ? (globalThis as any).browser : null;

  if (ff?.theme) {
    try {
      const theme = await ff.theme.getCurrent();
      chrome.runtime.sendMessage({action: "log", msg: {
        subsystem: 'theme', level: 'debug',
        message: `Theme: ${JSON.stringify(theme)}`
      }});
      const c = theme?.colors;
      if (c) {
        if (c.toolbar)            root.style.setProperty('--ek-toolbar-bg',    c.toolbar);
        if (c.toolbar_text)       root.style.setProperty('--ek-toolbar-fg',    c.toolbar_text);
        if (c.toolbar_field)      root.style.setProperty('--ek-input-bg',      c.toolbar_field);
        if (c.toolbar_field_text) root.style.setProperty('--ek-input-fg',      c.toolbar_field_text);
        if (c.ntp_background)     root.style.setProperty('--ek-page-bg',       c.ntp_background);
        if (c.ntp_text)           root.style.setProperty('--ek-page-fg',       c.ntp_text);
        if (c.toolbar)            dark = isDark(c.toolbar);
      }
    } catch (e) {}
  }

  root.setAttribute('data-theme', dark ? 'dark' : 'light');
}

document.addEventListener("DOMContentLoaded", applyTheme);
