import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, FilePlus2, FileText, Info, LogOut, Paperclip, Plus, Send, ShieldAlert, Trash2, Undo2 } from 'lucide-react';
import { CurrencyService, OcrService, workflowLabel } from './services';
import type { Budget, ExpenseInvoiceDraft, Reimbursement, RuleHit, SessionUser } from './types';

export type ClaimDraftInput = { id?: string; purpose: string; category: string; budgetId: string; attachments: ExpenseInvoiceDraft[]; resubmissionOf?: string };
const money = (amount: number) => CurrencyService.format(amount);
const editable = (status: Reimbursement['workflowStatus']) => ['DRAFT', 'WAITING_SUPPLEMENT'].includes(status);
const reviewStatuses: Reimbursement['workflowStatus'][] = ['SUBMITTED', 'OCR_PROCESSING', 'WAITING_FIELD_CONFIRMATION', 'VERIFYING', 'AUDITING', 'WAITING_MANUAL_REVIEW'];
const endedStatuses: Reimbursement['workflowStatus'][] = ['APPROVED', 'REJECTED', 'PAID', 'PAYMENT_FAILED', 'CANCELLED'];

const employeeAdvice = (claim: Reimbursement): { text: string; tone: 'info' | 'warn' | 'danger' | 'success' } => {
  if (claim.workflowStatus === 'WAITING_SUPPLEMENT') return { text: claim.supplementRequest ? `财务需要您补充：${claim.supplementRequest.items.join('、')}。${claim.supplementRequest.dueAt ? `请在 ${claim.supplementRequest.dueAt.slice(0, 10)} 前完成。` : ''}补充完成后可再次提交。` : '财务需要您补充业务事由、同行名单或相关凭证。补充完成后可再次提交。', tone: 'warn' };
  if (claim.workflowStatus === 'REJECTED') return { text: '本次申请未能通过。请核对票据、公司抬头和业务信息后，新建一笔修改后的申请。', tone: 'danger' };
  if (claim.workflowStatus === 'SUSPENDED') return { text: '申请正在等待预算或相关事项处理，请耐心关注进度。', tone: 'warn' };
  if (claim.workflowStatus === 'PAYMENT_FAILED') return { text: '款项支付遇到问题，财务正在处理，无需重复提交。', tone: 'danger' };
  if (claim.workflowStatus === 'PAID') return { text: '报销款项已支付，请留意收款账户。', tone: 'success' };
  if (['PAYMENT_PENDING', 'APPROVED'].includes(claim.workflowStatus)) return { text: '申请已通过，正在安排付款。', tone: 'success' };
  return { text: '申请已提交，财务正在审核中。', tone: 'info' };
};

type FilterKey = 'all' | 'draft' | 'reviewing' | 'supplement' | 'ended';

