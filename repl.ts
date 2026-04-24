import * as fs from 'fs';
import * as readline from 'readline';
import { globalEnv, runAll, lispToString, setFileLoader, setExitHandler } from './lisp';

setFileLoader((path: string) => fs.readFileSync(path, 'utf8'));
setExitHandler((code: number) => process.exit(code));

const interactive = !!process.stdin.isTTY;

function loadFile(path: string): any {
  const code = fs.readFileSync(path, 'utf8');
  return runAll(code, globalEnv);
}

const arg = process.argv[2];
if (arg) {
  try {
    loadFile(arg);
  } catch (e: any) {
    console.error('Error loading file:', e.message);
  }
}

if (interactive) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'lisp> ',
    terminal: true,
  });
  console.log("Lisp REPL. Type (exit) or Ctrl+C to quit.");
  rl.prompt();
  rl.on('close', () => process.exit(0));
  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (trimmed === '(exit)') { rl.close(); return; }
    if (trimmed.length === 0) { rl.prompt(); return; }
    try {
      const result = runAll(trimmed);
      console.log('=>', lispToString(result));
    } catch (e: any) {
      console.error('Error:', e.message);
    }
    rl.prompt();
  });
} else {
  // pipe mode: read all stdin then evaluate as one block
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => { input += chunk; });
  process.stdin.on('end', () => {
    const trimmed = input.trim();
    if (trimmed.length === 0) { process.exit(0); return; }
    try {
      const result = runAll(trimmed);
      console.log(lispToString(result));
    } catch (e: any) {
      console.error('Error:', e.message);
    }
    process.exit(0);
  });
}
