export type ToolObservation={ name:string;kind:'local'|'hosted';status:'started'|'returned'|'reported_error'|'approval_requested'|'unverified'|'blocked'|'threw';sequence:number }
export type RuleObservation={ id:string;revision:number | null;title:string }
export type SourceObservation={ kind:'catalogue'|'message'|'case_answer';id:string;title?:string }
export type TurnEvidence={ version:1;rules:RuleObservation[];sources:SourceObservation[];tools:ToolObservation[];truncated:boolean }
