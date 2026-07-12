/* eslint-disable @typescript-eslint/no-explicit-any */
// Student-facing server functions for the Subject Progress module.
//
// Every endpoint:
//   - Requires an authenticated session (requireSupabaseAuth middleware).
//   - Scopes all reads/writes to context.userId — students can never touch
//     another student's rows.
//   - Validates input with zod (see subject-progress-shared).
//   - Handles missing-table (42P01) gracefully so the UI keeps functioning
//     before the SQL phase lands. No fake/demo/mock data is ever returned.
//
// Data ownership:
//   OWN tables (assumed post-migration):
//     - public.subject_progress_chapter
//         (user_id, chapter_id, class_status, slide_status, book_status,
//          class_updated_at, slide_updated_at, book_updated_at,
//          created_at, updated_at)
//     - public.subject_progress_activity_log
//         (user_id, action, entity_type, entity_id, metadata, created_at)
//   READ-ONLY external tables (existing):
//     - public.subjects, public.chapters  (enumeration)
//     - public.mcqs, public.mcq_practice_progress (MCQ completion sync)
//
// This module NEVER writes to MCQ Practice, Quiz, Mock, Custom Exam, Routine,
// Wrong Questions, Bookmarks, or the existing analytics tables.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validate, noInput } from "@/lib/validate";
import {
  adminExportSchema, // re-used by report shape only
  chapterIdSchema,
  clampPct,
  computeChapterCompletion,
  deriveStudentStatus,
  err,
  isMissingTable,
  MANUAL_STATUS,
  ok,
  snapBucket,
  statusPct,
  subjectIdSchema,
  subjectReportSchema,
  trackUpdateSchema,
  type ChapterProgressDTO,
  type ManualStatus,
  type ManualTrack,
  type Result,
  type SubjectDTO,
  type SubjectProgressResponse,
  type SubjectSummaryDTO,
} from "@/lib/subject-progress-shared";

const asAny = (x: unknown) => x as any;

// ---------------------------------------------------------------- //
// Internal helpers
// ---------------------------------------------------------------- //

async function loadSubject(sb: any, subjectId: string): Promise<SubjectDTO | null> {
  const { data, error } = await sb
    .from("subjects")
    .select("id,name,slug,level,color,icon")
    .eq("id", subjectId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug ?? null,
    level: data.level ?? null,
    color: data.color ?? null,
    icon: data.icon ?? null,
  };
}

async function loadChaptersForSubject(sb: any, subjectId: string) {
  const { data, error } = await sb
    .from("chapters")
    .select("id,name,subject_id,sort_order,status")
    .eq("subject_id", subjectId)
    .eq("status", "published")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string; subject_id: string }>;
}

/**
 * Load per-chapter MCQ completion for a set of chapter IDs, for one user.
 * Source of truth: `mcqs` (all published MCQs for the chapter) +
 * `mcq_practice_progress` (this user's answered MCQs). We count distinct
 * MCQs the user has answered correctly. This module NEVER writes here.
 * Returns a Map<chapterId, { completed, total, percent }>.
 */
