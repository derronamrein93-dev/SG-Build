/**
 * Legacy-browser scanner: does this JavaScript actually run on the pilot iPad?
 *
 * Claiming compatibility because a Chromium test passed proves nothing — the
 * A1490 runs WebKit 12.1 and there is no WebKit 12.1 available to this project
 * to test against. What CAN be proved mechanically is the half that is about
 * the code rather than the engine: that no syntax the target parser rejects is
 * present in the files we ship, and that no runtime API it lacks is called.
 *
 * A syntax error is total on a `<script>`: the whole file fails to parse and
 * nothing in it runs. So this check is not a lint preference, it is the
 * difference between a working kiosk and a blank screen.
 *
 * Parsed with the TypeScript compiler, which is already a devDependency, rather
 * than by matching text. `?.` inside a string literal is not optional chaining
 * and a regex cannot tell the difference.
 *
 *   npx tsx scripts/legacy-scan.ts public/kiosk .next/static/chunks
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';

export type Severity = 'error' | 'warn';
export interface Finding {
  file: string; line: number; kind: string; severity: Severity; detail: string;
}

export interface ScanOptions {
  /**
   * `es5` — our own hand-written kiosk files, held to ES5 syntax so the rule is
   *         checkable rather than a judgement call about what Safari 12.1 has.
   * `safari12` — build output, held only to what WebKit 12.1 cannot parse. Next
   *         and React legitimately emit ES2015-2017, all of which it runs.
   */
  syntax: 'es5' | 'safari12';
  /** Runtime APIs missing from WebKit 12.1. `warn` for bundles that ship their own guards. */
  apis: Severity | 'off';
}

/**
 * Missing from WebKit 12.1 (iPadOS 12.5.7), with the version that added each.
 *
 * Maps, not object literals: a plain object inherits `hasOwnProperty`, `toString`
 * and friends, so looking up a property NAMED one of those returns a function
 * and the scanner reports every `hasOwnProperty` call as a missing API. It did
 * exactly that on the first run.
 */
const MISSING_MEMBERS = new Map<string, string>(Object.entries({
  at: 'Array.prototype.at — Safari 15.4',
  replaceAll: 'String.prototype.replaceAll — Safari 13.1',
  allSettled: 'Promise.allSettled — Safari 13',
  hasOwn: 'Object.hasOwn — Safari 15.4',
  matchAll: 'String.prototype.matchAll — Safari 13',
  findLast: 'Array.prototype.findLast — Safari 15.4',
  findLastIndex: 'Array.prototype.findLastIndex — Safari 15.4',
  replaceChildren: 'Element.replaceChildren — Safari 14',
  toggleAttribute: 'Element.toggleAttribute — Safari 12.1 (borderline)',
}));

const MISSING_GLOBALS = new Map<string, string>(Object.entries({
  structuredClone: 'structuredClone — Safari 15.4',
  ResizeObserver: 'ResizeObserver — Safari 13.1',
  WeakRef: 'WeakRef — Safari 14.1',
  FinalizationRegistry: 'FinalizationRegistry — Safari 14.1',
  BroadcastChannel: 'BroadcastChannel — Safari 15.4',
  requestIdleCallback: 'requestIdleCallback — not in Safari 12',
  ReportingObserver: 'ReportingObserver — not in Safari 12',
}));

const K = ts.SyntaxKind;

/** Syntax WebKit 12.1 cannot parse, whatever else is in the file. */
function checkSafari12Syntax(node: ts.Node, hit: (kind: string, detail: string, n: ts.Node) => void) {
  if (node.kind === K.PrivateIdentifier) hit('private-class-field', 'private class fields — Safari 14.1', node);
  if (node.kind === K.BigIntLiteral) hit('bigint', 'BigInt literal — Safari 14', node);
  if (node.kind === K.ClassStaticBlockDeclaration) hit('class-static-block', 'class static block — Safari 16.4', node);
  if (ts.isPropertyAccessExpression(node) && node.questionDotToken) hit('optional-chaining', 'optional chaining — Safari 13.1', node);
  if (ts.isElementAccessExpression(node) && node.questionDotToken) hit('optional-chaining', 'optional chaining — Safari 13.1', node);
  if (ts.isCallExpression(node) && node.questionDotToken) hit('optional-call', 'optional call — Safari 13.1', node);
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === K.QuestionQuestionToken) hit('nullish-coalescing', 'nullish coalescing — Safari 13.1', node);
    if (op === K.QuestionQuestionEqualsToken || op === K.BarBarEqualsToken ||
        op === K.AmpersandAmpersandEqualsToken) {
      hit('logical-assignment', 'logical assignment — Safari 14', node);
    }
  }
}

