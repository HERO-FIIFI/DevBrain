import path from 'node:path';
import { readRepositoryText, repositoryFiles } from './repository.js';

export type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'variable';
export interface SymbolRecord { symbol: string; kind: SymbolKind; file: string; startLine: number; endLine: number; language: string; resolutionMethod: 'heuristic'; confidence: 'medium' }

const language = (file: string) => ['.ts','.tsx'].includes(path.extname(file)) ? 'typescript' : ['.js','.jsx','.mjs','.cjs'].includes(path.extname(file)) ? 'javascript' : path.extname(file) === '.py' ? 'python' : null;

function endLine(lines: string[], start: number, lang: string): number {
  if (lang === 'python') {
    const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
    let end = start;
    for (let index = start + 1; index < lines.length; index++) {
      if (!lines[index].trim()) { end = index; continue; }
      const nextIndent = lines[index].match(/^\s*/)?.[0].length ?? 0;
      if (nextIndent <= indent) break;
      end = index;
    }
    return end + 1;
  }
  let depth = 0, opened = false;
  for (let index = start; index < lines.length; index++) {
    for (const character of lines[index]) { if (character === '{') { depth++; opened = true; } else if (character === '}') depth--; }
    if ((opened && depth <= 0) || (!opened && /[;=]\s*$/.test(lines[index]))) return index + 1;
  }
  return start + 1;
}

export function symbolsInText(file: string, text: string): SymbolRecord[] {
  const lang = language(file); if (!lang) return [];
  const lines = text.split(/\r?\n/), result: SymbolRecord[] = [];
  const patterns = lang === 'python'
    ? [{ kind:'class', regex:/^\s*class\s+([A-Za-z_$][\w$]*)\b/ }, { kind:'function', regex:/^\s*(?:async\s+)?def\s+([A-Za-z_$][\w$]*)\s*\(/ }]
    : [
      { kind:'class', regex:/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
      { kind:'interface', regex:/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/ },
      { kind:'type', regex:/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/ },
      { kind:'enum', regex:/^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/ },
      { kind:'function', regex:/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
      { kind:'variable', regex:/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/ },
    ];
  for (let index = 0; index < lines.length; index++) for (const pattern of patterns) {
    const match = pattern.regex.exec(lines[index]); if (!match) continue;
    result.push({ symbol: match[1], kind: pattern.kind as SymbolKind, file, startLine: index + 1, endLine: endLine(lines,index,lang), language: lang, resolutionMethod:'heuristic', confidence:'medium' }); break;
  }
  return result;
}

export async function findSymbols(root: string, gitRepository: boolean, query: string, kind?: SymbolKind, limit = 200): Promise<{ symbols: SymbolRecord[]; total: number; scannedFiles: number; ignoredFiles: number }> {
  const listing = await repositoryFiles(root, gitRepository); const matches: SymbolRecord[] = []; let total = 0, scannedFiles = 0;
  for (const file of listing.files) {
    if (!language(file)) continue;
    try { const content = await readRepositoryText(root,file); scannedFiles++; for (const symbol of symbolsInText(file,content.text)) if (symbol.symbol === query && (!kind || symbol.kind === kind)) { total++; if (matches.length < limit) matches.push(symbol); } } catch { /* unreadable files are skipped */ }
  }
  return { symbols: matches, total, scannedFiles, ignoredFiles: listing.ignoredFiles };
}
