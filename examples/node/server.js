const http = require('node:http');
http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({service:'SRE Node.js example',status:'ok',path:req.url,time:new Date().toISOString()}));
}).listen(Number(process.env.PORT||3000),'0.0.0.0');
