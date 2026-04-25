import { run, runAll, globalEnv, lispToString, setRemoteLoadAllowed } from './lisp';

var options: Record<string, any> = {};
var search_tab_id: number | null = null;
var editor_window_id: number | null = null;
var prefix_origin_tab_id: number | null = null;

function getManifestVersion(): number {
  return chrome.runtime.getManifest().manifest_version;
}

interface BrowserAction {
  setPopup(details: { popup: string }): void;
  openPopup(): Promise<void> | void;
}

function getAction(): BrowserAction {
  if (getManifestVersion() === 3) {
    return chrome.action as unknown as BrowserAction;
  }
  return ((globalThis as any).browser).browserAction as BrowserAction;
}

function openEditorWindow() {
  if (editor_window_id !== null) {
    chrome.windows.update(editor_window_id, {focused: true}, () => {
      if (chrome.runtime.lastError) {
        editor_window_id = null;
        openEditorWindow();
      }
    });
    return;
  }
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/minibuffer.html'),
    type: 'popup',
    width: 800,
    height: 500,
  }, (win) => { editor_window_id = win?.id ?? null; });
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === editor_window_id) editor_window_id = null;
});

function openSearchPopup(tabId: number | null) {
  search_tab_id = tabId;
  const searchAction = getAction();
  searchAction.setPopup({popup: '/popup/minibuffer.html?mode=search'});
  const opening = searchAction.openPopup();
  if (opening && (opening as Promise<void>).catch) {
    (opening as Promise<void>).catch((e: Error) => {
      logMsg({'subsystem': 'backend', 'level': 'error', 'message': 'Open popup error: ' + e.message});
      if (options.popup_window_fallback) {
        chrome.windows.create({
          url: chrome.runtime.getURL('popup/minibuffer.html?mode=search'),
          type: 'popup', width: 500, height: 80, focused: true,
        }, (win) => {
          if (chrome.runtime.lastError || !win) {
            searchAction.setPopup({popup: '/popup/minibuffer.html'});
            search_tab_id = null;
          }
        });
      } else {
        searchAction.setPopup({popup: '/popup/minibuffer.html'});
        search_tab_id = null;
      }
    });
  }
}

function openPrefixPopup(tabId: number | null, prefix: string = 'cx') {
  prefix_origin_tab_id = tabId;
  const prefixAction = getAction();
  const timeout = options.prefix_popup_timeout ?? 5000;
  const popupUrl = `/popup/prefix.html?prefix=${prefix}&timeout=${timeout}`;
  prefixAction.setPopup({popup: popupUrl});
  const opening = prefixAction.openPopup();
  if (opening && (opening as Promise<void>).catch) {
    (opening as Promise<void>).catch((e: Error) => {
      logMsg({'subsystem': 'backend', 'level': 'error', 'message': 'Open prefix popup error: ' + e.message});
      if (options.popup_window_fallback) {
        chrome.windows.create({
          url: chrome.runtime.getURL(`popup/prefix.html?prefix=${prefix}&timeout=${timeout}`),
          type: 'popup', width: 400, height: 40, focused: true,
        }, (win) => {
          if (chrome.runtime.lastError || !win) {
            prefixAction.setPopup({popup: '/popup/minibuffer.html'});
            prefix_origin_tab_id = null;
          }
        });
      } else {
        prefixAction.setPopup({popup: '/popup/minibuffer.html'});
        prefix_origin_tab_id = null;
      }
    });
  }
}

chrome.commands.onCommand.addListener((command: string) => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tabId = tabs[0]?.id ?? null;
    switch (command) {
      case 'search':
        openSearchPopup(tabId);
        break;
      case 'cx-prefix':
        openPrefixPopup(tabId, 'cx');
        break;
      case 'ch-prefix':
        openPrefixPopup(tabId, 'ch');
        break;
      case 'cu-prefix':
        openPrefixPopup(tabId, 'cu');
        break;
    }
  });
});

// Search overrides this temporarily with ?mode=search; restored on disconnect.
getAction().setPopup({popup: '/popup/minibuffer.html'});
// onClicked only fires when popup is '' (no URL), so it is never triggered in
// normal operation. Registering it anyway provides the user-gesture context
// Firefox requires for openPopup() to work from a background message handler.
const _actionTarget: any = getManifestVersion() === 3
  ? (globalThis as any).chrome?.action
  : (globalThis as any).browser?.browserAction;
if (_actionTarget?.onClicked) {
  _actionTarget.onClicked.addListener(() => {});
}

