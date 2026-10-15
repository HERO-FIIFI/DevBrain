import path from 'node:path';
import type { ModuleInfo, RepositoryModel } from './graph.js';
import type { Classification, Confidence, Evidence } from './model.js';

export interface RouteRecord { kind: 'http' | 'page'; method: string; path: string; file: string; line: number; handler?: { file: string; symbol: string }; framework: string; middleware: string[]; dynamic: boolean; resolved: boolean; mountedAt?: string; classification: Classification; confidence: Confidence; resolutionMethod: string; evidence: Evidence }
export interface FrameworkAdapter { name: string; detect(model: RepositoryModel): boolean; routes(model: RepositoryModel): RouteRecord[] }

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;
const literal = (value: string) => { const match = /^(['"`])([\s\S]*)\1$/.exec(value.trim()); return match && !(match[1] === '`' && match[2].includes('${')) ? match[2] : undefined; };
const isDynamic = (route: string) => /[:{<[*]/.test(route);
const joinRoute = (prefix: string | undefined, route: string) => prefix ? `${prefix.replace(/\/$/, '')}/${route.replace(/^\//, '')}` : route; // trailing slashes are kept: Django treats them as part of the pattern

/** Split the arguments of a call starting at the opening parenthesis; tracks nesting and quotes so multi-line handlers stay intact. */
export function callArguments(text: string, open: number): { args: string[]; end: number } {
  const args: string[] = []; let depth = 0, current = '', quote: string | null = null;
  for (let index = open + 1; index < text.length; index++) {
    const character = text[index];
    if (quote) { current += character; if (character === '\\') { current += text[++index] ?? ''; continue; } if (character === quote) quote = null; continue; }
    if (character === '"' || character === "'" || character === '`') { quote = character; current += character; continue; }
    if ('([{'.includes(character)) depth++; else if (')]}'.includes(character)) { if (depth === 0) { if (current.trim()) args.push(current.trim()); return { args, end: index }; } depth--; }
    if (character === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += character;
  }
  if (current.trim()) args.push(current.trim());
  return { args, end: text.length };
}

const identifier = (value: string) => /^[\w$.]+$/.test(value) ? value.split('.').at(-1)! : undefined;
const mountTarget = (value: string) => /^[\w$.]+$/.test(value.trim()) ? value.trim().split('.')[0] : undefined; // `users.router` mounts the imported `users` module
function record(module: ModuleInfo, framework: string, method: string, rawPath: string, line: number, handler: string | undefined, middleware: string[], how: string): RouteRecord {
  const value = literal(rawPath), resolved = value !== undefined, route = value ?? rawPath.trim();
  return { kind: 'http', method: method.toUpperCase(), path: resolved ? (route.startsWith('/') ? route : `/${route}`) : route, file: module.file, line, ...(handler ? { handler: { file: module.file, symbol: handler } } : {}), framework, middleware, dynamic: resolved ? isDynamic(route) : true, resolved, classification: 'observed', confidence: resolved ? 'high' : 'low', resolutionMethod: how, evidence: { file: module.file, line, method: how } };
}

/** Apply mount prefixes: `app.use('/p', router)`, `include_router(r, prefix=)`, `register_blueprint(bp, url_prefix=)`, Django `include()` — one hop, labelled inferred. */
function applyMounts(model: RepositoryModel, routes: RouteRecord[], mounts: { from: ModuleInfo; name: string; prefix: string; line: number }[]): RouteRecord[] {
  const byFile = new Map<string, string>();
  for (const mount of mounts) { const record = mount.from.imports.find((item) => item.resolved && (item.names.includes(mount.name) || path.posix.basename(item.resolved!, path.posix.extname(item.resolved!)) === mount.name)); if (record?.resolved && !byFile.has(record.resolved)) byFile.set(record.resolved, mount.prefix); }
  return routes.map((route) => { const prefix = byFile.get(route.file); return prefix && route.resolved ? { ...route, path: joinRoute(prefix, route.path), mountedAt: prefix, classification: 'inferred', confidence: 'medium', resolutionMethod: `${route.resolutionMethod}+mount_prefix` } : route; });
}

const express: FrameworkAdapter = {
  name: 'express', detect: (model) => model.stack.frameworks.includes('Express'),
  routes(model) {
    const routes: RouteRecord[] = [], mounts: { from: ModuleInfo; name: string; prefix: string; line: number }[] = [];
    for (const module of model.modules.values()) {
      if (module.language === 'python') continue;
      const receivers = new Set([...module.text.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:express(?:\.Router)?|Router)\s*\(/g)].map((match) => match[1]));
      for (const match of module.text.matchAll(/\b([\w$]+)\.(get|post|put|patch|delete|options|head|all|use)\(/g)) {
        const receiver = match[1], method = match[2], { args } = callArguments(module.text, match.index! + match[0].length - 1), line = lineAt(module.text, match.index!);
        if (method === 'use') { const prefix = args.length > 1 ? literal(args[0]) : undefined, target = mountTarget(args.at(-1) ?? ''); if (prefix && target) mounts.push({ from: module, name: target, prefix, line }); continue; }
        if (!receivers.has(receiver) || !args.length) continue;
        const rest = args.slice(1), handler = identifier(rest.at(-1) ?? '') ?? (rest.length ? 'inline' : undefined);
        routes.push(record(module, 'express', method, args[0], line, handler, rest.slice(0, -1).map((item) => identifier(item) ?? 'inline'), 'express_route_call'));
      }
    }
    return applyMounts(model, routes, mounts);
  },
};

const next: FrameworkAdapter = {
  name: 'next', detect: (model) => model.stack.frameworks.includes('Next.js'),
  routes(model) {
    const routes: RouteRecord[] = [];
    const routePath = (segments: string) => `/${segments.split('/').filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith('@')).join('/')}`;
    for (const module of model.modules.values()) {
      const app = /(?:^|\/)(?:src\/)?app\/(.*?)(?:\/)?(route|page)\.[cm]?[jt]sx?$/.exec(module.file), pages = /(?:^|\/)(?:src\/)?pages\/api\/(.*?)\.[cm]?[jt]sx?$/.exec(module.file);
      if (app && app[2] === 'route') for (const match of module.text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)) { const route = routePath(app[1]); routes.push({ kind: 'http', method: match[1], path: route, file: module.file, line: lineAt(module.text, match.index!), handler: { file: module.file, symbol: match[1] }, framework: 'next', middleware: [], dynamic: isDynamic(route), resolved: true, classification: 'observed', confidence: 'high', resolutionMethod: 'next_app_route_file', evidence: { file: module.file, line: lineAt(module.text, match.index!), method: 'next_app_route_file' } }); }
      else if (app && app[2] === 'page') { const route = routePath(app[1]); routes.push({ kind: 'page', method: 'GET', path: route, file: module.file, line: 1, handler: { file: module.file, symbol: 'default' }, framework: 'next', middleware: [], dynamic: isDynamic(route), resolved: true, classification: 'observed', confidence: 'high', resolutionMethod: 'next_app_page_file', evidence: { file: module.file, line: 1, method: 'next_app_page_file' } }); }
      else if (pages) { const route = `/api/${pages[1].replace(/(?:^|\/)index$/, '')}`.replace(/\/$/, '') || '/api'; routes.push({ kind: 'http', method: 'ANY', path: route, file: module.file, line: 1, handler: { file: module.file, symbol: 'default' }, framework: 'next', middleware: [], dynamic: isDynamic(route), resolved: true, classification: 'observed', confidence: 'high', resolutionMethod: 'next_pages_api_file', evidence: { file: module.file, line: 1, method: 'next_pages_api_file' } }); }
    }
    return routes;
  },
};

function pythonDecorators(model: RepositoryModel, framework: string, appPattern: RegExp, decorator: RegExp, methodOf: (name: string, args: string[]) => string[]): RouteRecord[] {
  const routes: RouteRecord[] = [], mounts: { from: ModuleInfo; name: string; prefix: string; line: number }[] = [];
  for (const module of model.modules.values()) {
    if (module.language !== 'python') continue;
    const receivers = new Map<string, string | undefined>();
    for (const match of module.text.matchAll(appPattern)) receivers.set(match[1], /(?:prefix|url_prefix)\s*=\s*["']([^"']+)["']/.exec(callArguments(module.text, match.index! + match[0].length - 1).args.join(','))?.[1]);
    for (const match of module.text.matchAll(/\b(\w+)\.(include_router|register_blueprint)\(/g)) { const { args } = callArguments(module.text, match.index! + match[0].length - 1), prefix = /(?:prefix|url_prefix)\s*=\s*["']([^"']+)["']/.exec(args.join(','))?.[1], target = mountTarget(args[0] ?? ''); if (prefix && target) mounts.push({ from: module, name: target, prefix, line: lineAt(module.text, match.index!) }); }
    for (const match of module.text.matchAll(decorator)) {
      const receiver = match[1]; if (!receivers.has(receiver)) continue;
      const { args, end } = callArguments(module.text, match.index! + match[0].length - 1), line = lineAt(module.text, match.index!), handler = /^\s*(?:@[^\n]*\n\s*)*(?:async\s+)?def\s+(\w+)/.exec(module.text.slice(end + 1))?.[1];
      const middleware = [...args.join(',').matchAll(/Depends\(\s*([\w.]+)/g)].map((item) => item[1].split('.').at(-1)!);
      for (const method of methodOf(match[2], args)) { const item = record(module, framework, method, args[0] ?? '""', line, handler, middleware, `${framework}_decorator`); const prefix = receivers.get(receiver); routes.push(prefix && item.resolved ? { ...item, path: joinRoute(prefix, item.path) } : item); }
    }
  }
  return applyMounts(model, routes, mounts);
}

const fastapi: FrameworkAdapter = { name: 'fastapi', detect: (model) => model.stack.frameworks.includes('FastAPI'), routes: (model) => pythonDecorators(model, 'fastapi', /(\w+)\s*=\s*(?:FastAPI|APIRouter)\(/g, /@(\w+)\.(get|post|put|patch|delete|options|head|api_route)\(/g, (name, args) => name === 'api_route' ? [...args.join(',').matchAll(/["'](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["']/gi)].map((match) => match[1]) : [name]) };
const flask: FrameworkAdapter = { name: 'flask', detect: (model) => model.stack.frameworks.includes('Flask'), routes: (model) => pythonDecorators(model, 'flask', /(\w+)\s*=\s*(?:Flask|Blueprint)\(/g, /@(\w+)\.(route|get|post|put|patch|delete)\(/g, (name, args) => name === 'route' ? ([...args.join(',').matchAll(/["'](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["']/gi)].map((match) => match[1]).length ? [...args.join(',').matchAll(/["'](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["']/gi)].map((match) => match[1]) : ['GET']) : [name]) };

const django: FrameworkAdapter = {
  name: 'django', detect: (model) => model.stack.frameworks.includes('Django'),
  routes(model) {
    const routes: RouteRecord[] = [], includes = new Map<string, string>();
    for (const module of model.modules.values()) {
      if (module.language !== 'python' || path.posix.basename(module.file) !== 'urls.py') continue;
      for (const match of module.text.matchAll(/\b(path|re_path|url)\(/g)) {
        const { args } = callArguments(module.text, match.index! + match[0].length - 1), line = lineAt(module.text, match.index!), route = literal(args[0] ?? ''), target = args[1] ?? '';
        const included = /include\(\s*["']([\w.]+)["']/.exec(target)?.[1];
        if (included !== undefined && route !== undefined) { const resolved = module.imports.find((item) => item.specifier === included)?.resolved ?? [...model.modules.keys()].find((file) => file.replace(/\.py$/, '').replaceAll('/', '.').endsWith(included)); if (resolved) includes.set(resolved, `/${route}`); continue; }
        const handler = identifier(target.replace(/\.as_view\(\)$/, ''));
        routes.push({ ...record(module, 'django', 'ANY', args[0] ?? '""', line, handler, [], 'django_urlpattern'), path: route !== undefined ? `/${route}` : (args[0] ?? '').trim() });
      }
    }
    return routes.map((route) => { const prefix = includes.get(route.file); return prefix && route.resolved ? { ...route, path: joinRoute(prefix, route.path), mountedAt: prefix, classification: 'inferred', confidence: 'medium', resolutionMethod: 'django_urlpattern+include' } : route; });
  },
};

export const FRAMEWORK_ADAPTERS: FrameworkAdapter[] = [express, next, fastapi, flask, django];

export function collectRoutes(model: RepositoryModel): { frameworks: string[]; routes: RouteRecord[] } {
  const detected = FRAMEWORK_ADAPTERS.filter((adapter) => adapter.detect(model));
  const routes = detected.flatMap((adapter) => adapter.routes(model)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.method.localeCompare(b.method));
  return { frameworks: detected.map((adapter) => adapter.name), routes };
}
