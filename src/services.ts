import { COMPANY_NAME, DEMO_ACCOUNTS, TENANT_ID } from './data';
import type { AuditEvaluation, AuditRecord, Budget, BudgetReservation, CommandResult, Decision, Employee, ExpenseInvoiceDraft, Invoice, OcrResult, PaymentStatus, Reimbursement, Role, Rule, RuleCondition, RuleGroup, RuleHit, SessionUser, UserAccount, VerifyStatus, WorkflowStatus } from './types';

export class DomainError extends Error { constructor(public code:string,message:string,public retryable=false){super(message)} }
export class ConcurrencyError extends DomainError { constructor(){super('VERSION_CONFLICT','数据已被其他用户更新，请刷新后重试',true)} }
export class PermissionError extends DomainError { constructor(){super('FORBIDDEN','当前账号没有执行此操作的权限')} }

const SESSION_KEY='finwise-auth-session-v1';
export const AuthService={
  login(username:string,password:string):SessionUser{const account=DEMO_ACCOUNTS.find(x=>x.username.toLowerCase()===username.trim().toLowerCase()&&x.password===password);if(!account)throw new DomainError('INVALID_CREDENTIALS','账号或密码不正确');localStorage.setItem(SESSION_KEY,JSON.stringify(account.user));return account.user},
  current():SessionUser|null{try{const raw=localStorage.getItem(SESSION_KEY);const session=raw?JSON.parse(raw) as SessionUser:null;return session?.tenantId===TENANT_ID?session:null}catch{return null}},
  logout(){localStorage.removeItem(SESSION_KEY)},
  canAccessClaim(user:SessionUser,claim:Reimbursement){return user.role!=='EMPLOYEE'||claim.employeeId===user.employeeId}
};

export const WORKFLOW_TRANSITIONS:Record<WorkflowStatus,WorkflowStatus[]>={
  DRAFT:['SUBMITTED','CANCELLED'],SUBMITTED:['OCR_PROCESSING','CANCELLED'],OCR_PROCESSING:['WAITING_FIELD_CONFIRMATION','VERIFYING','SUSPENDED','CANCELLED'],WAITING_FIELD_CONFIRMATION:['VERIFYING','CANCELLED'],VERIFYING:['AUDITING','SUSPENDED','CANCELLED'],AUDITING:['WAITING_MANUAL_REVIEW','WAITING_SUPPLEMENT','SUSPENDED','APPROVED','REJECTED','CANCELLED'],WAITING_MANUAL_REVIEW:['APPROVED','REJECTED','WAITING_SUPPLEMENT','SUSPENDED','CANCELLED'],WAITING_SUPPLEMENT:['AUDITING','CANCELLED'],SUSPENDED:['AUDITING','CANCELLED'],APPROVED:['PAYMENT_PENDING'],REJECTED:[],PAYMENT_PENDING:['PAID','PAYMENT_FAILED'],PAID:[],PAYMENT_FAILED:['PAYMENT_PENDING','CANCELLED'],CANCELLED:[]
};
export const WorkflowStateMachine={
  canTransition(from:WorkflowStatus,to:WorkflowStatus){return WORKFLOW_TRANSITIONS[from].includes(to)},
  transition(claim:Reimbursement,to:WorkflowStatus){if(!this.canTransition(claim.workflowStatus,to))throw new DomainError('INVALID_TRANSITION',`不允许从 ${claim.workflowStatus} 进入 ${to}`);return {...claim,workflowStatus:to,version:claim.version+1}}
};
export const decisionToWorkflow=(d:Decision):WorkflowStatus=>d==='自动通过'?'APPROVED':d==='驳回'?'REJECTED':d==='挂起'?'SUSPENDED':d==='要求补充材料'?'WAITING_SUPPLEMENT':'WAITING_MANUAL_REVIEW';
export const workflowLabel=(s:WorkflowStatus)=>({DRAFT:'草稿',SUBMITTED:'待处理',OCR_PROCESSING:'识别中',WAITING_FIELD_CONFIRMATION:'待确认字段',VERIFYING:'验真中',AUDITING:'审核中',WAITING_MANUAL_REVIEW:'人工复核',WAITING_SUPPLEMENT:'待补充材料',SUSPENDED:'挂起',APPROVED:'已通过',REJECTED:'驳回',PAYMENT_PENDING:'待支付',PAID:'已支付',PAYMENT_FAILED:'支付失败',CANCELLED:'已取消'} as Record<WorkflowStatus,string>)[s];

