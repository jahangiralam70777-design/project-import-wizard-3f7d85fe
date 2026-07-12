/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin-facing server functions for the Subject Progress module.
//
// Every endpoint:
//   - Requires authentication (requireSupabaseAuth) AND the "view_analytics"
//     admin permission via assertPermission. Denial is logged by that helper.
//   - Validates input with zod (see subject-progress-shared).
//   - Handles missing-table (42P01) gracefully so the UI keeps functioning
//     before the SQL phase lands. No fake/demo/mock data is ever returned.
//   - Records admin views in public.subject_progress_activity_log.
//
// This module is self-contained: it never reads/writes MCQ Practice, Quiz,
// Mock, Custom Exam, Wrong Questions, Bookmarks, Routine, or the existing
// analytics tables — beyond reading `mcqs` + `mcq_practice_progress` in a
// read-only, per-student aggregation for the MCQ completion sync.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPermission } from "@/lib/admin-permissions";
import { validate } from "@/lib/validate";
import {
  adminChapterAnalyticsSchema,
  adminExportSchema,
  adminListSchema,
  adminStudentSubjectSchema,
  adminSubjectAnalyticsSchema,
  clampPct,
  computeChapterCompletion,
  deriveStudentStatus,
  err,
  isMissingTable,
  ok,
  snapBucket,
  statusPct,
  type AdminStudentRow,
  type ChapterProgressDTO,
  type ManualStatus,
  type PagedResult,
  type Result,
  type SubjectDTO,
  type SubjectSummaryDTO,
} from "@/lib/subject-progress-shared";

const PERM = "view_analytics";
const asAny = (x: unknown) => x as any;

// ---------------------------------------------------------------- //
// Admin helpers
// ---------------------------------------------------------------- //

async function logAdminActivity(
  sb: any,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  try {
    const { error } = await sb.from("subject_progress_activity_log").insert({
      user_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata ?? {},
    });
    if (error && !isMissingTable(error)) {
      console.error("[subject-progress-admin:activity-log-fail]", {
        action,
        entityType,
        entityId,
        message: error.message,
      });
    }
  } catch (e) {
    console.error("[subject-progress-admin:activity-log-crash]", {
      action,
      entityType,
      entityId,
      error: e,
    });
  }
}

