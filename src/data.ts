import type { AuditRecord, Budget, Decision, Employee, Invoice, Reimbursement, Rule, RuleHit, WorkflowStatus } from './types';

export const TENANT_ID = 'TENANT-XINGHAI';
export const COMPANY_NAME = '上海星海科技有限公司';
export const CURRENT_USER = { id:'U-FM-001', tenantId:TENANT_ID, employeeId:'E008', name:'王敏', role:'FINANCE_MANAGER' as const, permissions:['claim:view','claim:review','claim:approve-high-value','rule:manage','budget:manage','audit:view','invoice:export'] as const };
export const DEMO_ACCOUNTS = [
  {id:'ACC-EMP-001',tenantId:TENANT_ID,username:'employee@xinghai.com',password:'Employee@2026',user:{id:'U-EMP-001',tenantId:TENANT_ID,employeeId:'E001',name:'陈晨',role:'EMPLOYEE' as const,permissions:['claim:view'] as const}},
  {id:'ACC-FIN-001',tenantId:TENANT_ID,username:'finance@xinghai.com',password:'Finance@2026',user:CURRENT_USER}
];

export const employees: Employee[] = [
  ['E001','陈晨','产品中心','产品经理','陈',96,'A',48,1,0],['E002','张三','销售一部','客户经理','张',91,'A',73,2,1],['E003','李四','市场部','市场专员','李',61,'C',39,8,6],['E004','王悦','研发中心','前端工程师','王',94,'A',29,0,0],['E005','赵凯','供应链部','采购主管','赵',78,'B',55,5,3],['E006','周舟','人力资源部','HRBP','周',89,'B',22,1,1],['E007','孙杰','销售二部','销售总监','孙',83,'B',86,4,2],['E008','林琳','财务部','财务分析师','林',98,'A',35,0,0],['E009','黄思远','行政部','行政专员','黄',72,'B',41,6,3],['E010','吴桐','研发中心','研发总监','吴',93,'A',18,0,0]
].map(x=>({tenantId:TENANT_ID,id:x[0] as string,name:x[1] as string,department:x[2] as string,title:x[3] as string,avatar:x[4] as string,creditScore:x[5] as number,creditLevel:x[6] as 'A'|'B'|'C',historyCount:x[7] as number,rejectedCount:x[8] as number,abnormalCount:x[9] as number}));

const sellers=['云途商旅服务有限公司','沪上味道餐饮管理有限公司','高铁网络科技有限公司','中海酒店管理有限公司','智联办公用品有限公司','极光广告传媒有限公司'];
export const invoices: Invoice[]=Array.from({length:30},(_,i)=>({
  id:`INV${String(i+1).padStart(3,'0')}`,tenantId:TENANT_ID,number:i===1?'123456789':`2631090${String(10000+i).padStart(5,'0')}`,code:`044002100${String(100+i).padStart(3,'0')}`,date:`2026-0${i%2+8}-${String((i%27)+1).padStart(2,'0')}`,
  seller:sellers[i%sellers.length],sellerTaxId:`91310${String(100000000000+i).padStart(13,'0')}`,buyer:i===2?'北京远山贸易有限公司':COMPANY_NAME,buyerTaxId:i===2?'91110108MA00X90A1P':'91310000MA1K3X2R6P',
  amount:[301.89,1207.55,833.96,3301.89,8113.21,450.94,12264.15,660.38][i%8],tax:[18.11,72.45,50.04,198.11,486.79,27.06,735.85,39.62][i%8],total:[320,1280,884,3500,8600,478,13000,700][i%8],currency:'CNY',item:['*运输服务*出租车费','*住宿服务*房费','*现代服务*办公用品','*技术服务*项目服务','*餐饮服务*餐费','*运输服务*机票','*现代服务*广告费','*住宿服务*住宿费'][i%8],verifyStatus:i===8?'VOIDED':i===15?'NOT_FOUND':'VALID',source:['微信卡包','邮箱导入','文件上传','支付宝导入'][i%4],ocrConfidence:96.2+(i%4)*.7
}));

