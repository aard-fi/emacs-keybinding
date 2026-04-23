// Browser compatibility shim: Firefox uses `browser`, Chrome uses `chrome`
const _b = (() => {
  const isFirefox = typeof (globalThis as any).browser !== 'undefined';
  const ff: any = isFirefox ? (globalThis as any).browser : null;
  return {
    tabs: {
      query: (opts: any) => isFirefox ? ff.tabs.query(opts) : chrome.tabs.query(opts)
    },
    search: {
      search: (opts: any) => isFirefox
        ? ff.search.search(opts)
        : (chrome as any).search.query({text: opts.query, disposition: opts.disposition}),
      get: (): Promise<any[]> => isFirefox ? ff.search.get() : Promise.resolve([])
    },
    topSites: {
      // Chrome's topSites.get() doesn't support the options object
      get: (opts?: any) => isFirefox ? ff.topSites.get(opts) : chrome.topSites.get()
    },
    history: {
      search: (opts: any) => isFirefox ? ff.history.search(opts) : chrome.history.search(opts)
    },
    runtime: {
      sendMessage: (msg: any) => isFirefox
        ? ff.runtime.sendMessage(msg)
        : chrome.runtime.sendMessage(msg)
    }
  };
})();

var urlbar: HTMLInputElement | null = null;
var options: Record<string, any> = {};
var default_options: Record<string, any> = {};
var state = { dom_ready: false, options_ready: false };

async function urlOrSearch(event: Event): Promise<void> {
  event.preventDefault();
  var protocols = [ "https", "http" ];

  try {
    new URL(urlbar!.value);

    try {
      if (options.experimental == true) {
        let tabs = _b.tabs.query({url: urlbar!.value});
        let all_tabs = _b.tabs.query({currentWindow: true});

        chrome.runtime.sendMessage({action: "log", msg: `Queried tabs for ${urlbar!.value}: ${JSON.stringify(tabs)}`});
        chrome.runtime.sendMessage({action: "log", msg: `Queried all tabs: ${JSON.stringify(all_tabs)}`});
      }
    } catch (error) {
      chrome.runtime.sendMessage({action: "log", msg: `Eggsperimental issues: ${error}`});
    }

    document.location.href = urlbar!.value;
    return;
  } catch (error) {
    chrome.runtime.sendMessage({action: "log", msg: `Not a valid URL: ${error}`});
  }

  // TODO: check if this works with proxies
  //       add better handling of http errors
  for (var i in protocols) {
    var url = protocols[i] + "://" + urlbar!.value;
    chrome.runtime.sendMessage({action: "log", msg: `Trying: ${url}`});
    try {
      await fetch(url, {
        method: "GET",
        mode: "no-cors",
        cache: "no-cache",
        credentials: "same-origin",
        redirect: "follow",
        referrerPolicy: "no-referrer"
      });
      chrome.runtime.sendMessage({action: "log", msg: `Going to: ${url}`});
      document.location.href = url;
      return;
    } catch (error) {
      chrome.runtime.sendMessage({action: "log", msg: `Error looking up URL: ${error}`});
    }
  }

  // disposition came with version 111
  try {
    _b.search.search({
      query: urlbar!.value,
      disposition: "CURRENT_TAB"
    });
    return;
  } catch (error) {
    chrome.runtime.sendMessage({action: "log", msg: `Search not working: ${error}`});
  }

  // this will open the search in a new tab, unless tab ID is provided
  try {
    _b.search.search({
      query: urlbar!.value,
    });
    return;
  } catch (error) {
    chrome.runtime.sendMessage({action: "log", msg: `Search not working: ${error}`});
  }
}

async function loadTopSites(): Promise<void> {
  let topSites = await _b.topSites.get({
    includeFavicon: !options.nt_top_nofavicons,
    includeBlocked: options.nt_top_blocked,
    includePinned: options.nt_top_pinned,
    includeSearchShortcuts: options.nt_top_searchshortcuts,
    newtab: options.nt_top_newtab,
    limit: Number(options.nt_top_num) || default_options.nt_top_num
  });
  let container = document.getElementById("top-site-group")!;

  for (const topSite of topSites) {
    var groupItem = document.createElement("div");

    if (options.nt_top_nofavicons) {
      groupItem.className = "group-list-item";
      groupItem.innerHTML = `<a href="${topSite.url}">${topSite.title}</a>`;
    } else {
      groupItem.className = "group-item";
      groupItem.innerHTML = `<a href="${topSite.url}"><div class="group-item-img"><img src="${topSite.favicon}"></div><br />${topSite.title}</a>`;
    }

    container.appendChild(groupItem);

    chrome.runtime.sendMessage({action: "log", msg: {
      'subsystem': 'top_sites',
      'level': 'debug',
      'message': `Title: ${topSite.title}, URL: ${topSite.url}`
    }});
  }
}

