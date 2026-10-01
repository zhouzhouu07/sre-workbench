import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Backend } from "../src/main/core/backend";
import { AgentTools } from "../src/main/features/agent-tools";
const closes:(()=>Promise<unknown>)[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const f of closes.splice(0).reverse())await f();});
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),"sre-risk-"));closes.push(()=>rm(dir,{recursive:true,force:true}));const core=new Backend({dataDir:dir,encrypt:s=>s,decrypt:s=>s,emit:()=>{},chooseFile:async()=>null});await core.init();closes.push(()=>core.close());return core.toolRegistry;}
const target={kind:"ssh" as const,hostId:"host",root:"/opt/blog",sudo:false};
it("rejects relative and normalized structured critical paths before execution even when approved",async()=>{
 const r=await fixture(),execute=vi.spyOn(AgentTools.prototype,"execute");
 for(const [root,file]of [["/etc","shadow"],["/etc","./shadow"],["/","etc/ssh/sshd_config"],["/","opt/../etc/shadow"],["/","/opt/../etc/shadow"],["/boot","new-file"]]){
  const call={tool:"write_file",arguments:{path:file,content:"replacement"}},t={...target,root};
  expect(r.assess("autonomous",call,t,{backupEvidence:true,verificationPlanned:true})).toMatchObject({level:"CRITICAL",action:"deny"});
  await expect(r.execute(t,"autonomous",call,true,new AbortController().signal,()=>{})).rejects.toThrow(/CRITICAL/);
 }
 expect(execute).not.toHaveBeenCalled();
 expect(r.assess("autonomous",{tool:"make_directory",arguments:{path:"ssh/new-directory"}},{...target,root:"/etc"}).action).toBe("deny");
 expect(r.assess("autonomous",{tool:"write_file",arguments:{path:"public/index.html",content:"safe"}},target).action).toBe("allow");
});
it("recognizes relative systemd configuration paths with the same high risk as absolute paths",async()=>{
 const r=await fixture(),t={...target,root:"/etc/systemd/system",sudo:true};
 const absolute=r.assess("autonomous",{tool:"write_file",arguments:{path:"/etc/systemd/system/demo.service",content:"[Unit]"}},t,{policy:"balanced"});
 const relative=r.assess("autonomous",{tool:"write_file",arguments:{path:"./demo.service",content:"[Unit]"}},t,{policy:"balanced"});
 expect(relative).toMatchObject({score:absolute.score,level:"HIGH",action:"confirm"});
 expect(relative.factors.some(f=>f.id==="systemd")).toBe(true);
});
it("allows null output sinks in diagnostics while retaining device and null-node modification protection",async()=>{
 const r=await fixture();for(const command of ["curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18138/","docker inspect demo >/dev/null 2>&1","curl --output '/dev/null' http://127.0.0.1:18138/"]){const risk=r.assess("autonomous",{tool:"run_command",arguments:{command}},target);expect(risk.action).toBe("allow");expect(risk.factors.some(f=>f.id==="critical-path")).toBe(false);}
 for(const command of ["echo x > /dev/sda","mv /dev/null /tmp/null","curl -o /dev/null/../sda http://127.0.0.1/","rm /dev/null"]){expect(r.assess("autonomous",{tool:"run_command",arguments:{command}},target).action).toBe("deny");}
});
it("leaves structured readonly observations low risk without granting mutation permissions",async()=>{
 const r=await fixture();const read=r.assess("readonly",{tool:"host_resources",arguments:{}},target);expect(read).toMatchObject({level:"LOW",action:"allow"});
 expect(r.assess("readonly",{tool:"service_action",arguments:{unit:"demo.service",action:"restart"}},target,{policy:"autonomous"}).action).toBe("deny");
});
it("explains service, systemd, sudo, overwrite and evidence factors with stricter policy intersection",async()=>{
 const r=await fixture(),call={tool:"write_file",arguments:{path:"/etc/systemd/system/demo.service",content:"[Unit]"}};
 const risk=r.assess("autonomous",call,{...target,sudo:true},{policy:"balanced"});expect(risk.action).toBe("confirm");expect(risk.level).toBe("HIGH");expect(risk.factors.map(f=>f.id)).toEqual(expect.arrayContaining(["overwrite","systemd","sudo","backup-unknown","reversibility"]));
 const backed=r.assess("autonomous",call,{...target,sudo:true},{policy:"balanced",backupEvidence:true,verificationPlanned:true});expect(backed.score).toBeLessThan(risk.score);
 const service={tool:"service_action",arguments:{unit:"demo.service",action:"restart"}};expect(r.assess("autonomous",service,target,{policy:"cautious"}).action).toBe("confirm");expect(r.assess("autonomous",service,target,{policy:"autonomous"}).action).toBe("allow");
});
it.each(["rm -rf /", "rm -f /opt/blog/data.db", "mkfs.ext4 /dev/sdb", "firewall-cmd --permanent --add-port=22/tcp", "echo replacement > /etc/shadow"])("rejects critical command even with approved=true: %s",async command=>{
 const r=await fixture(),call={tool:"run_command",arguments:{command}};const risk=r.assess("autonomous",call,target,{backupEvidence:true,verificationPlanned:true});
 if(command.includes("/opt/blog"))expect(risk.factors.some(f=>f.id==="delete")).toBe(true);
 expect(risk.action).toBe("deny");const execute=vi.spyOn(AgentTools.prototype,"execute");await expect(r.execute(target,"autonomous",call,true,new AbortController().signal,()=>{})).rejects.toThrow(/CRITICAL/);expect(execute).not.toHaveBeenCalled();expect(r.usage()[0].risk?.level).toBe("CRITICAL");
});
it("scores package and Docker operations and cannot downgrade confirm permission",async()=>{
 const r=await fixture();for(const [command,factor] of [["dnf install -y nginx","package"],["docker compose up -d","docker"]]){const risk=r.assess("confirm",{tool:"run_command",arguments:{command}},target,{policy:"autonomous"});expect(risk.factors.some(f=>f.id===factor)).toBe(true);expect(risk.action).toBe("confirm");}
});
