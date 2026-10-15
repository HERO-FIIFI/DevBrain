import { z } from 'zod';
import { HARD_CONTEXT_LIMITS, boundedInteger } from '../context/budgets.js';
import { findSymbols, type SymbolKind } from '../context/symbols.js';
import { contextRoot, repositorySource } from '../context/repository.js';
import { failure } from './common.js';

const kinds=['function','method','class','interface','type','enum','variable'] as const;
const symbolSchema=z.object({symbol:z.string(),kind:z.enum(kinds),file:z.string(),startLine:z.number().int(),endLine:z.number().int(),language:z.string(),resolutionMethod:z.literal('heuristic'),confidence:z.literal('medium'),source:z.object({type:z.literal('repository_file'),trust:z.literal('untrusted_content')})});
export const searchSymbolsInput=z.object({path:z.string().optional(),query:z.string().min(1).max(200),kind:z.enum(kinds).optional(),maxResults:z.number().int().min(1).max(HARD_CONTEXT_LIMITS.maxSearchResults).optional()});
export const searchSymbolsOutput=z.object({status:z.enum(['complete','partial','error']),query:z.string().optional(),repositoryRoot:z.string().optional(),symbols:z.array(symbolSchema).optional(),totalSymbols:z.number().int().optional(),returnedSymbols:z.number().int().optional(),scannedFiles:z.number().int().optional(),ignoredFiles:z.number().int().optional(),truncated:z.boolean().optional(),errorCode:z.string().optional(),message:z.string().optional()});
export async function searchSymbols(input:z.infer<typeof searchSymbolsInput>){try{const root=await contextRoot(input.path),limit=boundedInteger(input.maxResults,50,HARD_CONTEXT_LIMITS.maxSearchResults,'max_results');const result=await findSymbols(root.repositoryRoot,root.gitRepository,input.query,input.kind as SymbolKind|undefined,limit);const symbols=result.symbols.map((symbol)=>({...symbol,source:repositorySource})),truncated=result.total>symbols.length;return{status:truncated?'partial' as const:'complete' as const,query:input.query,repositoryRoot:root.repositoryRoot,symbols,totalSymbols:result.total,returnedSymbols:symbols.length,scannedFiles:result.scannedFiles,ignoredFiles:result.ignoredFiles,truncated};}catch(error){return failure(error,'SEARCH_SYMBOLS_FAILED');}}
