// initial we should have:
// cons, car, cdr, eq, atom, quote, if, cond, lambda, apply, read, print,
// eval

// just treating everything as string was a bit too simplistic - as one example,
// that breaks comparisons like (eq (gensym) 'G__0)) - the unquoted symbol becomes
// a string, gensym evaluates to a string, so that becomes true, while gensym
// should return a unique object
class LispSymbol {
  constructor(public name: string) {}
  toString() { return this.name; }
}
type LispVal = number | string | LispSymbol | null | LispVal[];

class Env {
  constructor(private vars: Record<string, any> = {}, private parent?: Env, private barrier = false) {}

  ownEntries(): [string, any][] { return Object.entries(this.vars); }

  get(name: string | LispSymbol): any {
    const key = typeof name === 'string' ? name : name.name;
    if (key in this.vars) return this.vars[key];
    if (this.parent) return this.parent.get(key);
    throw new Error(`Symbol '${key}' not found`);
  }

  set(name: string | LispSymbol, val: any) {
    const key = typeof name === 'string' ? name : name.name;
    this.vars[key] = val;
    return val;
  }

  // walk scope chain to update an existing binding (used by setq).
  // stops at barrier envs so eval-string isolation doesn't bleed into globalEnv.
  update(name: string, val: any): boolean {
    if (name in this.vars) { this.vars[name] = val; return true; }
    if (this.parent && !this.barrier) return this.parent.update(name, val);
    return false;
  }

  deleteOwn(name: string): void {
    delete this.vars[name];
  }
}

// now that we have proper symbols we also need to make sure we don't
// accidentally create new symbols for the same thing
const symbolCache: Record<string, LispSymbol> = {};
function intern(name: string): LispSymbol {
  if (!(name in symbolCache)) {
    symbolCache[name] = new LispSymbol(name);
  }
  return symbolCache[name];
}

// convert a JS array to a proper Lisp cons list; [] -> null
function arrayToList(arr: any[]): any {
  if (arr.length === 0) return null;
  return { car: arr[0], cdr: arrayToList(arr.slice(1)) };
}

// convert a cons list to a flat JS array (for evalLisp to execute)
function listToArray(cell: any): any[] {
  const result: any[] = [];
  let cur = cell;
  while (cur !== null && typeof cur === 'object' && 'car' in cur) {
    result.push(cur.car);
    cur = cur.cdr;
  }
  return result;
}

// bind function arguments, handling dotted-pair rest params: (a b . rest)
function bindParams(env: Env, params: LispVal | null, vals: any[]) {
  if (params === null) return;
  if (!Array.isArray(params)) {
    // single bare symbol: bind all args as a list, e.g. (lambda args ...)
    env.set((params as LispSymbol).name, arrayToList(vals));
    return;
  }
  const ps = params as LispSymbol[];
  const dotIdx  = ps.findIndex(p => p instanceof LispSymbol && p.name === '.');
  const restIdx = ps.findIndex(p => p instanceof LispSymbol && p.name === '&rest');
  const optIdx  = ps.findIndex(p => p instanceof LispSymbol && p.name === '&optional');

  if (dotIdx !== -1 || restIdx !== -1) {
    const split = dotIdx !== -1 ? dotIdx : restIdx;
    for (let i = 0; i < split; i++) env.set(ps[i].name, vals[i] ?? null);
    env.set(ps[split + 1].name, arrayToList(vals.slice(split)));
  } else if (optIdx !== -1) {
    for (let i = 0; i < optIdx; i++) env.set(ps[i].name, vals[i] ?? null);
    for (let i = optIdx + 1; i < ps.length; i++)
      env.set(ps[i].name, vals[optIdx + (i - optIdx - 1)] ?? null);
  } else {
    ps.forEach((p, i) => env.set(p.name, vals[i] !== undefined ? vals[i] : null));
  }
}

// JS-accessible namespace, populated at runtime by defun/defvar forms.
const lispNamespace: Record<string, any> = {};
(globalThis as any).lisp = lispNamespace;

// convert a lisp name to a valid JS identifier for dot-notation access.
// rules: strip *earmuffs*, convert kebab-case and slash/separated to camelCase.
// returns null if the result still contains non-identifier characters
// (e.g. >=, !, ?) — those get no alias and must be accessed via bracket notation.
function toLispJsName(name: string): string | null {
  const camel = name
    .replace(/^\*+|\*+$/g, '')                        // strip *earmuffs*
    .replace(/[-/](.)/g, (_, c: string) => c.toUpperCase()); // kebab/slash → camelCase
  if (!camel) return null;
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(camel) ? camel : null;
}

// install an accessor descriptor on lispNamespace for both the raw lisp name
// and (if different and valid) a camelCase JS alias.
// The getter reads from globalEnv so JS always sees the current value;
// the setter writes back so JS can push values into lisp.
function exposeVar(name: string): void {
  function installAccessor(key: string) {
    if (Object.prototype.hasOwnProperty.call(lispNamespace, key)) delete lispNamespace[key];
    Object.defineProperty(lispNamespace, key, {
      get: () => { try { return globalEnv.get(name); } catch { return null; } },
      set: (v: any) => globalEnv.set(name, v),
      configurable: true,
      enumerable: key === name, // only the raw name shows up in Object.keys()
    });
  }
  installAccessor(name);
  const jsName = toLispJsName(name);
  if (jsName && jsName !== name) installAccessor(jsName);
}