const normalize=(value:string)=>String(value??'').normalize('NFKC').replace(/[\s-]/g,'').toUpperCase();
export function createInvoiceFingerprint(invoice:Pick<Invoice,'code'|'number'|'date'|'total'|'sellerTaxId'>){
  const raw=[invoice.code,invoice.number,invoice.date,Number(invoice.total).toFixed(2),invoice.sellerTaxId].map(v=>normalize(String(v))).join('|');
  let hash=2166136261;for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return `FP-${(hash>>>0).toString(16).padStart(8,'0')}`;
}
export const DuplicateDetectionService={
  check(candidate:Invoice,history:Invoice[],currentId?:string){const fingerprint=createInvoiceFingerprint(candidate);const matches=history.filter(i=>i.id!==currentId&&i.tenantId===candidate.tenantId&&createInvoiceFingerprint(i)===fingerprint);return {fingerprint,level:matches.length?'EXACT' as const:'NONE' as const,matches};}
};

const withTimeout=<T>(promise:Promise<T>,ms:number)=>new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>reject(new DomainError('TIMEOUT','服务响应超时',true)),ms);promise.then(v=>{clearTimeout(timer);resolve(v)},e=>{clearTimeout(timer);reject(e)})});
export const InvoiceVerificationService={
  async verifyInvoice(invoice:Invoice,options:{timeoutMs?:number;simulateFailure?:boolean}={}):Promise<{verified:boolean;status:VerifyStatus;message:string;technicalFailure:boolean}>{
    if(!invoice.number||!invoice.date||!invoice.sellerTaxId)throw new DomainError('MISSING_FIELDS','验真所需字段不完整');
    return withTimeout(new Promise((resolve,reject)=>setTimeout(()=>{
      if(options.simulateFailure)return reject(new DomainError('VERIFY_UNAVAILABLE','税务验真服务暂时不可用',true));
      const messages:Record<VerifyStatus,string>={PENDING:'等待验真',VALID:'国家税务平台信息匹配，发票验真通过',INVALID:'发票关键字段与税务平台记录不一致',VOIDED:'该发票已作废',RED_FLUSHED:'该发票已红冲',NOT_FOUND:'未查询到该发票',TECHNICAL_ERROR:'验真服务暂时不可用'};
      resolve({verified:invoice.verifyStatus==='VALID',status:invoice.verifyStatus,message:messages[invoice.verifyStatus],technicalFailure:invoice.verifyStatus==='TECHNICAL_ERROR'});
    },300)),options.timeoutMs??4000);
  }
};