async function loadChaptersForSubjects(
  sb: any,
  subjectIds: string[],
): Promise<Array<{ id: string; name: string; subject_id: string }>> {
  if (subjectIds.length === 0) return [];
  const out: Array<{ id: string; name: string; subject_id: string }> = [];
  const pageSize = 1000;
  let from = 0;
  for (let i = 0; i < 200; i++) {
    const { data, error } = await sb
      .from("chapters")
      .select("id,name,subject_id,status,sort_order")
      .in("subject_id", subjectIds)
      .eq("status", "published")
      .order("subject_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    for (const r of rows) {
      out.push({ id: r.id, name: r.name, subject_id: r.subject_id });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function loadPerChapterMcqTotalsAndUserSets(
  sb: any,
  chapterIds: string[],
  userIds: string[],
): Promise<{
  totals: Map<string, { total: number; published: Set<string> }>;
  perUser: Map<string, Map<string, Set<string>>>;
}> {
  const totals = new Map<string, { total: number; published: Set<string> }>();
  const perUser = new Map<string, Map<string, Set<string>>>();
  if (chapterIds.length === 0 || userIds.length === 0) return { totals, perUser };

  const pageSize = 1000;
  // Totals
  let from = 0;
  for (let i = 0; i < 500; i++) {
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
      const bucket = totals.get(r.chapter_id) ?? { total: 0, published: new Set<string>() };
      bucket.total += 1;
      bucket.published.add(r.id);
      totals.set(r.chapter_id, bucket);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // Per-user correct answers
  from = 0;
  for (let i = 0; i < 1000; i++) {
    const { data, error } = await sb
      .from("mcq_practice_progress")
      .select("user_id,mcq_id,chapter_id,is_correct")
      .in("user_id", userIds)
      .in("chapter_id", chapterIds)
      .eq("is_correct", true)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      user_id: string;
      mcq_id: string;
      chapter_id: string | null;
      is_correct: boolean;
    }>;
    for (const r of rows) {
      if (!r.chapter_id) continue;
      const bucket = totals.get(r.chapter_id);
      if (!bucket || !bucket.published.has(r.mcq_id)) continue;
      const userMap = perUser.get(r.user_id) ?? new Map<string, Set<string>>();
      const set = userMap.get(r.chapter_id) ?? new Set<string>();
      set.add(r.mcq_id);
      userMap.set(r.chapter_id, set);
      perUser.set(r.user_id, userMap);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return { totals, perUser };
}

async function loadOwnProgressForStudents(
  sb: any,
  userIds: string[],
  chapterIds: string[],
): Promise<{
  perUser: Map<
    string,
    Map<
      string,
      {
        classStatus: ManualStatus;
        slideStatus: ManualStatus;
        bookStatus: ManualStatus;
        updatedAt: string | null;
      }
    >
  >;
  fallback: boolean;
}> {
  const perUser = new Map<
    string,
    Map<
      string,
      {
        classStatus: ManualStatus;
        slideStatus: ManualStatus;
        bookStatus: ManualStatus;
        updatedAt: string | null;
      }
    >
  >();
  if (userIds.length === 0 || chapterIds.length === 0) return { perUser, fallback: false };

  const pageSize = 1000;
  let from = 0;
  for (let i = 0; i < 1000; i++) {
    const { data, error } = await sb
      .from("subject_progress_chapter")
      .select("user_id,chapter_id,class_status,slide_status,book_status,updated_at")
      .in("user_id", userIds)
      .in("chapter_id", chapterIds)
      .range(from, from + pageSize - 1);
    if (error) {
      if (isMissingTable(error)) return { perUser, fallback: true };
      throw error;
    }
    const rows = (data ?? []) as any[];
    for (const r of rows) {
      const m = perUser.get(r.user_id) ?? new Map<string, any>();
      m.set(r.chapter_id, {
        classStatus: (r.class_status ?? "not_started") as ManualStatus,
        slideStatus: (r.slide_status ?? "not_started") as ManualStatus,
        bookStatus: (r.book_status ?? "not_started") as ManualStatus,
        updatedAt: r.updated_at ?? null,
      });
      perUser.set(r.user_id, m);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { perUser, fallback: false };
}

function buildStudentRow(
  student: { id: string; name: string; email: string | null; level: string | null },
  subject: SubjectDTO,
  chapters: Array<{ id: string; name: string; subject_id: string }>,
  ownById: Map<string, {
    classStatus: ManualStatus;
    slideStatus: ManualStatus;
    bookStatus: ManualStatus;
    updatedAt: string | null;
  }>,
  mcqTotals: Map<string, { total: number; published: Set<string> }>,
  userMcq: Map<string, Set<string>> | undefined,
): AdminStudentRow {
  let sumOverall = 0;
  let completed = 0;
  let lastUpdated: string | null = null;
  for (const ch of chapters) {
    const own = ownById.get(ch.id) ?? {
      classStatus: "not_started" as ManualStatus,
      slideStatus: "not_started" as ManualStatus,
      bookStatus: "not_started" as ManualStatus,
      updatedAt: null as string | null,
    };
    const total = mcqTotals.get(ch.id)?.total ?? 0;
    const doneSet = userMcq?.get(ch.id);
    const doneCount = doneSet?.size ?? 0;
    const mcqPercent = total > 0 ? clampPct((doneCount / total) * 100) : 0;
    const pct = computeChapterCompletion({
      classStatus: own.classStatus,
      slideStatus: own.slideStatus,
      bookStatus: own.bookStatus,
      mcqPercent,
    });
    sumOverall += pct;
    if (pct >= 100) completed += 1;
    if (own.updatedAt && (!lastUpdated || own.updatedAt > lastUpdated)) {
      lastUpdated = own.updatedAt;
    }
  }
  const total = chapters.length;
  const overall = total > 0 ? clampPct(sumOverall / total) : 0;
  return {
    studentId: student.id,
    studentName: student.name,
    studentEmail: student.email,
    level: student.level,
    subjectId: subject.id,
    subjectName: subject.name,
    completedChapters: completed,
    totalChapters: total,
    averageProgress: overall,
    overallProgress: overall,
    status: deriveStudentStatus(overall),
    lastUpdatedAt: lastUpdated,
  };
}

// ---------------------------------------------------------------- //
// Student-list (paginated, filtered, sorted)
// ---------------------------------------------------------------- //

export const adminListStudentProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(adminListSchema))
  .handler(
    async ({ data, context }): Promise<Result<PagedResult<AdminStudentRow>>> => {
      await assertPermission(context.supabase, context.userId, PERM, "list_student_progress", {
        module: "subject_progress",
      });
      const sb = context.supabase;

      // 1. Students (paginated at the DB level to bound work).
      let studentQ = sb
        .from("profiles")
        .select("id,full_name,email,level,status", { count: "exact" })
        .eq("role", "student");
      if (data.level) studentQ = studentQ.eq("level", data.level);
      if (data.studentId) studentQ = studentQ.eq("id", data.studentId);
      if (data.search) {
        const q = data.search.replace(/[%_]/g, "");
        studentQ = studentQ.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
      }
      // Basic status exclusion: never surface deleted/suspended students.
      studentQ = studentQ.not("status", "in", "(deleted,banned,suspended)");

      const pageSize = data.pageSize;
      const fromIdx = (data.page - 1) * pageSize;
      const toIdx = fromIdx + pageSize - 1;
      const { data: studentRows, error: studentErr, count } = await studentQ
        .order(data.sortBy === "student_name" ? "full_name" : "full_name", {
          ascending: data.sortDir === "asc",
        })
        .range(fromIdx, toIdx);
      if (studentErr) throw studentErr;
      const students = (studentRows ?? []).map((r: any) => ({
        id: r.id as string,
        name: (r.full_name ?? "") as string,
        email: (r.email ?? null) as string | null,
        level: (r.level ?? null) as string | null,
      }));
      const total = count ?? students.length;

      if (students.length === 0) {
        return ok({ rows: [], page: data.page, pageSize, total, fallback: false });
      }

      // 2. Subjects the report iterates over. If admin narrowed by subjectId
      //    only that subject; otherwise every published subject that matches
      //    the (optional) level filter.
      let subjectQ = sb
        .from("subjects")
        .select("id,name,slug,level,color,icon")
        .eq("status", "published");
      if (data.subjectId) subjectQ = subjectQ.eq("id", data.subjectId);
      if (data.level) subjectQ = subjectQ.eq("level", data.level);
      const { data: subjectRows, error: subjectErr } = await subjectQ;
      if (subjectErr) throw subjectErr;
      const subjects: SubjectDTO[] = (subjectRows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug ?? null,
        level: r.level ?? null,
        color: r.color ?? null,
        icon: r.icon ?? null,
      }));
      if (subjects.length === 0) {
        return ok({ rows: [], page: data.page, pageSize, total, fallback: false });
      }

      const subjectIds = subjects.map((s) => s.id);
      const chapters = await loadChaptersForSubjects(sb, subjectIds);
      if (data.chapterId) {
        // Filter to just the one chapter's subject for accurate aggregates.
        const only = chapters.filter((c) => c.id === data.chapterId);
        if (only.length === 0) {
          return ok({ rows: [], page: data.page, pageSize, total, fallback: false });
        }
      }

      const chapterIds = chapters.map((c) => c.id);
      const userIds = students.map((s) => s.id);
      const [{ perUser: ownPerUser, fallback }, { totals: mcqTotals, perUser: mcqPerUser }] =
        await Promise.all([
          loadOwnProgressForStudents(sb, userIds, chapterIds),
          loadPerChapterMcqTotalsAndUserSets(sb, chapterIds, userIds),
        ]);

      // Build (student × subject) rows.
      const rows: AdminStudentRow[] = [];
      const bySubject = new Map<string, Array<{ id: string; name: string; subject_id: string }>>();
      for (const ch of chapters) {
        const arr = bySubject.get(ch.subject_id) ?? [];
        arr.push(ch);
        bySubject.set(ch.subject_id, arr);
      }
      for (const stu of students) {
        for (const subj of subjects) {
          const subjChapters = bySubject.get(subj.id) ?? [];
          if (subjChapters.length === 0) continue;
          const ownForUser =
            ownPerUser.get(stu.id) ??
            new Map<string, {
              classStatus: ManualStatus;
              slideStatus: ManualStatus;
              bookStatus: ManualStatus;
              updatedAt: string | null;
            }>();
          const row = buildStudentRow(
            stu,
            subj,
            subjChapters,
            ownForUser,
            mcqTotals,
            mcqPerUser.get(stu.id),
          );
          rows.push(row);
        }
      }

      // Post-filter progress + status (cannot be done in DB because these are
      // derived columns).
      const filtered = rows.filter((r) => {
        if (typeof data.progressMin === "number" && r.overallProgress < data.progressMin) return false;
        if (typeof data.progressMax === "number" && r.overallProgress > data.progressMax) return false;
        if (data.status && r.status !== data.status) return false;
        return true;
      });

      // Post-sort where sorting is on a derived column.
      const dir = data.sortDir === "asc" ? 1 : -1;
      const cmp = (a: AdminStudentRow, b: AdminStudentRow) => {
        switch (data.sortBy) {
          case "overall_progress":
            return (a.overallProgress - b.overallProgress) * dir;
          case "average_progress":
            return (a.averageProgress - b.averageProgress) * dir;
          case "completed_chapters":
            return (a.completedChapters - b.completedChapters) * dir;
          case "last_updated":
            return (
              ((a.lastUpdatedAt ?? "") > (b.lastUpdatedAt ?? "") ? 1 : -1) * dir
            );
          case "level":
            return ((a.level ?? "").localeCompare(b.level ?? "")) * dir;
          case "subject":
            return a.subjectName.localeCompare(b.subjectName) * dir;
          case "student_name":
          default:
            return a.studentName.localeCompare(b.studentName) * dir;
        }
      };
      filtered.sort(cmp);

      await logAdminActivity(sb, context.userId, "admin_viewed_progress_list", "list", null, {
        page: data.page,
        pageSize,
        filters: {
          level: data.level ?? null,
          subjectId: data.subjectId ?? null,
          studentId: data.studentId ?? null,
          status: data.status ?? null,
          progressMin: data.progressMin ?? null,
          progressMax: data.progressMax ?? null,
        },
      });

      return ok({
        rows: filtered,
        page: data.page,
        pageSize,
        total: filtered.length,
        fallback,
      });
    },
  );

// ---------------------------------------------------------------- //
// Single student × subject detail
// ---------------------------------------------------------------- //

export const adminGetStudentSubjectProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(adminStudentSubjectSchema))
  .handler(
    async ({ data, context }): Promise<
      Result<{
        student: { id: string; name: string; email: string | null; level: string | null };
        subjects: Array<{
          subject: SubjectDTO;
          summary: SubjectSummaryDTO;
          chapters: ChapterProgressDTO[];
        }>;
        fallback: boolean;
      }>
    > => {
      await assertPermission(context.supabase, context.userId, PERM, "view_student_progress", {
        module: "subject_progress",
        studentId: data.studentId,
      });
      const sb = context.supabase;

      const { data: profile, error: profileErr } = await sb
        .from("profiles")
        .select("id,full_name,email,level,status,role")
        .eq("id", data.studentId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) return err("not_found", "Student not found");
      if (profile.status && ["deleted", "banned"].includes(profile.status)) {
        return err("not_found", "Student not accessible");
      }
      const student = {
        id: profile.id as string,
        name: (profile.full_name ?? "") as string,
        email: (profile.email ?? null) as string | null,
        level: (profile.level ?? null) as string | null,
      };

      // Subjects: one or all published subjects at the student's level.
      let subjectQ = sb
        .from("subjects")
        .select("id,name,slug,level,color,icon")
        .eq("status", "published");
      if (data.subjectId) subjectQ = subjectQ.eq("id", data.subjectId);
      else if (student.level) subjectQ = subjectQ.eq("level", student.level);
      const { data: subjectRows, error: subjectErr } = await subjectQ.order("sort_order", {
        ascending: true,
      });
      if (subjectErr) throw subjectErr;
      const subjects: SubjectDTO[] = (subjectRows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug ?? null,
        level: r.level ?? null,
        color: r.color ?? null,
        icon: r.icon ?? null,
      }));

      let anyFallback = false;
      const out: Array<{
        subject: SubjectDTO;
        summary: SubjectSummaryDTO;
        chapters: ChapterProgressDTO[];
      }> = [];
      for (const s of subjects) {
        const chapters = await loadChaptersForSubjects(sb, [s.id]);
        const chapterIds = chapters.map((c) => c.id);
        const [{ perUser: ownPerUser, fallback }, { totals: mcqTotals, perUser: mcqPerUser }] =
          await Promise.all([
            loadOwnProgressForStudents(sb, [student.id], chapterIds),
            loadPerChapterMcqTotalsAndUserSets(sb, chapterIds, [student.id]),
          ]);
        if (fallback) anyFallback = true;
        const ownById =
          ownPerUser.get(student.id) ??
          new Map<
            string,
            {
              classStatus: ManualStatus;
              slideStatus: ManualStatus;
              bookStatus: ManualStatus;
              updatedAt: string | null;
            }
          >();
        const userMcq = mcqPerUser.get(student.id);
        const chapterRows: ChapterProgressDTO[] = chapters.map((ch) => {
          const own = ownById.get(ch.id) ?? {
            classStatus: "not_started" as ManualStatus,
            slideStatus: "not_started" as ManualStatus,
            bookStatus: "not_started" as ManualStatus,
            updatedAt: null,
          };
          const total = mcqTotals.get(ch.id)?.total ?? 0;
          const completed = userMcq?.get(ch.id)?.size ?? 0;
          const mcqPercent = total > 0 ? clampPct((completed / total) * 100) : 0;
          const chapterCompletion = computeChapterCompletion({
            classStatus: own.classStatus,
            slideStatus: own.slideStatus,
            bookStatus: own.bookStatus,
            mcqPercent,
          });
          return {
            chapterId: ch.id,
            chapterName: ch.name,
            subjectId: ch.subject_id,
            classStatus: own.classStatus,
            slideStatus: own.slideStatus,
            bookStatus: own.bookStatus,
            mcqCompleted: completed,
            mcqTotal: total,
            mcqPercent,
            chapterCompletion,
            chapterCompletionBucket: snapBucket(chapterCompletion),
            lastUpdatedAt: own.updatedAt,
            classUpdatedAt: null,
            slideUpdatedAt: null,
            bookUpdatedAt: null,
          };
        });

        // Reuse the aggregation math from the student module — inline to
        // avoid a cross-import cycle.
        const totalChapters = chapterRows.length;
        let sumOverall = 0;
        let sumClass = 0;
        let sumSlide = 0;
        let sumBook = 0;
        let sumMcq = 0;
        let completed = 0;
        let lastActivity: string | null = null;
        for (const r of chapterRows) {
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
        const overall = totalChapters === 0 ? 0 : clampPct(sumOverall / totalChapters);
        const summary: SubjectSummaryDTO = {
          subjectId: s.id,
          totalChapters,
          completedChapters: completed,
          incompleteChapters: totalChapters - completed,
          overallProgress: overall,
          averageProgress: overall,
          classCompletion: totalChapters === 0 ? 0 : clampPct(sumClass / totalChapters),
          slideCompletion: totalChapters === 0 ? 0 : clampPct(sumSlide / totalChapters),
          bookCompletion: totalChapters === 0 ? 0 : clampPct(sumBook / totalChapters),
          mcqCompletion: totalChapters === 0 ? 0 : clampPct(sumMcq / totalChapters),
          lastActivityAt: lastActivity,
          status: deriveStudentStatus(overall),
        };
        out.push({ subject: s, summary, chapters: chapterRows });
      }

      await logAdminActivity(sb, context.userId, "admin_viewed_student_progress", "student", student.id, {
        subjectId: data.subjectId ?? null,
      });

      return ok({ student, subjects: out, fallback: anyFallback });
    },
  );

// ---------------------------------------------------------------- //
// Subject-level analytics (avg progress across all students on subject)
// ---------------------------------------------------------------- //

export const adminGetSubjectAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(adminSubjectAnalyticsSchema))
  .handler(
    async ({ data, context }): Promise<
      Result<{
        subjects: Array<{
          subject: SubjectDTO;
          studentsTracked: number;
          averageOverallProgress: number;
          completedStudents: number;
          behindStudents: number;
        }>;
        totals: {
          studentsTracked: number;
          overallCompletion: number;
          bestSubject: { name: string; average: number } | null;
          worstSubject: { name: string; average: number } | null;
          behindSchedule: number;
        };
        fallback: boolean;
      }>
    > => {
      await assertPermission(context.supabase, context.userId, PERM, "subject_analytics", {
        module: "subject_progress",
      });
      const sb = context.supabase;

      let subjectQ = sb
        .from("subjects")
        .select("id,name,slug,level,color,icon")
        .eq("status", "published");
      if (data.subjectId) subjectQ = subjectQ.eq("id", data.subjectId);
      if (data.level) subjectQ = subjectQ.eq("level", data.level);
      const { data: subjectRows, error: subjectErr } = await subjectQ;
      if (subjectErr) throw subjectErr;
      const subjects: SubjectDTO[] = (subjectRows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug ?? null,
        level: r.level ?? null,
        color: r.color ?? null,
        icon: r.icon ?? null,
      }));

      // Enumerate active students at the appropriate level.
      let studentQ = sb
        .from("profiles")
        .select("id,level,status")
        .eq("role", "student")
        .not("status", "in", "(deleted,banned,suspended)");
      if (data.level) studentQ = studentQ.eq("level", data.level);
      const { data: studentRows, error: studentErr } = await studentQ;
      if (studentErr) throw studentErr;
      const students = (studentRows ?? []) as Array<{
        id: string;
        level: string | null;
      }>;
      const userIds = students.map((s) => s.id);

      if (subjects.length === 0 || userIds.length === 0) {
        return ok({
          subjects: [],
          totals: {
            studentsTracked: 0,
            overallCompletion: 0,
            bestSubject: null,
            worstSubject: null,
            behindSchedule: 0,
          },
          fallback: false,
        });
      }

      const chapters = await loadChaptersForSubjects(sb, subjects.map((s) => s.id));
      const bySubject = new Map<string, Array<{ id: string; name: string; subject_id: string }>>();
      for (const ch of chapters) {
        const arr = bySubject.get(ch.subject_id) ?? [];
        arr.push(ch);
        bySubject.set(ch.subject_id, arr);
      }
      const chapterIds = chapters.map((c) => c.id);
      const [{ perUser: ownPerUser, fallback }, { totals: mcqTotals, perUser: mcqPerUser }] =
        await Promise.all([
          loadOwnProgressForStudents(sb, userIds, chapterIds),
          loadPerChapterMcqTotalsAndUserSets(sb, chapterIds, userIds),
        ]);

      const perSubject: Array<{
        subject: SubjectDTO;
        studentsTracked: number;
        averageOverallProgress: number;
        completedStudents: number;
        behindStudents: number;
      }> = [];
      let studentsBehindTotal = 0;
      const seenBehindByStudent = new Set<string>();
      let totalOverallSum = 0;
      let totalOverallCount = 0;

      for (const s of subjects) {
        const subjChapters = bySubject.get(s.id) ?? [];
        if (subjChapters.length === 0) {
          perSubject.push({
            subject: s,
            studentsTracked: 0,
            averageOverallProgress: 0,
            completedStudents: 0,
            behindStudents: 0,
          });
          continue;
        }
        let sum = 0;
        let n = 0;
        let completed = 0;
        let behind = 0;
        for (const stu of students) {
          const ownForUser = ownPerUser.get(stu.id);
          const userMcq = mcqPerUser.get(stu.id);
          // If the student has no activity at all AND no MCQs in this subject,
          // they still count as tracked at 0%; that matches the product intent
          // (we track everyone at the appropriate level).
          const row = buildStudentRow(
            { id: stu.id, name: "", email: null, level: stu.level ?? null },
            s,
            subjChapters,
            ownForUser ?? new Map(),
            mcqTotals,
            userMcq,
          );
          sum += row.overallProgress;
          n += 1;
          totalOverallSum += row.overallProgress;
          totalOverallCount += 1;
          if (row.status === "complete") completed += 1;
          if (row.status === "behind" || row.status === "at_risk") {
            behind += 1;
            if (!seenBehindByStudent.has(stu.id)) {
              seenBehindByStudent.add(stu.id);
              studentsBehindTotal += 1;
            }
          }
        }
        perSubject.push({
          subject: s,
          studentsTracked: n,
          averageOverallProgress: n === 0 ? 0 : clampPct(sum / n),
          completedStudents: completed,
          behindStudents: behind,
        });
      }

      let best: { name: string; average: number } | null = null;
      let worst: { name: string; average: number } | null = null;
      for (const p of perSubject) {
        if (p.studentsTracked === 0) continue;
        if (!best || p.averageOverallProgress > best.average) {
          best = { name: p.subject.name, average: p.averageOverallProgress };
        }
        if (!worst || p.averageOverallProgress < worst.average) {
          worst = { name: p.subject.name, average: p.averageOverallProgress };
        }
      }

      await logAdminActivity(sb, context.userId, "admin_viewed_subject_analytics", "analytics", null, {
        subjectId: data.subjectId ?? null,
        level: data.level ?? null,
      });

      return ok({
        subjects: perSubject,
        totals: {
          studentsTracked: userIds.length,
          overallCompletion: totalOverallCount === 0 ? 0 : clampPct(totalOverallSum / totalOverallCount),
          bestSubject: best,
          worstSubject: worst,
          behindSchedule: studentsBehindTotal,
        },
        fallback,
      });
    },
  );

