import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../src/main/core/store";
test("Runs displays legacy evidence and exports actual JSON",async({},info)=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-trace-ui-")),file=path.join(dir,"trace.json");const store=new Store(dir,s=>s,s=>s);await store.init();store.put("aiSessions",{id:"trace-test",title:"历史巡检证据",instruction:"巡检",providerId:"model",target:{kind:"ssh",hostId:"host",root:"/",sudo:false},permission:"readonly",createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:10Z",status:"completed",summary:"已采集资源，未测试业务",steps:[{id:"observe",createdAt:"2026-09-30T00:00:05Z",status:"succeeded",summary:"读取资源",call:{tool:"host_resources",arguments:{}},output:'{"code":0,"stdout":"test evidence"}'}],maxSteps:10,verification:["observe"]});store.close();const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},file);const page=await app.firstWindow();await page.getByRole("menuitem",{name:"Agent Studio"}).click();await page.getByRole("tab",{name:"Runs · 执行记录"}).click();await page.getByRole("combobox",{name:"选择执行记录"}).click();await page.getByText(/Agent · 历史巡检证据/).last().click();await expect(page.getByText("未采集",{exact:true})).toBeVisible();await page.getByRole("searchbox",{name:"搜索执行事件"}).fill("host_resources");const evidenceRow=page.getByRole("row").filter({hasText:"observe"});await expect(evidenceRow).toContainText("成功");await evidenceRow.getByRole("button",{name:/展开|Expand/}).click();await expect(page.locator(".trace-event-detail")).toContainText("test evidence");await page.getByRole("button",{name:"导出 Trace JSON"}).click();await expect.poll(async()=>{try{return JSON.parse(await readFile(file,"utf8")).id;}catch{return "";}}).toBe("trace-test");await page.screenshot({path:info.outputPath("execution-trace.png"),fullPage:true});
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test("switching runs cannot replace the selected evidence with a delayed previous response",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-trace-race-"));
 const store=new Store(dir,s=>s,s=>s);await store.init();
 for(const id of ["slow","current"])store.put("aiSessions",{id,title:`${id} evidence`,instruction:"synthetic",providerId:"none",target:{kind:"ssh",hostId:"none",root:"/",sudo:false},permission:"readonly",createdAt:"2026-10-01T00:00:00Z",updatedAt:"2026-10-01T00:00:10Z",status:"completed",summary:`${id} summary`,steps:[],maxSteps:10,verification:[]});
 store.close();const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{
  const page=await app.firstWindow();
  await app.evaluate(({ipcMain})=>{
   const globals=globalThis as any,original=(ipcMain as any)._invokeHandlers.get("sre:call");ipcMain.removeHandler("sre:call");
   ipcMain.handle("sre:call",async(e,method,params)=>{
    if(method==="studio.trace.get"&&params.id==="slow"){
     await new Promise<void>(resolve=>{globals.releaseSlowTrace=resolve;});
     const result=await original(e,method,params);globals.slowTraceReturned=true;return result;
    }
    return original(e,method,params);
   });
  });
  await page.getByRole("menuitem",{name:"Agent Studio"}).click();await page.getByRole("tab",{name:"Runs · 执行记录"}).click();
  const select=page.getByRole("combobox",{name:"选择执行记录"});
  await select.click();await page.getByText(/Agent · slow evidence/).last().click();
  await expect.poll(()=>app.evaluate(()=>typeof (globalThis as any).releaseSlowTrace)).toBe("function");
  await select.click();await page.getByText(/Agent · current evidence/).last().click();
  await expect(page.getByRole("heading",{name:"current evidence",exact:true})).toBeVisible();
  await app.evaluate(()=>(globalThis as any).releaseSlowTrace());
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).slowTraceReturned)).toBe(true);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.getByRole("heading",{name:"current evidence",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"slow evidence",exact:true})).toHaveCount(0);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test("Runs exposes a loading error and refresh recovers without stale evidence",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-trace-retry-"));const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{const page=await app.firstWindow();await app.evaluate(({ipcMain})=>{
  const original=(ipcMain as any)._invokeHandlers.get("sre:call");let failed=false;ipcMain.removeHandler("sre:call");ipcMain.handle("sre:call",async(e,method,params)=>{if(method==="studio.trace.list"&&!failed){failed=true;return {ok:false,error:"合成暂时错误"};}return original(e,method,params);});
 });await page.getByRole("menuitem",{name:"Agent Studio"}).click();await page.getByRole("tab",{name:"Runs · 执行记录"}).click();await expect(page.getByText("执行证据加载失败",{exact:true})).toBeVisible();await expect(page.getByText("合成暂时错误",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"导出 Trace JSON"})).toHaveCount(0);await page.getByRole("button",{name:/^刷\s*新$/,exact:true}).click();await expect(page.getByText("执行证据加载失败",{exact:true})).toHaveCount(0);await expect(page.getByText("选择运行查看执行证据",{exact:true})).toBeVisible();
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
