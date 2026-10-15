export const LIFECYCLE_CHECK_IDS=['DB001','DB002','DB003','DB004','DB005','DB006','DB007','DB008','DB009','DB010','DB011'] as const;
export type CheckId=typeof LIFECYCLE_CHECK_IDS[number];
export type CheckStatus='PASS'|'WARN'|'FAIL';

export interface LifecycleCheck{
  id:CheckId;
  status:CheckStatus;
  title:string;
  detected:string;
  expected?:string;
  explanation:string;
  remediation:string;
  repairable:boolean;
}

export function check(id:CheckId,status:CheckStatus,title:string,detected:string,expected:string|undefined,explanation:string,remediation:string,repairable:boolean):LifecycleCheck{
  return {id,status,title,detected,...(expected===undefined?{}:{expected}),explanation,remediation,repairable};
}

export type LifecycleResult='READY'|'READY_WITH_WARNINGS'|'NOT_READY'|'INTERNAL_ERROR';