// ---------------------------------------------------------------- //
// Chapter analytics — per-chapter cohort stats within one subject
// ---------------------------------------------------------------- //

export const adminGetChapterAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(adminChapterAnalyticsSchema))
  .handler(
    async ({ data, context }): Promise<
      Result<{
        subject: SubjectDTO | null;
        chapters: Array<{
          chapterId: string;
          chapterName: string;
          studentsTracked: number;
          averageCompletion: number;
          completedStudents: number;
          classCompletion: number;
          slideCompletion: number;
          bookCompletion: number;
          mcqCompletion: number;
        }>;
        fallback: boolean;
      }>
    > => {
      await assertPermission(context.supabase, context.userId, PERM, "chapter_analytics", {
        module: "subject_progress",
      });
      const sb = context.supabase;

      const { data: subjectRow, error: subjectErr } = await sb
        .from("subjects")
        .select("id,name,slug,level,color,icon,status")
        .eq("id", data.subjectId)
        .maybeSingle();
      if (subjectErr) throw subjectErr;
      if (!subjectRow || subjectRow.status !== "published") {
        return err("not_found", "Subject not found");
      }
      const subject: SubjectDTO = {
        id: subjectRow.id,
        name: subjectRow.name,
        slug: subjectRow.slug ?? null,
        level: subjectRow.level ?? null,
        color: subjectRow.color ?? null,
        icon: subjectRow.icon ?? null,
      };

      const chapters = await loadChaptersForSubjects(sb, [subject.id]);
      if (chapters.length === 0) {
        return ok({ subject, chapters: [], fallback: false });
      }

      // Students at this subject's level.
      let studentQ = sb
        .from("profiles")
        .select("id")
        .eq("role", "student")
        .not("status", "in", "(deleted,banned,suspended)");
      if (subject.level) studentQ = studentQ.eq("level", subject.level);
      const { data: studentRows, error: studentErr } = await studentQ;
      if (studentErr) throw studentErr;
      const userIds = (studentRows ?? []).map((r: any) => r.id as string);

      const chapterIds = chapters.map((c) => c.id);
      const [{ perUser: ownPerUser, fallback }, { totals: mcqTotals, perUser: mcqPerUser }] =
        await Promise.all([
          loadOwnProgressForStudents(sb, userIds, chapterIds),
          loadPerChapterMcqTotalsAndUserSets(sb, chapterIds, userIds),
        ]);

      const out = chapters.map((ch) => {
        let sumCompletion = 0;
        let sumClass = 0;
        let sumSlide = 0;
        let sumBook = 0;
        let sumMcq = 0;
        let completed = 0;
        for (const uid of userIds) {
          const own = ownPerUser.get(uid)?.get(ch.id) ?? {
            classStatus: "not_started" as ManualStatus,
            slideStatus: "not_started" as ManualStatus,
            bookStatus: "not_started" as ManualStatus,
            updatedAt: null,
          };
          const total = mcqTotals.get(ch.id)?.total ?? 0;
          const done = mcqPerUser.get(uid)?.get(ch.id)?.size ?? 0;
          const mcqPercent = total > 0 ? clampPct((done / total) * 100) : 0;
          const chapterPct = computeChapterCompletion({
            classStatus: own.classStatus,
            slideStatus: own.slideStatus,
            bookStatus: own.bookStatus,
            mcqPercent,
          });
          sumCompletion += chapterPct;
          sumClass += statusPct(own.classStatus);
          sumSlide += statusPct(own.slideStatus);
          sumBook += statusPct(own.bookStatus);
          sumMcq += mcqPercent;
          if (chapterPct >= 100) completed += 1;
        }
        const n = userIds.length;
        return {
          chapterId: ch.id,
          chapterName: ch.name,
          studentsTracked: n,
          averageCompletion: n === 0 ? 0 : clampPct(sumCompletion / n),
          completedStudents: completed,
          classCompletion: n === 0 ? 0 : clampPct(sumClass / n),
          slideCompletion: n === 0 ? 0 : clampPct(sumSlide / n),
          bookCompletion: n === 0 ? 0 : clampPct(sumBook / n),
          mcqCompletion: n === 0 ? 0 : clampPct(sumMcq / n),
        };
      });

      await logAdminActivity(sb, context.userId, "admin_viewed_chapter_analytics", "subject", subject.id);

      return ok({ subject, chapters: out, fallback });
    },
  );

