import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../src/main/core/store";
test("workflow canvas edits connections and runs a persisted bounded wait without remote mutations",async({},info)=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-flow-ui-"));const store=new Store(dir,s=>s,s=>s);await store.init();store.put("hosts",{id:"host",name:"Workflow测试目标",address:"192.0.2.10",port:22,username:"root",fingerprint:"test",credentialId:"",authType:"password",group:"",tags:[]});store.close();
 const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{const page=await app.firstWindow();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.getByRole("menuitem",{name:"Agent Studio"}).click();await page.getByRole("tab",{name:"Workflows · 流程"}).click();await page.getByRole("button",{name:"新建流程"}).click();
 await page.getByRole("textbox",{name:"工作流名称",exact:true}).fill("图编辑器验收");await page.getByRole("button",{name:"+ Wait",exact:true}).click();
 await page.getByRole("textbox",{name:"节点配置JSON"}).fill('{"seconds":0}');await page.getByRole("button",{name:"应用节点配置"}).click();
 await page.getByRole("combobox",{name:"下一节点"}).click();await page.getByText("结束 (end)",{exact:true}).click();
 await page.getByRole("button",{name:"节点 start",exact:true}).press("Enter");await page.getByRole("combobox",{name:"下一节点"}).click();await page.getByText("Wait (wait3)",{exact:true}).click();
 await page.getByRole("button",{name:"验证流程"}).click();await expect(page.getByText("流程结构验证通过",{exact:true})).toBeVisible();await page.getByRole("button",{name:"保存流程"}).click();await expect(page.getByText("流程已保存",{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath("workflow-canvas.png"),fullPage:true});await page.getByRole("button",{name:"运行流程",exact:true}).click();await page.getByRole("combobox",{name:"流程目标服务器"}).click();await page.getByText("Workflow测试目标",{exact:true}).click();await page.getByRole("button",{name:"启动流程",exact:true}).click();
 await expect(page.getByText("流程结束，已完成实际节点及独立验收要求",{exact:true}).first()).toBeVisible();expect(errors).toEqual([]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