export const OcrService={
  validateFile(file:Pick<File,'name'|'size'|'type'>){const allowed=['image/jpeg','image/png','image/webp','application/pdf'];if(!allowed.includes(file.type))throw new DomainError('UNSUPPORTED_FILE','仅支持 JPG、PNG、WebP 或 PDF');if(file.size>10*1024*1024)throw new DomainError('FILE_TOO_LARGE','文件不能超过 10MB');if(file.size===0)throw new DomainError('EMPTY_FILE','文件内容为空')},
  async recognize(file:File,options:{timeoutMs?:number}={}):Promise<OcrResult>{this.validateFile(file);const api=import.meta.env.VITE_OCR_API_URL as string|undefined;if(api){const body=new FormData();body.append('file',file);const response=await withTimeout(fetch(api,{method:'POST',body}),options.timeoutMs??15000);if(!response.ok)throw new DomainError('OCR_SERVICE_ERROR',`OCR 服务返回 ${response.status}`,true);const payload=await response.json();const fields:Record<string,{value?:string|number;confidence:number;requiresConfirmation:boolean}>=Object.fromEntries(Object.entries(payload.fields||{}).map(([key,value])=>{const item=value as {value?:unknown;confidence?:number;requiresConfirmation?:boolean};return [key,{value:item.value===undefined?undefined:String(item.value),confidence:item.confidence??.9,requiresConfirmation:item.requiresConfirmation??false}]}));return {jobId:payload.jobId||`OCR-${Date.now()}`,status:payload.status||'SUCCESS',fileName:payload.fileName||file.name,warnings:payload.warnings||[],fields};}const provided={number:{value:'2611700000655930077',confidence:.99,requiresConfirmation:false},code:{value:'',confidence:.72,requiresConfirmation:true},date:{value:'2026-05-05',confidence:.99,requiresConfirmation:false},seller:{value:'小米通讯技术有限公司',confidence:.98,requiresConfirmation:false},sellerTaxId:{value:'91110108558521630L',confidence:.98,requiresConfirmation:false},buyer:{value:'黄虹龄',confidence:.98,requiresConfirmation:false},buyerTaxId:{value:'',confidence:.7,requiresConfirmation:true},amount:{value:132.32,confidence:.96,requiresConfirmation:false},tax:{value:17.2,confidence:.96,requiresConfirmation:false},total:{value:149.52,confidence:.99,requiresConfirmation:false},item:{value:'家用美容保健电器具',confidence:.94,requiresConfirmation:false}};return withTimeout(new Promise(resolve=>setTimeout(()=>resolve({jobId:`OCR-${Date.now()}`,status:'SUCCESS',fileName:file.name,warnings:['演示识别：配置 VITE_OCR_API_URL 后将调用 PaddleOCR'],fields:provided}),500)),options.timeoutMs??8000)},
  toInvoice(result:OcrResult):Invoice{if(result.status==='FAILED')throw new DomainError('OCR_FAILED','OCR 识别失败');const v=(k:string)=>result.fields[k]?.value;if(!v('number')||!v('total'))throw new DomainError('OCR_INCOMPLETE','发票号码或金额识别失败');return {id:`INV-${Date.now()}`,tenantId:TENANT_ID,number:String(v('number')),code:String(v('code')||''),date:String(v('date')||''),seller:String(v('seller')||''),sellerTaxId:String(v('sellerTaxId')||''),buyer:String(v('buyer')||''),buyerTaxId:String(v('buyerTaxId')||''),amount:Number(v('amount')||0),tax:Number(v('tax')||0),total:Number(v('total')),currency:'CNY',item:String(v('item')||''),source:result.fileName,ocrConfidence:Math.round(Object.values(result.fields).reduce((n,f)=>n+f.confidence,0)/Object.keys(result.fields).length*1000)/10,verifyStatus:'PENDING'};}
};

