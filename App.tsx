import { useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";

type Issue = { id: string; title: string; severity: string; category: string; lineNumber: number | null; description: string; codeSnippet: string; recommendation: string; suggestedFix: string };
type Review = { id: string; projectName: string; language: string; sourceCode: string; overallScore: number; securityScore: number; performanceScore: number; readabilityScore: number; maintainabilityScore: number; reviewSummary: string; strengths: string[]; recommendations: string[]; issues: Issue[] };

const LANGS = ["javascript", "typescript", "python", "java", "c", "cpp", "csharp", "php", "go", "rust", "sql", "html", "css"];
const CATS = ["Bug detection", "Security", "Performance", "Code quality", "Best practices", "Maintainability"];

async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = localStorage.getItem("cg_token");
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) { if (res.status === 401) localStorage.removeItem("cg_token"); throw new Error(j.error || "Request failed"); }
  return j.data;
}

const save = (text: string, name: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text])); a.download = name; a.click(); };

function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const submit = async () => {
    try { const d = await api<{ token: string }>(`/auth/${mode}`, { body: f }); localStorage.setItem("cg_token", d.token); onDone(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="auth card">
      <h2>CodeGuard AI</h2>
      {mode === "register" && <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
      <input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input placeholder="Password (8+ characters)" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {err && <div className="err">{err}</div>}
      <button className="btn" onClick={submit}>{mode === "login" ? "Log in" : "Create account"}</button>
      <button className="btn ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Need an account? Register" : "Have an account? Log in"}</button>
    </div>
  );
}

function IssueCard({ issue, review }: { issue: Issue; review: Review }) {
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState<{ fixedCode: string; explanation: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const getFix = async () => {
    setBusy(true); setErr("");
    try { setFix(await api("/ai/fix", { body: { reviewId: review.id, issueId: issue.id } })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className="row" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <span className={`sev ${issue.severity}`}>{issue.severity}</span><b>{issue.title}</b>
        <span style={{ color: "var(--mut)" }}>{issue.category}{issue.lineNumber ? ` · line ${issue.lineNumber}` : ""}</span>
      </div>
      {open && <>
        <p>{issue.description}</p>
        <pre>{issue.codeSnippet}</pre>
        <p><b>Recommendation:</b> {issue.recommendation}</p>
        <pre>{issue.suggestedFix}</pre>
        <button className="btn" disabled={busy} onClick={getFix}>{busy ? "Generating fix…" : "Fix this issue"}</button>
        {err && <span className="err"> {err}</span>}
        {fix && <>
          <p>{fix.explanation}</p>
          <DiffEditor height="260px" theme="vs-dark" language={review.language} original={review.sourceCode} modified={fix.fixedCode} options={{ readOnly: true, renderSideBySide: true }} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={() => navigator.clipboard.writeText(fix.fixedCode)}>Copy corrected code</button>
            <button className="btn ghost" onClick={() => save(fix.fixedCode, `fixed.${review.language}`)}>Download</button>
          </div>
        </>}
      </>}
    </div>
  );
}

function Results({ r }: { r: Review }) {
  const s = [["Overall", r.overallScore], ["Security", r.securityScore], ["Performance", r.performanceScore], ["Readability", r.readabilityScore], ["Maintainability", r.maintainabilityScore]] as const;
  const order = ["critical", "high", "medium", "low"];
  return (
    <>
      <div className="scores">{s.map(([k, v]) => <div key={k} className="card score"><b style={{ color: v >= 80 ? "var(--green)" : v >= 60 ? "var(--amber)" : "var(--red)" }}>{v}</b>{k}</div>)}</div>
      <div className="card"><p>{r.reviewSummary}</p>
        {r.strengths.length > 0 && <p><b>Strengths:</b> {r.strengths.join("; ")}</p>}
        {r.recommendations.length > 0 && <p><b>Next steps:</b> {r.recommendations.join("; ")}</p>}
        <button className="btn ghost" onClick={async () => save(JSON.stringify(await api(`/reports/${r.id}/json`), null, 2), `review-${r.id}.json`)}>Download JSON report</button>
      </div>
      {r.issues.length === 0 && <div className="card">No issues found. This is not a guarantee the code is secure or bug-free.</div>}
      {[...r.issues].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).map((i) => <IssueCard key={i.id} issue={i} review={r} />)}
    </>
  );
}

function Workspace({ onSaved }: { onSaved: (r: Review) => void }) {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [name, setName] = useState("");
  const [depth, setDepth] = useState("standard");
  const [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const upload = async (f?: File) => {
    if (!f) return;
    if (f.size > 100_000) return setErr("File too large (100 KB max)");
    setCode(await f.text()); setName(f.name);
  };
  const run = async () => {
    setBusy(true); setErr("");
    try { onSaved(await api<Review>("/ai/analyze", { body: { projectName: name || "Untitled", language, code, depth, categories: cats.length ? cats : ["Full code review"] } })); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "2 1 420px", minWidth: 0 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
          <input type="file" accept=".js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.cs,.php,.go,.rs,.sql,.html,.css" onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn ghost" onClick={() => setCode("")}>Clear</button>
        </div>
        <Editor height="55vh" theme="vs-dark" language={language} value={code} onChange={(v) => setCode(v ?? "")} options={{ minimap: { enabled: false }, formatOnPaste: true, fontSize: 14 }} />
      </div>
      <div className="card" style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 10 }}>
        <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        {CATS.map((c) => <label key={c}><input type="checkbox" checked={cats.includes(c)} onChange={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])} /> {c}</label>)}
        <small style={{ color: "var(--mut)" }}>None selected runs a full review.</small>
        <select value={depth} onChange={(e) => setDepth(e.target.value)}><option value="quick">Quick review</option><option value="standard">Standard review</option><option value="deep">Deep analysis</option></select>
        <button className="btn" disabled={busy || !code.trim()} onClick={run}>{busy ? "Analyzing…" : "Analyze code"}</button>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}

type Row = { id: string; projectName: string; language: string; overallScore: number; createdAt: string; _count: { issues: number } };
function History({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const load = (search = q) => api<Row[]>(`/reviews?search=${encodeURIComponent(search)}`).then(setRows);
  if (rows === null) load();
  return (
    <>
      <input placeholder="Search reviews" value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
      {rows?.length === 0 && <div className="card">No reviews yet. Start one from New review.</div>}
      {rows?.map((r) => (
        <div key={r.id} className="card row" style={{ justifyContent: "space-between" }}>
          <span><b>{r.projectName}</b> · {r.language} · {new Date(r.createdAt).toLocaleDateString()}</span>
          <span className="row">Score {r.overallScore} · {r._count.issues} issues
            <button className="btn ghost" onClick={() => onOpen(r.id)}>Open</button>
            <button className="btn ghost" onClick={async () => { if (confirm("Delete this review?")) { await api(`/reviews/${r.id}`, { method: "DELETE" }); load(); } }}>Delete</button>
          </span>
        </div>
      ))}
    </>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("cg_token"));
  const [tab, setTab] = useState<"new" | "history">("new");
  const [review, setReview] = useState<Review | null>(null);
  if (!authed) return <AuthForm onDone={() => setAuthed(true)} />;
  return (
    <div className="shell">
      <nav className="side">
        <b style={{ marginBottom: 10 }}>CodeGuard AI</b>
        <button className={tab === "new" ? "on" : ""} onClick={() => { setTab("new"); setReview(null); }}>New review</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => { setTab("history"); setReview(null); }}>Review history</button>
        <button onClick={() => { localStorage.removeItem("cg_token"); setAuthed(false); }}>Log out</button>
      </nav>
      <main>
        {review ? <><button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => setReview(null)}>Back</button><Results r={review} /></>
          : tab === "new" ? <Workspace onSaved={setReview} />
          : <History onOpen={async (id) => setReview(await api<Review>(`/reviews/${id}`))} />}
      </main>
    </div>
  );
}