async function loadMcqProgressByChapter(
  sb: any,
  userId: string,
  chapterIds: string[],
): Promise<Map<string, { completed: number; total: number; percent: number }>> {
  const empty = new Map<string, { completed: number; total: number; percent: number }>();
  if (chapterIds.length === 0) return empty;

  // Totals per chapter — from the canonical `mcqs` table.
  const totalsById = new Map<string, number>();
  const perChapterMcqIds = new Map<string, Set<string>>();
  const pageSize = 1000;
  let from = 0;
  // Loop with hard cap to avoid runaway on hostile data.
  for (let i = 0; i < 200; i++) {
    const { data, error } = await sb
      .from("mcqs")
      .select("id,chapter_id")
      .in("chapter_id", chapterIds)
      .eq("status", "published")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string; chapter_id: string | null }>;
    for (const r of rows) {
      if (!r.chapter_id) continue;
      totalsById.set(r.chapter_id, (totalsById.get(r.chapter_id) ?? 0) + 1);
      const set = perChapterMcqIds.get(r.chapter_id) ?? new Set<string>();
      set.add(r.id);
      perChapterMcqIds.set(r.chapter_id, set);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // Correctly-answered distinct MCQs per chapter for this user.
  const completedByChapter = new Map<string, Set<string>>();
  from = 0;
  for (let i = 0; i < 200; i++) {
    const { data, error } = await sb
      .from("mcq_practice_progress")
      .select("mcq_id,chapter_id,is_correct")
      .eq("user_id", userId)
      .eq("is_correct", true)
      .in("chapter_id", chapterIds)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      mcq_id: string;
      chapter_id: string | null;
      is_correct: boolean;
    }>;
    for (const r of rows) {
      if (!r.chapter_id) continue;
      // Only count if the MCQ still belongs to that chapter and is published.
      const publishedSet = perChapterMcqIds.get(r.chapter_id);
      if (!publishedSet || !publishedSet.has(r.mcq_id)) continue;
      const done = completedByChapter.get(r.chapter_id) ?? new Set<string>();
      done.add(r.mcq_id);
      completedByChapter.set(r.chapter_id, done);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const out = new Map<string, { completed: number; total: number; percent: number }>();
  for (const cid of chapterIds) {
    const total = totalsById.get(cid) ?? 0;
    const completed = completedByChapter.get(cid)?.size ?? 0;
    const percent = total > 0 ? clampPct((completed / total) * 100) : 0;
    out.set(cid, { completed, total, percent });
  }
  return out;
}

/** Fetch the student's own manual progress rows for a chapter set. */
async function loadOwnProgressByChapter(
  sb: any,
  userId: string,
  chapterIds: string[],
): Promise<{
  byId: Map<
    string,
    {
      classStatus: ManualStatus;
      slideStatus: ManualStatus;
      bookStatus: ManualStatus;
      classUpdatedAt: string | null;
      slideUpdatedAt: string | null;
      bookUpdatedAt: string | null;
      updatedAt: string | null;
    }
  >;
  fallback: boolean;
}> {
  if (chapterIds.length === 0) return { byId: new Map(), fallback: false };
  const { data, error } = await sb
    .from("subject_progress_chapter")
    .select(
      "chapter_id,class_status,slide_status,book_status,class_updated_at,slide_updated_at,book_updated_at,updated_at",
    )
    .eq("user_id", userId)
    .in("chapter_id", chapterIds);
  if (error) {
    if (isMissingTable(error)) return { byId: new Map(), fallback: true };
    throw error;
  }
  const byId = new Map<
    string,
    {
      classStatus: ManualStatus;
      slideStatus: ManualStatus;
      bookStatus: ManualStatus;
      classUpdatedAt: string | null;
      slideUpdatedAt: string | null;
      bookUpdatedAt: string | null;
      updatedAt: string | null;
    }
  >();
  for (const r of (data ?? []) as any[]) {
    byId.set(r.chapter_id, {
      classStatus: (r.class_status ?? "not_started") as ManualStatus,
      slideStatus: (r.slide_status ?? "not_started") as ManualStatus,
      bookStatus: (r.book_status ?? "not_started") as ManualStatus,
      classUpdatedAt: r.class_updated_at ?? null,
      slideUpdatedAt: r.slide_updated_at ?? null,
      bookUpdatedAt: r.book_updated_at ?? null,
      updatedAt: r.updated_at ?? null,
    });
  }
  return { byId, fallback: false };
}

function assembleChapterRows(
  chapters: Array<{ id: string; name: string; subject_id: string }>,
  ownById: Map<string, {
    classStatus: ManualStatus;
    slideStatus: ManualStatus;
    bookStatus: ManualStatus;
    classUpdatedAt: string | null;
    slideUpdatedAt: string | null;
    bookUpdatedAt: string | null;
    updatedAt: string | null;
  }>,
  mcqById: Map<string, { completed: number; total: number; percent: number }>,
): ChapterProgressDTO[] {
  return chapters.map((ch) => {
    const own = ownById.get(ch.id) ?? {
      classStatus: "not_started" as ManualStatus,
      slideStatus: "not_started" as ManualStatus,
      bookStatus: "not_started" as ManualStatus,
      classUpdatedAt: null,
      slideUpdatedAt: null,
      bookUpdatedAt: null,
      updatedAt: null,
    };
    const mcq = mcqById.get(ch.id) ?? { completed: 0, total: 0, percent: 0 };
    const chapterCompletion = computeChapterCompletion({
      classStatus: own.classStatus,
      slideStatus: own.slideStatus,
      bookStatus: own.bookStatus,
      mcqPercent: mcq.percent,
    });
    return {
      chapterId: ch.id,
      chapterName: ch.name,
      subjectId: ch.subject_id,
      classStatus: own.classStatus,
      slideStatus: own.slideStatus,
      bookStatus: own.bookStatus,
      mcqCompleted: mcq.completed,
      mcqTotal: mcq.total,
      mcqPercent: mcq.percent,
      chapterCompletion,
      chapterCompletionBucket: snapBucket(chapterCompletion),
      lastUpdatedAt: own.updatedAt,
      classUpdatedAt: own.classUpdatedAt,
      slideUpdatedAt: own.slideUpdatedAt,
      bookUpdatedAt: own.bookUpdatedAt,
    };
  });
}

function summarise(subjectId: string | null, rows: ChapterProgressDTO[]): SubjectSummaryDTO {
  const totalChapters = rows.length;
  if (totalChapters === 0) {
    return {
      subjectId,
      totalChapters: 0,
      completedChapters: 0,
      incompleteChapters: 0,
      overallProgress: 0,
      averageProgress: 0,
      classCompletion: 0,
      slideCompletion: 0,
      bookCompletion: 0,
      mcqCompletion: 0,
      lastActivityAt: null,
      status: "at_risk",
    };
  }
  let sumOverall = 0;
  let sumClass = 0;
  let sumSlide = 0;
  let sumBook = 0;
  let sumMcq = 0;
  let completed = 0;
  let lastActivity: string | null = null;
  for (const r of rows) {
    sumOverall += r.chapterCompletion;
    sumClass += statusPct(r.classStatus);
    sumSlide += statusPct(r.slideStatus);
    sumBook += statusPct(r.bookStatus);
    sumMcq += r.mcqPercent;
    if (r.chapterCompletion >= 100) completed += 1;
    if (r.lastUpdatedAt && (!lastActivity || r.lastUpdatedAt > lastActivity)) {
      lastActivity = r.lastUpdatedAt;
    }
  }
  const overall = clampPct(sumOverall / totalChapters);
  return {
    subjectId,
    totalChapters,
    completedChapters: completed,
    incompleteChapters: totalChapters - completed,
    overallProgress: overall,
    averageProgress: overall, // per-chapter mean IS the overall in this weighting
    classCompletion: clampPct(sumClass / totalChapters),
    slideCompletion: clampPct(sumSlide / totalChapters),
    bookCompletion: clampPct(sumBook / totalChapters),
    mcqCompletion: clampPct(sumMcq / totalChapters),
    lastActivityAt: lastActivity,
    status: deriveStudentStatus(overall),
  };
}

/** Best-effort activity log; never blocks the caller on failure. */
async function logActivity(
  sb: any,
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  try {
    const { error } = await sb.from("subject_progress_activity_log").insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata ?? {},
    });
    if (error && !isMissingTable(error)) {
      console.error("[subject-progress:activity-log-fail]", {
        action,
        entityType,
        entityId,
        message: error.message,
      });
    }
  } catch (e) {
    console.error("[subject-progress:activity-log-crash]", {
      action,
      entityType,
      entityId,
      error: e,
    });
  }
}