function evalLisp(x: LispVal, env: Env): any {
  if (x instanceof LispSymbol) {
    if (x.name.startsWith(':')) return x; // keywords are self-evaluating
    return env.get(x.name);
  }
  if (x === null || typeof x === 'number' || typeof x === 'string') return x; // Literals

  // cons cells produced by macro expansion: convert to array and eval
  if (typeof x === 'object' && !Array.isArray(x) && 'car' in (x as any)) {
    return evalLisp(listToArray(x as any) as any, env);
  }

  if (!Array.isArray(x) || x.length === 0) return x;

  const [opVal, ...args] = x;

  // extract the string name if the operator is a symbol
  const op = (opVal instanceof LispSymbol) ? opVal.name : opVal;

  switch (op) {
    case 'quote': return args[0];
    case 'function': {
      // #'x — for symbols, look up function value; for lambda forms, eval them
      const farg = args[0];
      if (Array.isArray(farg)) return evalLisp(farg, env);
      return env.get((farg as LispSymbol).name);
    }
    case 'if': {
      const [test, con, ...alt] = args;
      const testResult = evalLisp(test, env);
      // in Lisp only nil (null) and false are false
      const isTruthy = testResult !== null && testResult !== false;
      if (isTruthy) return evalLisp(con, env);
      if (alt.length > 1) {
        let res;
        for (const expr of alt) res = evalLisp(expr, env);
        return res;
      }
      return alt.length === 1 ? evalLisp(alt[0], env) : null;
    }
    case 'cond':
      for (const clause of args as LispVal[][]) {
        const [test, ...body] = clause;
        const cv = evalLisp(test, env);
        if (cv !== null && cv !== false) {
          let res = null;
          for (const expr of body) res = evalLisp(expr, env);
          return res;
        }
      }
      return null;
    case 'when': {
      const wCond = evalLisp(args[0], env);
      if (wCond === null || wCond === false) return null;
      let wRes: any = null;
      for (const expr of args.slice(1)) wRes = evalLisp(expr, env);
      return wRes;
    }
    case 'unless': {
      const uv = evalLisp(args[0], env);
      if (uv !== null && uv !== false) return null;
      let uRes: any = null;
      for (const expr of args.slice(1)) uRes = evalLisp(expr, env);
      return uRes;
    }
    case 'define':
      // always binds in current scope
      return env.set((args[0] as LispSymbol).name, evalLisp(args[1], env));
    case 'setq': {
      // mutates existing binding in the nearest enclosing scope that has it
      const varName = (args[0] as LispSymbol).name;
      const newVal = evalLisp(args[1], env);
      if (!env.update(varName, newVal)) env.set(varName, newVal);
      return newVal;
    }
    // eval-when: in an interpreter everything is effectively :execute; ignore timing specifiers
    case 'eval-when': {
      let ewResult: any = null;
      for (const form of args.slice(1)) ewResult = evalLisp(form, env);
      return ewResult;
    }
    // defvar: bind only if not already bound
    case 'defvar': {
      const dvName = (args[0] as LispSymbol).name;
      if (args.length > 1) {
        try { env.get(dvName); } catch { env.set(dvName, evalLisp(args[1], env)); }
      } else {
        try { env.get(dvName); } catch { env.set(dvName, null); }
      }
      exposeVar(dvName);
      return args[0];
    }
    // defparameter: always rebind
    case 'defparameter': {
      const dpName = (args[0] as LispSymbol).name;
      env.set(dpName, args.length > 1 ? evalLisp(args[1], env) : null);
      exposeVar(dpName);
      return args[0];
    }
    // defconstant: bind once (treat like defparameter for simplicity)
    case 'defconstant': {
      const dcName = (args[0] as LispSymbol).name;
      env.set(dcName, args.length > 1 ? evalLisp(args[1], env) : null);
      return args[0];
    }
    // defpackage / in-package: stubs (no package system yet)
    case 'defpackage': return args[0];
    case 'in-package':  return args[0];
    // declaim / declare / deftype: ignore
    case 'declaim':  return null;
    case 'declare':  return null;
    case 'deftype':  return args[0];
    // setf: simple variable assignment; compound places not yet supported
    case 'setf': {
      let sfResult: any = null;
      for (let si = 0; si < args.length - 1; si += 2) {
        const place = args[si];
        sfResult = evalLisp(args[si + 1], env);
        if (place instanceof LispSymbol) {
          if (!env.update(place.name, sfResult)) env.set(place.name, sfResult);
        }
        // compound places (slot-value, gethash, car, etc.) not yet supported
      }
      return sfResult;
    }
    case 'defmacro': {
      const [mName, mParams, mBody] = args;
      const macroFunc = (macroArgs: LispVal[]) => {
        const macroEnv = new Env({}, env);
        bindParams(macroEnv, mParams as LispVal, macroArgs);
        return evalLisp(mBody, macroEnv);
      };
      return env.set(mName as LispSymbol, { __isMacro: true, transformer: macroFunc, __lsource: [intern('defmacro'), mName, mParams, mBody] });
    }
    case 'macroexpand': {
      // special form: arg is not evaluated; we expand a macro call and return the form
      const form = args[0];
      if (!Array.isArray(form) || form.length === 0) return form;
      const macroSym = form[0] as LispSymbol;
      let macro: any;
      try { macro = env.get(macroSym.name); } catch { return form; }
      if (macro && macro.__isMacro) return macro.transformer((form as any[]).slice(1));
      return form;
    }
    case 'progn': {
      let result: any = null;
      for (const form of args) result = evalLisp(form, env);
      return result;
    }
    case 'and': {
      let result: any = true;
      for (const form of args) {
        result = evalLisp(form, env);
        if (result === null || result === false) return null;
      }
      return result;
    }
    case 'or': {
      for (const form of args) {
        const result = evalLisp(form, env);
        if (result !== null && result !== false) return result;
      }
      return null;
    }
    case 'let': {
      // make sure we always pass an array
      const bindings = ((args[0] ?? []) as LispVal[][]);
      const childEnv = new Env({}, env);
      bindings.forEach(([name, val]) => childEnv.set(name as LispSymbol, evalLisp(val, env)));
      let letResult: any = null;
      for (const form of args.slice(1)) letResult = evalLisp(form, childEnv);
      return letResult;
    }
    case 'let*': {
      const bindings = ((args[0] ?? []) as LispVal[][]);
      const childEnv = new Env({}, env);
      bindings.forEach(([name, val]) => childEnv.set(name as LispSymbol, evalLisp(val, childEnv)));
      let letResult: any = null;
      for (const form of args.slice(1)) letResult = evalLisp(form, childEnv);
      return letResult;
    }
    case 'dolist': {
      const [varSym, listExpr, resultExpr] = args[0] as LispVal[];
      const items = evalLisp(listExpr, env);
      const arr = Array.isArray(items) ? items : listToArray(items);
      const doEnv = new Env({}, env);
      for (const item of arr) {
        doEnv.set((varSym as LispSymbol).name, item);
        for (const form of args.slice(1)) evalLisp(form, doEnv);
      }
      doEnv.set((varSym as LispSymbol).name, null);
      return resultExpr ? evalLisp(resultExpr, doEnv) : null;
    }
    case 'defun': {
      const dName = args[0] as LispSymbol;
      const dParams = args[1] as LispVal;
      let dBody = args.slice(2);
      // skip docstring (string as first body form when there are more forms)
      if (dBody.length > 1 && typeof dBody[0] === 'string') dBody = dBody.slice(1);
      const lambdaFunc: any = evalLisp([intern('lambda'), dParams, ...dBody], env);
      lambdaFunc.__lsource = [intern('defun'), dName, dParams, ...dBody];
      env.set(dName.name, lambdaFunc);
      lispNamespace[dName.name] = lambdaFunc;
      const jsName = toLispJsName(dName.name);
      if (jsName && jsName !== dName.name) lispNamespace[jsName] = lambdaFunc;
      return lambdaFunc;
    }
    case 'lambda': {
      const lParams = args[0] as LispVal;
      const lBody = args.slice(1);
      const lfn: any = (...vals: any[]) => {
        const funcEnv = new Env({}, env);
        bindParams(funcEnv, lParams, vals);
        let result: any = null;
        for (const form of lBody) result = evalLisp(form, funcEnv);
        return result;
      };
      lfn.__lsource = [intern('lambda'), lParams, ...lBody];
      return lfn;
    }
    case 'while': {
      const [wTest, ...wBody] = args;
      let lastResult: any = null;
      while (evalLisp(wTest, env)) {
        wBody.forEach(expr => { lastResult = evalLisp(expr, env); });
      }
      return lastResult;
    }
    default: {
      const proc = evalLisp(opVal, env);

      // handle macros first
      if (proc && typeof proc === 'object' && proc.__isMacro) {
        const expanded = proc.transformer(args);
        return evalLisp(expanded, env);
      }

      // improve error for non-callable values (like nil/null/())
      if (typeof proc !== 'function') {
        throw new Error(`Invalid function call: ${lispToString(op)} is not a function`);
      }

      const evaluatedArgs = args.map(arg => evalLisp(arg, env));
      return proc(...evaluatedArgs);
    }
  }
}

