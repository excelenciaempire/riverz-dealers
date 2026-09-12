/** Read-only architectural guard: keep every application Anthropic call behind
 * the protected shared factory. Not a jailbreak detector or general SAST scan.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const findings = [];
let files = 0;
let providerCalls = 0;
const secretPattern = /\b(?:sbp_[a-f0-9]{40}|sk-ant-api03-[A-Za-z0-9_-]{40,}|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16})\b/g;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { scan(path); continue; }
    if (!/\.tsx?$/.test(path) || /\.(test|spec)\.tsx?$/.test(path)) continue;
    files++;
    const name = relative(root, path).replaceAll('\\', '/');
    const text = readFileSync(path, 'utf8');
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const imports = new Set();
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === '@anthropic-ai/sdk') {
        const clause = statement.importClause;
        if (clause && !clause.isTypeOnly && clause.name) imports.add(clause.name.text);
      }
    }
    function visit(node) {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && imports.has(node.expression.text)) {
        providerCalls++;
        if (name !== 'src/lib/ai/anthropic-client.ts') findings.push({ file: name, rule: 'unprotected_anthropic_client', line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const match of text.matchAll(secretPattern)) findings.push({ file: name, rule: 'credential_pattern', line: text.slice(0, match.index).split('\n').length });
  }
}
scan(join(root, 'src'));
console.log(JSON.stringify({ files, providerConstructors: providerCalls, findings }, null, 2));
if (findings.length) process.exitCode = 1;