/** Verify a chapter exists and is published. Returns its subject_id. */
async function assertChapterExists(sb: any, chapterId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("chapters")
    .select("id,subject_id,status")
    .eq("id", chapterId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status && data.status !== "published") return null;
  return data.subject_id ?? null;
}

/** Upsert a single track (class/slide/book) for one chapter, owned by user. */
async function upsertTrack(
  sb: any,
  userId: string,
  chapterId: string,
  track: ManualTrack,
  status: ManualStatus,
): Promise<{ fallback: boolean }> {
  const now = new Date().toISOString();
  const col =
    track === "class"
      ? "class_status"
      : track === "slide"
        ? "slide_status"
        : "book_status";
  const tsCol =
    track === "class"
      ? "class_updated_at"
      : track === "slide"
        ? "slide_updated_at"
        : "book_updated_at";

  const payload: Record<string, unknown> = {
    user_id: userId,
    chapter_id: chapterId,
    [col]: status,
    [tsCol]: now,
    updated_at: now,
  };

  const { error } = await sb
    .from("subject_progress_chapter")
    .upsert(payload, { onConflict: "user_id,chapter_id" });
  if (error) {
    if (isMissingTable(error)) return { fallback: true };
    throw error;
  }
  return { fallback: false };
}

async function updateTrackHandler(
  context: { supabase: any; userId: string },
  input: { chapterId: string; status: ManualStatus },
  track: ManualTrack,
): Promise<Result<{ chapter: ChapterProgressDTO | null; fallback: boolean }>> {
  const sb = context.supabase;
  const subjectId = await assertChapterExists(sb, input.chapterId);
  if (!subjectId) return err("not_found", "Chapter not found or unpublished");

  const { fallback } = await upsertTrack(
    sb,
    context.userId,
    input.chapterId,
    track,
    input.status,
  );

  await logActivity(sb, context.userId, `${track}_updated`, "chapter", input.chapterId, {
    status: input.status,
  });

  // Return the freshly-computed row so the client can rehydrate without an extra call.
  const chapters = [{ id: input.chapterId, name: "", subject_id: subjectId }];
  const [{ byId: ownById, fallback: ownFallback }, mcqById] = await Promise.all([
    loadOwnProgressByChapter(sb, context.userId, [input.chapterId]),
    loadMcqProgressByChapter(sb, context.userId, [input.chapterId]),
  ]);
  const [row] = assembleChapterRows(chapters, ownById, mcqById);
  return ok({ chapter: row ?? null, fallback: fallback || ownFallback });
}

