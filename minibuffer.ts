import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { run, runAll, globalEnv, lispToString, snapshotGlobalEnv, restoreGlobalEnv, setRemoteLoadAllowed } from "./lisp";

// expose Lisp interpreter globally for JS interop and debug console use
(globalThis as any).lisp = { run, runAll, globalEnv, lispToString };

// chrome.storage.*.get() only returns a promise in chrome mv3; in firefox's
// chrome.* shim it is callback-only. This wrapper works in both.
function storageGet(area: chrome.storage.StorageArea, keys: any): Promise<Record<string, any>> {
  return new Promise(resolve => area.get(keys, resolve));
}

// find the last complete token or sexp before the cursor.
// `)` triggers a balanced paren walk; any other non-whitespace char returns the atom.
function findExprBeforeCursor(text: string, pos: number): string | null {
  let end = pos - 1;
  while (end >= 0 && /\s/.test(text[end])) end--;
  if (end < 0) return null;

  if (text[end] === ')') {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === ')') depth++;
      else if (text[i] === '(') { depth--; if (depth === 0) return text.slice(i, end + 1); }
    }
    return null;
  } else if (text[end] === '(') {
    return null;
  } else {
    let start = end;
    while (start > 0 && !/[\s()]/.test(text[start - 1])) start--;
    return text.slice(start, end + 1);
  }
}

var params = new URLSearchParams(window.location.search);

// default editor - this should load the editor in the popup, when called
// without argumetnts. In other modes we should get the mode from loading
// like popup.html?mode=search
var mode: string = params.get('mode') || 'editor';

var port = chrome.runtime.connect({name: 'minibuffer'});
var promptEl = document.getElementById('minibuffer-prompt');
var input = document.getElementById('minibuffer-input') as HTMLInputElement | null;
var editorContainer = document.getElementById('lisp-editor');
var outputEl = document.getElementById('lisp-output');

function showOutput(text: string, isError = false) {
  if (!outputEl) return;
  outputEl.textContent = text;
  outputEl.style.color = isError ? 'var(--ek-error, red)' : '';
}

// capture print output to the output area instead of just console
globalEnv.set('print', (...args: any[]) => {
  const text = args.map((a: any) => String(a)).join(' ');
  showOutput(text);
  console.log(...args);
  return args[0];
});

if (mode === 'search' && input) {
  if (promptEl) promptEl.textContent = 'Search:';

  var findDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  input.addEventListener('input', function(this: HTMLInputElement) {
    var value = this.value;
    if (findDebounceTimer !== null) clearTimeout(findDebounceTimer);
    if (value.length > 0) {
      findDebounceTimer = setTimeout(() => {
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
    } else if (e.key === 's' && e.ctrlKey) {
      e.preventDefault();
      chrome.runtime.sendMessage({action: 'find_next'});
    } else if (e.key === 'r' && e.ctrlKey) {
      e.preventDefault();
      chrome.runtime.sendMessage({action: 'find_previous'});
    } else if (e.key === 'Enter') {
      e.preventDefault();
      chrome.runtime.sendMessage({action: 'find_activate'}, () => window.close());
    }
  });

  window.focus();
  input.focus();

} else if (mode === 'editor' && editorContainer) {
  if (promptEl) promptEl.style.display = 'none';
  if (input) input.parentElement!.style.display = 'none';

  document.body.classList.add('editor-mode');
  editorContainer.style.display = 'block';
  if (outputEl) outputEl.style.display = 'block';

  (async () => {
    const settings = await storageGet(chrome.storage.sync, {lisp_buffer_persist: 'none', remote_lisp: false});
    const persistMode = settings.lisp_buffer_persist as string;
    setRemoteLoadAllowed(!!settings.remote_lisp);

    let initialDoc = ';; Type Lisp here\n';
    if (persistMode === 'local') {
      const stored = await storageGet(chrome.storage.local, 'lisp_buffer');
      if (stored.lisp_buffer) initialDoc = stored.lisp_buffer;
    } else if (persistMode === 'sync') {
      const stored = await storageGet(chrome.storage.sync, 'lisp_buffer');
      if (stored.lisp_buffer) initialDoc = stored.lisp_buffer;
    }

    // restore persisted interpreter state — always local regardless of buffer persist mode
    // TODO, this needs to change once we mone stuff into background
    if (persistMode !== 'none') {
      const stored = await storageGet(chrome.storage.local, 'lisp_env');
      if (stored.lisp_env) {
        try { restoreGlobalEnv(stored.lisp_env); } catch {}
      }
    }

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleSave(content: string) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (persistMode === 'local') chrome.storage.local.set({lisp_buffer: content});
        else if (persistMode === 'sync') chrome.storage.sync.set({lisp_buffer: content});
      }, 500);
    }

    function saveEnv() {
      if (persistMode === 'none') return;
      chrome.storage.local.set({lisp_env: snapshotGlobalEnv()});
    }

    const evalAtCursor = (view: EditorView): boolean => {
      const code = view.state.doc.toString();
      const pos = view.state.selection.main.head;
      const expr = findExprBeforeCursor(code, pos);
      try {
        const result = expr != null ? run(expr, globalEnv) : runAll(code, globalEnv);
        showOutput(result !== undefined ? String(result) : '');
        saveEnv();
      } catch (err: any) {
        showOutput('Error: ' + err.message, true);
      }
      return true;
    };

    const editorView = new EditorView({
      doc: initialDoc,
      extensions: [
        Prec.highest(keymap.of([
          { key: "Ctrl-x Ctrl-e", run: evalAtCursor },
        ])),
        basicSetup,
        StreamLanguage.define(commonLisp),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && persistMode !== 'none') {
            scheduleSave(update.state.doc.toString());
          }
        }),
      ],
      parent: editorContainer
    });

    editorView.focus();
  })();
}
