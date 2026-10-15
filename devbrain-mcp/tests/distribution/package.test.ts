import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';

describe('npm distribution contract',()=>{
  it('publishes only runtime artifacts with the setup CLI as the default executable',async()=>{
    const manifest=JSON.parse(await readFile('package.json','utf8'));
    expect(manifest).toMatchObject({
      name:'devbrain-mcp',
      version:'0.6.0-rc.1',
      private:false,
      license:'UNLICENSED',
      bin:{devbrain:'dist/admin.js','devbrain-mcp':'dist/admin.js','devbrain-mcp-server':'dist/index.js'},
      files:expect.arrayContaining(['dist','README.md']),
      engines:{node:'>=20'},
    });
    expect(manifest.scripts.prepack).toBe('npm run build');
  });
});
