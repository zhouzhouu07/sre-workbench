export type RiskPolicy="cautious"|"balanced"|"autonomous";
export interface RiskAssessment {score:number;level:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";factors:{id:string;label:string;delta:number}[];action:"allow"|"confirm"|"deny";reason:string;policy:RiskPolicy;version:string}
export interface RiskContext {policy?:RiskPolicy;backupEvidence?:boolean;verificationPlanned?:boolean;targetCount?:number}
