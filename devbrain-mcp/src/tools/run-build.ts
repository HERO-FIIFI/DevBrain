import {z} from 'zod'; import {runCapability} from './run-common.js';
export const runBuildInput=z.object({path:z.string().optional(),timeoutMs:z.number().int().min(1).max(900_000).optional()});
export const runBuild=(input:z.infer<typeof runBuildInput>)=>runCapability(input,'build');
