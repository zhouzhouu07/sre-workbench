import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("agent builder saves, versions, clones and removes custom definitions",async({},info)=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-builder-ui-"));const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{const page=await app.firstWindow();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.getByRole("menuitem",{name:"Agent Studio"}).click();await page.getByRole("tab",{name:"Agents · 助手"}).click();
 await page.getByRole("button",{name:"新建 Agent"}).click();await page.getByLabel("名称",{exact:true}).fill("测试巡检助手");await page.getByRole("button",{name:"保存 Agent"}).click();
 const row=page.getByRole("row").filter({hasText:"测试巡检助手"});await expect(row).toHaveCount(1);await expect(row).toContainText("1.0.0");
 await row.getByRole("button",{name:/^编\s*辑$/}).click();await page.getByLabel("描述",{exact:true}).fill("版本更新验证");await page.getByRole("button",{name:"保存 Agent"}).click();await expect(row).toContainText("1.0.1");
 await row.getByRole("button",{name:/^克\s*隆$/}).click();const copy=page.getByRole("row").filter({hasText:"测试巡检助手 副本"});await expect(copy).toHaveCount(1);await expect(copy.getByRole("switch")).not.toBeChecked();
 await page.screenshot({path:info.outputPath("agent-builder.png"),fullPage:true});await copy.getByRole("button",{name:/^删\s*除$/}).click();await page.getByRole("button",{name:"确 定"}).click();await expect(copy).toHaveCount(0);expect(errors).toEqual([]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