// tokenize a Lisp source string into a flat array of token strings.
// tokens are: '(', ')', "'", two-char dispatch sequences ("#'", "#+", "#-", "#:"),
// quoted strings (with delimiters preserved), and atoms (everything else).
// the parser consumes this array from the front via shift().
function tokenize(str: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i];

    // semicolon introduces a line comment — discard until end-of-line.
    if (c === ';') { while (i < str.length && str[i] !== '\n') i++; continue; }

    // we don't care about whitespace between tokens
    if (/\s/.test(c)) { i++; continue; }

    // these three characters are self-delimiting single-character tokens:
    //   (  )  — list open/close
    //   '     — shorthand for (quote ...), expanded by the parser
    if (c === '(' || c === ')' || c === "'") { tokens.push(c); i++; continue; }

    // '#' introduces a two-character dispatch sequence.  We peek at the next
    // character and emit a single two-char token so the parser can switch on it:
    //   #'  — function namespace: (function ...) shorthand, e.g. #'foo -> (function foo)
    //   #+  — reader conditional: include next form only if feature is present
    //   #-  — reader conditional: include next form only if feature is absent
    //   #:  — uninterned (gensym-like) symbol: not looked up in any package
    // Unrecognised #X falls through to the atom reader below, which is fine for
    // things like #t/#f if we ever add them.
    // this is heavily used by common lisp packages, like asdf
    if (c === '#') {
      const next = str[i + 1];
      if (next === "'") { tokens.push("#'"); i += 2; continue; }
      if (next === '+')  { tokens.push("#+"); i += 2; continue; }
      if (next === '-')  { tokens.push("#-"); i += 2; continue; }
      if (next === ':') { tokens.push("#:"); i += 2; continue; }
    }

    // double-quoted string literal.  We keep the surrounding '"' delimiters in
    // the token so the parser can distinguish strings from symbols without a
    // separate token type.  Backslash escapes are passed through verbatim here;
    // evalLisp converts them when it evaluates the string literal.
    if (c === '"') {
      let s = '"';
      i++;
      while (i < str.length && str[i] !== '"') {
        if (str[i] === '\\') { s += str[i] + str[i + 1]; i += 2; }
        else { s += str[i++]; }
      }
      tokens.push(s + '"');
      i++; // consume closing "
      continue;
    }

    // atom: any run of characters that is not a delimiter.
    // stops at whitespace, list delimiters, string delimiter, comment char,
    // and the quasiquote/unquote characters ',' and '`' (reserved for future
    // macro-character use even though quasiquote is not yet implemented).
    // this means package-qualified names like ext:exit and keyword symbols
    // like :keyword are captured as single atoms.
    let atom = '';
    while (i < str.length && !/[\s()"';,`]/.test(str[i])) atom += str[i++];
    if (atom) tokens.push(atom);
  }
  return tokens;
}