/** Everything above ES5. Applied to our own files only. */
function checkEs5Syntax(node: ts.Node, hit: (kind: string, detail: string, n: ts.Node) => void) {
  if (ts.isVariableDeclarationList(node)) {
    if (node.flags & ts.NodeFlags.Let) hit('let', '`let` is ES2015 — use `var`', node);
    if (node.flags & ts.NodeFlags.Const) hit('const', '`const` is ES2015 — use `var`', node);
  }
  if (ts.isArrowFunction(node)) hit('arrow-function', 'arrow function is ES2015', node);
  if (node.kind === K.TemplateExpression || node.kind === K.NoSubstitutionTemplateLiteral ||
      node.kind === K.TaggedTemplateExpression) {
    hit('template-literal', 'template literal is ES2015', node);
  }
  if (ts.isClassLike(node)) hit('class', '`class` is ES2015', node);
  if (node.kind === K.SpreadElement || node.kind === K.SpreadAssignment) hit('spread', 'spread is ES2015/ES2018', node);
  if (node.kind === K.ForOfStatement) hit('for-of', '`for...of` is ES2015', node);
  if (node.kind === K.ObjectBindingPattern || node.kind === K.ArrayBindingPattern) {
    hit('destructuring', 'destructuring is ES2015', node);
  }
  if (node.kind === K.ShorthandPropertyAssignment) hit('shorthand-property', 'shorthand property is ES2015', node);
  if (node.kind === K.ComputedPropertyName) hit('computed-property', 'computed property name is ES2015', node);
  if (node.kind === K.AwaitExpression) hit('await', '`await` is ES2017', node);
  if (node.kind === K.ImportDeclaration || node.kind === K.ExportDeclaration ||
      node.kind === K.ExportAssignment || node.kind === K.ImportEqualsDeclaration) {
    hit('module', 'ES modules are ES2015 — the kiosk scripts are classic scripts', node);
  }
  if (ts.isFunctionLike(node)) {
    const fn = node as ts.FunctionLikeDeclaration;
    if (fn.asteriskToken) hit('generator', 'generator is ES2015', node);
    if (fn.modifiers && fn.modifiers.some((m) => m.kind === K.AsyncKeyword)) {
      hit('async', '`async` is ES2017', node);
    }
    for (const p of fn.parameters ?? []) {
      if (p.initializer) hit('default-parameter', 'default parameter is ES2015', p);
      if (p.dotDotDotToken) hit('rest-parameter', 'rest parameter is ES2015', p);
    }
  }
  if (ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === K.AsteriskAsteriskToken ||
       node.operatorToken.kind === K.AsteriskAsteriskEqualsToken)) {
    hit('exponent', '`**` is ES2016', node);
  }
  checkSafari12Syntax(node, hit);
}

function checkApis(node: ts.Node, hit: (kind: string, detail: string, n: ts.Node) => void) {
  if (ts.isPropertyAccessExpression(node)) {
    const name = node.name.text;
    const missing = MISSING_MEMBERS.get(name);
    if (missing) hit('missing-api', missing, node);
    // Promise.any specifically — `.any` is a common property name elsewhere.
    if (name === 'any' && ts.isIdentifier(node.expression) && node.expression.text === 'Promise') {
      hit('missing-api', 'Promise.any — Safari 15.4', node);
    }
  }
  const global = ts.isIdentifier(node) ? MISSING_GLOBALS.get(node.text) : undefined;
  if (global) hit('missing-api', global, node);
}

export function scanSource(file: string, text: string, options: ScanOptions): Finding[] {
  const findings: Finding[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

  const hit = (severity: Severity) => (kind: string, detail: string, node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ file, line: line + 1, kind, severity, detail });
  };
  const syntaxHit = hit('error');
  const apiHit = options.apis === 'off' ? null : hit(options.apis);

  const visit = (node: ts.Node): void => {
    if (options.syntax === 'es5') checkEs5Syntax(node, syntaxHit);
    else checkSafari12Syntax(node, syntaxHit);
    if (apiHit) checkApis(node, apiHit);
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Numeric separators are lexical, not a node kind the AST exposes usefully.
  const separator = /(^|[^\w$"'])\d[\d_]*_\d/m.exec(text);
  if (separator) {
    const line = text.slice(0, separator.index).split('\n').length;
    findings.push({ file, line, kind: 'numeric-separator', severity: 'error',
                    detail: 'numeric separator — Safari 13' });
  }
  return findings;
}

/**
 * The file with its comments removed, via the real parser.
 *
 * Used by the tests that assert what the kiosk client does NOT do — reference
 * localStorage, open a new context. A prose explanation of why localStorage is
 * not used must not read as a use of localStorage, and a regex cannot tell a
 * comment from a string literal reliably enough to be the thing standing
 * between a customer's phone number and persistent storage.
 */
export function stripComments(text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.None,
      removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    },
  }).outputText;
}

export function scanFile(path: string, options: ScanOptions): Finding[] {
  return scanSource(path, readFileSync(path, 'utf8'), options);
}

export function jsFilesIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (extname(p) === '.js') out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** legacy.js exists to define the missing APIs, so it is exempt from that check. */
export function optionsFor(path: string): ScanOptions {
  if (basename(path) === 'legacy.js') return { syntax: 'es5', apis: 'off' };
  if (path.indexOf('public/kiosk') >= 0) return { syntax: 'es5', apis: 'error' };
  // Build output: Next and React ship their own inline guards for `.at` and
  // `Object.hasOwn`, so an API hit there is worth reporting and not worth
  // failing on. Syntax is not negotiable.
  return { syntax: 'safari12', apis: 'warn' };
}

function main(): void {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.error('usage: tsx scripts/legacy-scan.ts <dir|file> [...]');
    process.exit(2);
  }
  let errors = 0, warnings = 0, files = 0;
  for (const target of targets) {
    const paths = statSync(target).isDirectory() ? jsFilesIn(target) : [target];
    for (const path of paths) {
      files += 1;
      for (const f of scanFile(path, optionsFor(path))) {
        if (f.severity === 'error') errors += 1; else warnings += 1;
        console.log(`${f.severity === 'error' ? 'FAIL' : 'warn'} ${f.file}:${f.line}  ${f.kind}  ${f.detail}`);
      }
    }
  }
  console.log(`\n${files} file(s) scanned · ${errors} error(s) · ${warnings} warning(s)`);
  process.exit(errors ? 1 : 0);
}

// tsx runs this file directly; the test suite imports it instead.
if (process.argv[1] && process.argv[1].indexOf('legacy-scan') >= 0) main();
