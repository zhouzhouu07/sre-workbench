import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("tool center imports reviewed package, persists enable state and uninstalls",async({},info)=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sre-tool-ui-"));
 const app=await electron.launch({args:["."],env:{...process.env,SRE_DATA_DIR:dir}});
 try{
  await app.evaluate(({dialog},packagePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[packagePath]});},path.resolve("examples/tool-packages/uptime"));
  const page=await app.firstWindow();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.getByRole("menuitem",{name:"Agent Studio"}).click();
  await page.getByRole("tab",{name:"Tools · 工具"}).click();
  await expect(page.getByText("Tool Center · 工具中心",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"导入工具包"}).click();
  await expect(page.getByText("审阅工具包并安装",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"安装（默认禁用）"}).click();
  await page.getByRole("searchbox",{name:"搜索工具"}).fill("custom.uptime");
  const toggle=page.getByRole("switch",{name:"启用 custom.uptime"});await expect(toggle).not.toBeChecked();
  await toggle.click();await expect(toggle).toBeChecked();
  await page.getByRole("button",{name:/^详\s*情$/}).click();
  await expect(page.getByText("暂无执行记录",{exact:true})).toBeVisible();
  await page.waitForTimeout(350); // Capture the fully opened drawer, not its animation.
  await page.screenshot({path:info.outputPath("tool-center.png"),fullPage:true});
  await page.getByRole("button",{name:"关闭",exact:true}).click();
  await page.getByRole("button",{name:"刷新工具"}).click();await expect(toggle).toBeChecked();
  await toggle.click();await expect(toggle).not.toBeChecked();
  await page.getByRole("button",{name:/^卸\s*载$/}).click();
  await page.getByRole("button",{name:"确 定"}).click();await expect(toggle).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
