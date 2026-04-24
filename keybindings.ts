interface SearchNamespace {
  query: string;
  index: number;
  matches: Range[];
  hasCSSHighlights: boolean;
  clearHighlights(): void;
  findMatches(query: string): Range[];
  applyHighlights(matches: Range[], activeIndex: number): void;
  updateActiveHighlight(matches: Range[], activeIndex: number): void;
  scrollToMatch(index: number): void;
}
// Resolved lazily inside the message handler after both content scripts have loaded.
let search_ns: SearchNamespace | undefined;

var current_binding: BindingMap | null = null;
var search_input_id = "emacsBindingsSearchInput";

function safeSendMessage(msg: any, callback?: (response: any) => void): void {
  try {
    if (callback) chrome.runtime.sendMessage(msg, callback);
    else chrome.runtime.sendMessage(msg);
  } catch (_) { /* extension context invalidated */ }
}

safeSendMessage({action: "log", msg: {
  'subsystem': 'content',
  'level': 'debug',
  'message': `Loading content script in ${document.title}`
}});

type BindingFn = () => void;
type Binding = BindingFn | BindingMap;
interface BindingMap {
  [key: string]: Binding;
}

// recursively generate ESC <key> compat mappings for M-<key>
function generate_ESC_bindings(bindings: BindingMap): BindingMap {
  var new_bindings: BindingMap = {};
  var esc_bindings: BindingMap = {};

  for (const key in bindings) {
    const value = bindings[key];
    if (typeof value == "object") {
      var submap = generate_ESC_bindings(value as BindingMap);
      new_bindings[key] = submap;
      continue;
    }
    new_bindings[key] = value;
    if (key.startsWith("M-")) {
      var esc_key = key.replace("M-", "");
      esc_bindings[esc_key] = value;
    }
  }

  if (Object.keys(esc_bindings).length > 0)
    new_bindings['ESC'] = esc_bindings;

  return new_bindings;
}

const focus_window = () => {
  if (document.activeElement) {
    (document.activeElement as HTMLElement).blur();
  }
};

const focus_first_input = () => {
  var form = document.forms[0];
  var i = 0;
  while (i < form.elements.length && (form.elements[i] as HTMLInputElement).type == 'hidden') i++;
  (form.elements[i] as HTMLElement).focus();
};

// toplevel keybindings without modifier can break some sites -> make it optional
var nomod_keybindings: BindingMap = {
  "n": () => window.scrollBy(0, 30),
  "p": () => window.scrollBy(0, -30),
  "t": () => focus_first_input(),
};

var experimental_keybindings: BindingMap = {};

var search_keybindings: BindingMap = {
  "C-s": () => safeSendMessage({action: "search"}),
  "C-r": () => safeSendMessage({action: "search"}),
};

var body_keybindings: BindingMap = {
  // scroll
  "C-f": () => window.scrollBy(30, 0),
  "C-b": () => window.scrollBy(-30, 0),
  "C-n": () => window.scrollBy(0, 30),
  "C-p": () => window.scrollBy(0, -30),
  "M-<": () => window.scroll(0, 0),
  "M->": () => window.scroll(0, document.body.scrollHeight),

  // refresh history
  "C-r": () => window.location.reload(),
  "C-F": () => window.history.forward(),
  "C-B": () => window.history.back(),

  // tabs
  "M-f": () => safeSendMessage({action: "next_tab"}),
  "M-b": () => safeSendMessage({action: "previous_tab"}),

  "C-h": {
    "?": () => safeSendMessage({action: "options_page"}),
    "s": () => safeSendMessage({action: "search"}),
  },

  "C-x": {
    "k":   () => safeSendMessage({action: "close_tab"}),
    "C-f": () => safeSendMessage({action: "new_tab"})
  },

  "C-u": {
    "C-x": {
      "k":   () => safeSendMessage({action: "close_window"}),
      "C-f": () => safeSendMessage({action: "new_window"})
    }
  }
};

var textarea_keybindings: BindingMap = {
  "C-g": () => focus_window()
};

// initialise keybindings based on above tables + settings; this should
// be redone in a way allowing re-init on changed settings. As the bindings
// are per tab, and get updated on reload not high priority, though.
var generated_keybindings: BindingMap = generate_ESC_bindings(body_keybindings);
var generated_textarea_keybindings: BindingMap = {};

// add textarea bindings before potentially adding nomod keybindings —
// nomod bindings on text fields would break typing
Object.assign(generated_textarea_keybindings, generated_keybindings);

// add in top level bindings without modifier, if needed
chrome.storage.sync.get("bindings_without_modifier", function(setting) {
  if (setting["bindings_without_modifier"] == true) {
    Object.assign(generated_keybindings, nomod_keybindings);
  }
});

chrome.storage.sync.get("bindings_search", function(setting) {
  if (setting["bindings_search"] == true) {
    Object.assign(generated_keybindings, search_keybindings);
  }
});

chrome.storage.sync.get("experimental", function(setting) {
  if (setting["experimental"] == true) {
    Object.assign(generated_keybindings, experimental_keybindings);
  }
});

/**
 * Turn KeyboardEvent to string.
 * @param {KeyboardEvent} e
 * @returns {String}
 */
