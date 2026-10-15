export type TomlScalar=string|boolean|number|string[];
export interface TomlSection{name:string;start:number;end:number;values:Record<string,TomlScalar>}
export interface ParsedCodexConfig{ok:boolean;text:string;sections:TomlSection[];errors:string[]}
export interface DevbrainDefinition{command:string;args:string[];cwd:string;required:boolean;workspaceRoot:string;unknownFields?:string[]}

function cleanLine(line:string):string{const trimmed=line.trim();if(!trimmed||trimmed.startsWith('#'))return '';return line.replace(/\s+#.*$/,'').trim();}

function parseValue(raw:string):TomlScalar{
  const value=raw.trim();
  if(value.startsWith('"')){const parsed=JSON.parse(value);if(typeof parsed!=='string')throw new Error('INVALID_STRING');return parsed;}
  if(value.startsWith('[')){const parsed=JSON.parse(value);if(!Array.isArray(parsed)||!parsed.every(item=>typeof item==='string'))throw new Error('INVALID_ARRAY');return parsed;}
  if(value==='true'||value==='false')return value==='true';
  if(/^-?\d+(?:\.\d+)?$/.test(value))return Number(value);
  throw new Error('UNSUPPORTED_VALUE');
}

export function parseCodexConfig(text:string):ParsedCodexConfig{
  const errors:string[]=[];const sections:TomlSection[]=[];const seen=new Set<string>();
  const matches=[...text.matchAll(/^\s*\[([^\]\r\n]+)\]\s*(?:#.*)?$/gm)];
  const headerLines=(text.match(/^\s*\[/gm)??[]).length;
  if(headerLines!==matches.length)errors.push('MALFORMED_SECTION');
  for(let index=0;index<matches.length;index++){
    const match=matches[index];const name=match[1].trim();if(seen.has(name))errors.push(`DUPLICATE_SECTION:${name}`);seen.add(name);
    const start=match.index!;const bodyStart=start+match[0].length;const end=matches[index+1]?.index??text.length;const values:Record<string,TomlScalar>={};
    for(const line of text.slice(bodyStart,end).split(/\r?\n/)){
      const clean=cleanLine(line);if(!clean)continue;
      const assignment=/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(clean);if(!assignment){errors.push(`MALFORMED_ASSIGNMENT:${name}`);continue;}
      try{values[assignment[1]]=parseValue(assignment[2]);}catch{errors.push(`MALFORMED_VALUE:${name}.${assignment[1]}`);}
    }
    sections.push({name,start,end,values});
  }
  const prefix=text.slice(0,matches[0]?.index??text.length);
  for(const line of prefix.split(/\r?\n/)){const clean=cleanLine(line);if(clean&&!/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.test(clean))errors.push('MALFORMED_ROOT');else if(clean){const assignment=/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(clean)!;try{parseValue(assignment[2]);}catch{errors.push(`MALFORMED_VALUE:root.${assignment[1]}`);}}}
  return {ok:errors.length===0,text,sections,errors};
}

export function readDevbrainDefinition(parsed:ParsedCodexConfig):DevbrainDefinition|null{
  if(!parsed.ok)return null;const main=parsed.sections.find(item=>item.name==='mcp_servers.devbrain');if(!main)return null;const env=parsed.sections.find(item=>item.name==='mcp_servers.devbrain.env');
  const command=main.values.command,args=main.values.args,cwd=main.values.cwd,required=main.values.required,workspaceRoot=env?.values.DEVBRAIN_WORKSPACE_ROOT;
  if(typeof command!=='string'||!Array.isArray(args)||typeof cwd!=='string'||typeof required!=='boolean'||typeof workspaceRoot!=='string')return null;
  const knownMain=new Set(['command','args','cwd','required']);const knownEnv=new Set(['DEVBRAIN_WORKSPACE_ROOT']);
  const unknownFields=[...Object.keys(main.values).filter(key=>!knownMain.has(key)),...Object.keys(env?.values??{}).filter(key=>!knownEnv.has(key)).map(key=>`env.${key}`)];
  return {command,args,cwd,required,workspaceRoot,...(unknownFields.length?{unknownFields}:{})};
}

const quote=(value:string)=>JSON.stringify(value.replace(/\\/g,'/'));
export function renderDevbrainDefinition(definition:DevbrainDefinition):string{return `[mcp_servers.devbrain]\ncommand = ${quote(definition.command)}\nargs = [${definition.args.map(quote).join(', ')}]\ncwd = ${quote(definition.cwd)}\nrequired = ${definition.required}\n\n[mcp_servers.devbrain.env]\nDEVBRAIN_WORKSPACE_ROOT = ${quote(definition.workspaceRoot)}\n`;}