async function loadSearchEngines(): Promise<void> {
  let engines: any[] = await _b.search.get();
  let table = document.getElementById("search_engine_table") as HTMLTableElement;

  let keys = Object.keys(engines);

  chrome.runtime.sendMessage({action: "log", msg: {
    'subsystem': 'search_engines',
    'level': 'debug',
    'message': `Table: ${keys}`
  }});

  // filling the table is a bit more complicated as we start with one empty row
  // for getting proper formatting exported from org-mode
  for (const engine of engines) {
    let keys = Object.keys(engine);
    chrome.runtime.sendMessage({action: "log", msg: {
      'subsystem': 'search_engines',
      'level': 'debug',
      'message': `Table: ${keys}`
    }});

    chrome.runtime.sendMessage({action: "log", msg: {
      'subsystem': 'search_engines',
      'level': 'debug',
      'message': `Search engine: ${engine.name} in ${table.rows.length}`
    }});

    var row: HTMLTableRowElement;
    var new_row: HTMLTableRowElement;
    if (table.rows.length == 2) {
      row = table.rows[1];
      new_row = table.insertRow(table.rows.length);
    } else {
      row = table.rows[table.rows.length - 1];
      row.insertCell(0);
      row.insertCell(1);
      row.insertCell(2);

      if (table.rows.length <= engines.length)
        new_row = table.insertRow(table.rows.length);
    }

    row.cells[0].innerHTML = engine.alias;
    row.cells[1].innerHTML = engine.name;
    if (engine.isDefault)
      row.cells[2].innerHTML = "x";
  }
}

async function loadOptions(): Promise<void> {
  _b.runtime.sendMessage({action: "options"}).then((message: any) => {
    state.options_ready = true;
    options = message.response.current_options;
    default_options = message.response.default_options;
    updatePage();
  });
}

