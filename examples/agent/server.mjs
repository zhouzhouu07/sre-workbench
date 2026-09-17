import { createServer } from 'node:http';
// Development-only loopback example; no SSH access and no command execution.
const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/diagnose'){res.writeHead(404).end();return;}
  let text='';for await(const chunk of req){text+=chunk;if(text.length>200000){res.writeHead(413).end();return;}}
  try{
    const body=JSON.parse(text);if(body.protocolVersion!=='1'||typeof body.instruction!=='string')throw new Error('Invalid request');
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({summary:'这是 Agent 协议示例。建议先收集只读系统信息，再根据具体日志分析。',scripts:[{name:'基础巡检',body:'#!/usr/bin/env bash\nset -euo pipefail\nuptime\nfree -m\ndf -h\n',description:'读取系统负载、内存和磁盘使用率',sudo:false}]}));
  }catch{res.writeHead(400).end('Invalid request');}
});
server.listen(8765,'127.0.0.1',()=>console.log('Agent example: http://127.0.0.1:8765/diagnose'));
