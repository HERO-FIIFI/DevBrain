/* global process, console */
import {spawn} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root=process.cwd();
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const temporary=await mkdtemp(path.join(os.tmpdir(),'devbrain-package-'));
const project=path.join(temporary,'clean project with spaces');
const runner=path.join(temporary,'temporary npx runner');
const durableHome=path.join(temporary,'durable home with spaces');
const packDirectory=path.join(temporary,'package output');
const cache=path.join(temporary,'temporary npm cache');
const npmCli=process.env.npm_execpath??path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const environment={...process.env,HOME:durableHome,USERPROFILE:durableHome,npm_config_cache:cache};

function run(executable,args,cwd,env=environment){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let stdout='';let stderr='';
    child.stdout.on('data',chunk=>stdout+=String(chunk));child.stderr.on('data',chunk=>stderr+=String(chunk));child.on('error',reject);
    child.on('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(`COMMAND_FAILED:${executable} ${args.join(' ')}\n${stdout}\n${stderr}`)));
  });
}

try{
  await Promise.all([mkdir(project,{recursive:true}),mkdir(runner,{recursive:true}),mkdir(durableHome,{recursive:true}),mkdir(packDirectory,{recursive:true}),mkdir(cache,{recursive:true})]);
  await run('git',['init'],project);
  const dryRun=await run(process.execPath,[npmCli,'pack','--dry-run','--json','--ignore-scripts','--cache',cache],root);const packagePreview=JSON.parse(dryRun.stdout);const publishedPaths=packagePreview[0].files.map(file=>file.path);
  if(publishedPaths.some(file=>/(^|\/)(src|tests|benchmarks|\.codex)(\/|$)|(^|\/)\.env$|credentials?/i.test(file)))throw new Error(`PACKAGE_CONTENT_LEAK:${publishedPaths.join(',')}`);
  await run(process.execPath,[npmCli,'pack','--pack-destination',packDirectory,'--cache',cache],root);
  const filename=`${manifest.name.replace(/^@/,'').replace('/','-')}-${manifest.version}.tgz`;const tarball=path.join(packDirectory,filename);
  await access(tarball);
  await run(process.execPath,[npmCli,'install','--prefix',runner,'--omit=dev','--ignore-scripts','--no-audit','--no-fund',tarball],runner);
  const setup=await run(process.execPath,[npmCli,'exec','--prefix',runner,'--','devbrain-mcp','setup','--workspace',project,'--package',tarball,'--yes','--json'],project);
  const result=JSON.parse(setup.stdout);if(result.status!=='READY'||result.packageVersion!==manifest.version||result.toolCount!==26)throw new Error(`SETUP_RESULT_INVALID:${setup.stdout}`);
  const persistentAdmin=path.join(result.installationRoot,'node_modules',...manifest.name.split('/'),'dist','admin.js');const persistentServer=result.serverPath;
  await Promise.all([access(persistentAdmin),access(persistentServer)]);
  await Promise.all([rm(runner,{recursive:true,force:true}),rm(cache,{recursive:true,force:true}),rm(packDirectory,{recursive:true,force:true})]);
  const doctor=await run(process.execPath,[persistentAdmin,'doctor','--workspace',project,'--json'],project);
  const report=JSON.parse(doctor.stdout);if(report.result!=='READY'||report.mcpToolCount!==26)throw new Error(`FRESH_PROCESS_VALIDATION_FAILED:${doctor.stdout}`);
  const config=await readFile(path.join(project,'.codex','config.toml'),'utf8');if(config.includes(runner)||config.includes(packDirectory)||!config.includes(persistentServer.replaceAll('\\','/')))throw new Error('EPHEMERAL_PATH_LEAK');
  console.log(JSON.stringify({status:'PASS',package:`${manifest.name}@${manifest.version}`,platform:process.platform,projectPathContainsSpaces:true,temporaryRunnerRemoved:true,persistentServer,toolCount:report.mcpToolCount},null,2));
}finally{await rm(temporary,{recursive:true,force:true});}
