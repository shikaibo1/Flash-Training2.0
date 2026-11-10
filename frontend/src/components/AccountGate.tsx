import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowRight, GitBranch, LockKeyhole, Shapes, Sprout } from "lucide-react";
import { AccountContext } from "../hooks/useAccount";
import { ApiError, authApi, setApiAccount } from "../lib/api";
import type { Account } from "../lib/api";

function announceAccountChange() {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("flash-account");
    channel.postMessage("changed");
    channel.close();
  }
}

function SignIn() {
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (registering && password !== confirmation) { setError("两次输入的密码不一致。"); return; }
    setBusy(true);
    setError("");
    try {
      if (registering) await authApi.register(username.trim(), password, displayName.trim());
      else await authApi.login(username.trim(), password);
      announceAccountChange();
      // Reload clears pending work and all in-memory caches from a previous account.
      window.location.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "登录失败，请重试。");
      setBusy(false);
    }
  };
  return <main className="account-page">
    <section className="account-intro">
      <div className="account-brand"><Shapes size={28} /><strong>FlashTrain<span>.</span></strong></div>
      <span className="account-eyebrow">YOUR LEARNING, CONNECTED</span>
      <h1>让每一次练习，<br />都属于你的成长。</h1>
      <p>从课堂知识出发，在真实任务中练习，逐渐连接起自己的能力地图。</p>
      <div className="account-benefits"><span><Sprout size={20} />接着上次的学习目标继续</span><span><GitBranch size={20} />积累属于自己的能力证据</span><span><LockKeyhole size={20} />按账号保存项目与练习记录</span></div>
    </section>
    <section className="account-card" aria-labelledby="account-title">
      <div className="account-tabs" aria-label="账号入口">
        <button type="button" aria-pressed={!registering} disabled={busy} onClick={() => { setRegistering(false); setError(""); setPassword(""); setConfirmation(""); }}>登录</button>
        <button type="button" aria-pressed={registering} disabled={busy} onClick={() => { setRegistering(true); setError(""); setPassword(""); }}>注册</button>
      </div>
      <h2 id="account-title">{registering ? "创建你的学习账号" : "欢迎回到学习空间"}</h2>
      <p>{registering ? "创建后自动登录，从第一个目标开始。" : "登录后继续你的目标、练习与复测。"}</p>
      <form onSubmit={submit} className="account-form">
        {registering && <label>昵称<input autoComplete="nickname" value={displayName} maxLength={40} required onChange={event => setDisplayName(event.target.value)} disabled={busy} placeholder="怎么称呼你" /></label>}
        <label>用户名<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" disabled={busy} spellCheck={false} autoCapitalize="none" placeholder="3–32 位字母、数字或下划线" /></label>
        <label>密码<input type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={128} disabled={busy} placeholder="8–128 位，区分大小写" /></label>
        {registering && <label>确认密码<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={8} maxLength={128} disabled={busy} placeholder="再次输入密码" /></label>}
        {error && <p className="account-error" role="alert">{error}</p>}
        <button className="account-submit" type="submit" disabled={busy}>{busy ? "正在处理…" : registering ? "创建账号并进入" : "登录学习空间"}<ArrowRight size={17} /></button>
      </form>
      <p className="account-note">用户名不区分大小写。登录状态保留 30 天；共用设备时请在使用后退出。</p>
    </section>
  </main>;
}

export default function AccountGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    let active = true;
    authApi.me().then(value => {
      if (active) { setApiAccount(value.user_id); setAccount(value); setError(""); }
    }).catch(failure => {
      if (!active) return;
      if (failure instanceof ApiError && failure.status === 401) { setApiAccount(null); setAccount(null); setError(""); }
      else setError(failure instanceof Error ? failure.message : "无法读取账号状态。");
    }).finally(() => { if (active) setLoading(false); });
    const expired = () => { setApiAccount(null); setAccount(null); setError(""); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("flash-account") : null;
    if (channel) channel.onmessage = () => window.location.reload();
    const restored = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("auth:expired", expired);
    window.addEventListener("pageshow", restored);
    return () => { active = false; channel?.close(); window.removeEventListener("auth:expired", expired); window.removeEventListener("pageshow", restored); };
  }, [revision]);

  const logout = async () => {
    setLoggingOut(true);
    setError("");
    try {
      await authApi.logout();
      setApiAccount(null);
      announceAccountChange();
      window.location.replace("/");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "退出失败，请重试。");
      setLoggingOut(false);
    }
  };
  if (loading || loggingOut) return <main className="account-status" role="status">{loggingOut ? "正在退出账号…" : "正在恢复登录状态…"}</main>;
  if (error && !account) return <main className="account-status"><p role="alert">{error}</p><button onClick={() => { setLoading(true); setRevision(value => value + 1); }}>重新连接</button></main>;
  if (!account) return <SignIn />;
  return <AccountContext.Provider value={{ account, logout }}>
    {error && <div className="account-session-error" role="alert">{error}</div>}
    {children}
  </AccountContext.Provider>;
}
