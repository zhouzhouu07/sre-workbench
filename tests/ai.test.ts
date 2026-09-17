import { describe,it,expect } from 'vitest';
import { parseAgentResult, validateApiUrl, sanitizeContext, AIService } from '../src/main/features/ai';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
describe('AI boundary',()=>{
  it('rejects remote plaintext and URL-embedded credentials',()=>{expect(()=>validateApiUrl('http://example.com/v1')).toThrow();expect(()=>validateApiUrl('https://user:pass@example.com')).toThrow();expect(validateApiUrl('http://127.0.0.1:8000')).toBeTruthy();});
  it('parses fenced JSON and refuses malformed script responses',()=>{expect(parseAgentResult('```json\n{"summary":"ok","scripts":[]}\n```')).toEqual({summary:'ok',scripts:[]});expect(()=>parseAgentResult('{"summary":"ok","scripts":[{"body":4}]}')).toThrow();});
  it('redacts PEMs and bearer tokens',()=>{const result=sanitizeContext('Authorization: Bearer abc123\npassword=abc\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----');expect(result).not.toContain('abc123');expect(result).not.toContain('password=abc');expect(result).not.toContain('secret');});
  it('binds outgoing approval to exact content and provider',async()=>{const providers=new Map([['p',{id:'p',kind:'model',baseUrl:'http://localhost:8000/v1',model:'test',timeout:10}]]);const store={get:(_:string,id:string)=>providers.get(id),redact:(s:string)=>s};const ai=new AIService(store as any,()=>{});const preview=await ai.handle('ai.preview',{providerId:'p',instruction:'inspect',context:'logs'});await expect(ai.handle('ai.request',{providerId:'p',...preview,context:'changed',requestId:'r'})).rejects.toThrow(/预览|确认/);});
});
describe('AI HTTP integration',()=>{
  async function service(handler:RequestListener){
    const server=createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    const provider={id:'p',name:'test',kind:'agent',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}/agent`,model:'',timeout:10,credentialId:'key'};
    const store={get:()=>provider,getSecret:()=> 'test-key',redact:(s:string)=>s.replaceAll('test-key','[REDACTED]')};
    return {server,ai:new AIService(store as any,()=>{}),close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
  }
  it('sends approved context, bearer authentication, and parses real HTTP response',async()=>{
    let received:any,authorization:string|undefined;
    const s=await service(async(req,res)=>{authorization=req.headers.authorization;let data='';for await(const chunk of req)data+=chunk;received=JSON.parse(data);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({summary:'分析结果',scripts:[{name:'检查',body:'uptime',description:'只读',sudo:false}]}));});
    try{const preview=await s.ai.handle('ai.preview',{providerId:'p',instruction:'诊断',context:'test-key'});const result=await s.ai.handle('ai.request',{providerId:'p',...preview,requestId:'http-test'});expect(received.context).toBe('[REDACTED]');expect(received.protocolVersion).toBe('1');expect(authorization).toBe('Bearer test-key');expect(result.scripts[0].body).toBe('uptime');await expect(s.ai.handle('ai.request',{providerId:'p',...preview,requestId:'retry'})).rejects.toThrow(/预览/);}finally{await s.close();}
  });
  it('reports HTTP errors without echoing response secrets',async()=>{
    const s=await service((_req,res)=>{res.writeHead(401).end('test-key secret server diagnostics');});
    try{const p=await s.ai.handle('ai.preview',{providerId:'p',instruction:'诊断',context:''});await expect(s.ai.handle('ai.request',{providerId:'p',...p,requestId:'error'})).rejects.toThrow('HTTP 401');}finally{await s.close();}
  });
  it('cancels an in-flight HTTP request',async()=>{
    let reached!:()=>void;const pending=new Promise<void>(r=>reached=r);const s=await service(()=>reached());
    try{const p=await s.ai.handle('ai.preview',{providerId:'p',instruction:'诊断',context:''});const request=s.ai.handle('ai.request',{providerId:'p',...p,requestId:'cancel'});const assertion=expect(request).rejects.toThrow(/取消/);await pending;await s.ai.handle('ai.cancel',{requestId:'cancel'});await assertion;}finally{await s.close();}
  });
});
