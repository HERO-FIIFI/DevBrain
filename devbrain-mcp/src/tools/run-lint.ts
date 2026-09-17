import {z} from 'zod'; import {runCapability} from './run-common.js';
export const runLintInput=z.object({path:z.string().optional(),timeoutMs:z.number().int().min(1).max(300_000).optional()});
export const runLint=(input:z.infer<typeof runLintInput>)=>runCapability(input,'lint');
