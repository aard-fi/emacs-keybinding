var params = new URLSearchParams(window.location.search);
var mode = params.get('mode') || 'search';

var prompts = {
  search: 'Search:'
};

var promptEl = document.getElementById('minibuffer-prompt');
if (promptEl && mode in prompts) {
  promptEl.textContent = prompts[mode];
}

var input = document.getElementById('minibuffer-input');

if (input) {
  var findDebounceTimer = null;
  input.addEventListener('input', function() {
    var value = this.value;
    clearTimeout(findDebounceTimer);
    if (value.length > 0) {
      findDebounceTimer = setTimeout(function() {
        chrome.runtime.sendMessage({action: 'find', search: value});
      }, 200);
    } else {
      chrome.runtime.sendMessage({action: 'find_clear'});
    }
  });

  input.addEventListener('keydown', function(e) {
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
}