type RuleContext={claim:Reimbursement;invoice:Invoice;employee:Employee;budget:Budget;duplicate:boolean};
const contextValue=(c:RuleContext,field:RuleCondition['field'])=>({
  'invoice.buyerName':c.invoice.buyer,'invoice.verifyStatus':c.invoice.verifyStatus,'invoice.fingerprint':c.duplicate?createInvoiceFingerprint(c.invoice):'',
  'claim.amount':c.claim.amount,'claim.category':c.claim.category,'budget.available':c.budget.total-c.budget.spent-c.budget.frozen,
  'employee.permissions':['差旅','住宿','交通','办公用品'],'supplier.riskLevel':'低'
} as Record<string,unknown>)[field];
const resolveExpected=(value:unknown,c:RuleContext)=>value==='$claim.amount'?c.claim.amount:value==='$claim.category'?c.claim.category:value;
export function evaluateCondition(condition:RuleCondition,context:RuleContext){const actual=contextValue(context,condition.field);const expected=resolveExpected(condition.value,context);switch(condition.operator){case'EQ':return actual===expected;case'NEQ':return actual!==expected;case'GT':return Number(actual)>Number(expected);case'GTE':return Number(actual)>=Number(expected);case'LT':return Number(actual)<Number(expected);case'LTE':return Number(actual)<=Number(expected);case'CONTAINS':return Array.isArray(actual)?actual.includes(expected):String(actual).includes(String(expected));case'NOT_CONTAINS':return Array.isArray(actual)?!actual.includes(expected):!String(actual).includes(String(expected));case'EXISTS':return Boolean(actual)}}
export function evaluateGroup(group:RuleGroup,context:RuleContext):boolean{const values=group.conditions.map(x=>'combinator'in x?evaluateGroup(x,context):evaluateCondition(x,context));return group.combinator==='AND'?values.every(Boolean):values.some(Boolean)}
const riskWeight={高:3,中:2,低:1};
export const RuleEngine={
  execute(context:RuleContext,rules:Rule[]):RuleHit[]{return rules.filter(r=>r.enabled&&r.lifecycle==='PUBLISHED'&&r.rolloutPercentage>0).sort((a,b)=>b.priority-a.priority).filter(r=>evaluateGroup(r.ast,context)).map(r=>({id:r.id,version:r.version,name:r.name,description:r.condition,risk:r.risk,action:r.action,evidence:[`规则表达式：${r.condition}`,`规则版本：v${r.version}`,`执行结果：命中`],blocking:r.blocking}))}
};
export const RiskScoringService={score(r:Reimbursement,hits:RuleHit[],creditScore:number){let score=70;if(r.amount<500)score+=5;if(r.amount>10000)score-=5;if(creditScore>=90)score+=10;if(r.urgent)score+=5;if(hits.some(h=>h.id==='RULE-004'))score-=30;if(hits.some(h=>h.id==='RULE-001'))score-=30;if(hits.some(h=>h.id==='RULE-003'))score-=20;return Math.max(0,Math.min(100,score))}};
const actionPriority:Record<Decision,number>={'驳回':100,'挂起':90,'升级审批':80,'要求补充材料':75,'人工复核':70,'自动通过':0};
export const DecisionRouter={route(hits:RuleHit[],score:number,amount=0):{decision:Decision;assignee:string;reason:string}{const chosen=[...hits].sort((a,b)=>(Number(b.blocking)-Number(a.blocking))||(actionPriority[b.action]-actionPriority[a.action])||(riskWeight[b.risk]-riskWeight[a.risk]))[0];if(chosen)return {decision:chosen.action,assignee:chosen.action==='升级审批'?'财务负责人 · 王敏':chosen.action==='人工复核'?'普通财务 · 林琳':chosen.action==='挂起'?'预算管理员':'系统自动决策',reason:`命中 ${chosen.id} v${chosen.version}`};if(amount>10000||score<65)return {decision:'升级审批',assignee:'财务负责人 · 王敏',reason:'金额或优先级触发升级审批'};return {decision:'自动通过',assignee:'支付队列',reason:'全部确定性规则通过'}}};

export const AuthorizationService={
  require(user:SessionUser,permission:SessionUser['permissions'][number]){if(user.tenantId!==TENANT_ID||!user.permissions.includes(permission))throw new PermissionError()},
  canApprove(user:SessionUser,claim:Reimbursement){this.require(user,'claim:review');if(user.employeeId===claim.employeeId)throw new DomainError('SEGREGATION_OF_DUTIES','不能审核本人提交的报销');if(claim.amount>10000&&!user.permissions.includes('claim:approve-high-value'))throw new PermissionError();}
};

