// Shared types, Zod schemas, and pure helpers for the Subject Progress
// module. Client-safe: no server-only imports.
//
// This module is intentionally 100% independent from Routine, Quiz, Mock
// Test, Custom Exam, Wrong Questions, Bookmarks and the existing
// analytics/progress/dashboard/leaderboard pipelines. It ONLY reads the
// existing MCQ Practice data (via mcqs + mcq_practice_progress) to derive
// per-chapter MCQ completion — never writes to any of those tables.

import { z } from "zod";

// ---------- Enums / constants ----------

export const MANUAL_STATUS = ["not_started", "in_progress", "completed"] as const;
export type ManualStatus = (typeof MANUAL_STATUS)[number];

export const MANUAL_TRACKS = ["class", "slide", "book"] as const;
export type ManualTrack = (typeof MANUAL_TRACKS)[number];

/** Weighted contribution of each track to overall chapter completion. */
export const TRACK_WEIGHT = 0.25 as const;

/** Chapter is "completed" when overall completion is at (or above) 100%. */
export const COMPLETION_THRESHOLD = 100 as const;

export const STUDENT_STATUS = ["on_track", "behind", "at_risk", "complete"] as const;
export type StudentStatus = (typeof STUDENT_STATUS)[number];

// ---------- Zod primitives ----------

export const uuid = z.string().uuid();
export const shortText = z.string().trim().min(1).max(200);
export const optionalText = z.string().trim().max(2000).optional().nullable();

// ---------- Input schemas ----------

export const subjectIdSchema = z.object({ subjectId: uuid });
export const chapterIdSchema = z.object({ chapterId: uuid });
export const studentIdSchema = z.object({ studentId: uuid });

export const trackUpdateSchema = z.object({
  chapterId: uuid,
  status: z.enum(MANUAL_STATUS),
});

export const subjectReportSchema = z.object({
  subjectId: uuid.optional(),
});

/** Server-side pagination + filters for admin lists. */
export const adminListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  level: z.string().trim().max(100).optional(),
  subjectId: uuid.optional(),
  chapterId: uuid.optional(),
  studentId: uuid.optional(),
  status: z.enum(STUDENT_STATUS).optional(),
  progressMin: z.number().int().min(0).max(100).optional(),
  progressMax: z.number().int().min(0).max(100).optional(),
  page: z.number().int().min(1).max(2000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum([
      "student_name",
      "overall_progress",
      "average_progress",
      "completed_chapters",
      "last_updated",
      "level",
      "subject",
    ])
    .default("overall_progress"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const adminStudentSubjectSchema = z.object({
  studentId: uuid,
  subjectId: uuid.optional(),
});

export const adminSubjectAnalyticsSchema = z.object({
  subjectId: uuid.optional(),
  level: z.string().trim().max(100).optional(),
});

export const adminChapterAnalyticsSchema = z.object({
  subjectId: uuid,
});

export const adminExportSchema = adminListSchema.extend({
  format: z.enum(["csv", "xlsx", "pdf"]).default("csv"),
});

// ---------- Return DTOs ----------

export type SubjectDTO = {
  id: string;
  name: string;
  slug: string | null;
  level: string | null;
  color: string | null;
  icon: string | null;
};

export type ChapterProgressDTO = {
  chapterId: string;
  chapterName: string;
  subjectId: string;
  classStatus: ManualStatus;
  slideStatus: ManualStatus;
  bookStatus: ManualStatus;
  mcqCompleted: number;
  mcqTotal: number;
  mcqPercent: number;
  chapterCompletion: number;
  chapterCompletionBucket: 0 | 25 | 50 | 75 | 100;
  lastUpdatedAt: string | null;
  classUpdatedAt: string | null;
  slideUpdatedAt: string | null;
  bookUpdatedAt: string | null;
};

export type SubjectSummaryDTO = {
  subjectId: string | null;
  totalChapters: number;
  completedChapters: number;
  incompleteChapters: number;
  overallProgress: number;
  averageProgress: number;
  classCompletion: number;
  slideCompletion: number;
  bookCompletion: number;
  mcqCompletion: number;
  lastActivityAt: string | null;
  status: StudentStatus;
};

export type SubjectProgressResponse = {
  subject: SubjectDTO | null;
  summary: SubjectSummaryDTO;
  chapters: ChapterProgressDTO[];
  /** True when the tracking tables have not been provisioned yet. */
  fallback: boolean;
};

export type PagedResult<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  fallback: boolean;
};

export type AdminStudentRow = {
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  level: string | null;
  subjectId: string;
  subjectName: string;
  completedChapters: number;
  totalChapters: number;
  averageProgress: number;
  overallProgress: number;
  status: StudentStatus;
  lastUpdatedAt: string | null;
};

// ---------- Pure math helpers ----------

/** Map a manual (class/slide/book) status to a 0..100 percentage. */
export function statusPct(s: ManualStatus): number {
  return s === "completed" ? 100 : s === "in_progress" ? 50 : 0;
}

/** Clamp + round to a 0..100 integer. */
export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Snap a raw completion to the required display buckets: 0 / 25 / 50 / 75 / 100.
 * Matches the product spec ("Automatically display 0%, 25%, 50%, 75%, 100%").
 */
export function snapBucket(pct: number): 0 | 25 | 50 | 75 | 100 {
  const buckets = [0, 25, 50, 75, 100] as const;
  const clamped = clampPct(pct);
  return buckets.reduce<0 | 25 | 50 | 75 | 100>(
    (best, b) => (Math.abs(b - clamped) < Math.abs(best - clamped) ? b : best),
    0,
  );
}

/**
 * Weighted chapter completion (0..100).
 *   Class 25% + Slide 25% + Book 25% + MCQ 25%
 * Where class/slide/book contribute via statusPct(s) and MCQ contributes via
 * its real 0..100 completion percentage — never a fake value.
 */
export function computeChapterCompletion(row: {
  classStatus: ManualStatus;
  slideStatus: ManualStatus;
  bookStatus: ManualStatus;
  mcqPercent: number;
}): number {
  const raw =
    statusPct(row.classStatus) * TRACK_WEIGHT +
    statusPct(row.slideStatus) * TRACK_WEIGHT +
    statusPct(row.bookStatus) * TRACK_WEIGHT +
    clampPct(row.mcqPercent) * TRACK_WEIGHT;
  return clampPct(raw);
}

/**
 * Derived per-student status label for admin dashboards.
 * "at_risk": <25%, "behind": 25..49%, "on_track": 50..99%, "complete": 100%.
 */
export function deriveStudentStatus(overall: number): StudentStatus {
  const p = clampPct(overall);
  if (p >= 100) return "complete";
  if (p >= 50) return "on_track";
  if (p >= 25) return "behind";
  return "at_risk";
}

/** Missing table sentinel (Supabase 42P01) — same convention as routine-shared. */
export function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  const msg = (err as { message?: string }).message ?? "";
  return code === "42P01" || /relation .* does not exist/i.test(msg);
}

/** Standardised success envelope used by every server fn in this module. */
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; code: "validation" | "not_found" | "forbidden" | "conflict" | "server" };
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(code: Err["code"], error: string): Err {
  return { ok: false, code, error };
}
