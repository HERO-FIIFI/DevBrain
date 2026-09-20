import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { exclude: ['dist/**', 'node_modules/**', 'fixtures/**', 'benchmarks/**'], testTimeout: 15_000 } });