export const TaskAssignmentService={
  isOverdue(claim:Pick<Reimbursement,'workflowStatus'|'dueAt'>,now=Date.now()){return claim.workflowStatus==='WAITING_MANUAL_REVIEW'&&!!claim.dueAt&&new Date(claim.dueAt).getTime()<now},
  claim(claim:Reimbursement,user:SessionUser,now=new Date().toISOString()){AuthorizationService.require(user,'claim:review');if(claim.workflowStatus!=='WAITING_MANUAL_REVIEW')throw new DomainError('TASK_NOT_ASSIGNABLE','只有人工复核任务可以认领');if(claim.assignedTo&&claim.assignedTo!==user.id)throw new DomainError('ALREADY_CLAIMED','任务已被其他审核人认领');return {...claim,assignedTo:user.id,claimedAt:now,dueAt:new Date(new Date(now).getTime()+2*3600_000).toISOString(),version:claim.version+1}},
  release(claim:Reimbursement,user:SessionUser){AuthorizationService.require(user,'claim:review');if(claim.assignedTo&&claim.assignedTo!==user.id&&!user.permissions.includes('claim:approve-high-value'))throw new PermissionError();return {...claim,assignedTo:undefined,claimedAt:undefined,dueAt:undefined,version:claim.version+1}},
  transfer(claim:Reimbursement,user:SessionUser,targetUserId:string){AuthorizationService.require(user,'claim:review');if(!targetUserId.trim())throw new DomainError('INVALID_ASSIGNEE','请选择转派对象');return {...claim,assignedTo:targetUserId,claimedAt:new Date().toISOString(),dueAt:new Date(Date.now()+2*3600_000).toISOString(),version:claim.version+1}}
};

export const CurrencyService={
  format(amount:number,currency='CNY',locale='zh-CN'){try{return new Intl.NumberFormat(locale,{style:'currency',currency,maximumFractionDigits:2}).format(amount)}catch{return `${currency} ${amount.toFixed(2)}`}},
  assertSupported(currency:string){if(!['CNY','USD','EUR','HKD','JPY'].includes(currency))throw new DomainError('UNSUPPORTED_CURRENCY',`暂不支持 ${currency} 币种`)}
};

export const BudgetTransactionService={
  reserve(budget:Budget,claim:Reimbursement,amount:number,idempotencyKey:string,existing:BudgetReservation[]){const duplicate=existing.find(x=>x.idempotencyKey===idempotencyKey);if(duplicate)return {budget,reservation:duplicate};const available=budget.total-budget.spent-budget.frozen;if(available<amount)throw new DomainError('BUDGET_INSUFFICIENT',`可用预算仅 ¥${available.toLocaleString()}`);const now=new Date().toISOString();return {budget:{...budget,frozen:budget.frozen+amount,version:budget.version+1},reservation:{id:`RSV-${Date.now()}`,reimbursementId:claim.id,budgetId:budget.id,amount,status:'RESERVED' as const,createdAt:now,updatedAt:now,idempotencyKey}}},
  release(budget:Budget,reservation:BudgetReservation){if(reservation.status!=='RESERVED')return {budget,reservation};return {budget:{...budget,frozen:Math.max(0,budget.frozen-reservation.amount),version:budget.version+1},reservation:{...reservation,status:'RELEASED' as const,updatedAt:new Date().toISOString()}}},
  consume(budget:Budget,reservation:BudgetReservation){if(reservation.status!=='RESERVED')throw new DomainError('RESERVATION_NOT_ACTIVE','预算冻结记录不是可扣减状态');return {budget:{...budget,frozen:Math.max(0,budget.frozen-reservation.amount),spent:budget.spent+reservation.amount,version:budget.version+1},reservation:{...reservation,status:'CONSUMED' as const,updatedAt:new Date().toISOString()}}}
};

