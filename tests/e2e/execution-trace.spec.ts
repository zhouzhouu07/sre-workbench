import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../src/main/core/store";
test("Runs displays legacy evidence and exports actual JSON",async({},info)=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-trace-ui-")),file=path.join(dir,"trace.json");const store=new Store(dir,s=>s,s=>s);await store.init();store.put("aiSessions",{id:"trace-test",title:"历史巡检证据",instruction:"巡检",providerId:"model",target:{kind:"ssh",hostId:"host",root:"/",sudo:false},permission:"readonly",createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:10Z",status:"completed",summary:"已采集资源，未测试业务",steps:[{id:"observe",createdAt:"2026-09-30T00:00:05Z",status:"succeeded",summary:"读取资源",call:{tool:"host_resources",arguments:{}},output:'{"code":0,"stdout":"test evidence"}'}],maxSteps:10,verification:["observe"]});store.close();const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},file);const page=await app.firstWindow();await page.getByRole("menuitem",{name:"Agent Studio"}).click();await page.getByRole("tab",{name:"Runs · 执行记录"}).click();await page.getByRole("combobox",{name:"选择执行记录"}).click();await page.getByText(/Agent · 历史巡检证据 · completed/).last().click();await expect(page.getByText("未采集",{exact:true})).toBeVisible();await page.getByRole("button",{name:"导出 Trace JSON"}).click();await expect.poll(async()=>{try{return JSON.parse(await readFile(file,"utf8")).id;}catch{return "";}}).toBe("trace-test");await page.screenshot({path:info.outputPath("execution-trace.png"),fullPage:true});
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
