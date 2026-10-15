import {describe,expect,it} from 'vitest';
import {analyzeConfigCollisions,removeDevbrainSections,replaceDevbrainSections} from '../../src/lifecycle/config.js';
import {parseCodexConfig,readDevbrainDefinition,renderDevbrainDefinition} from '../../src/lifecycle/toml.js';

const original=`# keep me\nmodel = "gpt"\n\n[mcp_servers.other]\ncommand = "other"\nunknown = 7\n\n[mcp_servers.devbrain]\ncommand = "node"\nargs = ["C:/old/dist/index.js"]\ncwd = "C:/old"\nrequired = true\ncustom = "preserve on read"\n\n[mcp_servers.devbrain.env]\nDEVBRAIN_WORKSPACE_ROOT = "C:/old"\nSECRET_TOKEN = "do-not-print"\n\n[projects."C:/repo"]\ntrust_level = "trusted"\n`;

describe('Codex TOML parsing',()=>{
  it('reads the supported DevBrain definition and reports unknown fields without secrets',()=>{const parsed=parseCodexConfig(original);expect(parsed.ok).toBe(true);expect(readDevbrainDefinition(parsed)).toMatchObject({command:'node',args:['C:/old/dist/index.js'],cwd:'C:/old',required:true,workspaceRoot:'C:/old',unknownFields:['custom','env.SECRET_TOKEN']});expect(JSON.stringify(readDevbrainDefinition(parsed))).not.toContain('do-not-print');});
  it('rejects malformed TOML and duplicate relevant sections',()=>{expect(parseCodexConfig('[mcp_servers.devbrain\ncommand="node"').ok).toBe(false);expect(parseCodexConfig('[mcp_servers.devbrain]\ncommand="node"\n[mcp_servers.devbrain]\ncommand="x"').ok).toBe(false);expect(parseCodexConfig('[x]\na = ["unterminated"').ok).toBe(false);});
  it('renders a parseable canonical definition',()=>{const text=renderDevbrainDefinition({command:'node',args:['C:/Program Files/DevBrain/dist/index.js'],cwd:'C:/My App',required:true,workspaceRoot:'C:/My App'});expect(readDevbrainDefinition(parseCodexConfig(text))).toMatchObject({cwd:'C:/My App',required:true,workspaceRoot:'C:/My App'});});
});

describe('lossless DevBrain section editing',()=>{
  it('replaces only owned sections and preserves unrelated configuration byte-for-byte',()=>{const replacement=renderDevbrainDefinition({command:'node',args:['C:/new/dist/index.js'],cwd:'C:/repo',required:true,workspaceRoot:'C:/repo'});const edited=replaceDevbrainSections(original,replacement);expect(edited).toContain('# keep me\nmodel = "gpt"');expect(edited).toContain('[mcp_servers.other]\ncommand = "other"\nunknown = 7');expect(edited).toContain('[projects."C:/repo"]\ntrust_level = "trusted"');expect(edited).not.toContain('C:/old');expect(parseCodexConfig(edited).ok).toBe(true);});
  it('removes only DevBrain sections during uninstall',()=>{const edited=removeDevbrainSections(original);expect(edited).not.toContain('[mcp_servers.devbrain]');expect(edited).not.toContain('SECRET_TOKEN');expect(edited).toContain('[mcp_servers.other]');expect(edited).toContain('[projects."C:/repo"]');});
  it('detects equivalent duplicates and conflicting definitions across scopes',()=>{const definition={command:'node',args:['x'],cwd:'C:/repo',required:true,workspaceRoot:'C:/repo'};expect(analyzeConfigCollisions([{file:'a',scope:'global',definition},{file:'b',scope:'repository',definition}]).kind).toBe('duplicate');expect(analyzeConfigCollisions([{file:'a',scope:'global',definition},{file:'b',scope:'repository',definition:{...definition,cwd:'C:/other'}}]).kind).toBe('conflict');});
});