function registerHistoryCompleter(input: HTMLInputElement): void {
  var activeElement = -1;

  chrome.runtime.sendMessage({action: "log", msg: {
    'subsystem': 'history',
    'level': 'debug',
    'message': `Registering URL input handler`
  }});

  input.addEventListener("input", async function(this: HTMLInputElement) {
    if (this.value == "") {
      destroyCompletions();
      activeElement = -1;
      return;
    }

    let historyDate = new Date();
    historyDate.setDate(historyDate.getDate() - Number(options.nt_history_age_days) || default_options.nt_history_age_days);
    chrome.runtime.sendMessage({action: "log", msg: {
      'subsystem': 'history',
      'level': 'debug',
      'message': `URL value: ${this.value}, until ${historyDate}`
    }});
    let completions: any[] = await _b.history.search({
      text: this.value,
      maxResults: Number(options.nt_history_max_items) || default_options.nt_history_max_items,
      startTime: historyDate
    });
    chrome.runtime.sendMessage({action: "log", msg: {
      'subsystem': 'history',
      'level': 'debug',
      'message': `URL completions: ${JSON.stringify(completions)}`
    }});
    destroyCompletions();
    activeElement = -1;

    var container = document.createElement("div");
    container.className = "history-completion-list";
    container.id = "history-completions";
    this.parentNode!.appendChild(container);

    for (const item of completions) {
      var completion = document.createElement("div");
      completion.className = "history-completion-element";
      // order of those input aelements matters as extraction of URL happens
      // based on index later on
      if (item.title == null) item.title = "";
      item.title = item.title
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

      completion.innerHTML = `<b>${item.title}</b><span style="float:right">[Visits: ${item.visitCount}]</span><br/>${item.url}
      <input type='hidden' id='url' value='${item.url}'/>
      <input type='hidden' id='title' value='${item.title}'/>
      <input type='hidden' id='visitCount' value='${item.visitCount}'/>
      <input type='hidden' id='lastVisitTime' value='${item.lastVisitTime}'/>`;
      completion.addEventListener("click", function(this: HTMLElement) {
        input.value = this.getElementsByTagName("input")[0].value;
      });
      container.appendChild(completion);
    }
  });

  input.addEventListener("keydown", function(event: KeyboardEvent) {
    if (event.keyCode == 27) { // ESC
      // TODO: also handle C-g
      destroyCompletions();
    } else if (event.keyCode == 40) {
      activateElement(1);
    } else if (event.keyCode == 38) {
      activateElement(-1);
    } else if (event.keyCode == 13) {
      if (activeCompletionLists().length > 0) {
        if (options.nt_url_autosubmit == false) {
          event.preventDefault();
        }
        clickActiveElement();
      }
    }
  });

  function activeCompletionLists(): HTMLCollectionOf<Element> {
    return document.getElementsByClassName("history-completion-list");
  }

  function clickActiveElement(): void {
    var completions_array = document.getElementsByClassName("history-completion-list");

    if (completions_array.length != 1) {
      chrome.runtime.sendMessage({action: "log", msg: {
        'subsystem': 'history',
        'level': 'warning',
        'message': `Weird element count: ${completions_array.length}`
      }});
    } else {
      var completions = completions_array[0].getElementsByTagName("div");
      if (activeElement >= 0 && activeElement < completions.length) {
        completions[activeElement].click();
      }
    }
  }

  function activateElement(relIndex: number): void {
    var completions_array = document.getElementsByClassName("history-completion-list");

    if (completions_array.length != 1) {
      chrome.runtime.sendMessage({action: "log", msg: {
        'subsystem': 'history',
        'level': 'warning',
        'message': `Weird element count: ${completions_array.length}`
      }});
    } else {
      activeElement += relIndex;

      var completions = completions_array[0].getElementsByTagName("div");
      if (activeElement >= completions.length) activeElement = 0;
      if (activeElement < 0) activeElement = completions.length - 1;

      for (var i = 0; i < completions.length; i++) {
        if (i == activeElement) {
          chrome.runtime.sendMessage({action: "log", msg: {
            'subsystem': 'history',
            'level': 'debug',
            'message': `Activating element ${i}`
          }});
          completions[i].classList.add("history-completion-active");
        } else {
          chrome.runtime.sendMessage({action: "log", msg: {
            'subsystem': 'history',
            'level': 'debug',
            'message': `Disabling element ${i}, active is ${activeElement}`
          }});
          completions[i].classList.remove("history-completion-active");
        }
      }
    }
  }

  function destroyCompletions(list?: Element): void {
    var completions = document.getElementsByClassName("history-completion-list");
    for (var i = 0; i < completions.length; i++) {
      // this is required to avoid deleting a list by clicking into it
      if (list != completions[i]) {
        completions[i].parentNode!.removeChild(completions[i]);
      }
    }
  }

  // make sure we register the click handle for dismissing the completion popup
  // only once
  if (!(window as any).completionClickHandler) {
    (window as any).completionClickHandler = function(event: MouseEvent) {
      destroyCompletions(event.target as Element);
    };
    document.addEventListener("click", (window as any).completionClickHandler);
  }
}

function updatePage(): void {
  if (state.options_ready == true && state.dom_ready == true) {
    urlbar = document.getElementById("urlbar") as HTMLInputElement | null;
    if (urlbar) {
      registerHistoryCompleter(urlbar);
    }
    if (options.nt_hide_title == true) {
      (document.getElementsByClassName("title")[0] as HTMLElement).style.display = "none";
    }
    if (options.nt_hide_intro == true) {
      document.getElementById("introduction")!.style.display = "none";
    }
    if (options.nt_hide_github == true) {
      document.getElementById("github")!.style.display = "none";
    }
    if (options.nt_hide_input_label == true) {
      document.getElementById("input_label")!.style.display = "none";
    }
    if (options.nt_hide_url_instructions == true) {
      document.getElementById("url_instructions")!.style.display = "none";
    }
    if (options.nt_hide_search_engines == true) {
      document.getElementById("search_engines")!.style.display = "none";
    } else {
      loadSearchEngines();
    }
    if (options.nt_hide_top_sites == true) {
      document.getElementById("top_sites")!.style.display = "none";
    } else {
      loadTopSites();
    }
  }
}

loadOptions();

const form = document.getElementById("form");
if (form) form.addEventListener("submit", urlOrSearch);

document.addEventListener("DOMContentLoaded", () => { state.dom_ready = true; updatePage(); });
