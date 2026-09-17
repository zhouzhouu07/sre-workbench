import {it,expect} from 'vitest';import {Server} from 'ssh2';import {generateKeyPairSync} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Backend} from '../src/main/core/backend';
it('probes without authentication, authenticates only after explicit trust, fails closed after key change',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});let auths=0;
 const server=new Server({hostKeys:[privateKey.export({type:'pkcs1',format:'pem'})]},client=>{client.on('error',()=>{});client.on('authentication',ctx=>{auths++;if(ctx.method==='password'&&ctx.password==='test-secret')ctx.accept();else ctx.reject();});client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('exec',(accept,reject,info)=>{const stream=accept();stream.write('hello test-secret');stream.exit(0);stream.end();});}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(typeof address==='string'||!address)throw new Error('listen');
 const dataDir=mkdtempSync(join(tmpdir(),'sre-ssh-'));const b=new Backend({dataDir,encrypt:s=>s,decrypt:s=>s,emit:()=>{},chooseFile:async()=>null});await b.init();
 try{const host=await b.handle('host.save',{name:'test',address:'127.0.0.1',port:address.port,username:'test',authType:'password',password:'test-secret'});
  await expect(b.ssh.exec(host.id,'echo x')).rejects.toThrow('指纹');expect(auths).toBe(0);
  const probe=await b.handle('host.probe',{id:host.id});expect(auths).toBe(0);expect(probe.fingerprint).toMatch(/^SHA256:/);
  await b.handle('host.trust',{id:host.id,fingerprint:probe.fingerprint});const result=await b.ssh.exec(host.id,'echo x');expect(result.code).toBe(0);expect(result.stdout).toBe('hello [REDACTED]');
  b.store.put('hosts',{...b.ssh.host(host.id),fingerprint:'SHA256:wrong'});await expect(b.ssh.exec(host.id,'echo x')).rejects.toThrow('密钥发生变化');
 }finally{await b.close();await new Promise<void>(r=>server.close(()=>r()));rmSync(dataDir,{recursive:true,force:true});}
},15000);
