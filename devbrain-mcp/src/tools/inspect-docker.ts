import path from 'node:path';
import {z} from 'zod';
import {isWithin} from '../lib/filesystem.js';
import {runProcess,type ProcessOptions,type ProcessResult} from '../lib/process-runner.js';
import {failure,toolRoot} from './common.js';

type Runner=(options:ProcessOptions)=>Promise<ProcessResult>;
export const inspectDockerInput=z.object({path:z.string().optional(),limit:z.number().int().min(1).max(100).default(50)});
const mountSchema=z.object({type:z.string(),source:z.string(),destination:z.string(),mode:z.string()});
export const inspectDockerOutput=z.object({status:z.enum(['complete','partial','unsupported','error']),dockerAvailable:z.boolean().optional(),repositoryRoot:z.string().optional(),version:z.object({client:z.string().optional(),server:z.string().optional()}).optional(),containers:z.array(z.object({id:z.string(),name:z.string(),image:z.string(),state:z.string(),status:z.string(),health:z.string().optional(),ports:z.array(z.string()),composeProject:z.string().optional(),mounts:z.array(mountSchema)})).optional(),images:z.array(z.object({repository:z.string(),tag:z.string(),id:z.string(),size:z.string()})).optional(),containerTotal:z.number().int().optional(),imageTotal:z.number().int().optional(),returnedCount:z.number().int().optional(),limit:z.number().int().optional(),truncated:z.boolean().optional(),errorCode:z.string().optional(),message:z.string().optional()});

const jsonLines=(text:string)=>text.split(/\r?\n/).filter(Boolean).map((line)=>JSON.parse(line));
export async function inspectDocker(input:z.input<typeof inspectDockerInput>,runner:Runner=runProcess){
  try{
    const parsed=inspectDockerInput.parse(input);let repositoryRoot:string|undefined;if(parsed.path)repositoryRoot=(await toolRoot(parsed.path)).repositoryRoot;
    const cwd=repositoryRoot??process.cwd();const version=await runner({executable:'docker',args:['version','--format','{{json .}}'],cwd,timeoutMs:10_000,maxStdoutBytes:100_000,maxStderrBytes:100_000});
    if(version.status==='error'||version.status==='failed')return{status:'unsupported',dockerAvailable:false,message:'Docker is unavailable'};
    if(version.status!=='completed')return{status:'partial',dockerAvailable:false,message:'Docker inspection timed out or exceeded output bounds'};
    const versionData=JSON.parse(version.stdout.trim()||'{}');
    const containersResult=await runner({executable:'docker',args:['ps','-a','--no-trunc','--format','{{json .}}'],cwd,timeoutMs:10_000,maxStdoutBytes:1_000_000,maxStderrBytes:100_000});
    const imagesResult=await runner({executable:'docker',args:['images','--no-trunc','--format','{{json .}}'],cwd,timeoutMs:10_000,maxStdoutBytes:1_000_000,maxStderrBytes:100_000});
    const rows=containersResult.status==='completed'?jsonLines(containersResult.stdout):[];const ids=rows.map((row:any)=>String(row.ID??row.Id)).filter(Boolean);
    const inspectResult=ids.length?await runner({executable:'docker',args:['inspect',...ids.slice(0,parsed.limit)],cwd,timeoutMs:10_000,maxStdoutBytes:2_000_000,maxStderrBytes:100_000}):null;
    const details:Record<string,any>=Object.fromEntries(inspectResult?.status==='completed'?(JSON.parse(inspectResult.stdout) as any[]).map((item)=>[String(item.Id).toLowerCase(),item]):[]);
    const sanitize=(source:string)=>repositoryRoot&&isWithin(repositoryRoot,path.resolve(source))?`[repository]/${path.relative(repositoryRoot,path.resolve(source)).replaceAll('\\','/')}`:'[host-path]';
    const containers=rows.slice(0,parsed.limit).map((row:any)=>{const detail=details[String(row.ID??row.Id).toLowerCase()]??Object.values(details).find((item:any)=>String(item.Id).startsWith(String(row.ID??row.Id)));return{id:String(row.ID??row.Id),name:String(row.Names??row.Name??''),image:String(row.Image??''),state:String(row.State??detail?.State?.Status??''),status:String(row.Status??''),...(detail?.State?.Health?.Status?{health:String(detail.State.Health.Status)}:{}),ports:String(row.Ports??'').split(',').map((item)=>item.trim()).filter(Boolean),...(String(row.Labels??'').match(/(?:^|,)com\.docker\.compose\.project=([^,]+)/)?.[1]?{composeProject:String(row.Labels).match(/(?:^|,)com\.docker\.compose\.project=([^,]+)/)![1]}:{}),mounts:(detail?.Mounts??[]).slice(0,20).map((mount:any)=>({type:String(mount.Type??''),source:sanitize(String(mount.Source??'')),destination:String(mount.Destination??''),mode:String(mount.Mode??'')}))};});
    const imageRows=imagesResult.status==='completed'?jsonLines(imagesResult.stdout):[];const images=imageRows.slice(0,parsed.limit).map((row:any)=>({repository:String(row.Repository??''),tag:String(row.Tag??''),id:String(row.ID??row.Id??''),size:String(row.Size??'')}));
    const partial=containersResult.status!=='completed'||imagesResult.status!=='completed'||(inspectResult!==null&&inspectResult.status!=='completed');
    return{status:partial?'partial':'complete',dockerAvailable:true,...(repositoryRoot?{repositoryRoot}:{}),version:{client:versionData.Client?.Version,server:versionData.Server?.Version},containers,images,containerTotal:rows.length,imageTotal:imageRows.length,returnedCount:containers.length+images.length,limit:parsed.limit,truncated:rows.length>containers.length||imageRows.length>images.length};
  }catch(error){return failure(error,'DOCKER_INSPECTION_FAILED');}
}
