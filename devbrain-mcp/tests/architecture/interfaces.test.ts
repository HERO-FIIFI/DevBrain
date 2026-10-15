import { afterEach, describe, expect, it } from 'vitest';
import { apiInventory } from '../../src/tools/api-inventory.js';
import { routeInventory } from '../../src/tools/route-inventory.js';
import { expressPackage, fixture, type Fixture } from './fixture.js';

let current: Fixture | undefined;
afterEach(async () => { await current?.cleanup(); current = undefined; });
const byPath = (routes: { method: string; path: string }[] | undefined, method: string, route: string) => routes?.find((item) => item.method === method && item.path === route);

describe('api and route inventory', () => {
  it('maps Express routes with middleware, handlers, mounts, and honest dynamic/unresolved states', async () => {
    current = await fixture({
      'package.json': expressPackage,
      'src/app.ts': `import express from 'express';\nimport usersRouter from './routes/users';\nimport { auth } from './middleware/auth';\nconst app = express();\napp.get('/health', health);\napp.post('/login', auth, rateLimit, login);\napp.use('/api', usersRouter);\nfunction health() {}\nfunction login() {}\n`,
      'src/routes/users.ts': `import { Router } from 'express';\nimport { userService } from '../services/userService';\nconst prefix = '/v2';\nconst router = Router();\nrouter.get('/users/:id', (req, res) => {\n  res.json(userService.find(req.params.id));\n});\nrouter.delete(\`/users/\${prefix}\`, remove);\nrouter.put(prefix + '/users', update);\nexport default router;\n`,
      'src/services/userService.ts': `export const userService = { find: (id: string) => id };\n`,
      'src/middleware/auth.ts': `export const auth = () => {};\n`,
    });
    const api = await apiInventory({ path: current.repo });
    expect(api).toMatchObject({ status: 'partial', frameworks: ['express'], totalApis: 5, unresolvedApis: 2, boundary: { runtime: 'not_observed' } });
    if (!('apis' in api) || !api.apis) throw new Error('missing apis');
    expect(byPath(api.apis, 'POST', '/login')).toMatchObject({ handler: { file: 'src/app.ts', symbol: 'login' }, middleware: ['auth', 'rateLimit'], framework: 'express', classification: 'observed', confidence: 'high', resolved: true, dynamic: false, evidence: { file: 'src/app.ts', line: 6, method: 'express_route_call' } });
    expect(byPath(api.apis, 'GET', '/api/users/:id')).toMatchObject({ handler: { symbol: 'inline' }, mountedAt: '/api', dynamic: true, resolved: true, classification: 'inferred', confidence: 'medium' });
    expect(api.apis.filter((route) => !route.resolved)).toEqual([expect.objectContaining({ method: 'DELETE', confidence: 'low', dynamic: true }), expect.objectContaining({ method: 'PUT', path: "prefix + '/users'", confidence: 'low' })]);
    const routes = await routeInventory({ path: current.repo });
    expect(routes).toMatchObject({ status: 'partial', totalRoutes: 5, unresolvedRoutes: 2 });
    expect('routes' in routes && byPath(routes.routes, 'GET', '/api/users/:id')).toMatchObject({ downstream: [expect.objectContaining({ file: 'src/services/userService.ts', names: ['userService'], classification: 'inferred', confidence: 'medium' })] });
    expect(await routeInventory({ path: current.repo, framework: 'fastapi' })).toMatchObject({ status: 'unsupported', routes: [] });
  });

  it('discovers Next.js app routes, pages API handlers, and page routes from files', async () => {
    current = await fixture({
      'package.json': JSON.stringify({ name: 'site', dependencies: { next: '14.0.0', react: '18.0.0' } }),
      'app/api/users/[id]/route.ts': `export async function GET() { return Response.json({}); }\nexport const DELETE = async () => new Response();\n`,
      'app/(marketing)/pricing/page.tsx': `export default function Pricing() { return null; }\n`,
      'app/page.tsx': `export default function Home() { return null; }\n`,
      'pages/api/health.ts': `export default function handler() {}\n`,
    });
    const api = await apiInventory({ path: current.repo });
    expect(api).toMatchObject({ status: 'complete', frameworks: ['next'], totalApis: 3 });
    if (!('apis' in api) || !api.apis) throw new Error('missing apis');
    expect(byPath(api.apis, 'GET', '/api/users/[id]')).toMatchObject({ dynamic: true, resolved: true, confidence: 'high', handler: { symbol: 'GET' }, resolutionMethod: 'next_app_route_file' });
    expect(byPath(api.apis, 'DELETE', '/api/users/[id]')).toBeDefined();
    expect(byPath(api.apis, 'ANY', '/api/health')).toMatchObject({ resolutionMethod: 'next_pages_api_file' });
    const routes = await routeInventory({ path: current.repo });
    expect('routes' in routes && routes.routes?.filter((route) => route.kind === 'page').map((route) => route.path).sort()).toEqual(['/', '/pricing']);
  });

  it('maps FastAPI decorators, dependencies, router prefixes, and include_router mounts', async () => {
    current = await fixture({
      'pyproject.toml': `[project]\nname = "svc"\ndependencies = ["fastapi>=0.100"]\n`,
      'svc/__init__.py': '',
      'svc/main.py': `from fastapi import FastAPI\nfrom .items import router as items_router\nfrom . import admin\n\napp = FastAPI()\n\n@app.get("/healthz")\nasync def health():\n    return {}\n\napp.include_router(items_router, prefix="/api")\napp.include_router(admin.router, prefix="/admin")\n`,
      'svc/items.py': `from fastapi import APIRouter, Depends\nfrom .auth import require_user\n\nrouter = APIRouter(prefix="/v1")\n\n@router.post("/items", dependencies=[Depends(require_user)])\ndef create_item(payload: dict):\n    return payload\n\n@router.api_route("/items/{item_id}", methods=["GET", "DELETE"])\ndef item(item_id: int):\n    return item_id\n`,
      'svc/admin.py': `from fastapi import APIRouter\nrouter = APIRouter()\n\n@router.get("/stats")\ndef stats():\n    return {}\n`,
      'svc/auth.py': `def require_user():\n    return True\n`,
    });
    const api = await apiInventory({ path: current.repo });
    expect(api).toMatchObject({ status: 'complete', frameworks: ['fastapi'], totalApis: 5 });
    if (!('apis' in api) || !api.apis) throw new Error('missing apis');
    expect(byPath(api.apis, 'GET', '/healthz')).toMatchObject({ handler: { file: 'svc/main.py', symbol: 'health' }, classification: 'observed', confidence: 'high', evidence: { line: 7, method: 'fastapi_decorator' } });
    expect(byPath(api.apis, 'POST', '/api/v1/items')).toMatchObject({ handler: { symbol: 'create_item' }, middleware: ['require_user'], mountedAt: '/api', classification: 'inferred', confidence: 'medium' });
    expect(byPath(api.apis, 'DELETE', '/api/v1/items/{item_id}')).toMatchObject({ dynamic: true, handler: { symbol: 'item' } });
    expect(byPath(api.apis, 'GET', '/admin/stats')).toMatchObject({ mountedAt: '/admin', handler: { symbol: 'stats' } });
  });

  it('maps Flask routes and blueprints and Django url patterns with includes', async () => {
    current = await fixture({
      'requirements.txt': 'flask\n',
      'app.py': `from flask import Flask\nfrom admin import bp\napp = Flask(__name__)\napp.register_blueprint(bp)\n\n@app.route("/login", methods=["POST"])\ndef login():\n    return ""\n\n@app.get("/")\ndef index():\n    return ""\n`,
      'admin.py': `from flask import Blueprint\nbp = Blueprint("admin", __name__, url_prefix="/admin")\n\n@bp.get("/users")\ndef users():\n    return ""\n`,
    });
    const flask = await apiInventory({ path: current.repo });
    if (!('apis' in flask) || !flask.apis) throw new Error('missing apis');
    expect(flask).toMatchObject({ frameworks: ['flask'], totalApis: 3 });
    expect(byPath(flask.apis, 'POST', '/login')).toMatchObject({ handler: { symbol: 'login' }, confidence: 'high' });
    expect(byPath(flask.apis, 'GET', '/admin/users')).toMatchObject({ handler: { symbol: 'users' } });
    await current.cleanup();
    current = await fixture({
      'requirements.txt': 'Django==5.0\n',
      'project/urls.py': `from django.urls import include, path\nfrom django.contrib import admin\nurlpatterns = [\n    path('admin/', admin.site.urls),\n    path('blog/', include('blog.urls')),\n]\n`,
      'blog/urls.py': `from django.urls import path\nfrom . import views\nurlpatterns = [\n    path('posts/', views.post_list, name='posts'),\n    path('posts/<int:pk>/', views.PostDetail.as_view()),\n]\n`,
      'blog/views.py': `def post_list(request):\n    return None\n\nclass PostDetail:\n    pass\n`,
    });
    const django = await routeInventory({ path: current.repo });
    if (!('routes' in django) || !django.routes) throw new Error('missing routes');
    expect(django).toMatchObject({ frameworks: ['django'], totalRoutes: 3 });
    expect(byPath(django.routes, 'ANY', '/blog/posts/')).toMatchObject({ handler: { symbol: 'post_list' }, mountedAt: '/blog/', classification: 'inferred', confidence: 'medium', resolutionMethod: 'django_urlpattern+include' });
    expect(byPath(django.routes, 'ANY', '/blog/posts/<int:pk>/')).toMatchObject({ handler: { symbol: 'PostDetail' }, dynamic: true });
    expect(byPath(django.routes, 'ANY', '/admin/')).toMatchObject({ handler: { symbol: 'urls' }, classification: 'observed' });
  });

  it('does not claim routes without framework dependency evidence', async () => {
    current = await fixture({ 'package.json': JSON.stringify({ name: 'lib', dependencies: {} }), 'src/server.ts': `const app = express();\napp.get('/ghost', () => {});\n` });
    expect(await apiInventory({ path: current.repo })).toMatchObject({ status: 'unsupported', frameworks: [], apis: [] });
    expect(await routeInventory({ path: current.repo })).toMatchObject({ status: 'unsupported', routes: [], message: expect.stringContaining('not claimed') });
  });
});