export function EmployeePortal({ user, reimbursements, budgets, onSave, onSubmit, onWithdraw, onLogout }: {
  user: SessionUser; reimbursements: Reimbursement[]; budgets: Budget[];
  onSave: (data: ClaimDraftInput) => void; onSubmit: (data: ClaimDraftInput) => void; onWithdraw: (id: string) => void; onLogout: () => void;
}) {
  const mine = useMemo(() => reimbursements.filter(r => r.employeeId === user.employeeId).sort((a, b) => b.id.localeCompare(a.id)), [reimbursements, user]);
  const [tab, setTab] = useState<'list' | 'form'>('list');
  const [editing, setEditing] = useState<Reimbursement | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const blank = (): ClaimDraftInput => ({ purpose: '', category: '差旅', budgetId: budgets[0]?.id || '', attachments: [] });
  const [form, setForm] = useState<ClaimDraftInput>(blank);
  const [fileError, setFileError] = useState<string>('');
  const begin = (claim?: Reimbursement) => {
    setEditing(claim || null);
    setForm(claim ? { id: claim.id, purpose: claim.purpose, category: claim.category, budgetId: claim.budgetId, attachments: claim.attachments || [], resubmissionOf: claim.workflowStatus === 'REJECTED' ? claim.id : undefined } : blank());
    setFileError('');
    setTab('form');
  };
  const total = form.attachments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const save = () => { if (!form.purpose.trim()) return; onSave(form); setTab('list'); };
  const submit = () => { if (!form.purpose.trim() || !form.attachments.length || total <= 0) return; onSubmit(form); setTab('list'); };

  const addInvoice = () => setForm(v => ({ ...v, attachments: [...v.attachments, { id: `ATT-${Date.now()}`, fileName: '', category: v.category, purpose: '', amount: 0, ocrStatus: 'PENDING', verifyStatus: 'PENDING' }] }));
  const updateInvoice = (index: number, patch: Partial<ExpenseInvoiceDraft>) => setForm(v => ({ ...v, attachments: v.attachments.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  const recognizeInvoice = async (index: number, file?: File) => {
    if (!file) return;
    setFileError('');
    try { OcrService.validateFile(file); }
    catch (err) { setFileError(err instanceof Error ? err.message : '文件校验失败'); return; }
    updateInvoice(index, { fileName: file.name, ocrStatus: 'PROCESSING' });
    try {
      const result = await OcrService.recognize(file);
      const field = (name: string) => result.fields[name]?.value;
      updateInvoice(index, { ocrStatus: 'COMPLETED', invoiceNumber: String(field('number') || ''), invoiceCode: String(field('code') || ''), invoiceDate: String(field('date') || ''), seller: String(field('seller') || ''), sellerTaxId: String(field('sellerTaxId') || ''), buyer: String(field('buyer') || ''), buyerTaxId: String(field('buyerTaxId') || ''), amount: Number(field('total') || 0), tax: Number(field('tax') || 0), item: String(field('item') || ''), ocrConfidence: Math.round(Object.values(result.fields).reduce((sum, value) => sum + value.confidence, 0) / Object.keys(result.fields).length * 100), ocrWarning: result.warnings[0] });
    } catch { updateInvoice(index, { ocrStatus: 'FAILED', ocrWarning: '识别失败，请重新上传或手工填写金额' }); }
  };

  const stats = {
    draft: mine.filter(x => x.workflowStatus === 'DRAFT').length,
    reviewing: mine.filter(x => reviewStatuses.includes(x.workflowStatus)).length,
    supplement: mine.filter(x => x.workflowStatus === 'WAITING_SUPPLEMENT').length,
    paid: mine.filter(x => x.workflowStatus === 'PAID').length,
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return mine;
    if (filter === 'draft') return mine.filter(x => x.workflowStatus === 'DRAFT');
    if (filter === 'reviewing') return mine.filter(x => reviewStatuses.includes(x.workflowStatus));
    if (filter === 'supplement') return mine.filter(x => x.workflowStatus === 'WAITING_SUPPLEMENT');
    return mine.filter(x => endedStatuses.includes(x.workflowStatus));
  }, [mine, filter]);

  const filterTabs: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: mine.length },
    { key: 'draft', label: '草稿', count: stats.draft },
    { key: 'reviewing', label: '审核中', count: stats.reviewing },
    { key: 'supplement', label: '待补充', count: stats.supplement },
    { key: 'ended', label: '已结束', count: mine.filter(x => endedStatuses.includes(x.workflowStatus)).length },
  ];

  // 预算实时校验
  const selectedBudget = budgets.find(b => b.id === form.budgetId);
  const budgetRemaining = selectedBudget ? selectedBudget.total - selectedBudget.spent - selectedBudget.frozen : 0;
  const overBudget = selectedBudget && total > budgetRemaining;

  const toggleExpand = (id: string) => setExpanded(v => ({ ...v, [id]: !v[id] }));

  return <div className="employee-app">
    <header className="employee-header">
      <div className="employee-brand"><CheckCircle2 /><div><b>衡策报销</b><small>员工自助服务</small></div></div>
      <div><span>{user.name} · {user.employeeId}</span><button onClick={onLogout}><LogOut />退出登录</button></div>
    </header>
    <main className="employee-main">
      <section className="employee-hero">
        <div><p>我的报销</p><h1>轻松提交，清晰跟进</h1><span>上传发票、保存草稿并随时查看申请进度。</span></div>
        <button className="primary" onClick={() => begin()}><Plus />新建报销</button>
      </section>

      <div className="employee-tabs">
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>我的申请</button>
        <button className={tab === 'form' ? 'active' : ''} onClick={() => begin()}><FilePlus2 />填写报销</button>
      </div>

      {tab === 'list' ? (<>
        <section className="employee-stats">
          <div className="draft"><span>草稿</span><b>{stats.draft}</b></div>
          <div className="reviewing"><span>审核中</span><b>{stats.reviewing}</b></div>
          <div className="supplement"><span>待补充</span><b>{stats.supplement}</b></div>
          <div className="paid"><span>已支付</span><b>{stats.paid}</b></div>
        </section>

        <div className="filter-tabs">
          {filterTabs.map(t => <button key={t.key} className={filter === t.key ? 'active' : ''} onClick={() => setFilter(t.key)}>{t.label}<span className="badge">{t.count}</span></button>)}
        </div>

        <section className="employee-list">
          {filtered.length ? filtered.map(claim => {
            const advice = employeeAdvice(claim);
            const isOpen = !!expanded[claim.id];
            const hasHits = claim.hits && claim.hits.length > 0;
            return <article key={claim.id}>
              <div className="claim-title">
                <FileText />
                <div>
                  <b>{claim.purpose}</b>
                  <small>{claim.id} · {claim.submittedAt || '未提交'}</small>
                </div>
                <strong>{money(claim.amount)}</strong>
              </div>
              <div className="claim-meta">
                <span className={`employee-status tag-${claim.workflowStatus}`}>{workflowLabel(claim.workflowStatus)}</span>
                <span>{claim.category}</span>
                <span>{claim.attachments?.length || claim.invoiceIds?.length || 1} 张票据</span>
                {claim.urgent && <span style={{ color: '#e44c5a', fontWeight: 600 }}>加急</span>}
                {hasHits && <button onClick={() => toggleExpand(claim.id)} style={{ marginLeft: 'auto', background: 'none', border: 0, color: '#3157d5', cursor: 'pointer', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{isOpen ? <ChevronUp /> : <ChevronDown />}{isOpen ? '收起规则' : `命中 ${claim.hits.length} 条规则`}</button>}
              </div>

              {isOpen && hasHits && <div className="detail-expand">
                <h5>命中规则明细</h5>
                {claim.hits.map((hit: RuleHit) => <div className="rule-row" key={hit.id}>
                  <span>{hit.name}{hit.blocking ? ' · 阻断' : ''}</span><b>{hit.action}</b>
                </div>)}
              </div>}

              {claim.workflowStatus === 'WAITING_SUPPLEMENT' && claim.supplementRequest && <div className="supplement-box">
                <h4><ShieldAlert />需补充材料</h4>
                <ul>{claim.supplementRequest.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
                {claim.supplementRequest.dueAt && <div className="due"><Clock />截止：{claim.supplementRequest.dueAt.slice(0, 10)}</div>}
              </div>}

              <p className="advice">
                {advice.tone === 'warn' && <AlertTriangle />}
                {advice.tone === 'danger' && <AlertTriangle />}
                {advice.tone === 'success' && <CheckCircle2 />}
                {advice.tone === 'info' && <Info />}
                <span>{advice.text}</span>
              </p>

              <div className="claim-actions">
                {editable(claim.workflowStatus) && <button onClick={() => begin(claim)}>修改申请</button>}
                {claim.workflowStatus === 'WAITING_SUPPLEMENT' && <button className="primary" onClick={() => begin(claim)}>立即补充</button>}
                {claim.workflowStatus === 'REJECTED' && <button onClick={() => begin(claim)}>按此申请重新填写</button>}
                {['DRAFT', ...reviewStatuses, 'WAITING_SUPPLEMENT', 'SUSPENDED'].includes(claim.workflowStatus) && <button className="danger-link" onClick={() => { if (window.confirm(`确认撤回「${claim.purpose}」吗？撤回后可在草稿中继续编辑。`)) onWithdraw(claim.id); }}><Undo2 />撤回</button>}
              </div>
            </article>;
          }) : <div className="employee-empty">
            <FileText />
            <b>{filter === 'all' ? '还没有报销申请' : '该状态下暂无申请'}</b>
            <span>从一笔已开具的发票开始吧。</span>
            {filter === 'all' && <button className="primary" onClick={() => begin()}><Plus />新建报销</button>}
          </div>}
        </section>
      </>) : (
        <section className="claim-form">
          <div className="form-title">
            <div><h2>{editing ? '修改报销申请' : '新建报销申请'}</h2><p>请如实填写业务信息；提交后财务会进行审核。</p></div>
            <b>合计 {money(total)}</b>
          </div>
          <div className="form-grid">
            <label>费用科目<select value={form.category} onChange={e => setForm(v => ({ ...v, category: e.target.value }))}><option>差旅</option><option>住宿</option><option>交通</option><option>餐饮</option><option>办公用品</option><option>技术服务</option></select></label>
            <label>使用预算<select value={form.budgetId} onChange={e => setForm(v => ({ ...v, budgetId: e.target.value }))}>{budgets.map(b => <option key={b.id} value={b.id}>{b.name}（可用 {money(b.total - b.spent - b.frozen)}）</option>)}</select></label>
            {selectedBudget && <div className={`budget-hint${overBudget ? ' warn' : ''}`}>
              {overBudget ? <AlertTriangle /> : <Info />}
              <span>预算 {selectedBudget.name}：可用 {money(budgetRemaining)}，本单合计 {money(total)}{overBudget ? `，已超支 ${money(total - budgetRemaining)}` : '，预算充足'}</span>
            </div>}
            <label className="wide">业务事由<textarea value={form.purpose} onChange={e => setForm(v => ({ ...v, purpose: e.target.value }))} placeholder="例如：客户需求调研市内交通" /></label>
          </div>

          <div className="invoice-form-head">
            <div><h3>报销票据</h3><p>支持 JPG / PNG / WebP / PDF，单张 ≤ 10MB，上传后自动识别发票字段。</p></div>
            <button onClick={addInvoice}><Plus />添加票据</button>
          </div>

          {fileError && <p className="advice danger"><AlertTriangle /><span>{fileError}</span></p>}

          {form.attachments.map((row, index) => <div className="invoice-row" key={row.id}>
            <label className="file-field"><Paperclip /><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => recognizeInvoice(index, e.target.files?.[0])} /><span>{row.ocrStatus === 'PROCESSING' ? '正在识别…' : row.fileName || '选择发票文件'}</span></label>
            <input value={row.purpose} onChange={e => updateInvoice(index, { purpose: e.target.value })} placeholder="票据用途" />
            <input type="number" min="0" step="0.01" value={row.amount || ''} onChange={e => updateInvoice(index, { amount: Number(e.target.value) })} placeholder="金额" />
            <button aria-label="删除票据" onClick={() => setForm(v => ({ ...v, attachments: v.attachments.filter((_, i) => i !== index) }))}><Trash2 /></button>
            {row.ocrStatus === 'COMPLETED' && <small className={`ocr-result${row.ocrWarning ? ' warn' : ''}`}>已识别：{row.invoiceNumber} · {row.seller} · {money(row.amount)}{row.ocrWarning ? ` · ${row.ocrWarning}` : ''}</small>}
            {row.ocrStatus === 'FAILED' && <small className="ocr-result error">识别失败，请手工填写金额</small>}
          </div>)}

          {!form.attachments.length && <button className="add-invoice-empty" onClick={addInvoice}><Plus />添加第一张票据</button>}

          <div className="form-actions">
            <button onClick={() => setTab('list')}>取消</button>
            <button onClick={save} disabled={!form.purpose.trim()}>保存草稿</button>
            <button className="primary" onClick={submit} disabled={!form.purpose.trim() || !form.attachments.length || total <= 0 || !!overBudget}><Send />提交审核</button>
          </div>
        </section>
      )}
    </main>
  </div>;
}
