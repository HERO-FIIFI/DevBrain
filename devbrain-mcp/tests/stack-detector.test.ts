import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectStack } from '../src/lib/stack-detector.js';

const fixture = (name: string) => path.join(process.cwd(), 'fixtures', name);
describe('stack detector', () => {
  it.each([
    ['npm-react', ['npm'], ['React'], ['TypeScript'], 'single-package'],
    ['pnpm-monorepo', ['pnpm'], ['React'], ['TypeScript'], 'monorepo'],
    ['python-pip', ['pip'], ['FastAPI'], ['Python'], 'single-package'],
    ['python-poetry', ['poetry'], ['Django'], ['Python'], 'single-package'],
    ['mixed-stack', ['npm', 'yarn', 'pip'], ['Express', 'Flask'], ['JavaScript', 'Python'], 'single-package'],
    ['unknown', [], [], [], 'single-package'],
  ] as const)('detects %s', async (name, managers, frameworks, languages, repositoryType) => {
    const result = await detectStack(fixture(name));
    expect(result.packageManagers).toEqual(managers); expect(result.frameworks).toEqual(frameworks);
    expect(result.languages).toEqual(languages); expect(result.repositoryType).toBe(repositoryType);
  });
});
