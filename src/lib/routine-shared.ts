// Shared types, Zod schemas, constants and pure helpers for the Routine
// Management module. Client-safe: no server-only imports.
//
// This module is intentionally 100% independent from MCQ Practice, Quiz,
// Mock Test, Custom Exam, Wrong Questions, Bookmarks and the existing
// analytics/progress/dashboard/leaderboard pipelines. Nothing here reads or
// writes any of those domains.

import { z } from "zod";

export const ROUTINE_STATUS = ["active", "disabled", "archived"] as const;
export type RoutineStatus = (typeof ROUTINE_STATUS)[number];

export const REVIEW_STATUS = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[number];

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const CALENDAR_STATE = [
  "not_started",
  "in_progress",
  "completed",
  "missed",
  "holiday",
  "today",
] as const;
export type CalendarState = (typeof CALENDAR_STATE)[number];

// ---------- Zod primitives ----------

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const nonEmpty = z.string().trim().min(1).max(200);
export const optionalText = z.string().trim().max(2000).optional().nullable();

export const routineScopeSchema = z
  .object({
    level: nonEmpty,
    subjectId: uuid.optional().nullable(),
    chapterId: uuid.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    // Chapter without a subject is meaningless — reject early.
    if (v.chapterId && !v.subjectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chapterId"],
        message: "chapterId requires a subjectId",
      });
    }
  });

export const routineTargetsSchema = z.object({
  studyMinutes: z.number().int().min(0).max(24 * 60),
  mcqCount: z.number().int().min(0).max(10_000),
});

export const activeDaysSchema = z
  .array(z.enum(DAY_KEYS))
  .min(1, "Select at least one active day")
  .max(7);

export const ASSIGNMENT_MODES = ["all_students", "selected_students"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export const routineCreateSchema = z.object({
  name: nonEmpty,
  description: optionalText,
  scope: routineScopeSchema,
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  activeDays: activeDaysSchema,
  targets: routineTargetsSchema,
  assignmentMode: z.enum(ASSIGNMENT_MODES).default("all_students"),
  selectedStudentIds: z.array(uuid).max(10_000).default([]),
});

export const routineUpdateSchema = routineCreateSchema
  .partial({ scope: true, activeDays: true, targets: true, assignmentMode: true, selectedStudentIds: true })
  .extend({ id: uuid });

export const setAssignmentsSchema = z.object({
  routineId: uuid,
  mode: z.enum(ASSIGNMENT_MODES),
  studentIds: z.array(uuid).max(10_000).default([]),
});

export const listStudentsSchema = z.object({
  search: z.string().trim().max(200).optional(),
  level: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(2000).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const listAssignmentsSchema = z.object({
  routineId: uuid,
  search: z.string().trim().max(200).optional(),
  status: z.enum(["active", "removed", "all"]).default("active"),
  page: z.number().int().min(1).max(2000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const listFiltersSchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(ROUTINE_STATUS).optional(),
  level: z.string().trim().max(100).optional(),
  subjectId: uuid.optional(),
  chapterId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.number().int().min(1).max(2000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["created_at", "updated_at", "name", "start_date", "end_date"])
    .default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const reviewListSchema = z.object({
  status: z.enum(REVIEW_STATUS).optional(),
  search: z.string().trim().max(200).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.number().int().min(1).max(2000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const reviewActionSchema = z.object({
  sessionId: uuid,
  action: z.enum(["approve", "reject"]),
  adminNotes: optionalText,
});

export const dailyProgressSchema = z.object({
  routineId: uuid,
  date: isoDate,
  studyMinutes: z.number().int().min(0).max(24 * 60).optional(),
  mcqsSolved: z.number().int().min(0).max(10_000).optional(),
});

export const manualSessionCreateSchema = z.object({
  routineId: uuid,
  date: isoDate,
  title: nonEmpty,
  durationMinutes: z.number().int().min(1).max(24 * 60),
  mcqsSolved: z.number().int().min(0).max(10_000).default(0),
  notes: optionalText,
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
});

export const manualSessionUpdateSchema = manualSessionCreateSchema
  .partial()
  .extend({ id: uuid });

export const calendarRangeSchema = z.object({
  routineId: uuid.optional(),
  monthStart: isoDate,
  monthEnd: isoDate,
});

export const reportRangeSchema = z.object({
  routineId: uuid.optional(),
  period: z.enum(["daily", "weekly", "monthly", "yearly"]),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ---------- Helpers ----------

export function clampInt(n: unknown, min: number, max: number, fallback = 0): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function percent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (part / total) * 100)));
}

export function dayKeyFromDate(dateISO: string): DayKey {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return DAY_KEYS[d.getUTCDay()];
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  const msg = (err as { message?: string }).message ?? "";
  return code === "42P01" || /relation .* does not exist/i.test(msg);
}

export type RoutineDTO = {
  id: string;
  name: string;
  description: string | null;
  scope: { level: string; subjectId: string | null; chapterId: string | null };
  startDate: string | null;
  endDate: string | null;
  activeDays: DayKey[];
  targets: { studyMinutes: number; mcqCount: number };
  status: RoutineStatus;
  assignmentMode: AssignmentMode;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PagedResult<T> = {
  rows: T[];
  count: number;
  page: number;
  pageSize: number;
  /** True when the underlying storage isn't provisioned yet. */
  fallback?: boolean;
};

export type ProgressSummary = {
  studyMinutes: number;
  mcqsSolved: number;
  studyPct: number;
  mcqPct: number;
  overallPct: number;
  targetStudyMinutes: number;
  targetMcqCount: number;
};

export type StreakStats = {
  currentStreak: number;
  longestStreak: number;
  completedDays: number;
  missedDays: number;
  completionRate: number;
};