// sentinel returned by parse when a #+/- conditional suppresses a form.
// filtered out of lists and skipped in runAll/run.
const SKIP_FORM: unique symbol = Symbol('skip');

// active feature flags for #+ / #- reader conditionals.
// no implementation-specific flags — implementation-specific forms are skipped.
const _features = new Set<string>(['common-lisp']);

function evalFeatureExpr(expr: any): boolean {
  if (expr instanceof LispSymbol) {
    const name = expr.name.startsWith(':') ? expr.name.slice(1) : expr.name;
    return _features.has(name.toLowerCase());
  }
  if (Array.isArray(expr) && expr.length > 0) {
    const op = (expr[0] as LispSymbol).name?.toLowerCase();
    if (op === 'or')  return (expr as any[]).slice(1).some(evalFeatureExpr);
    if (op === 'and') return (expr as any[]).slice(1).every(evalFeatureExpr);
    if (op === 'not') return !evalFeatureExpr((expr as any[])[1]);
  }
  return false;
}

function parse(tokens: string[]): LispVal | typeof SKIP_FORM {
  if (tokens.length === 0) throw new Error("Unexpected EOF");

  let token = tokens.shift();
  if (token === '(') {
    if (tokens[0] === ')') {
      tokens.shift();
      return null; // () is now null
    }
    let list: LispVal[] = [];
    while (tokens[0] !== ')') {
      const item = parse(tokens);
      if (item !== SKIP_FORM) list.push(item as LispVal);
      if (tokens.length === 0) throw new Error("Missing ')'");
    }
    tokens.shift(); // remove ')'
    return list;
  }

  // handle the quote shorthand
  if (token === "'") {
    const inner = parse(tokens);
    if (inner === SKIP_FORM) return SKIP_FORM;
    return [intern("quote"), inner as LispVal];
  }

  // #'x -> (function x)
  if (token === "#'") {
    const inner = parse(tokens);
    if (inner === SKIP_FORM) return SKIP_FORM;
    return [intern("function"), inner as LispVal];
  }

  // #:foo -> uninterned symbol; self-evaluating (treated as quoted symbol, no package system)
  if (token === "#:") {
    const inner = parse(tokens);
    if (inner === SKIP_FORM) return SKIP_FORM;
    return [intern("quote"), inner as LispVal];
  }

  // #+feature form  — include form if feature is present, else skip
  if (token === "#+") {
    const feat = parse(tokens);
    const body = parse(tokens);
    return evalFeatureExpr(feat) ? body : SKIP_FORM;
  }

  // #-feature form  — include form if feature is absent, else skip
  if (token === "#-") {
    const feat = parse(tokens);
    const body = parse(tokens);
    return evalFeatureExpr(feat) ? SKIP_FORM : body;
  }

  // string literal
  if (token!.startsWith('"')) {
    const raw = token!.slice(1, -1);
    return raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // return number if it's numeric, otherwise return the string as a symbol
  return isNaN(Number(token)) ? intern(token!) : Number(token);
}

let gensymCounter = 0;

// platform file loader — replaced by setFileLoader() in Node.js environments.
// default uses synchronous XHR against the extension root (works in popups/pages).
// ideally that should be rewritten async eventually
let _fileLoader: ((path: string) => string) | null = null;

export function setFileLoader(fn: (path: string) => string): void {
  _fileLoader = fn;
}

// platform exit handler — replaced by setExitHandler() in Node.js environments.
// default is a no-op in browser contexts (no concept of process exit).
let _exitHandler: ((code: number) => void) | null = null;

export function setExitHandler(fn: (code: number) => void): void {
  _exitHandler = fn;
}

// guard for remote (http/https) URL loading.  Off by default; toggled by the
// "remote_lisp" user option in background.ts.  Requires the extension to have
// <all_urls> in its manifest permissions so the background XHR can bypass CORS.
let _remoteLoadAllowed = false;

export function setRemoteLoadAllowed(allowed: boolean): void {
  _remoteLoadAllowed = allowed;
}

function loadSource(path: string): string {
  if (_fileLoader) return _fileLoader(path);
  if (typeof XMLHttpRequest !== 'undefined') {
    const cr = (globalThis as any).chrome;
    const base = cr?.runtime?.getURL ? cr.runtime.getURL('') : '';
    const isRemote = /^https?:\/\//.test(path);
    if (isRemote && !_remoteLoadAllowed)
      throw new Error(`load: remote loading is disabled (enable via settings)`);
    const url = isRemote ? path : base + path;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // synchronous
    xhr.send();
    if (xhr.status === 200) return xhr.responseText;
    throw new Error(`load: cannot fetch '${path}' (HTTP ${xhr.status})`);
  }
  throw new Error(`load: no file loader configured`);
}

const _loadedFeatures = new Set<string>();

const globalEnv = new Env({
  // constants
  'nil': null,
  't': true,

  // math
  '+': (...args: number[]) => args.reduce((a, b) => a + b, 0),
  '*': (...args: number[]) => args.reduce((a, b) => a * b, 1),
  '-': (first: number, ...rest: number[]) =>
    rest.length === 0 ? -first : rest.reduce((a, b) => a - b, first),
  '/': (first: number, ...rest: number[]) =>
    rest.length === 0 ? 1 / first : rest.reduce((a, b) => a / b, first),

  // comparison
  // numerical comparison: variadic and monotonic
  '=': (...args: number[]) => args.every((val, i) => i === 0 || val === args[i - 1]),
  '<': (...args: number[]) => args.every((val, i) => i === 0 || args[i - 1] < val),
  '>': (...args: number[]) => args.every((val, i) => i === 0 || args[i - 1] > val),

  // equality: eq vs equal
  // eq: checks reference/identity (fastest)
  'eq': (a: any, b: any) => a === b,

  // equal: checks structural similarity (deep equality)
  'equal': (a: any, b: any) => {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => globalEnv.get('equal')(v, b[i]));
    }
    return a === b;
  },

  // list Primitives
  // the original approach is too simple:
  //'car': (list: any[]) => list[0],
  //'cdr': (list: any[]) => list.slice(1),
  //'cons': (x: any, list: any[]) => [x, ...list],
  // we need to be able to distinguish between lists and single
  // elements - (cons 'a 'b) becomes (a . b), but if it's a list
  // we get (cons 'a '(b c)) -> (a b c)
  'car': (val: any) => Array.isArray(val) ? val[0] : val.car,
  'cdr': (val: any) => Array.isArray(val) ? (val.length > 1 ? val.slice(1) : null) : val.cdr,
  'cons': (x: any, y: any) => ({ car: x, cdr: y }),

  'gensym': () => new LispSymbol(`G__${gensymCounter++}`),

  'setcar': (cell: any, val: any) => {
    if (cell && typeof cell === 'object' && 'car' in cell) {
      cell.car = val;
      return val;
    }
    throw new Error("setcar: argument is not a cons cell");
  },
  'setcdr': (cell: any, val: any) => {
    if (cell && typeof cell === 'object' && 'cdr' in cell) {
      cell.cdr = val;
      return val;
    }
    throw new Error("setcdr: argument is not a cons cell");
  },

  'list': (...args: any[]) => args,

  // atom: true for any non-cons value (nil, symbol, number); nil for lists/cons cells
  'atom': (val: any) => {
    if (val === null) return true;
    if (typeof val === 'object' && 'car' in val) return null;
    if (Array.isArray(val) && val.length > 0) return null;
    return true;
  },

  // apply: (apply fn arg1 ... last-list) — spreads last arg as argument list
  'apply': (fn: any, ...argsAndList: any[]) => {
    const last = argsAndList[argsAndList.length - 1];
    const leading = argsAndList.slice(0, -1);
    const tail = last === null ? [] : Array.isArray(last) ? last : listToArray(last);
    return fn(...leading, ...tail);
  },

  // string predicates and operations
  // tyype predicates
  'not':       (v: any) => (v === null || v === false) ? true : null,
  'null':      (v: any) => (v === null || v === false) ? true : null,
  'numberp':   (v: any) => typeof v === 'number' ? true : null,
  'symbolp':   (v: any) => (v === null || v === true || v instanceof LispSymbol) ? true : null,
  'listp':     (v: any) => (v === null || Array.isArray(v) || (typeof v === 'object' && 'car' in v)) ? true : null,
  'functionp': (v: any) => typeof v === 'function' ? true : null,
  'stringp':   (v: any) => typeof v === 'string' ? true : null,

  // numeric shorthands
  '1+': (n: number) => n + 1,
  '1-': (n: number) => n - 1,
  'max': (...args: number[]) => Math.max(...args),
  'min': (...args: number[]) => Math.min(...args),
  'abs': (n: number) => Math.abs(n),
  'mod': (a: number, b: number) => a - Math.floor(a / b) * b,

  // list/sequence utilities
  'length': (v: any) => {
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) return v.length;
    return listToArray(v).length;
  },
  'nth':    (i: number, v: any) => Array.isArray(v) ? (v[i] ?? null) : listToArray(v)[i] ?? null,
  'last':   (v: any) => { const a = Array.isArray(v) ? v : listToArray(v); return a.length ? [a[a.length - 1]] : null; },
  'reverse':(v: any) => Array.isArray(v) ? [...v].reverse() : listToArray(v).reverse(),
  'append': (...args: any[]) => ([] as any[]).concat(...args.map(a => Array.isArray(a) ? a : listToArray(a))),
  'mapcar': (fn: Function, v: any) => (Array.isArray(v) ? v : listToArray(v)).map((x: any) => fn(x)),
  'cadr':   (v: any) => { const a = Array.isArray(v) ? v : listToArray(v); return a[1] ?? null; },
  'caddr':  (v: any) => { const a = Array.isArray(v) ? v : listToArray(v); return a[2] ?? null; },
  'caar':   (v: any) => { const x = Array.isArray(v) ? v[0] : v?.car; return Array.isArray(x) ? x[0] : x?.car ?? null; },
  'cddr':   (v: any) => { const a = Array.isArray(v) ? v : listToArray(v); return a.slice(2); },

  // CL string functions — https://www.lispworks.com/documentation/HyperSpec/Body/f_stgeq_.htm
  // case-sensitive comparisons
  'string=':          (a: string, b: string) => a === b ? true : null,
  'string/=':         (a: string, b: string) => a !== b ? true : null,
  'string<':          (a: string, b: string) => a < b ? true : null,
  'string>':          (a: string, b: string) => a > b ? true : null,
  'string<=':         (a: string, b: string) => a <= b ? true : null,
  'string>=':         (a: string, b: string) => a >= b ? true : null,
  // case-insensitive comparisons
  'string-equal':     (a: string, b: string) => a.toLowerCase() === b.toLowerCase() ? true : null,
  'string-not-equal': (a: string, b: string) => a.toLowerCase() !== b.toLowerCase() ? true : null,
  'string-lessp':     (a: string, b: string) => a.toLowerCase() < b.toLowerCase() ? true : null,
  'string-greaterp':  (a: string, b: string) => a.toLowerCase() > b.toLowerCase() ? true : null,
  'string-not-lessp': (a: string, b: string) => a.toLowerCase() >= b.toLowerCase() ? true : null,
  'string-not-greaterp': (a: string, b: string) => a.toLowerCase() <= b.toLowerCase() ? true : null,

  // CL string coercion: symbol or string -> string
  'string': (v: any) => v instanceof LispSymbol ? v.name : String(v),

  // CL case operations (https://www.lispworks.com/documentation/HyperSpec/Body/f_stg_up.htm)
  'string-upcase':    (s: string) => s.toUpperCase(),
  'string-downcase':  (s: string) => s.toLowerCase(),
  'string-capitalize':(s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),

  // CL trim — (string-trim char-bag string); 1-arg form trims whitespace
  'string-trim': (bagOrStr: any, maybeStr?: string) => {
    const [s, bag] = maybeStr !== undefined ? [maybeStr, String(bagOrStr)] : [String(bagOrStr), null];
    if (!bag) return s.trim();
    const esc = bag.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    return s.replace(new RegExp(`^[${esc}]+|[${esc}]+$`, 'g'), '');
  },
  'string-left-trim': (bagOrStr: any, maybeStr?: string) => {
    const [s, bag] = maybeStr !== undefined ? [maybeStr, String(bagOrStr)] : [String(bagOrStr), null];
    if (!bag) return s.trimStart();
    const esc = bag.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    return s.replace(new RegExp(`^[${esc}]+`), '');
  },
  'string-right-trim': (bagOrStr: any, maybeStr?: string) => {
    const [s, bag] = maybeStr !== undefined ? [maybeStr, String(bagOrStr)] : [String(bagOrStr), null];
    if (!bag) return s.trimEnd();
    const esc = bag.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    return s.replace(new RegExp(`[${esc}]+$`), '');
  },

  // CL sequence function — works on strings and lists
  'subseq': (seq: any, start: number, end?: number) => {
    if (typeof seq === 'string') return seq.slice(start, end);
    const arr = Array.isArray(seq) ? seq : listToArray(seq);
    return arr.slice(start, end ?? arr.length);
  },

  // CL character access — returns 1-char string (no char type in this impl)
  'char': (s: string, i: number) => s[i] ?? null,

  // CL symbol/string conversion
  'intern':      (s: any) => intern(s instanceof LispSymbol ? s.name : String(s)),
  'symbol-name': (sym: any) => sym instanceof LispSymbol ? sym.name : String(sym),

  // CL string construction
  'string-append': (...args: string[]) => args.join(''),

  // Emacs-style non-CL utilities
  'string-to-number': (s: string) => { const n = Number(s); return isNaN(n) ? null : n; },
  'number-to-string': (n: number) => String(n),
  'string-contains':  (s: string, sub: string) => s.includes(sub) ? true : null,
  'split-string':     (s: string, sep?: string) => sep ? s.split(sep) : s.split(/\s+/).filter(Boolean),

  'prin1-to-string': (v: any) => lispToString(v),

  // read: parse a string into a Lisp form
  'read': (str: any) => {
    const s = str instanceof LispSymbol ? str.name : String(str);
    const tokens = tokenize(s);
    if (tokens.length === 0) return null;
    const form = parse(tokens);
    return form === SKIP_FORM ? null : form as LispVal;
  },

  // eval: evaluate a Lisp form in the global environment
  'eval': (form: any) => evalLisp(form, globalEnv),

  // eval-string: parse and run all forms in a string, isolated from global state.
  // uses a barrier env so setq cannot mutate globalEnv.
  'eval-string': (s: string) => {
    gensymCounter = 0;
    return runAll(s, new Env({}, globalEnv, true));
  },

  '*features*': null,   // initialised after globalEnv is constructed
  '*load-truename*': null,
  '*load-pathname*': null,

  // load: read and evaluate a file, always (no caching)
  'load': (path: string) => {
    const prev = globalEnv.get('*load-truename*');
    globalEnv.set('*load-truename*', path);
    globalEnv.set('*load-pathname*', path);
    try { return runAll(loadSource(path), globalEnv); }
    finally { globalEnv.set('*load-truename*', prev); globalEnv.set('*load-pathname*', prev); }
  },

  // require: load a file at most once, tracked by feature name
  // accepts a symbol or string; tries name.lisp then name.el if no extension given
  // TODO, on load we should check if the file provides the requested featur,
  // and fail if not
  'require': (feature: any) => {
    const name = feature instanceof LispSymbol ? feature.name : String(feature);
    if (_loadedFeatures.has(name)) return feature;
    _loadedFeatures.add(name);
    const path = /\.(lisp|el)$/.test(name) ? name : `${name}.lisp`;
    runAll(loadSource(path), globalEnv);
    return feature;
  },

  // provide: mark a feature as loaded (Emacs compat, used at end of library files)
  'provide': (feature: any) => {
    const name = feature instanceof LispSymbol ? feature.name : String(feature);
    _loadedFeatures.add(name);
    return feature;
  },

  // member: (member item list) -> tail of list starting at item, or nil
  'member': (item: any, list: any) => {
    const arr = Array.isArray(list) ? list : listToArray(list);
    const idx = arr.findIndex((x: any) => x === item);
    return idx === -1 ? null : arr.slice(idx);
  },

  // alist: (assoc 'a '((a 1) (b 2)))
  'assoc': (key: any, alist: any[][]) => alist.find(pair => pair[0] === key),

  // plist: (getf '(a 1 b 2) 'b)
  'getf': (plist: any[], key: any) => {
    const idx = plist.indexOf(key);
    return (idx !== -1 && idx % 2 === 0) ? plist[idx + 1] : null;
  },

  // format: (format fmt arg...) -> string
  // supports: %s, %S (with quotes), %d %o %x %X %f %e %g %c %%
  // optional width/precision: %-10s  %8d  %.2f
  'format': (fmt: any, ...args: any[]) => {
    const s = typeof fmt === 'string' ? fmt : String(fmt);
    let i = 0;
    return s.replace(/%([-+0 ]*)(\d*)(?:\.(\d+))?([sSdfoOxXeEgGc%])/g,
      (_m, flags: string, width: string, prec: string, spec: string) => {
        if (spec === '%') return '%';
        const arg = args[i++];
        const n = typeof arg === 'number' ? arg : Number(arg);
        let val: string;
        switch (spec) {
          case 's': val = typeof arg === 'string' ? arg : lispToString(arg); break;
          case 'S': val = lispToString(arg); break;
          case 'd': val = String(Math.trunc(n)); break;
          case 'f': val = n.toFixed(prec !== undefined ? +prec : 6); break;
          case 'e': val = n.toExponential(prec !== undefined ? +prec : undefined); break;
          case 'E': val = n.toExponential(prec !== undefined ? +prec : undefined).toUpperCase(); break;
          case 'g': case 'G': val = prec ? n.toPrecision(+prec) : String(n); if (spec === 'G') val = val.toUpperCase(); break;
          case 'o': val = Math.trunc(n).toString(8); break;
          case 'x': val = Math.trunc(n).toString(16); break;
          case 'X': val = Math.trunc(n).toString(16).toUpperCase(); break;
          case 'c': val = String.fromCharCode(n); break;
          default:  val = String(arg);
        }
        const w = width ? +width : 0;
        if (w > val.length) {
          const pad = (flags.includes('0') && !flags.includes('-') ? '0' : ' ').repeat(w - val.length);
          val = flags.includes('-') ? val + pad : pad + val;
        }
        return val;
      });
  },

  // message: like format but also sends the result to print (shown in UI)
  'message': (fmt: any, ...args: any[]) => {
    const text = (globalEnv.get('format') as Function)(fmt, ...args);
    (globalEnv.get('print') as Function)(text);
    return text;
  },

  // extension/debug
  'print': (...args: any[]) => { console.log(...args); return args[0]; },
  // this is not properly tested/utilised so far
  'chrome':  'chrome'  in globalThis ? (globalThis as Record<string, unknown>)['chrome']  : null,
  'browser': 'browser' in globalThis ? (globalThis as Record<string, unknown>)['browser'] : null,

  // ext: namespace — platform services
  // ideally we should have  proper namespace handling later on as well
  'ext:exit': (code?: number) => {
    const exitCode = typeof code === 'number' ? code : 0;
    if (_exitHandler) {
      _exitHandler(exitCode);
    } else {
      console.log(`[lisp] ext:exit ${exitCode} (no exit handler in browser context)`);
    }
    return null;
  },
  'ext:clear-context': () => {
    for (const [key] of globalEnv.ownEntries()) {
      if (!_builtinKeys.has(key)) globalEnv.deleteOwn(key);
    }
    return null;
  },
});

