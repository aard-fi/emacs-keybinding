var current_binding;
var search_input_id = "emacsBindingsSearchInput";

chrome.runtime.sendMessage({action: "log", msg: {
  'subsystem': 'content',
  'level': 'debug',
  'message': `Loading content script in ${document.title}`
}});

// recursively generate ESC <key> compat mappings for M-<key>
function generate_ESC_bindings(bindings){
  var new_bindings = {}
  var esc_bindings = {}

  for (const key in bindings){
    const value = bindings[key];
    if (typeof value == "object"){
      var submap = generate_ESC_bindings(value);
      new_bindings[key] = submap;
      continue;
    }
    new_bindings[key] = value;
    if (key.startsWith("M-")){
      esc_key = key.replace("M-", "");
      esc_bindings[esc_key] = value;
    }
  }

  if (Object.keys(esc_bindings).length > 0)
    new_bindings['ESC'] = esc_bindings;

  return new_bindings;
}


const focus_window = () => {
  if (document.activeElement) {
    document.activeElement.blur();
  }
}

const focus_first_input = () => {
  for (var i = 0; document.forms[0].elements[i].type == 'hidden'; i++);
  document.forms[0].elements[i].focus();
}

// toplevel keybindings without modifier can break some sites -> make it optional
var nomod_keybindings = {
  "n": () => window.scrollBy(0, 30),
  "p": () => window.scrollBy(0, -30),
  "t": () => focus_first_input(),
}

var experimental_keybindings = {
}

var search_keybindings = {
  "C-s": () => chrome.runtime.sendMessage({action: "search"}),
  "C-r": () => chrome.runtime.sendMessage({action: "search"}),
}

var body_keybindings = {
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
  "M-f": () => chrome.runtime.sendMessage({action: "next_tab"}),
  "M-b": () => chrome.runtime.sendMessage({action: "previous_tab"}),

  "C-h": {
    "?": () => chrome.runtime.sendMessage({action: "options_page"}),
    "s": () => chrome.runtime.sendMessage({action: "search"}),
  },

  "C-x": {
    "k": () => chrome.runtime.sendMessage({action: "close_tab"}),
    "C-f": () => chrome.runtime.sendMessage({action: "new_tab"})
  },

  "C-u": {
    "C-x": {
      "k": () => chrome.runtime.sendMessage({action: "close_window"}),
      "C-f": () => chrome.runtime.sendMessage({action: "new_window"})
    }
  }
}

var textarea_keybindings = {
  "C-g": () => focus_window()
};

// initialise keybindings based on above tables + settings; this should
// be redone in a way allowing re-init on changed settings. As the bindings
// are per tab, and get updated on reload not high priority, though.
var generated_keybindings = generate_ESC_bindings(body_keybindings);
var generated_textarea_keybindings = {};

// this needs to happen before potentially adding nomod keybindings - having
// those on text fields would break stuff
Object.assign(generated_textarea_keybindings, generated_keybindings);

// add in top level bindings without modifier, if needed
chrome.storage.sync.get("bindings_without_modifier", function (setting) {
  if (setting["bindings_without_modifier"] == true){
    Object.assign(generated_keybindings, nomod_keybindings);
  }
});

chrome.storage.sync.get("bindings_search", function (setting) {
  if (setting["bindings_search"] == true){
    Object.assign(generated_keybindings, search_keybindings);
  }
});

chrome.storage.sync.get("experimental", function (setting) {
  if (setting["experimental"] == true){
    Object.assign(generated_keybindings, experimental_keybindings);
  }
});

/**
 * Turn KeyboardEvent to string.
 * @param {KeyboardEvent} e
 * @returns {String}
 */
const get_key = (e) => {
  var key = e.key,
      ctrl = e.ctrlKey ? "C-" : "",
      meta = e.altKey ? "M-" : "";

  if (e.key == "Escape")
    return "ESC";
  else
    return ctrl + meta + key;
}

/**
 * get current keybindings according to focus state.
 * @param {string} target_type - current focus, either on textarea or window
 * @return {Object} keybindings - keybindings that current page uses
 */
