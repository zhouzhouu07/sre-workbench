import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/main/core/store';
import { ApprovalBook, shellQuote, HostScheduler } from '../src/main/core/safety';
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
describe('core safety',()=>{
 it('quotes shell metacharacters without executing them',()=>expect(shellQuote("a'$(touch /tmp/pwn);b")).toBe("'a'\"'\"'$(touch /tmp/pwn);b'"));
 it('binds approvals to exact script and host identity and consumes once',()=>{
  const book=new ApprovalBook(); const spec={hostId:'h',title:'x',script:'echo hi',sudo:false,timeout:60};
  const token=book.issue(spec,'identity');
  expect(()=>book.consume(token,{...spec,script:'rm -rf /'},'identity')).toThrow();
  const t=book.issue(spec,'identity'); book.consume(t,spec,'identity'); expect(()=>book.consume(t,spec,'identity')).toThrow();
  expect(()=>book.consume(book.issue(spec,'identity'),spec,'other')).toThrow();
 });
 it('limits concurrency to three and serializes each host',async()=>{
  const scheduler=new HostScheduler(3); let running=0,max=0; const active=new Set<string>(); const order:string[]=[];
  await Promise.all(['a','a','b','c','d'].map((host,i)=>scheduler.schedule(host,async()=>{
   expect(active.has(host)).toBe(false);active.add(host);running++;max=Math.max(max,running);order.push(`${host}${i}`);
   await new Promise(r=>setTimeout(r,10));active.delete(host);running--;
  })));
  expect(max).toBe(3);expect(order.indexOf('a0')).toBeLessThan(order.indexOf('a1'));
 });
 it('persists SQLite records and encrypts credentials without snapshot leaks',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sre-core-'));dirs.push(dir);
  const codec={encrypt:(s:string)=>Buffer.from(s).toString('base64'),decrypt:(s:string)=>Buffer.from(s,'base64').toString()};
  let store=new Store(dir,codec.encrypt,codec.decrypt);await store.init();
  const id=store.setSecret('private-password-123');store.put('hosts',{id:'h',name:'host',credentialId:id});
  expect(store.redact('x private-password-123 y')).toBe('x [REDACTED] y');
  expect(JSON.stringify(store.snapshot())).not.toContain('private-password-123');store.close();
  expect(readFileSync(join(dir,'sre.sqlite')).includes(Buffer.from('private-password-123'))).toBe(false);
  store=new Store(dir,codec.encrypt,codec.decrypt);await store.init();expect(store.getSecret(id)).toBe('private-password-123');expect(store.list('hosts')).toHaveLength(1);store.close();
 });
});
