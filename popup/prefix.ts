const port = chrome.runtime.connect({name: 'prefix'});

interface ActionMap { [key: string]: string | ActionMap; }

// TODO, currently we're duplicating sections of the keybindings map
//       ideally we should unify that eventually
const prefixMaps: Record<string, ActionMap> = {
  'cx': {
    'C-f': 'new_tab',
    'k':   'close_tab',
  },
  'ch': {
    '?': 'options_page',
    's': 'search',
  },
  'cu': {
    'C-x': {
      'C-f': 'new_window',
      'k':   'close_window',
    },
  },
};

function hintsFor(map: ActionMap): string {
  return Object.entries(map)
    .map(([k, v]) => typeof v === 'string' ? `${k}: ${v.replace(/_/g, ' ')}` : `${k}: [prefix]`)
    .join('   ');
}

const params = new URLSearchParams(location.search);
const prefixName = params.get('prefix') ?? 'cx';
const timeoutMs  = parseInt(params.get('timeout') ?? '0', 10);

let currentMap: ActionMap = prefixMaps[prefixName] ?? prefixMaps['cx'];
let prefixSeq = prefixName === 'cx' ? 'C-x' : prefixName === 'ch' ? 'C-h' : 'C-u';

const prefixEl = document.getElementById('prefix');
const hintsEl  = document.getElementById('hints');

function render() {
  if (prefixEl) prefixEl.textContent = prefixSeq;
  if (hintsEl)  hintsEl.textContent  = hintsFor(currentMap) + '   C-g/Esc: cancel';
}

render();

let idleTimer: ReturnType<typeof setTimeout> | null =
  timeoutMs > 0 ? setTimeout(() => window.close(), timeoutMs) : null;

function resetTimer() {
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
  if (timeoutMs > 0) idleTimer = setTimeout(() => window.close(), timeoutMs);
}

function getKey(e: KeyboardEvent): string {
  if (e.key === 'Escape') return 'Escape';
  const ctrl = e.ctrlKey ? 'C-' : '';
  const alt  = e.altKey  ? 'M-' : '';
  return ctrl + alt + e.key;
}

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // we don't care about modifier only events, so we ignore them while
  // collecting key combinations to make sure just pressing ctrl does not
  // close the popup
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

  e.preventDefault();
  resetTimer();
  const key = getKey(e);

  if (key === 'Escape' || key === 'C-g') {
    window.close();
    return;
  }

  const entry = currentMap[key];
  if (typeof entry === 'string') {
    chrome.runtime.sendMessage({action: entry});
    window.close();
  } else if (typeof entry === 'object') {
    prefixSeq += ' ' + key;
    currentMap = entry;
    render();
  } else {
    window.close();
  }
}, true);
