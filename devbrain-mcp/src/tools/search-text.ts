import { z } from 'zod';
import { HARD_CONTEXT_LIMITS, boundedInteger } from '../context/budgets.js';
import { contextRoot, globMatcher, readRepositoryText, redactRepositoryText, repositoryFiles, repositorySource } from '../context/repository.js';
import { failure } from './common.js';

const matchSchema = z.object({ file:z.string(), line:z.number().int(), column:z.number().int(), preview:z.string(), matchType:z.literal('exact'), source:z.object({type:z.literal('repository_file'),trust:z.literal('untrusted_content')}), redacted:z.boolean() });
export const searchTextInput=z.object({path:z.string().optional(),query:z.string().min(1).max(500),maxResults:z.number().int().min(1).max(HARD_CONTEXT_LIMITS.maxSearchResults).optional(),fileGlob:z.string().max(200).optional()});
export const searchTextOutput=z.object({status:z.enum(['complete','partial','error']),query:z.string().optional(),repositoryRoot:z.string().optional(),matches:z.array(matchSchema).optional(),totalMatches:z.number().int().optional(),returnedMatches:z.number().int().optional(),scannedFiles:z.number().int().optional(),ignoredFiles:z.number().int().optional(),truncated:z.boolean().optional(),redactionCount:z.number().int().optional(),errorCode:z.string().optional(),message:z.string().optional()});

export async function searchText(input:z.infer<typeof searchTextInput>){try{
  const root=await contextRoot(input.path),limit=boundedInteger(input.maxResults,50,HARD_CONTEXT_LIMITS.maxSearchResults,'max_results'),matches:any[]=[];let total=0,scannedFiles=0,redactionCount=0;
  const listing=await repositoryFiles(root.repositoryRoot,root.gitRepository),accept=globMatcher(input.fileGlob);
  for(const file of listing.files){if(!accept(file))continue;try{const content=await readRepositoryText(root.repositoryRoot,file);scannedFiles++;for(const [index,line] of content.text.split(/\r?\n/).entries()){let offset=0;while((offset=line.indexOf(input.query,offset))!==-1){total++;if(matches.length<limit){const preview=redactRepositoryText(line.slice(0,300));redactionCount+=preview.redactionCount;matches.push({file,line:index+1,column:offset+1,preview:preview.text,matchType:'exact',source:repositorySource,redacted:preview.redacted});}offset+=Math.max(1,input.query.length);}}}catch{/* skip unreadable/binary */}}
  const truncated=total>matches.length||listing.truncated;return{status:truncated?'partial' as const:'complete' as const,query:input.query,repositoryRoot:root.repositoryRoot,matches,totalMatches:total,returnedMatches:matches.length,scannedFiles,ignoredFiles:listing.ignoredFiles,truncated,redactionCount};
}catch(error){return failure(error,'SEARCH_TEXT_FAILED');}}