var default_options: Record<string, any> = {
  own_tab_page: true,
  debug_log: false,
  debug_level_keybinding: 1,
  debug_level_backend: 1,
  debug_level_content: 1,
  debug_level_search_engines: 1,
  debug_level_top_sites: 1,
  debug_level_history: 1,
  debug_level_theme: 1,
  bindings_without_modifier: false,
  bindings_search: true,
  bindings_prefix_popup: false,
  prefix_popup_timeout: 5000,
  popup_window_fallback: false,
  experimental: false,
  preferred_input: "dialog",
  nt_url_autosubmit: true,
  nt_history_age_days: 30,
  nt_history_max_items: 100,
  nt_hide_intro: false,
  nt_hide_github: false,
  nt_hide_search_engines: false,
  nt_hide_input_label: false,
  nt_hide_title: true,
  nt_hide_url_instructions: false,
  nt_hide_top_sites: false,
  nt_top_num: 10,
  nt_top_pinned: false,
  nt_top_blocked: false,
  nt_top_newtab: false,
  nt_top_searchshortcuts: false,
  nt_top_nofavicons: false,
  remote_lisp: false
};

// unlike the old way this only fires on update/install, not every time
// the service worker wakes up. On update this pulls existing values,  merges
// it with the defaults, and writes it back to storage.
chrome.runtime.onInstalled.addListener((_details) => {
  chrome.storage.sync.get(default_options, (data) => {
    chrome.storage.sync.set(data);
  });
  // in case we ever want to add a "first install" screen:
  //if (_details.reason === 'install') {
  //}
});

chrome.storage.sync.get(default_options, function(stored) {
  Object.assign(options, stored);
  setRemoteLoadAllowed(!!options.remote_lisp);
});

function onSuccess(): void {}

function onError(error: any): void {
  console.log(`Error; ${error}`);
}

// return true if the message was logged, false otherwise
function logMsg(msg: any): boolean {
  if ('debug_log' in options && options['debug_log'] == true) {
    const msgType = typeof(msg);
    if (msgType == "string") {
      console.log(`Emacs-keybinding: ${msg}`);
      return true;
    } else if (msgType == "object") {
      const keyName = 'debug_level_' + msg['subsystem'];
      if (keyName in options) {
        var msgLevel = 3;
        if ('level' in msg) {
          if (isNaN(msg.level)) {
            if (msg.level == "error")        msgLevel = 1;
            else if (msg.level == "warning") msgLevel = 2;
            else if (msg.level == "info")    msgLevel = 3;
            else if (msg.level == "debug")   msgLevel = 4;
          } else {
            msgLevel = msg.level;
          }
        }
        var debugLevel = options[keyName];
        if (msgLevel <= debugLevel) {
          console.log(`Emacs-keybinding[${msg.subsystem}:${msg.level}] ${msg.message}`);
          return true;
        }
      } else {
        console.log(`Emacs-keybinding: Log subsystem missing: ${msg.subsystem}`);
      }
    } else {
      console.log(`Emacs-keybinding: Unhandled message type ${msgType}`);
    }
  }
  return false;
}

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === 'minibuffer') {
    port.onDisconnect.addListener(() => {
      getAction().setPopup({popup: '/popup/minibuffer.html'});
      if (search_tab_id) {
        chrome.tabs.sendMessage(search_tab_id, {action: 'find_clear'}, () => {
          if (chrome.runtime.lastError) {}
        });
        search_tab_id = null;
      }
    });
  } else if (port.name === 'prefix') {
    port.onDisconnect.addListener(() => {
      getAction().setPopup({popup: '/popup/minibuffer.html'});
      prefix_origin_tab_id = null;
    });
  }
});

