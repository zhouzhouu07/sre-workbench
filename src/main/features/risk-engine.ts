import type { AgentPermission, AgentTarget, AgentToolCall } from "../../shared/agent";
import type { ToolDefinition } from "../../shared/studio";
import type { RiskAssessment, RiskContext } from "../../shared/risk";
import { toolDecision } from "./agent-contract";
import path from "node:path";
import { isCriticalStructuredPath } from "./agent-critical-paths";
export class RiskEngine {
 static readonly version="1.0.2";
 evaluate(tool:ToolDefinition,call:AgentToolCall,target:AgentTarget,permission:AgentPermission,context:RiskContext={}):RiskAssessment {
  const policy=context.policy??(permission==="autonomous"?"autonomous":"balanced"),factors:RiskAssessment["factors"]=[];
  const add=(id:string,label:string,delta:number)=>factors.push({id,label,delta});
  const mutation=tool.permissionRequirement==="mutation",a=call.arguments,command=String(a.command??""),rawFile=String(a.path??"");
  // Match the executor's lexical destination before applying path risk rules.
  // Keep the supplied spelling too: normalization must not lower prior blocks.
  const resolvedFile=rawFile?(target.kind==="ssh"?path.posix:path).resolve(target.root,rawFile):"";
  const file=`${rawFile}\n${resolvedFile}`,text=`${file}\n${command}`;
  // Discarding diagnostic output is not a device modification. Keep all other
  // /dev references, including moving/deleting /dev/null, subject to the rule.
  const criticalText=`${file}\n${command.replace(/(?:[012]?>>?\s*|(?:--output(?:=|\s+)|-o\s+))(['"]?)\/dev\/null\1(?=\s|[;&|]|$)/g," [null-output] ")}`;
  add("base",`Tool基础风险：${tool.name}`,tool.baseRisk);
  if(!mutation)add("read","结构化只读/本地计划，无主机变更",0);
  let critical=tool.baseRisk>=81;
  if(mutation){
   add("write","可能改变主机状态",0);
   if(call.tool==="write_file")add("overwrite","目标文件可能已存在，将覆盖内容",8);
   if(call.tool==="service_action"||/\bsystemctl\b|\/etc\/systemd\//i.test(text))add("systemd","修改服务状态或systemd配置",10);
   if(call.tool==="compose_action"||/\b(docker|podman|compose)\b/i.test(command))add("docker","影响容器或Compose项目",4);
   if(/\b(apt(?:-get)?|dnf|yum|rpm|pip3?|npm)\s+(?:[^\n]*\s)?(install|remove|upgrade|update|uninstall)\b/i.test(command))add("package","软件包安装、卸载或升级",4);
   if(/\b(firewall-cmd|iptables|nft|ufw)\b/i.test(command)){add("firewall","改变网络访问策略，可能影响远程连接",20);}
   if(/\b(rm|rmdir|unlink|shred)\b|\bfind\b[^\n]*-delete|\bdocker\s+[^\n]*(prune|volume\s+rm)/i.test(command)){add("delete","删除操作，恢复能力有限",25);}
   if(/(?:^|\s)(?:mkfs(?:\.[a-z0-9]+)?|wipefs|fdisk|parted)\b|\bdd\s[^\n]*\bof=\/dev\//i.test(command)){add("disk","磁盘格式化/分区或设备覆盖",60);critical=true;}
   if(isCriticalStructuredPath(resolvedFile)||/\/(?:etc\/(?:shadow|passwd|sudoers|ssh)(?:[\s/]|$)|boot(?:[\s/]|$)|dev(?:[\s/]|$)|sys(?:[\s/]|$)|proc\/sys(?:[\s/]|$))/.test(criticalText)||/\brm\s+[^\n]*(?:\s\/\s*$|\/\*|--no-preserve-root)/.test(command)){add("critical-path","涉及系统关键路径或根目录范围",40);critical=true;}
   if(/\b(?:chmod|chown)\s+[^\n]*-R\s+\//.test(command)||/\b(?:killall|pkill)\b|\bdocker\s+(?:stop|rm)\s+\$\(/.test(command)){add("broad-impact","批量进程/容器或递归权限影响范围较广",20);}
   if(target.kind==="ssh"&&target.sudo)add("sudo","显式使用提权执行",6);
   if((context.targetCount??1)>1)add("targets","操作跨越多个目标",20);
   else add("target","固定单一目标服务器",0);
   if(context.backupEvidence&&call.tool==="write_file")add("backup","已有匹配文件的成功备份证据",-8);
   else add("backup-unknown","未取得匹配备份证据，不假定可回滚",0);
   if(call.tool==="service_action")add("reversible","服务动作可再次控制，但不等于撤销业务影响",0);
   else add("reversibility","无法保证完全可逆",0);
   if(context.verificationPlanned)add("verify","已配置独立后置验收，不抵消严重风险",-3);
  }
  const score=Math.min(100,Math.max(0,critical?90:0,factors.reduce((sum,f)=>sum+f.delta,0))),level=score<=20?"LOW":score<=50?"MEDIUM":score<=80?"HIGH":"CRITICAL";
  let action:RiskAssessment["action"]=tool.source==="builtin"?toolDecision(permission,call):permission==="advice"||permission==="readonly"?"deny":"confirm";
  let reason=action==="deny"?"当前权限不允许此工具":action==="confirm"?"当前权限或导入工具要求逐次审批":"符合已授权权限";
  if(!tool.enabled){action="deny";reason="工具已禁用";}
  if(level==="CRITICAL"){action="deny";reason="CRITICAL默认拒绝，模型或普通操作审批不能解除";}
  else if(action!=="deny"&&mutation&&(policy==="cautious"||(policy==="balanced"&&level==="HIGH"))){action="confirm";reason=policy==="cautious"?"谨慎策略要求所有变更审批":"均衡策略要求高风险操作审批";}
  return {score,level,factors,action,reason,policy,version:RiskEngine.version};
 }
}