const STORAGE_KEY='finwise-demo-v4';
export interface PersistedState{schemaVersion:4;tenantId:string;reimbursements:Reimbursement[];invoices:Invoice[];budgets:Budget[];rules:Rule[];audits:AuditRecord[];reservations:BudgetReservation[];commands:CommandResult<unknown>[]}
export const PersistenceService={
  load():PersistedState|null{try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;const parsed=JSON.parse(raw);return parsed.schemaVersion===4&&parsed.tenantId===TENANT_ID?parsed:null}catch{return null}},
  save(state:PersistedState){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch(error){throw new DomainError('PERSISTENCE_FAILED',error instanceof Error?error.message:'本地持久化失败',true)}},
  clear(){localStorage.removeItem(STORAGE_KEY)}
};

export function createAuditEvaluation(claim:Reimbursement,invoice:Invoice,employee:Employee,budget:Budget,rules:Rule[],history:Invoice[]):AuditEvaluation{
  const duplicate=DuplicateDetectionService.check(invoice,history,invoice.id);const hits=RuleEngine.execute({claim,invoice,employee,budget,duplicate:duplicate.level==='EXACT'},rules);const priorityScore=RiskScoringService.score(claim,hits,employee.creditScore);const route=DecisionRouter.route(hits,priorityScore,claim.amount);return {id:`EVAL-${Date.now()}`,reimbursementId:claim.id,ruleSetVersion:rules.map(r=>`${r.id}@${r.version}`).join(','),hits,priorityScore,decision:route.decision,route:route.assignee,createdAt:new Date().toISOString(),traceId:`TR-${Date.now().toString(36).toUpperCase()}`};
}

export const PaymentService={
  enqueue(claim:Reimbursement):Reimbursement{if(claim.workflowStatus!=='APPROVED')throw new DomainError('NOT_APPROVED','仅已通过报销可以进入支付队列');return {...claim,workflowStatus:'PAYMENT_PENDING',paymentStatus:'QUEUED',version:claim.version+1}},
  settle(claim:Reimbursement,success=true):Reimbursement{if(claim.workflowStatus!=='PAYMENT_PENDING')throw new DomainError('NOT_PAYMENT_PENDING','当前报销不在支付队列');return {...claim,workflowStatus:success?'PAID':'PAYMENT_FAILED',paymentStatus:success?'PAID':'FAILED',version:claim.version+1}},
  retry(claim:Reimbursement):Reimbursement{if(claim.paymentStatus!=='FAILED')throw new DomainError('PAYMENT_NOT_FAILED','仅支付失败记录可以重试');return {...claim,workflowStatus:'PAYMENT_PENDING',paymentStatus:'QUEUED',version:claim.version+1}}
};

export const RuleLifecycleService={
  publish(rule:Rule):Rule{if(!rule.ast.conditions.length)throw new DomainError('EMPTY_RULE','规则至少需要一个条件');return {...rule,version:rule.version+1,lifecycle:'PUBLISHED',effectiveFrom:new Date().toISOString()}},
  rollback(current:Rule,history:Rule[],targetVersion:number):Rule{const snapshot=history.find(r=>r.id===current.id&&r.version===targetVersion);if(!snapshot)throw new DomainError('RULE_VERSION_NOT_FOUND','目标规则版本不存在');return {...snapshot,version:current.version+1,lifecycle:'PUBLISHED',effectiveFrom:new Date().toISOString()}},
  replay(rule:Rule,contexts:RuleContext[]){return {samples:contexts.length,matched:contexts.filter(c=>evaluateGroup(rule.ast,c)).length,errors:0,ruleVersion:`${rule.id}@${rule.version}`}}
};

export interface ExplanationProvider { explain(evaluation:AuditEvaluation):Promise<string> }
export const ExplanationService={
  async explain(evaluation:AuditEvaluation,provider?:ExplanationProvider){if(provider){try{return await withTimeout(provider.explain(evaluation),3000)}catch{/* deterministic fallback below */}}const reasons=evaluation.hits.map((h,i)=>`${i+1}. ${h.name}（${h.id} v${h.version}）`).join('\n');return `审核结论：${evaluation.decision}\n${reasons||'所有确定性规则均通过'}\n路由：${evaluation.route}`}
};
