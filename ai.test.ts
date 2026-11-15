import { describe, it, expect } from "vitest";
import { ReviewSchema } from "./ai.js";

const valid = { summary: "ok", overallScore: 80, scores: { security: 90, performance: 80, readability: 85, maintainability: 85 }, issues: [] };
describe("AI response validation", () => {
  it("accepts a valid review", () => expect(ReviewSchema.parse(valid).strengths).toEqual([]));
  it("rejects out-of-range scores", () => expect(() => ReviewSchema.parse({ ...valid, overallScore: 150 })).toThrow());
  it("rejects unknown severity", () => expect(() => ReviewSchema.parse({ ...valid, issues: [{ title: "x", severity: "bad", category: "bug", description: "", codeSnippet: "", recommendation: "", suggestedFix: "" }] })).toThrow());
});