function lispToString(val: any): string {
  if (val === null || val === undefined || val === false) return 'nil';
  if (val === true) return 't';
  if (val instanceof LispSymbol) return val.name;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  if (typeof val === 'function') return '<function>';

  // cons cells and lists
  if (typeof val === 'object' && 'car' in val) {
    let res = "(";
    let current = val;
    while (true) {
      res += lispToString(current.car);
      current = current.cdr;
      if (current === null) break;
      if (typeof current === 'object' && 'car' in current) {
        res += " ";
        continue;
      }
      res += " . " + lispToString(current);
      break;
    }
    return res + ")";
  }

  // fallback handling of JS arrays
  if (Array.isArray(val)) {
    return val.length === 0 ? 'nil' : '(' + val.map(lispToString).join(' ') + ')';
  }

  return String(val);
}

// evaluate a single expression
function run(code: string, env: Env = globalEnv): any {
  const tokens = tokenize(code);
  const ast = parse(tokens);
  return ast === SKIP_FORM ? null : evalLisp(ast as LispVal, env);
}

// evaluate all top-level expressions in a string, return the last result
function runAll(code: string, env: Env = globalEnv): any {
  const tokens = tokenize(code);
  let result: any;
  while (tokens.length > 0) {
    const form = parse(tokens);
    if (form !== SKIP_FORM) result = evalLisp(form as LispVal, env);
  }
  return result;
}

