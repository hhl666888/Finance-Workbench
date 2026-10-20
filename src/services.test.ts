import { describe, expect, it } from 'vitest';
import { budgets, employees, invoices, initialReimbursements, initialRules, TENANT_ID } from './data';
import { AuthService, BudgetTransactionService, createAuditEvaluation, createInvoiceFingerprint, CurrencyService, DecisionRouter, DuplicateDetectionService, RuleLifecycleService, TaskAssignmentService, WorkflowStateMachine } from './services';

describe('workflow state machine', () => {
  it('allows review decisions and rejects terminal state changes', () => {
    expect(WorkflowStateMachine.canTransition('WAITING_MANUAL_REVIEW', 'REJECTED')).toBe(true);
    expect(WorkflowStateMachine.canTransition('PAID', 'REJECTED')).toBe(false);
  });
});

describe('employee data access', () => {
  it('only allows an employee to access their own reimbursement', () => {
    const employee = { id: 'U-EMP-001', tenantId: TENANT_ID, employeeId: 'E001', name: '陈晨', role: 'EMPLOYEE' as const, permissions: ['claim:view'] as const };
    expect(AuthService.canAccessClaim(employee, initialReimbursements[0])).toBe(true);
    expect(AuthService.canAccessClaim(employee, initialReimbursements[1])).toBe(false);
  });
});

describe('invoice duplicate fingerprint', () => {
  it('normalizes equivalent invoice fields', () => {
    const a = { ...invoices[0], number: ' 0001-23 ' };
    const b = { ...invoices[0], number: '000123' };
    expect(createInvoiceFingerprint(a)).toBe(createInvoiceFingerprint(b));
  });
  it('finds exact duplicates without matching itself', () => {
    const duplicate = { ...invoices[0], id: 'HIST-1' };
    const result = DuplicateDetectionService.check(invoices[0], [invoices[0], duplicate], invoices[0].id);
    expect(result.level).toBe('EXACT');
    expect(result.matches).toHaveLength(1);
  });
});

describe('budget transaction', () => {
  it('reserves idempotently and consumes the reservation', () => {
    const claim = initialReimbursements[0];
    const budget = { ...budgets[1], frozen: 0 };
    const first = BudgetTransactionService.reserve(budget, claim, 320, 'cmd-1', []);
    expect(first.budget.frozen).toBe(320);
    const repeated = BudgetTransactionService.reserve(first.budget, claim, 320, 'cmd-1', [first.reservation]);
    expect(repeated.budget.frozen).toBe(320);
    const consumed = BudgetTransactionService.consume(first.budget, first.reservation);
    expect(consumed.budget.frozen).toBe(0);
    expect(consumed.budget.spent).toBe(budget.spent + 320);
  });
});

describe('integrated decision evaluation', () => {
  it('auto-approves the normal low-value travel case', () => {
    const evaluation = createAuditEvaluation(initialReimbursements[0], invoices[0], employees[0], budgets[1], initialRules, invoices);
    expect(evaluation.hits).toHaveLength(0);
    expect(evaluation.decision).toBe('自动通过');
  });
  it('returns a blocking duplicate decision with rule version evidence', () => {
    const claim = initialReimbursements[1];
    const historical = { ...invoices[1], id: 'HIST-PAID' };
    const evaluation = createAuditEvaluation(claim, invoices[1], employees[1], budgets[0], initialRules, [...invoices, historical]);
    expect(evaluation.decision).toBe('驳回');
    expect(evaluation.ruleSetVersion).toContain('RULE-004@3');
    expect(DecisionRouter.route(evaluation.hits, evaluation.priorityScore).decision).toBe('驳回');
  });
  it('keeps tenant isolation in seeded records', () => {
    expect(initialReimbursements.every(x => x.tenantId === TENANT_ID)).toBe(true);
  });
});

describe('rule lifecycle', () => {
  it('rolls back by creating a new immutable version', () => {
    const v1 = { ...initialRules[0], version: 1, condition: '旧条件' };
    const current = { ...initialRules[0], version: 3 };
    const rolled = RuleLifecycleService.rollback(current, [v1, current], 1);
    expect(rolled.version).toBe(4);
    expect(rolled.condition).toBe('旧条件');
  });
});

describe('task assignment and currency', () => {
  it('claims, detects overdue, releases and transfers a task', () => {
    const claim = { ...initialReimbursements[4], workflowStatus:'WAITING_MANUAL_REVIEW' as const, assignedTo:undefined, dueAt:new Date(Date.now()-1000).toISOString() };
    const user = { id:'U1',tenantId:TENANT_ID,employeeId:'E001',name:'财务',role:'FINANCE' as const,permissions:['claim:review'] as const };
    expect(TaskAssignmentService.isOverdue(claim)).toBe(true);
    const claimed = TaskAssignmentService.claim(claim,user as any);
    expect(claimed.assignedTo).toBe('U1');
    expect(TaskAssignmentService.release(claimed,user as any).assignedTo).toBeUndefined();
    expect(TaskAssignmentService.transfer(claimed,user as any,'U2').assignedTo).toBe('U2');
  });
  it('formats supported currencies and rejects unsupported ones', () => {
    expect(CurrencyService.format(120,'USD')).toContain('$');
    expect(() => CurrencyService.assertSupported('GBP')).toThrow();
  });
});
