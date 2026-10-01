import type { JsonSchema } from "../../shared/studio";

const kinds = ["object", "array", "string", "number", "integer", "boolean", "null"];
const keys = new Set(["type", "description", "properties", "required", "additionalProperties", "items", "enum", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
export function validateSchema(schema: unknown, depth = 0): asserts schema is JsonSchema {
  if (depth > 8 || !record(schema) || !kinds.includes(schema.type)) throw new Error("Schema需要合法type且嵌套不能超过8层");
  for (const k of Object.keys(schema)) if (!keys.has(k)) throw new Error(`Schema不支持关键字：${k}`);
  if (schema.description !== undefined && (typeof schema.description !== "string" || schema.description.length > 2000)) throw new Error("Schema description无效");
  for (const [type, fields] of [["string", ["minLength", "maxLength"]], ["array", ["minItems", "maxItems"]], ["numeric", ["minimum", "maximum"]]] as const) {
    if (fields.some(k=>schema[k]!==undefined) && (type==="numeric" ? !["number","integer"].includes(schema.type) : schema.type!==type)) throw new Error("Schema约束与type不匹配");
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100 || schema.enum.some((x:unknown)=>typeof x === "object" && x !== null))) throw new Error("Schema enum仅支持1–100个标量");
  for (const key of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]) if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw new Error(`Schema ${key}必须为有限数值`);
  for (const [min,max] of [["minLength","maxLength"],["minimum","maximum"],["minItems","maxItems"]]) {
    if (schema[min] !== undefined && schema[max] !== undefined && schema[min] > schema[max]) throw new Error("Schema上下限颠倒");
    if(min !== "minimum") for(const k of [min,max]) if(schema[k] !== undefined && (!Number.isInteger(schema[k]) || schema[k] < 0 || schema[k] > 100000)) throw new Error("Schema长度限制无效");
  }
  if (schema.type === "object") {
    if (!record(schema.properties) || Object.keys(schema.properties).length > 50 || schema.additionalProperties !== false) throw new Error("对象Schema需要properties及additionalProperties=false（最多50字段）");
    for (const [k,v] of Object.entries(schema.properties)) {
      if (forbidden.has(k) || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(k)) throw new Error("Schema字段名无效");
      validateSchema(v, depth + 1);
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length || schema.required.some((k:unknown)=>typeof k !== "string" || !Object.hasOwn(schema.properties,k)))) throw new Error("Schema required引用不存在或重复字段");
  } else if(schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) throw new Error("对象关键字只能用于object");
  if (schema.type === "array") validateSchema(schema.items,depth+1);
  else if(schema.items !== undefined) throw new Error("items只能用于array");
  if(schema.enum) for(const value of schema.enum) validateValue({...schema,enum:undefined},value,"Schema enum");
}
export function validateValue(schema: JsonSchema, value: unknown, label = "参数", depth = 0): void {
  const s = schema as any;
  if(depth > 9) throw new Error(`${label}嵌套过深`);
  const type = s.type;
  const ok = type === "object" ? record(value) : type === "array" ? Array.isArray(value) : type === "null" ? value === null : type === "integer" ? typeof value === "number" && Number.isInteger(value) : typeof value === type;
  if (!ok) throw new Error(`${label}类型不符合${type}`);
  if(s.enum && !s.enum.includes(value)) throw new Error(`${label}不属于允许值`);
  if(type === "object") {
    const v=value as Record<string,unknown>;
    for(const k of Object.keys(v)) if(forbidden.has(k)||!Object.hasOwn(s.properties,k)) throw new Error(`${label}包含未知字段：${k}`);
    for(const k of s.required ?? []) if(!Object.hasOwn(v,k)) throw new Error(`${label}缺少字段：${k}`);
    for(const [k,vv] of Object.entries(v)) validateValue(s.properties[k],vv,`${label}.${k}`,depth+1);
  }
  if(type === "array") { const a=value as unknown[]; if(a.length>1000 || (s.minItems!==undefined&&a.length<s.minItems)||(s.maxItems!==undefined&&a.length>s.maxItems)) throw new Error(`${label}数组长度超限`);a.forEach((v,i)=>validateValue(s.items,v,`${label}[${i}]`,depth+1)); }
  if(type === "string") {const v=value as string;if(v.includes("\0")||v.length>100000||(s.minLength!==undefined&&v.length<s.minLength)||(s.maxLength!==undefined&&v.length>s.maxLength))throw new Error(`${label}文本长度或字符无效`);}
  if(type === "number" || type === "integer") {const v=value as number;if(!Number.isFinite(v)||(s.minimum!==undefined&&v<s.minimum)||(s.maximum!==undefined&&v>s.maximum))throw new Error(`${label}数值超限`);}
}