// keys present at startup — anything added later is user-defined
// initialise *features* as a proper Lisp list of keyword symbols
// TODO, we probably want to investigate what other CL environments set here,
//       and do the same
globalEnv.set('*features*', [..._features].map(f => intern(':' + f)));

const _builtinKeys = new Set(globalEnv.ownEntries().map(([k]) => k));

// serialise user-defined globalEnv bindings to Lisp source for persistence
export function snapshotGlobalEnv(): string {
  const parts: string[] = [];
  for (const [key, val] of globalEnv.ownEntries()) {
    if (_builtinKeys.has(key)) continue;
    if (typeof val === 'function' && val.__lsource) {
      parts.push(lispToString(val.__lsource));
    } else if (val && typeof val === 'object' && val.__isMacro && val.__lsource) {
      parts.push(lispToString(val.__lsource));
    } else if (typeof val !== 'function') {
      parts.push(`(define ${key} ${lispToString(val)})`);
    }
  }
  return parts.join('\n');
}

// replay a snapshot into globalEnv (errors are swallowed per-form so partial restore works)
export function restoreGlobalEnv(source: string): void {
  if (!source.trim()) return;
  const tokens = tokenize(source);
  while (tokens.length > 0) {
    try { const f = parse(tokens); if (f !== SKIP_FORM) evalLisp(f as LispVal, globalEnv); } catch { /* skip broken forms */ }
  }
}

// expose engine API on the same namespace so callers don't need their own
// (globalThis as any).lisp = { run, runAll, ... } assignments.
Object.assign(lispNamespace, { run, runAll, globalEnv, lispToString, snapshotGlobalEnv, restoreGlobalEnv });

export { LispVal, Env, globalEnv, evalLisp, parse, tokenize, run, runAll, lispToString };