const get_key = (e: KeyboardEvent): string => {
  var key = e.key,
      ctrl = e.ctrlKey ? "C-" : "",
      meta = e.altKey ? "M-" : "";

  if (e.key == "Escape")
    return "ESC";
  else
    return ctrl + meta + key;
};

/**
 * get current keybindings according to focus state.
 * @param {string} target_type - current focus, either on textarea or window
 * @return {Object} keybindings - keybindings that current page uses
 */
const get_current_bind = (target_type: string): BindingMap =>
  (target_type == "input" || target_type == "textarea"
    ? generated_textarea_keybindings : generated_keybindings);

document.addEventListener("keyup", (e: KeyboardEvent) => {
  var target_type = (e.target as HTMLElement).tagName.toLowerCase();
  var target_id = (e.target as HTMLElement).id;

  if (target_type == "input" && (target_id == search_input_id || target_id == "urlbar")) {
    var target_value = (e.target as HTMLInputElement).value;

    if (target_value.length > 0) {
      safeSendMessage({action: "find", search: target_value});
    } else {
      safeSendMessage({action: "find_clear"});
    }
  }
}, true);

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key == "Shift" || e.key == "Control" || e.key == "Alt" || e.key == "Meta") {
    safeSendMessage({action: "log", msg: {
      'subsystem': 'keybinding',
      'level': 'debug',
      'message': "Ignoring modifier"
    }});
    return;
  }

  var key = get_key(e),
      target_type = (e.target as HTMLElement).tagName.toLowerCase();

  safeSendMessage({action: "log", msg: {
    'subsystem': 'keybinding',
    'level': 'debug',
    'message': `user press key is ${key}, target type is ${target_type}`
  }});

  if (!current_binding) {
    current_binding = get_current_bind(target_type);
  }

  safeSendMessage({action: "log", msg: {
    'subsystem': 'keybinding',
    'level': 'debug',
    'message': `current binding is ${Object.keys(current_binding)}`
  }});

  var command = current_binding[key];
  switch (typeof command) {
    case "function":
      (command as BindingFn)();
      current_binding = null;
      e.preventDefault();
      break;
    case "object":
      current_binding = command as BindingMap;
      e.preventDefault();
      break;
    default:
      current_binding = null;
      break;
  }
}, true);

chrome.runtime.onMessage.addListener((msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (!search_ns) search_ns = (window as any).__search_ns as SearchNamespace | undefined;
  if (msg.action != "log")
    safeSendMessage({action: "log", msg: {
      'subsystem': 'content',
      'level': 'debug',
      'message': `action: ${msg.action}`
    }});
  switch(msg.action) {
    case "focus_window":
      focus_window();
      break;
    case "find":
      if (!search_ns) { sendResponse(false); break; }
      search_ns.query = msg.search;
      search_ns.matches = search_ns.findMatches(msg.search);
      search_ns.index = search_ns.matches.length > 0 ? 0 : -1;
      search_ns.applyHighlights(search_ns.matches, search_ns.index);
      search_ns.scrollToMatch(search_ns.index);
      break;
    case "find_next":
      if (!search_ns || search_ns.matches.length === 0) break;
      search_ns.index = (search_ns.index + 1) % search_ns.matches.length;
      search_ns.updateActiveHighlight(search_ns.matches, search_ns.index);
      search_ns.scrollToMatch(search_ns.index);
      break;
    case "find_previous":
      if (!search_ns || search_ns.matches.length === 0) break;
      search_ns.index = (search_ns.index - 1 + search_ns.matches.length) % search_ns.matches.length;
      search_ns.updateActiveHighlight(search_ns.matches, search_ns.index);
      search_ns.scrollToMatch(search_ns.index);
      break;
    case "find_activate": {
      if (!search_ns) { sendResponse(false); break; }
      var activeNode: Element | null = null;
      if (search_ns.hasCSSHighlights) {
        if (search_ns.index >= 0 && search_ns.index < search_ns.matches.length) {
          var container = search_ns.matches[search_ns.index].startContainer;
          activeNode = container.nodeType === Node.TEXT_NODE
            ? (container as Text).parentElement
            : container as Element;
        }
      } else {
        activeNode = document.querySelector('.search-highlight-active');
      }
      var clicked = false;
      if (activeNode) {
        var n: Element | null = activeNode;
        while (n && n !== document.body) {
          if (n.tagName === 'A' || n.tagName === 'BUTTON' ||
            n.getAttribute('role') === 'link' || n.getAttribute('role') === 'button') {
              search_ns.clearHighlights();
              search_ns.query = "";
              search_ns.matches = [];
              search_ns.index = -1;
              (n as HTMLElement).click();
              clicked = true;
              break;
            }
          n = n.parentElement;
        }
      }
      if (!clicked) {
        search_ns.clearHighlights();
        search_ns.query = "";
        search_ns.matches = [];
        search_ns.index = -1;
      }
      sendResponse(true);
      break;
    }
    case "find_clear":
      if (!search_ns) { sendResponse(false); break; }
      search_ns.clearHighlights();
      search_ns.query = "";
      search_ns.matches = [];
      search_ns.index = -1;
      sendResponse(true);
      break;
  }
  return true;
});
