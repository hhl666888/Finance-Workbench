export type RiskLevel = '高' | '中' | '低';
export type Decision = '自动通过' | '驳回' | '人工复核' | '挂起' | '要求补充材料' | '升级审批';
export type VerifyStatus = 'PENDING' | 'VALID' | 'INVALID' | 'VOIDED' | 'RED_FLUSHED' | 'NOT_FOUND' | 'TECHNICAL_ERROR';
export type WorkflowStatus =
  | 'DRAFT' | 'SUBMITTED' | 'OCR_PROCESSING' | 'WAITING_FIELD_CONFIRMATION'
  | 'VERIFYING' | 'AUDITING' | 'WAITING_MANUAL_REVIEW' | 'WAITING_SUPPLEMENT'
  | 'SUSPENDED' | 'APPROVED' | 'REJECTED' | 'PAYMENT_PENDING' | 'PAID'
  | 'PAYMENT_FAILED' | 'CANCELLED';
export type PaymentStatus = 'NOT_STARTED' | 'QUEUED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REVERSED';
export type ReservationStatus = 'NONE' | 'RESERVED' | 'RELEASED' | 'CONSUMED' | 'EXPIRED';
export type Role = 'EMPLOYEE' | 'FINANCE' | 'FINANCE_MANAGER' | 'BUDGET_OWNER' | 'ADMIN' | 'AUDITOR';

export interface SessionUser {
  id: string; tenantId: string; employeeId: string; name: string; role: Role;
  permissions: readonly Permission[];
}
export interface UserAccount {
  id: string; tenantId: string; username: string; password: string; user: SessionUser;
}
export interface ExpenseInvoiceDraft {
  id: string; fileName: string; category: string; purpose: string; amount: number; invoiceNumber?: string;
  ocrStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'; verifyStatus: VerifyStatus;
  invoiceCode?: string; invoiceDate?: string; seller?: string; sellerTaxId?: string; buyer?: string; buyerTaxId?: string;
  tax?: number; item?: string; ocrConfidence?: number; ocrWarning?: string;
}
export type Permission = 'claim:view' | 'claim:review' | 'claim:approve-high-value' | 'rule:manage' | 'budget:manage' | 'audit:view' | 'invoice:export';
export interface Employee {
  id: string; tenantId: string; name: string; department: string; title: string; avatar: string;
  creditScore: number; creditLevel: 'A' | 'B' | 'C'; historyCount: number; rejectedCount: number; abnormalCount: number;
}
export interface OcrField<T = string | number> { value?: T; confidence: number; sourceText?: string; requiresConfirmation: boolean }
export interface OcrResult { jobId: string; status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; fields: Record<string, OcrField>; warnings: string[]; fileName: string }
export interface Invoice {
  id: string; tenantId: string; number: string; code: string; date: string; seller: string; sellerTaxId: string;
  buyer: string; buyerTaxId: string; amount: number; tax: number; total: number; currency: string; item: string;
  verifyStatus: VerifyStatus; verificationMessage?: string; source: string; ocrConfidence: number; fingerprint?: string;
}
export interface RuleHit {
  id: string; version: number; name: string; description: string; risk: RiskLevel; action: Decision; evidence: string[]; blocking: boolean;
}
export interface BudgetReservation {
  id: string; reimbursementId: string; budgetId: string; amount: number; status: ReservationStatus;
  createdAt: string; updatedAt: string; idempotencyKey: string;
}
export interface Reimbursement {
  id: string; tenantId: string; employeeId: string; amount: number; currency: string; category: string; submittedAt: string;
  workflowStatus: WorkflowStatus; machineDecision?: Decision; finalDecision?: Decision; paymentStatus: PaymentStatus;
  risk: RiskLevel; priorityScore: number; invoiceId: string; invoiceIds?: string[]; attachments?: ExpenseInvoiceDraft[]; budgetId: string; budgetName: string; availableBudget: number;
  reservationStatus: ReservationStatus; purpose: string; hits: RuleHit[]; route: string; version: number;
  historyDuplicateId?: string; urgent?: boolean; assignedTo?: string; claimedAt?: string; dueAt?: string;
  resubmissionOf?: string;
  supplementRequest?: { reason: string; items: string[]; requestedAt: string; dueAt?: string; response?: string; respondedAt?: string };
}
export interface Budget {
  id: string; tenantId: string; name: string; type: string; owner: string; total: number; spent: number; frozen: number; version: number;
}
export type RuleField = 'invoice.buyerName' | 'invoice.verifyStatus' | 'invoice.fingerprint' | 'claim.amount' | 'claim.category' | 'budget.available' | 'employee.permissions' | 'supplier.riskLevel';
export type RuleOperator = 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'CONTAINS' | 'NOT_CONTAINS' | 'EXISTS';
export interface RuleCondition { field: RuleField; operator: RuleOperator; value?: string | number | boolean }
export interface RuleGroup { combinator: 'AND' | 'OR'; conditions: Array<RuleCondition | RuleGroup> }
export interface Rule {
  id: string; tenantId: string; version: number; name: string; type: string; condition: string; ast: RuleGroup;
  risk: RiskLevel; action: Decision; priority: number; blocking: boolean; enabled: boolean;
  lifecycle: 'DRAFT' | 'TESTING' | 'PUBLISHED' | 'RETIRED'; rolloutPercentage: number; effectiveFrom: string;
}
export interface AuditEvaluation { id: string; reimbursementId: string; ruleSetVersion: string; hits: RuleHit[]; priorityScore: number; decision: Decision; route: string; createdAt: string; traceId: string }
export interface AuditRecord {
  id: string; tenantId: string; reimbursementId: string; time: string; aiResult: Decision; manualResult: string;
  risk: RiskLevel; reviewer: string; reviewerId?: string; note: string; action?: string; beforeStatus?: WorkflowStatus;
  afterStatus?: WorkflowStatus; ruleSetVersion?: string; traceId?: string;
}
export interface CommandResult<T> { commandId: string; result: T; completedAt: string }
