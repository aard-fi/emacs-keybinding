var params = new URLSearchParams(window.location.search);
var mode: string = params.get('mode') || 'search';

var port = chrome.runtime.connect({name: 'minibuffer'});

var prompts: Record<string, string> = {
  search: 'Search:'
};

var promptEl = document.getElementById('minibuffer-prompt');
if (promptEl && mode in prompts) {
  promptEl.textContent = prompts[mode];
}

var input = document.getElementById('minibuffer-input') as HTMLInputElement | null;

if (input) {
  var findDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  input.addEventListener('input', function(this: HTMLInputElement) {
    var value = this.value;
    if (findDebounceTimer !== null) clearTimeout(findDebounceTimer);
    if (value.length > 0) {
      findDebounceTimer = setTimeout(function() {
        chrome.runtime.sendMessage({action: 'find', search: value});
      }, 200);
    } else {
      chrome.runtime.sendMessage({action: 'find_clear'});
    }
  });

  input.addEventListener('keydown', function(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      chrome.runtime.sendMessage({action: 'find_clear'}, () => window.close());
    } else if (mode === 'search') {
      if (e.key === 's' && e.ctrlKey) {
        e.preventDefault();
        chrome.runtime.sendMessage({action: 'find_next'});
      } else if (e.key === 'r' && e.ctrlKey) {
        e.preventDefault();
        chrome.runtime.sendMessage({action: 'find_previous'});
      } else if (e.key === 'Enter') {
        e.preventDefault();
        chrome.runtime.sendMessage({action: 'find_activate'}, () => window.close());
      }
    }
  });

  window.focus();
  input.focus();
}