const hit=(id:string,version:number,name:string,description:string,risk:'高'|'中'|'低',action:Decision,evidence:string[],blocking=true):RuleHit=>({id,version,name,description,risk,action,evidence,blocking});
const workflowFor=(d:Decision):WorkflowStatus=>d==='自动通过'?'APPROVED':d==='驳回'?'REJECTED':d==='挂起'?'SUSPENDED':d==='要求补充材料'?'WAITING_SUPPLEMENT':'WAITING_MANUAL_REVIEW';
const claim=(partial:Partial<Reimbursement>&Pick<Reimbursement,'id'|'employeeId'|'amount'|'category'|'invoiceId'>):Reimbursement=>{
  const decision=partial.machineDecision||'自动通过';
  return {tenantId:TENANT_ID,currency:'CNY',submittedAt:'今天 09:42',workflowStatus:decision==='自动通过'?'PAYMENT_PENDING':workflowFor(decision),machineDecision:decision,finalDecision:decision==='人工复核'?undefined:decision,paymentStatus:decision==='自动通过'?'QUEUED':'NOT_STARTED',risk:'低',priorityScore:85,budgetId:'B002',budgetName:'部门月度费用预算',availableBudget:42800,reservationStatus:decision==='驳回'?'RELEASED':'RESERVED',purpose:'日常业务支出',hits:[],route:decision==='自动通过'?'支付队列':'系统自动决策',version:1,...partial};
};

export const initialReimbursements:Reimbursement[]=[
  claim({id:'BX202609070001',employeeId:'E001',amount:320,category:'差旅',invoiceId:'INV001',budgetId:'B002',budgetName:'产品中心·差旅费',purpose:'客户需求调研市内交通'}),
  claim({id:'BX202609070002',employeeId:'E002',amount:1280,category:'住宿',invoiceId:'INV002',machineDecision:'驳回',risk:'高',priorityScore:50,budgetId:'B001',budgetName:'销售一部·差旅费',availableBudget:18600,purpose:'杭州客户拜访住宿',historyDuplicateId:'BX202608180023',hits:[hit('RULE-004',3,'重复发票','发票唯一识别信息已存在','高','驳回',['发票号码：123456789','历史报销单：BX202608180023','历史员工：张三','历史状态：已支付'])]}),
  claim({id:'BX202609070003',employeeId:'E003',amount:884,category:'办公用品',invoiceId:'INV003',machineDecision:'驳回',risk:'高',priorityScore:40,budgetId:'B005',budgetName:'市场部·办公费',availableBudget:12500,purpose:'活动物料采购',hits:[hit('RULE-001',2,'发票购买方不一致','购买方名称与当前公司主体不一致','高','驳回',['发票购买方：北京远山贸易有限公司',`公司主体：${COMPANY_NAME}`,'比较结果：不一致'])]}),
  claim({id:'BX202609070004',employeeId:'E004',amount:3500,category:'技术服务',invoiceId:'INV004',machineDecision:'挂起',risk:'高',priorityScore:60,budgetId:'B003',budgetName:'研发中心·技术服务费',availableBudget:2000,purpose:'测试云服务续费',route:'预算管理员',hits:[hit('RULE-003',4,'超预算','可用预算不足以覆盖本次报销','高','挂起',['可用预算：¥2,000','本次报销：¥3,500','预算缺口：¥1,500'])]}),
  claim({id:'BX202609070005',employeeId:'E007',amount:8600,category:'餐饮',invoiceId:'INV005',machineDecision:'人工复核',finalDecision:undefined,workflowStatus:'WAITING_MANUAL_REVIEW',risk:'中',priorityScore:70,budgetId:'B004',budgetName:'销售二部·业务招待费',availableBudget:26400,purpose:'重要客户年度商务宴请',route:'财务负责人 · 王敏',assignedTo:'U-FM-001',dueAt:'2026-09-07 18:00',hits:[hit('RULE-002',5,'大额餐饮报销','单笔餐饮费用超过 ¥5,000','中','人工复核',['报销金额：¥8,600','餐饮限额：¥5,000','同行人数：8 人','人均金额：¥1,075'],false)]}),
  ...Array.from({length:15},(_,i)=>{const amount=[478,700,13000,320,1280][i%5];const d=(['自动通过','人工复核','驳回','自动通过','挂起'] as Decision[])[i%5];return claim({id:`BX202609${String(600+i).padStart(6,'0')}`,employeeId:`E${String(i%10+1).padStart(3,'0')}`,amount,category:['差旅','住宿','广告费','交通','办公用品'][i%5],invoiceId:`INV${String(6+i).padStart(3,'0')}`,submittedAt:`昨天 ${String(18-i%8).padStart(2,'0')}:${String(i*7%60).padStart(2,'0')}`,machineDecision:d,risk:d==='自动通过'?'低':d==='人工复核'?'中':'高',priorityScore:d==='自动通过'?88:d==='人工复核'?62:42,availableBudget:16800,hits:amount>10000?[hit('RULE-006',2,'高额报销','单笔金额超过 ¥10,000','中','升级审批',[`报销金额：¥${amount.toLocaleString()}`],false)]:[]})})
];