// ---------------------------------------------------------------- //
// Exported server functions
// ---------------------------------------------------------------- //

/** All chapter progress for one subject, for the current student. */
export const getSubjectChaptersProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(subjectIdSchema))
  .handler(
    async ({ data, context }): Promise<Result<SubjectProgressResponse>> => {
      const sb = context.supabase;
      const subject = await loadSubject(sb, data.subjectId);
      if (!subject) return err("not_found", "Subject not found");
      const chapters = await loadChaptersForSubject(sb, data.subjectId);
      const chapterIds = chapters.map((c) => c.id);
      const [{ byId: ownById, fallback }, mcqById] = await Promise.all([
        loadOwnProgressByChapter(sb, context.userId, chapterIds),
        loadMcqProgressByChapter(sb, context.userId, chapterIds),
      ]);
      const rows = assembleChapterRows(chapters, ownById, mcqById);
      await logActivity(sb, context.userId, "progress_viewed", "subject", data.subjectId);
      return ok({
        subject,
        summary: summarise(data.subjectId, rows),
        chapters: rows,
        fallback,
      });
    },
  );

/** Aggregate summary across every subject the student has visibility into. */
export const getMySubjectProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(noInput)
  .handler(
    async ({ context }): Promise<
      Result<{
        subjects: Array<{
          subject: SubjectDTO;
          summary: SubjectSummaryDTO;
        }>;
        fallback: boolean;
      }>
    > => {
      const sb = context.supabase;

      // Resolve the student's level (if any) — if they have one, scope
      // subjects to that level. Otherwise fall back to every published subject.
      const { data: profile } = await sb
        .from("profiles")
        .select("level")
        .eq("id", context.userId)
        .maybeSingle();
      const level = profile?.level ?? null;

      let query = sb
        .from("subjects")
        .select("id,name,slug,level,color,icon,status")
        .eq("status", "published")
        .order("sort_order", { ascending: true });
      if (level) query = query.eq("level", level);
      const { data: subjectRows, error: subjectErr } = await query;
      if (subjectErr) throw subjectErr;

      const subjects = (subjectRows ?? []) as Array<{
        id: string;
        name: string;
        slug: string | null;
        level: string | null;
        color: string | null;
        icon: string | null;
      }>;

      let anyFallback = false;
      const out: Array<{ subject: SubjectDTO; summary: SubjectSummaryDTO }> = [];
      for (const s of subjects) {
        const chapters = await loadChaptersForSubject(sb, s.id);
        const chapterIds = chapters.map((c) => c.id);
        const [{ byId: ownById, fallback }, mcqById] = await Promise.all([
          loadOwnProgressByChapter(sb, context.userId, chapterIds),
          loadMcqProgressByChapter(sb, context.userId, chapterIds),
        ]);
        if (fallback) anyFallback = true;
        const rows = assembleChapterRows(chapters, ownById, mcqById);
        out.push({
          subject: {
            id: s.id,
            name: s.name,
            slug: s.slug,
            level: s.level,
            color: s.color,
            icon: s.icon,
          },
          summary: summarise(s.id, rows),
        });
      }
      return ok({ subjects: out, fallback: anyFallback });
    },
  );

/** Compact summary for a single subject (used by dashboard cards). */
export const getSubjectSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(subjectIdSchema))
  .handler(
    async ({ data, context }): Promise<Result<{ summary: SubjectSummaryDTO; fallback: boolean }>> => {
      const sb = context.supabase;
      const chapters = await loadChaptersForSubject(sb, data.subjectId);
      const chapterIds = chapters.map((c) => c.id);
      const [{ byId: ownById, fallback }, mcqById] = await Promise.all([
        loadOwnProgressByChapter(sb, context.userId, chapterIds),
        loadMcqProgressByChapter(sb, context.userId, chapterIds),
      ]);
      const rows = assembleChapterRows(chapters, ownById, mcqById);
      return ok({ summary: summarise(data.subjectId, rows), fallback });
    },
  );

