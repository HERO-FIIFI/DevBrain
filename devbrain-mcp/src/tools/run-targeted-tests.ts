import {z} from 'zod'; import {runCapability} from './run-common.js';
export const runTargetedTestsInput=z.object({path:z.string().optional(),target:z.string().min(1).max(1_000),timeoutMs:z.number().int().min(1).max(600_000).optional()});
export const runTargetedTests=(input:z.infer<typeof runTargetedTestsInput>)=>runCapability(input,'targeted_test');