export const budgets:Budget[]=[
  ['B001','销售一部·差旅费','部门 / 月度','销售一部',120000,72400,29000],['B002','产品中心·差旅费','部门 / 月度','产品中心',80000,32600,4600],['B003','研发中心·技术服务费','部门 / 年度','研发中心',260000,238000,20000],['B004','销售二部·业务招待费','科目 / 月度','销售二部',90000,52200,11400],['B005','品牌升级项目','项目 / 年度','市场部',500000,312500,48600],['B006','行政部·办公费','部门 / 月度','行政部',60000,35800,5200]
].map(x=>({tenantId:TENANT_ID,id:x[0] as string,name:x[1] as string,type:x[2] as string,owner:x[3] as string,total:x[4] as number,spent:x[5] as number,frozen:x[6] as number,version:1}));

const rule=(id:string,version:number,name:string,type:string,condition:string,field:Rule['ast']['conditions'][number],risk:'高'|'中'|'低',action:Decision,priority:number,blocking=true):Rule=>({id,tenantId:TENANT_ID,version,name,type,condition,ast:{combinator:'AND',conditions:[field]},risk,action,priority,blocking,enabled:true,lifecycle:'PUBLISHED',rolloutPercentage:100,effectiveFrom:'2026-09-01'});
export const initialRules:Rule[]=[
  rule('RULE-001',2,'发票购买方不一致','购买方验证',`购买方 != ${COMPANY_NAME}`,{field:'invoice.buyerName',operator:'NEQ',value:COMPANY_NAME},'高','驳回',100),
  { ...rule('RULE-002',5,'大额餐饮报销','发票金额','金额 > 5,000 且 科目 = 餐饮',{field:'claim.amount',operator:'GT',value:5000},'中','人工复核',80,false),ast:{combinator:'AND',conditions:[{field:'claim.amount',operator:'GT',value:5000},{field:'claim.category',operator:'EQ',value:'餐饮'}]}},
  rule('RULE-003',4,'超预算','预算','可用预算 < 报销金额',{field:'budget.available',operator:'LT',value:'$claim.amount'},'高','挂起',95),
  rule('RULE-004',3,'重复发票','重复发票','发票指纹 已存在',{field:'invoice.fingerprint',operator:'EXISTS'},'高','驳回',100),
  rule('RULE-005',2,'员工无该类权限','员工权限','报销权限 不包含 科目',{field:'employee.permissions',operator:'NOT_CONTAINS',value:'$claim.category'},'中','人工复核',75,false),
  rule('RULE-006',2,'高额报销','发票金额','金额 > 10,000',{field:'claim.amount',operator:'GT',value:10000},'中','升级审批',85,false)
];

export const initialAudits:AuditRecord[]=[
  {id:'A001',tenantId:TENANT_ID,reimbursementId:'BX202609070002',time:'2026-09-07 09:32',aiResult:'驳回',manualResult:'—',risk:'高',reviewer:'系统',note:'重复发票，自动拦截',ruleSetVersion:'2026.09.1',traceId:'TR-001'},
  {id:'A002',tenantId:TENANT_ID,reimbursementId:'BX202609070005',time:'2026-09-07 09:01',aiResult:'人工复核',manualResult:'自动通过',risk:'中',reviewer:'王敏',note:'客户招待名单与事由已核实',ruleSetVersion:'2026.09.1',traceId:'TR-002'}
];
export const blacklist=[{name:'鑫盛商贸有限公司',taxId:'91310115MA1K4X9N2C',reason:'异常交易与虚假开票风险',risk:'高',date:'2026-08-21',status:'生效中'},{name:'宏远企业服务中心',taxId:'92310112MA7D8Y2K6F',reason:'注册地址与经营状态异常',risk:'高',date:'2026-07-14',status:'生效中'},{name:'乐享礼品有限公司',taxId:'91310109MA1G5R8B3W',reason:'礼品卡及私人消费高频',risk:'中',date:'2026-06-30',status:'观察中'}];
