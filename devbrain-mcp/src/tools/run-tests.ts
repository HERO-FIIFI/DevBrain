import {z} from 'zod'; import {runCapability} from './run-common.js';
export const runTestsInput=z.object({path:z.string().optional(),timeoutMs:z.number().int().min(1).max(1_800_000).optional()});
export const runTests=(input:z.infer<typeof runTestsInput>)=>runCapability(input,'test');