/** Single chapter, for detail views. */
export const getChapterProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(chapterIdSchema))
  .handler(
    async ({ data, context }): Promise<Result<{ chapter: ChapterProgressDTO | null; fallback: boolean }>> => {
      const sb = context.supabase;
      const { data: chapter, error } = await sb
        .from("chapters")
        .select("id,name,subject_id,status")
        .eq("id", data.chapterId)
        .maybeSingle();
      if (error) throw error;
      if (!chapter || (chapter.status && chapter.status !== "published")) {
        return err("not_found", "Chapter not found");
      }
      const [{ byId: ownById, fallback }, mcqById] = await Promise.all([
        loadOwnProgressByChapter(sb, context.userId, [chapter.id]),
        loadMcqProgressByChapter(sb, context.userId, [chapter.id]),
      ]);
      const [row] = assembleChapterRows(
        [{ id: chapter.id, name: chapter.name, subject_id: chapter.subject_id }],
        ownById,
        mcqById,
      );
      return ok({ chapter: row ?? null, fallback });
    },
  );

/** Update Class status. */
export const updateClassProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(trackUpdateSchema))
  .handler(({ data, context }) => updateTrackHandler(context, data, "class"));

/** Update Slide status. */
export const updateSlideProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(trackUpdateSchema))
  .handler(({ data, context }) => updateTrackHandler(context, data, "slide"));

/** Update Book status. */
export const updateBookProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(trackUpdateSchema))
  .handler(({ data, context }) => updateTrackHandler(context, data, "book"));

/**
 * Student-facing report: overall %, per-track breakdown, completed/pending,
 * MCQ completion, and last activity. Scoped to one subject or all subjects.
 */
export const getSubjectReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(subjectReportSchema))
  .handler(
    async ({ data, context }): Promise<
      Result<{
        subjects: Array<{
          subject: SubjectDTO;
          summary: SubjectSummaryDTO;
          chapters: ChapterProgressDTO[];
        }>;
        fallback: boolean;
      }>
    > => {
      const sb = context.supabase;

      // Determine target subject list.
      let subjectRows: Array<{
        id: string;
        name: string;
        slug: string | null;
        level: string | null;
        color: string | null;
        icon: string | null;
      }>;
      if (data.subjectId) {
        const one = await loadSubject(sb, data.subjectId);
        if (!one) return err("not_found", "Subject not found");
        subjectRows = [one];
      } else {
        const { data: profile } = await sb
          .from("profiles")
          .select("level")
          .eq("id", context.userId)
          .maybeSingle();
        const level = profile?.level ?? null;
        let q = sb
          .from("subjects")
          .select("id,name,slug,level,color,icon,status")
          .eq("status", "published")
          .order("sort_order", { ascending: true });
        if (level) q = q.eq("level", level);
        const { data: rows, error } = await q;
        if (error) throw error;
        subjectRows = (rows ?? []) as any[];
      }

      let anyFallback = false;
      const out: Array<{
        subject: SubjectDTO;
        summary: SubjectSummaryDTO;
        chapters: ChapterProgressDTO[];
      }> = [];
      for (const s of subjectRows) {
        const chapters = await loadChaptersForSubject(sb, s.id);
        const chapterIds = chapters.map((c) => c.id);
        const [{ byId: ownById, fallback }, mcqById] = await Promise.all([
          loadOwnProgressByChapter(sb, context.userId, chapterIds),
          loadMcqProgressByChapter(sb, context.userId, chapterIds),
        ]);
        if (fallback) anyFallback = true;
        const rows = assembleChapterRows(chapters, ownById, mcqById);
        out.push({
          subject: {
            id: s.id,
            name: s.name,
            slug: s.slug,
            level: s.level,
            color: s.color,
            icon: s.icon,
          },
          summary: summarise(s.id, rows),
          chapters: rows,
        });
      }
      await logActivity(sb, context.userId, "report_generated", "subject", data.subjectId ?? null);
      return ok({ subjects: out, fallback: anyFallback });
    },
  );

// Re-export the manual status enum (client uses it in form components).
export const MANUAL_STATUS_VALUES = MANUAL_STATUS;

// Silence unused import warning — schema is imported for potential shared use.
void adminExportSchema;
void z;