chrome.runtime.onMessage.addListener((msg: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (msg.action != "log")
    logMsg({'subsystem': 'backend', 'message': msg.action});

  // sender.tab is null for messages from extension pages (popups, prefix page).
  // Fall back to prefix_origin_tab_id so prefix popup actions hit the right tab.
  let current_tab = sender.tab ?? (prefix_origin_tab_id !== null
    ? {id: prefix_origin_tab_id} as chrome.tabs.Tab
    : null);

  switch(msg.action) {
    case "log":
      var sent = logMsg(msg.msg);
      sendResponse({ response: sent });
      break;
    case "option":
      if (msg.key in options && options[msg.key] != msg.value) {
        logMsg(`setting ${msg.key} to ${msg.value}`);
        options[msg.key] = msg.value;
        if (msg.key === 'remote_lisp') {
          if (msg.value) {
            // Request the optional permission so the browser-level XHR is allowed.
            // permissions.request() needs a user-gesture context (options page click).
            chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => {
              setRemoteLoadAllowed(granted);
              options.remote_lisp = granted;
            });
          } else {
            setRemoteLoadAllowed(false);
            chrome.permissions.remove({ origins: ['<all_urls>'] });
          }
        }
        sendResponse(true);
      } else
        sendResponse(false);
      break;
    case "options":
      sendResponse({ response: {
        'current_options': options,
        'default_options': default_options
      }});
      break;
    case "next_tab":
      chrome.tabs.query({currentWindow: true}).then((tabs) => {
        let next_tab = tabs[current_tab!.index + 1] || tabs[0];
        if (next_tab) {
          chrome.tabs.update(next_tab.id!, {active: true})
            .then(() => chrome.tabs.sendMessage(next_tab.id!, {action: "focus_window"}));
          sendResponse(true);
        } else
          sendResponse(false);
      });
      break;
    case "previous_tab":
      chrome.tabs.query({currentWindow: true}).then((tabs) => {
        let previous_tab = tabs[current_tab!.index - 1] || tabs[tabs.length - 1];
        if (previous_tab) {
          chrome.tabs.update(previous_tab.id!, {active: true})
            .then(() => chrome.tabs.sendMessage(previous_tab.id!, {action: "focus_window"}));
          sendResponse(true);
        } else
          sendResponse(false);
      });
      break;
    case "new_tab":
      if ('own_tab_page' in options && options['own_tab_page'] == true) {
        chrome.tabs.create({active: true, url: "new-tab.html"});
      } else {
        chrome.tabs.create({active: true});
      }
      sendResponse(true);
      break;
    case "close_tab":
      // TODO: this triggers a promise rejected error
      sendResponse(true);
      chrome.tabs.remove(current_tab!.id!);
      break;
    case "new_window":
      if ('own_tab_page' in options && options['own_tab_page'] == true) {
        chrome.windows.create({url: "new-tab.html"});
      } else {
        chrome.windows.create();
      }
      sendResponse(true);
      break;
    case "close_window":
      chrome.windows.remove(current_tab!.windowId!);
      sendResponse(true);
      break;
    case "options_page":
      if (getManifestVersion() === 3) {
        chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
      } else {
        try {
          const opening = chrome.runtime.openOptionsPage();
          if (opening && (opening as Promise<void>).catch) {
            (opening as Promise<void>).then(onSuccess, onError);
          }
        } catch (e) {
          console.log(`Error opening options page: ${e}`);
        }
      }
      sendResponse(true);
      break;
    case "search":
      openSearchPopup(current_tab?.id ?? null);
      sendResponse(true);
      break;
    case "prefix_popup":
      openPrefixPopup(current_tab?.id ?? null, msg.prefix ?? 'cx');
      sendResponse(true);
      break;
    case "find":
      if (msg.search.length > 0) {
        logMsg(`Searching for: ${msg.search}`);
        var find_tab = search_tab_id || (current_tab ? current_tab.id! : null);
        if (find_tab) chrome.tabs.sendMessage(find_tab, {action: 'find', search: msg.search});
        sendResponse(true);
      } else
        sendResponse(false);
      break;
    case "find_next": {
      var next_tab = search_tab_id || (current_tab ? current_tab.id! : null);
      if (next_tab) chrome.tabs.sendMessage(next_tab, {action: 'find_next'});
      sendResponse(true);
      break;
    }
    case "find_previous": {
      var prev_tab = search_tab_id || (current_tab ? current_tab.id! : null);
      if (prev_tab) chrome.tabs.sendMessage(prev_tab, {action: 'find_previous'});
      sendResponse(true);
      break;
    }
    case "find_activate": {
      var act_tab = search_tab_id || (current_tab ? current_tab.id! : null);
      if (act_tab) {
        chrome.tabs.sendMessage(act_tab, {action: 'find_activate'}, () => {
          if (chrome.runtime.lastError) {}
          sendResponse(true);
        });
        return true;
      }
      sendResponse(true);
      break;
    }
    case "find_clear": {
      var clear_tab = search_tab_id || (current_tab ? current_tab.id! : null);
      if (clear_tab) {
        chrome.tabs.sendMessage(clear_tab, {action: 'find_clear'}, () => {
          if (chrome.runtime.lastError) {}
          sendResponse(true);
        });
        return true;
      }
      sendResponse(true);
      break;
    }
    default:
      logMsg(`Unknown action: ${msg.action}`);
      sendResponse(false);
  }
  return true;
});
