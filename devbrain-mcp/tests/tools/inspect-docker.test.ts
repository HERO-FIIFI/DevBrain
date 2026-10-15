import {describe,expect,it} from 'vitest';
import {inspectDocker} from '../../src/tools/inspect-docker.js';

describe('Docker inspection',()=>{
  it('returns unsupported when Docker is unavailable',async()=>{const result=await inspectDocker({},async()=>({status:'error',exitCode:null,signal:null,stdout:'',stderr:'',timedOut:false,outputTruncated:false,error:'ENOENT'}));expect(result).toMatchObject({status:'unsupported',dockerAvailable:false});});
  it('returns bounded observational metadata without environment values or unrelated host paths',async()=>{
    const outputs=[{stdout:'{"Client":{"Version":"27.0"},"Server":{"Version":"27.0"}}\n'},{stdout:'{"ID":"abc","Names":"web","Image":"app:latest","State":"running","Status":"Up","Ports":"0.0.0.0:8080->80/tcp","Labels":"com.docker.compose.project=sample"}\n'},{stdout:'{"Repository":"app","Tag":"latest","ID":"sha256:1","Size":"10MB"}\n'},{stdout:'[{"Id":"abc","State":{"Status":"running","Health":{"Status":"healthy"}},"Mounts":[{"Type":"bind","Source":"C:/Users/private/project/data","Destination":"/data","Mode":"ro"}],"Config":{"Env":["TOKEN=supersecret"]}}]\n'}];let i=0;
    const result=await inspectDocker({},async()=>({status:'completed',exitCode:0,signal:null,stdout:outputs[i++].stdout,stderr:'',timedOut:false,outputTruncated:false}));expect(result).toMatchObject({status:'complete',dockerAvailable:true,containers:[{id:'abc',health:'healthy',mounts:[{type:'bind',source:'[host-path]',destination:'/data',mode:'ro'}]}]});expect(JSON.stringify(result)).not.toContain('supersecret');expect(JSON.stringify(result)).not.toContain('Users/private');
  });
});