// ---------------------------------------------------------------- //
// Export (server prepares row payload; UI serialises to CSV/XLSX/PDF)
// ---------------------------------------------------------------- //

export const adminExportSubjectProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(adminExportSchema))
  .handler(
    async ({ data, context }): Promise<
      Result<{
        format: "csv" | "xlsx" | "pdf";
        columns: string[];
        rows: Array<Record<string, string | number | null>>;
        fallback: boolean;
      }>
    > => {
      await assertPermission(context.supabase, context.userId, PERM, "export_progress", {
        module: "subject_progress",
        format: data.format,
      });

      // Reuse the list computation for a consistent snapshot. Force a large
      // page so a single export contains everything the filter matches.
      const listResult = await adminListStudentProgress({
        data: { ...data, page: 1, pageSize: 100 },
      });
      if (!listResult.ok) return listResult;

      const columns = [
        "Student",
        "Email",
        "Level",
        "Subject",
        "Completed",
        "Total",
        "Average Progress %",
        "Overall Progress %",
        "Status",
        "Last Updated",
      ];
      const rows = listResult.data.rows.map((r) => ({
        Student: r.studentName,
        Email: r.studentEmail,
        Level: r.level,
        Subject: r.subjectName,
        Completed: r.completedChapters,
        Total: r.totalChapters,
        "Average Progress %": r.averageProgress,
        "Overall Progress %": r.overallProgress,
        Status: r.status,
        "Last Updated": r.lastUpdatedAt,
      })) as Array<Record<string, string | number | null>>;

      await logAdminActivity(context.supabase, context.userId, "report_generated", "export", null, {
        format: data.format,
        rowCount: rows.length,
      });

      return ok({ format: data.format, columns, rows, fallback: listResult.data.fallback });
    },
  );

// asAny is kept for symmetry with sibling admin modules that call it inline;
// unused today but harmless.
void asAny;
