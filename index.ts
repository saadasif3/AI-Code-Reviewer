import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { analyze, fixIssue } from "./ai.js";

const prisma = new PrismaClient();
const app = express();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is required");

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json({ limit: "300kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120 }));
const aiLimit = rateLimit({ windowMs: 60_000, limit: 10 });
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30 });

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const wrap = (fn: (req: any, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const auth = (req: any, res: Response, next: NextFunction) => {
  try {
    const t = (req.headers.authorization || "").replace("Bearer ", "");
    req.userId = (jwt.verify(t, JWT_SECRET) as { sub: string }).sub;
    next();
  } catch { res.status(401).json({ success: false, error: "Unauthorized" }); }
};
const sign = (id: string) => jwt.sign({ sub: id }, JWT_SECRET, { expiresIn: "7d" });

const Creds = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(100) });
app.post("/api/auth/register", authLimit, wrap(async (req, res) => {
  const b = Creds.extend({ name: z.string().min(1).max(100) }).parse(req.body);
  if (await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } })) return res.status(409).json({ success: false, error: "Email already registered" });
  const u = await prisma.user.create({ data: { name: b.name, email: b.email.toLowerCase(), passwordHash: await bcrypt.hash(b.password, 12) } });
  ok(res, { token: sign(u.id), user: { id: u.id, name: u.name, email: u.email } }, 201);
}));
app.post("/api/auth/login", authLimit, wrap(async (req, res) => {
  const b = Creds.parse(req.body);
  const u = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
  if (!u || !(await bcrypt.compare(b.password, u.passwordHash))) return res.status(401).json({ success: false, error: "Invalid email or password" });
  ok(res, { token: sign(u.id), user: { id: u.id, name: u.name, email: u.email } });
}));
app.post("/api/auth/logout", (_req, res) => ok(res, null)); // stateless JWT: client discards token
app.get("/api/auth/me", auth, wrap(async (req, res) => {
  ok(res, await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true } }));
}));

const LANGS = ["javascript", "typescript", "python", "java", "c", "cpp", "csharp", "php", "go", "rust", "sql", "html", "css"] as const;
const AnalyzeBody = z.object({
  projectName: z.string().min(1).max(120).default("Untitled"),
  language: z.enum(LANGS),
  code: z.string().min(1).max(60_000),
  categories: z.array(z.string()).default(["Full code review"]),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
});

// Code is only sent to the model as text; it is never executed.
app.post("/api/ai/analyze", auth, aiLimit, wrap(async (req, res) => {
  const b = AnalyzeBody.parse(req.body);
  const r = await analyze(b.code, b.language, b.categories, b.depth);
  const review = await prisma.codeReview.create({
    data: {
      userId: req.userId, projectName: b.projectName, language: b.language, sourceCode: b.code,
      overallScore: r.overallScore, securityScore: r.scores.security, performanceScore: r.scores.performance,
      readabilityScore: r.scores.readability, maintainabilityScore: r.scores.maintainability,
      reviewSummary: r.summary, strengths: r.strengths, recommendations: r.recommendations,
      issues: { create: r.issues.map((i) => ({ ...i, lineNumber: i.lineNumber ?? null })) },
    },
    include: { issues: true },
  });
  ok(res, review, 201);
}));

app.post("/api/ai/fix", auth, aiLimit, wrap(async (req, res) => {
  const b = z.object({ reviewId: z.string(), issueId: z.string() }).parse(req.body);
  const review = await prisma.codeReview.findFirst({ where: { id: b.reviewId, userId: req.userId }, include: { issues: true } });
  const issue = review?.issues.find((i) => i.id === b.issueId);
  if (!review || !issue) return res.status(404).json({ success: false, error: "Not found" });
  ok(res, await fixIssue(review.sourceCode, review.language, issue)); // original is never overwritten
}));

app.get("/api/reviews", auth, wrap(async (req, res) => {
  const q = z.object({ search: z.string().optional(), language: z.string().optional() }).parse(req.query);
  ok(res, await prisma.codeReview.findMany({
    where: { userId: req.userId, language: q.language || undefined, projectName: q.search ? { contains: q.search, mode: "insensitive" } : undefined },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, projectName: true, language: true, overallScore: true, createdAt: true, _count: { select: { issues: true } } },
  }));
}));
app.get("/api/reviews/:id", auth, wrap(async (req, res) => {
  const r = await prisma.codeReview.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { issues: true } });
  r ? ok(res, r) : res.status(404).json({ success: false, error: "Not found" });
}));
app.delete("/api/reviews/:id", auth, wrap(async (req, res) => {
  const { count } = await prisma.codeReview.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  count ? ok(res, null) : res.status(404).json({ success: false, error: "Not found" });
}));
app.get("/api/reports/:id/json", auth, wrap(async (req, res) => {
  const r = await prisma.codeReview.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { issues: true } });
  r ? ok(res, r) : res.status(404).json({ success: false, error: "Not found" });
}));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: "Invalid input or malformed AI response", details: err.issues.map((i) => i.message) });
  console.error(err.message); // never log source code
  res.status(500).json({ success: false, error: process.env.NODE_ENV === "production" ? "Internal error" : err.message });
});

app.listen(Number(process.env.PORT) || 4000, () => console.log("CodeGuard API ready"));
