import { useState } from 'react';
import { LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { AuthService } from './services';
import type { SessionUser } from './types';

export function LoginPage({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try { setError(''); onLogin(AuthService.login(username, password)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试'); }
  };
  const fill = (account: 'employee' | 'finance') => {
    const finance = account === 'finance';
    setUsername(finance ? 'finance@xinghai.com' : 'employee@xinghai.com');
    setPassword(finance ? 'Finance@2026' : 'Employee@2026');
  };
  return <main className="login-page">
    <section className="login-card">
      <div className="login-brand"><span><ShieldCheck /></span><div><b>衡策</b><small>FINWISE · 企业财务智能审核</small></div></div>
      <div className="login-title"><h1>欢迎登录</h1><p>使用企业账号进入与您身份匹配的工作台。</p></div>
      <form onSubmit={submit}>
        <label>企业账号<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="name@xinghai.com" required /></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" required /></label>
        {error && <p className="login-error">{error}</p>}
        <button className="primary login-submit" type="submit"><LockKeyhole />登录系统</button>
      </form>
      <div className="demo-accounts"><b>演示账号</b><p>点击卡片自动填入，登录后按身份进入员工报销或财务审核工作台。</p>
        <button type="button" onClick={() => fill('employee')}><UserRound /><span>普通员工 · 陈晨</span><small>账号：employee@xinghai.com　密码：Employee@2026</small></button>
        <button type="button" onClick={() => fill('finance')}><ShieldCheck /><span>财务部 · 王敏</span><small>账号：finance@xinghai.com　密码：Finance@2026</small></button>
      </div>
    </section>
  </main>;
}
