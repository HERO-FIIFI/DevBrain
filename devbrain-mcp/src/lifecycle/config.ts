import type {ConfigScope} from './discovery.js';
import {parseCodexConfig,type DevbrainDefinition} from './toml.js';

const owned=new Set(['mcp_servers.devbrain','mcp_servers.devbrain.env']);
function requireParse(text:string){const parsed=parseCodexConfig(text);if(!parsed.ok)throw new Error(`MALFORMED_TOML:${parsed.errors.join(',')}`);return parsed;}
function strip(text:string):string{const parsed=requireParse(text);const ranges=parsed.sections.filter(item=>owned.has(item.name)).map(({start,end})=>({start,end})).sort((a,b)=>b.start-a.start);let result=text;for(const range of ranges)result=result.slice(0,range.start)+result.slice(range.end);return result.replace(/\s+$/,'');}
export function replaceDevbrainSections(text:string,replacement:string):string{requireParse(replacement);const base=strip(text);return `${base}${base?'\n\n':''}${replacement.trim()}\n`;}
export function removeDevbrainSections(text:string):string{const base=strip(text);return base?`${base}\n`:'';}

export interface ConfigDefinitionSource{file:string;scope:ConfigScope;definition:DevbrainDefinition}
export interface CollisionAnalysis{kind:'none'|'single'|'duplicate'|'conflict';files:string[]}
function stable(definition:DevbrainDefinition):string{return JSON.stringify({command:definition.command,args:definition.args,cwd:definition.cwd.replace(/\\/g,'/').toLowerCase(),required:definition.required,workspaceRoot:definition.workspaceRoot.replace(/\\/g,'/').toLowerCase()});}
export function analyzeConfigCollisions(items:ConfigDefinitionSource[]):CollisionAnalysis{if(!items.length)return {kind:'none',files:[]};if(items.length===1)return {kind:'single',files:[items[0].file]};return {kind:new Set(items.map(item=>stable(item.definition))).size===1?'duplicate':'conflict',files:items.map(item=>item.file)};}