const get_current_bind = (target_type) =>
      (target_type == "input" || target_type == "textarea"
       ? generated_textarea_keybindings : generated_keybindings);

document.addEventListener("keyup", (e) => {
  var target_type = e.target.tagName.toLowerCase();
  var target_id = e.target.id;

  // Handle search input in new-tab.html (urlbar) or dialog/popup (search_input_id)
  if (target_type == "input" && (target_id == search_input_id || target_id == "urlbar")){
    var target_value = e.target.value;

    if (target_value.length > 0){
      chrome.runtime.sendMessage({action: "find", search: target_value});
    } else {
      chrome.runtime.sendMessage({action: "find_clear"});
    }
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key == "Shift" || e.key == "Control" || e.key == "Alt" || e.key == "Meta"){
    chrome.runtime.sendMessage({action: "log", msg: {
      'subsystem': 'keybinding',
      'level': 'debug',
      'message': "Ignoring modifier"
    }});
    return;
  }

  var key = get_key(e),
      target_type = e.target.tagName.toLowerCase();

  chrome.runtime.sendMessage({action: "log", msg: {
    'subsystem': 'keybinding',
    'level': 'debug',
    'message': `user press key is ${key}, target type is ${target_type}`
  }});

  if (!current_binding) {
    current_binding = get_current_bind(target_type);
  }

  chrome.runtime.sendMessage({action: "log", msg: {
    'subsystem': 'keybinding',
    'level': 'debug',
    'message': `current binding is ${Object.keys(current_binding)}`
  }});

  var command = current_binding[key];
  switch (typeof command) {
    case "function":
      command();
      current_binding = null;   // reset keybinding
      e.preventDefault();
      break;
    case "object":
      current_binding = command;
      e.preventDefault();
      break;
    default:
      current_binding = null;
      break;
  }
}, true);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action != "log")
    chrome.runtime.sendMessage({action: "log", msg: {
      'subsystem': 'content',
      'level': 'debug',
      'message': `action: ${msg.action}`
    }});
  switch(msg.action) {
    case "focus_window":
      focus_window();
      break;
    case "find":
      currentSearchQuery = msg.search;
      allMatches = findMatches(msg.search);
      currentMatchIndex = allMatches.length > 0 ? 0 : -1;
      applyHighlights(allMatches, currentMatchIndex);
      scrollToMatch(currentMatchIndex);
      break;
    case "find_next":
      if (allMatches.length > 0) {
        currentMatchIndex = (currentMatchIndex + 1) % allMatches.length;
        updateActiveHighlight(allMatches, currentMatchIndex);
        scrollToMatch(currentMatchIndex);
      }
      break;
    case "find_previous":
      if (allMatches.length > 0) {
        currentMatchIndex = (currentMatchIndex - 1 + allMatches.length) % allMatches.length;
        updateActiveHighlight(allMatches, currentMatchIndex);
        scrollToMatch(currentMatchIndex);
      }
      break;
    case "find_activate": {
      var activeNode = null;
      if (hasCSSHighlights) {
        if (currentMatchIndex >= 0 && currentMatchIndex < allMatches.length) {
          var container = allMatches[currentMatchIndex].startContainer;
          activeNode = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
        }
      } else {
        var activeSpan = document.querySelector('.search-highlight-active');
        if (activeSpan) activeNode = activeSpan;
      }
      var clicked = false;
      if (activeNode) {
        var n = activeNode;
        while (n && n !== document.body) {
          if (n.tagName === 'A' || n.tagName === 'BUTTON' ||
              n.getAttribute('role') === 'link' || n.getAttribute('role') === 'button') {
            clearHighlights();
            currentSearchQuery = "";
            allMatches = [];
            currentMatchIndex = -1;
            n.click();
            clicked = true;
            break;
          }
          n = n.parentNode;
        }
      }
      if (!clicked) {
        clearHighlights();
        currentSearchQuery = "";
        allMatches = [];
        currentMatchIndex = -1;
      }
      sendResponse(true);
      break;
    }
    case "find_clear":
      clearHighlights();
      currentSearchQuery = "";
      allMatches = [];
      currentMatchIndex = -1;
      sendResponse(true);
      break;
  }
  return true;
});
