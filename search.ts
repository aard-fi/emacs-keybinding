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

var hasCSSHighlights: boolean = typeof CSS !== 'undefined' &&
  (CSS as any).highlights != null &&
  typeof (globalThis as any).Highlight !== 'undefined';

var currentSearchQuery: string = "";
var currentMatchIndex: number = -1;
var allMatches: Range[] = [];

var MAX_MATCHES = 500;

function getTextNodes(): Text[] {
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var nodes: Text[] = [];
  var node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  return nodes;
}

function findMatches(query: string): Range[] {
  if (!query || query.length === 0) return [];
  var textNodes = getTextNodes();
  var matches: Range[] = [];
  var lowerQuery = query.toLowerCase();

  for (var i = 0; i < textNodes.length && matches.length < MAX_MATCHES; i++) {
    var node = textNodes[i];
    var text = node.textContent!.toLowerCase();
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

function applyHighlights(matches: Range[], activeIndex: number): void {
  if (hasCSSHighlights) {
    (CSS as any).highlights.clear();
    if (matches.length === 0) return;
    (CSS as any).highlights.set('search-highlight', new (globalThis as any).Highlight(...matches));
    if (activeIndex >= 0 && activeIndex < matches.length) {
      (CSS as any).highlights.set('search-highlight-active', new (globalThis as any).Highlight(matches[activeIndex]));
    }
  } else {
    clearHighlights();
    for (var i = matches.length - 1; i >= 0; i--) {
      var span = highlightRange(matches[i]);
      if (i === activeIndex) span.classList.add('search-highlight-active');
    }
  }
}

function updateActiveHighlight(matches: Range[], activeIndex: number): void {
  if (hasCSSHighlights) {
    (CSS as any).highlights.delete('search-highlight-active');
    if (activeIndex >= 0 && activeIndex < matches.length) {
      (CSS as any).highlights.set('search-highlight-active', new (globalThis as any).Highlight(matches[activeIndex]));
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

function highlightRange(range: Range): HTMLSpanElement {
  var span = document.createElement("span");
  span.className = "search-highlight";
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
  } catch (e) {}
  return span;
}

function clearHighlights(): void {
  if (hasCSSHighlights) {
    (CSS as any).highlights.clear();
    return;
  }
  var highlights = document.querySelectorAll(".search-highlight");
  for (var i = 0; i < highlights.length; i++) {
    var parent = highlights[i].parentNode!;
    while (highlights[i].firstChild) {
      parent.insertBefore(highlights[i].firstChild!, highlights[i]);
    }
    parent.removeChild(highlights[i]);
  }
  document.body.normalize();
}

function scrollToMatch(index: number): void {
  if (index < 0 || index >= allMatches.length) return;
  var range = allMatches[index];
  var node: Node | Element = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = (node as Text).parentElement!;
  if (node) (node as Element).scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Expose state and functions via window for cross-content-script access
(window as any).__search_ns = {
  get query() { return currentSearchQuery; },
  set query(v: string) { currentSearchQuery = v; },
  get index() { return currentMatchIndex; },
  set index(v: number) { currentMatchIndex = v; },
  get matches() { return allMatches; },
  set matches(v: Range[]) { allMatches = v; },
  hasCSSHighlights,
  clearHighlights,
  findMatches,
  applyHighlights,
  updateActiveHighlight,
  scrollToMatch
};
