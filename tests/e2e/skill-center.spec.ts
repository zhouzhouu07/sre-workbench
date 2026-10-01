import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("skills center installs a package and exposes it in agent configuration",async({},info)=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-skill-ui-"));const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},path.resolve("examples/skill-packages/web-diagnosis"));
 const page=await app.firstWindow();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.getByRole("menuitem",{name:"Agent Studio"}).click();await page.getByRole("tab",{name:"Skills · 技能"}).click();
 await page.getByRole("button",{name:"导入 / 升级技能包"}).click();await expect(page.getByText("审阅技能包",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"安装（默认禁用）"}).click();const toggle=page.getByRole("switch",{name:"启用技能 custom.web-diagnosis"});await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked();
 await page.getByRole("button",{name:"Web服务证据巡检",exact:true}).click();await expect(page.getByRole("dialog").getByText("报告引用成功观测的步骤ID；区分事实、推断和未验证项",{exact:true})).toBeVisible();
 await page.waitForTimeout(350);await page.screenshot({path:info.outputPath("skill-center.png"),fullPage:true});await page.getByRole("button",{name:"关闭",exact:true}).click();
 await page.getByRole("menuitem",{name:"AI 助手"}).click();await page.getByRole("combobox",{name:"指定技能包"}).click();await expect(page.getByText("Web服务证据巡检 v1.0.0",{exact:true})).toBeVisible();expect(errors).toEqual([]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
