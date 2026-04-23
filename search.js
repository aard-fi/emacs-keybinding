// Shared search logic for both popup and inline dialog
// Uses CSS Custom Highlight API when available (no DOM mutation), falls back to Range+span

(function injectStyles() {
  if (document.getElementById('emacs-search-styles')) return;
  var style = document.createElement('style');
  style.id = 'emacs-search-styles';
  style.textContent =
    ':root{--search-hl-bg:yellow;--search-hl-color:black;--search-hl-active-bg:orange;--search-hl-active-color:black}' +
    '.search-highlight{background:var(--search-hl-bg);color:var(--search-hl-color)}' +
    '.search-highlight-active{background:var(--search-hl-active-bg);color:var(--search-hl-active-color)}' +
    '::highlight(search-highlight){background-color:var(--search-hl-bg);color:var(--search-hl-color)}' +
    '::highlight(search-highlight-active){background-color:var(--search-hl-active-bg);color:var(--search-hl-active-color)}';
  (document.head || document.documentElement).appendChild(style);
}());

var hasCSSHighlights = typeof CSS !== 'undefined' && CSS.highlights != null && typeof Highlight !== 'undefined';

// State tracking - shared across contexts
var currentSearchQuery = "";
var currentMatchIndex = -1;
var allMatches = [];

var MAX_MATCHES = 500;

function getTextNodes() {
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var nodes = [];
  var node;
  while ((node = walker.nextNode())) {
    nodes.push(node);
  }
  return nodes;
}

function findMatches(query) {
  if (!query || query.length === 0) return [];
  var textNodes = getTextNodes();
  var matches = [];
  var lowerQuery = query.toLowerCase();

  for (var i = 0; i < textNodes.length && matches.length < MAX_MATCHES; i++) {
    var node = textNodes[i];
    var text = node.textContent.toLowerCase();
    var index = 0;

    while (matches.length < MAX_MATCHES) {
      index = text.indexOf(lowerQuery, index);
      if (index === -1) break;

      var range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + query.length);
      matches.push(range);
      index += query.length;
    }
  }

  return matches;
}

function applyHighlights(matches, activeIndex) {
  if (hasCSSHighlights) {
    CSS.highlights.clear();
    if (matches.length === 0) return;
    CSS.highlights.set('search-highlight', new Highlight(...matches));
    if (activeIndex >= 0 && activeIndex < matches.length) {
      CSS.highlights.set('search-highlight-active', new Highlight(matches[activeIndex]));
    }
  } else {
    clearHighlights();
    for (var i = matches.length - 1; i >= 0; i--) {
      var span = highlightRange(matches[i]);
      if (i === activeIndex) span.classList.add('search-highlight-active');
    }
  }
}

function updateActiveHighlight(matches, activeIndex) {
  if (hasCSSHighlights) {
    CSS.highlights.delete('search-highlight-active');
    if (activeIndex >= 0 && activeIndex < matches.length) {
      CSS.highlights.set('search-highlight-active', new Highlight(matches[activeIndex]));
    }
  } else {
    var active = document.querySelector('.search-highlight-active');
    if (active) active.classList.remove('search-highlight-active');
    var all = document.querySelectorAll('.search-highlight');
    if (activeIndex >= 0 && activeIndex < all.length) {
      all[activeIndex].classList.add('search-highlight-active');
    }
  }
}

function highlightRange(range) {
  var span = document.createElement("span");
  span.className = "search-highlight";
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
  } catch (e) {}
  return span;
}

function clearHighlights() {
  if (hasCSSHighlights) {
    CSS.highlights.clear();
    return;
  }
  var highlights = document.querySelectorAll(".search-highlight");
  for (var i = 0; i < highlights.length; i++) {
    var parent = highlights[i].parentNode;
    while (highlights[i].firstChild) {
      parent.insertBefore(highlights[i].firstChild, highlights[i]);
    }
    parent.removeChild(highlights[i]);
  }
  document.body.normalize();
}

function scrollToMatch(index) {
  if (index < 0 || index >= allMatches.length) return;
  var range = allMatches[index];
  var node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

window.hasCSSHighlights = hasCSSHighlights;
window.applyHighlights = applyHighlights;
window.updateActiveHighlight = updateActiveHighlight;
window.findMatches = findMatches;
window.clearHighlights = clearHighlights;
window.highlightRange = highlightRange;
window.scrollToMatch = scrollToMatch;
window.getTextNodes = getTextNodes;
