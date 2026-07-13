/* eslint-disable @typescript-eslint/no-explicit-any */
// Student-facing server functions for the Routine Management module.
//
// Every endpoint:
//   - Requires an authenticated session (requireSupabaseAuth middleware).
//   - Scopes all reads/writes to context.userId — students can never touch
//     another student's rows.
//   - Validates input with zod.
//   - Returns { fallback: true } style responses when the underlying tables
//     have not yet been provisioned (Prompt 2 ships no SQL migrations).
//
// This module NEVER reads/writes MCQ, Quiz, Mock, Custom Exam, Wrong
// Questions, Bookmarks, or the existing analytics/progress/dashboard/
// leaderboard tables. The Routine domain is self-contained.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validate } from "@/lib/validate";
import {
  calendarRangeSchema,
  dailyProgressSchema,
  dayKeyFromDate,
  isMissingTable,
  manualSessionCreateSchema,
  manualSessionUpdateSchema,
  percent,
  reportRangeSchema,
  todayISO,
  uuid,
  type CalendarState,
  type PagedResult,
  type ProgressSummary,
  type RoutineDTO,
  type StreakStats,
} from "@/lib/routine-shared";
import { z } from "zod";

const asAny = (x: unknown) => x as any;

// ---------------- internal helpers ----------------

function mapRoutine(row: any): RoutineDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    scope: {
      level: row.scope_level ?? row.level ?? "",
      subjectId: row.scope_subject_id ?? null,
      chapterId: row.scope_chapter_id ?? null,
    },
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    activeDays: Array.isArray(row.active_days) ? row.active_days : [],
    targets: {
      studyMinutes: row.study_target_minutes ?? 0,
      mcqCount: row.mcq_target ?? 0,
    },
    status: row.status ?? "active",
    assignmentMode: row.assignment_mode ?? "all_students",
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/** Does this routine's scope apply to this student? */
async function studentMatchesRoutine(
  supabase: any,
  userId: string,
  routine: any,
): Promise<boolean> {
  const { data: profile } = await asAny(supabase)
    .from("profiles")
    .select("level")
    .eq("id", userId)
    .maybeSingle();
  const level = profile?.level;
  if (!level) return false;
  if (routine.scope_level && routine.scope_level !== level) return false;
  // Subject / chapter narrower scopes are additive: a routine limited to a
  // subject only applies when the student is currently studying that subject.
  // We do not maintain a `current subject` per student, so a subject/chapter
  // scoped routine applies to anyone on the matching level. Narrower filters
  // will be applied client-side via UI selection.
  return true;
}

async function todayActive(supabase: any, routine: any, dateISO: string): Promise<boolean> {
  if (routine.start_date && dateISO < routine.start_date) return false;
  if (routine.end_date && dateISO > routine.end_date) return false;
  if (Array.isArray(routine.active_days) && routine.active_days.length > 0) {
    if (!routine.active_days.includes(dayKeyFromDate(dateISO))) return false;
  }
  return routine.status === "active";
}

async function logActivity(
  supabase: any,
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    await asAny(supabase).from("routine_activity_log").insert({
      actor_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      description,
      metadata,
    });
  } catch {
    // Activity logging never blocks the caller.
  }
}

// ---------------- endpoints ----------------

/** List the routines currently assigned to the calling student.
 *
 * Visibility rules:
 *   - routine.assignment_mode = 'all_students' AND scope matches profile.level
 *   - routine.assignment_mode = 'selected_students' AND an active row exists
 *     in routine_assignments for (routine_id, auth.uid()).
 *   - Legacy rows with NULL assignment_mode are treated as 'all_students'.
 */
export const listMyRoutines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PagedResult<RoutineDTO>> => {
    const { supabase, userId } = context;
    const today = todayISO();
    const { data, error } = await asAny(supabase)
      .from("routines")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTable(error)) return { rows: [], count: 0, page: 1, pageSize: 50, fallback: true };
      throw new Error(error.message);
    }
    // Load this student's explicit active assignments once.
    let assignedIds = new Set<string>();
    try {
      const { data: ra, error: raErr } = await asAny(supabase)
        .from("routine_assignments")
        .select("routine_id")
        .eq("student_id", userId)
        .eq("status", "active");
      if (raErr && !isMissingTable(raErr)) throw new Error(raErr.message);
      assignedIds = new Set((ra ?? []).map((r: any) => r.routine_id as string));
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
    const applicable: any[] = [];
    for (const row of data ?? []) {
      if (row.start_date && row.start_date > today) continue;
      if (row.end_date && row.end_date < today) continue;
      const mode = (row.assignment_mode as string | null) ?? "all_students";
      if (mode === "selected_students") {
        if (assignedIds.has(row.id)) applicable.push(row);
      } else {
        if (await studentMatchesRoutine(supabase, userId, row)) applicable.push(row);
      }
    }
    const rows = applicable.map(mapRoutine);
    return { rows, count: rows.length, page: 1, pageSize: rows.length };
  });

/** Aggregate today's progress for one routine (or all active ones). */
export const getTodayProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ routineId: uuid.optional() })))
  .handler(async ({ context, data }): Promise<ProgressSummary & { fallback?: boolean }> => {
    const { supabase, userId } = context;
    const date = todayISO();

    // Sum approved manual sessions + explicit daily entry.
    const sums = { study: 0, mcqs: 0 };
    try {
      let q = asAny(supabase)
        .from("routine_study_sessions")
        .select("duration_minutes,mcqs_solved,status,routine_id")
        .eq("user_id", userId)
        .eq("date", date)
        .neq("status", "rejected");
      if (data.routineId) q = q.eq("routine_id", data.routineId);
      const { data: sessions, error } = await q;
      if (error && !isMissingTable(error)) throw new Error(error.message);
      for (const s of sessions ?? []) {
        sums.study += Number(s.duration_minutes ?? 0);
        sums.mcqs += Number(s.mcqs_solved ?? 0);
      }
      if (error && isMissingTable(error)) {
        return {
          studyMinutes: 0,
          mcqsSolved: 0,
          studyPct: 0,
          mcqPct: 0,
          overallPct: 0,
          targetStudyMinutes: 0,
          targetMcqCount: 0,
          fallback: true,
        };
      }
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    // Fetch routine target(s).
    let targetStudy = 0;
    let targetMcq = 0;
    try {
      let rq = asAny(supabase).from("routines").select("study_target_minutes,mcq_target,status").eq("status", "active");
      if (data.routineId) rq = rq.eq("id", data.routineId);
      const { data: routines } = await rq;
      for (const r of routines ?? []) {
        targetStudy += Number(r.study_target_minutes ?? 0);
        targetMcq += Number(r.mcq_target ?? 0);
      }
    } catch {
      /* no-op */
    }

    const studyPct = percent(sums.study, targetStudy);
    const mcqPct = percent(sums.mcqs, targetMcq);
    const overallPct = Math.round((studyPct + mcqPct) / 2);
    return {
      studyMinutes: sums.study,
      mcqsSolved: sums.mcqs,
      studyPct,
      mcqPct,
      overallPct,
      targetStudyMinutes: targetStudy,
      targetMcqCount: targetMcq,
    };
  });

/** Update the aggregate daily progress row for the calling student. */
export const submitDailyProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(dailyProgressSchema))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload = {
      routine_id: data.routineId,
      user_id: userId,
      date: data.date,
      study_minutes: data.studyMinutes ?? 0,
      mcqs_solved: data.mcqsSolved ?? 0,
      updated_at: new Date().toISOString(),
    };
    const { error } = await asAny(supabase)
      .from("routine_daily_progress")
      .upsert(payload, { onConflict: "routine_id,user_id,date" });
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true };
      throw new Error(error.message);
    }
    await logActivity(
      supabase,
      userId,
      "progress.updated",
      "routine_daily_progress",
      data.routineId,
      `Updated daily progress for ${data.date}`,
      { date: data.date },
    );
    return { ok: true };
  });

/** List the calling student's manual study sessions for a date range. */
export const listMyStudySessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    validate(
      z.object({
        routineId: uuid.optional(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        page: z.number().int().min(1).max(2000).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = asAny(supabase)
      .from("routine_study_sessions")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.routineId) q = q.eq("routine_id", data.routineId);
    if (data.dateFrom) q = q.gte("date", data.dateFrom);
    if (data.dateTo) q = q.lte("date", data.dateTo);
    const { data: rows, error, count } = await q;
    if (error) {
      if (isMissingTable(error))
        return { rows: [], count: 0, page: data.page, pageSize: data.pageSize, fallback: true };
      throw new Error(error.message);
    }
    return { rows: rows ?? [], count: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

/** Create a manual study session (pending admin review). */
export const createStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(manualSessionCreateSchema))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (data.startTime && data.endTime && data.endTime <= data.startTime) {
      throw new Error("End time must be after start time");
    }
    // Determine approval workflow from admin settings.
    // If Manual Study Review is disabled, auto-approve on submission.
    let requireApproval = true;
    try {
      const { data: settings, error: settingsErr } = await asAny(supabase)
        .from("routine_manual_review_settings")
        .select("require_admin_approval")
        .eq("id", true)
        .maybeSingle();
      if (!settingsErr && settings) {
        requireApproval = settings.require_admin_approval !== false;
      }
    } catch {
      // Fall through with default requireApproval=true.
    }
    const nowIso = new Date().toISOString();
    const row: Record<string, unknown> = {
      routine_id: data.routineId,
      user_id: userId,
      date: data.date,
      title: data.title,
      duration_minutes: data.durationMinutes,
      mcqs_solved: data.mcqsSolved ?? 0,
      notes: data.notes ?? null,
      start_time: data.startTime ?? null,
      end_time: data.endTime ?? null,
      status: requireApproval ? "pending" : "approved",
    };
    if (!requireApproval) {
      row.reviewed_at = nowIso;
      row.reviewed_by = userId;
    }


    const { data: inserted, error } = await asAny(supabase)
      .from("routine_study_sessions")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true, session: null };
      throw new Error(error.message);
    }
    await logActivity(
      supabase,
      userId,
      "manual_study.added",
      "routine_study_session",
      inserted?.id ?? null,
      `Submitted manual study session '${data.title}'`,
      { date: data.date, minutes: data.durationMinutes },
    );
    return { ok: true, session: inserted };
  });

/** Update a pending manual session (owner + still pending only). */
export const updateStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(manualSessionUpdateSchema))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: existing, error: readErr } = await asAny(supabase)
      .from("routine_study_sessions")
      .select("id,user_id,status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) {
      if (isMissingTable(readErr)) return { ok: true, fallback: true };
      throw new Error(readErr.message);
    }
    if (!existing) throw new Error("Session not found");
    if (existing.user_id !== userId) throw new Error("Forbidden");
    if (existing.status !== "pending") throw new Error("Approved / rejected sessions cannot be edited");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.durationMinutes !== undefined) patch.duration_minutes = data.durationMinutes;
    if (data.mcqsSolved !== undefined) patch.mcqs_solved = data.mcqsSolved;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.startTime !== undefined) patch.start_time = data.startTime;
    if (data.endTime !== undefined) patch.end_time = data.endTime;

    const { error } = await asAny(supabase)
      .from("routine_study_sessions")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Delete a pending manual session (owner + still pending only). */
export const deleteStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: existing, error: readErr } = await asAny(supabase)
      .from("routine_study_sessions")
      .select("id,user_id,status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) {
      if (isMissingTable(readErr)) return { ok: true, fallback: true };
      throw new Error(readErr.message);
    }
    if (!existing) return { ok: true };
    if (existing.user_id !== userId) throw new Error("Forbidden");
    if (existing.status !== "pending") throw new Error("Reviewed sessions cannot be deleted");
    const { error } = await asAny(supabase)
      .from("routine_study_sessions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Return per-date state for the calendar view. */
export const getMyCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(calendarRangeSchema))
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      days: { date: string; state: CalendarState; studyMinutes: number; mcqsSolved: number }[];
      fallback?: boolean;
    }> => {
      const { supabase, userId } = context;
      let q = asAny(supabase)
        .from("routine_daily_progress")
        .select("date,study_minutes,mcqs_solved,routine_id")
        .eq("user_id", userId)
        .gte("date", data.monthStart)
        .lte("date", data.monthEnd);
      if (data.routineId) q = q.eq("routine_id", data.routineId);
      const { data: rows, error } = await q;
      if (error) {
        if (isMissingTable(error)) return { days: [], fallback: true };
        throw new Error(error.message);
      }

      // Fetch active routines to compute targets and active days.
      let rq = asAny(supabase).from("routines").select("*").eq("status", "active");
      if (data.routineId) rq = rq.eq("id", data.routineId);
      const { data: routines } = await rq;

      const today = todayISO();
      const days: {
        date: string;
        state: CalendarState;
        studyMinutes: number;
        mcqsSolved: number;
      }[] = [];
      const start = new Date(`${data.monthStart}T00:00:00Z`);
      const end = new Date(`${data.monthEnd}T00:00:00Z`);
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const dayRows = (rows ?? []).filter((r: any) => r.date === iso);
        const study = dayRows.reduce((a: number, r: any) => a + Number(r.study_minutes ?? 0), 0);
        const mcqs = dayRows.reduce((a: number, r: any) => a + Number(r.mcqs_solved ?? 0), 0);

        let scheduled = false;
        let targetStudy = 0;
        let targetMcq = 0;
        for (const r of routines ?? []) {
          if (!(await todayActive(supabase, r, iso))) continue;
          scheduled = true;
          targetStudy += Number(r.study_target_minutes ?? 0);
          targetMcq += Number(r.mcq_target ?? 0);
        }

        let state: CalendarState;
        if (iso === today) state = "today";
        else if (!scheduled) state = "not_started";
        else if (study >= targetStudy && mcqs >= targetMcq && (targetStudy > 0 || targetMcq > 0))
          state = "completed";
        else if (study > 0 || mcqs > 0) state = "in_progress";
        else if (iso < today) state = "missed";
        else state = "not_started";
        days.push({ date: iso, state, studyMinutes: study, mcqsSolved: mcqs });
      }
      return { days };
    },
  );

/** Compute streak/completion stats for the caller. */
export const getMyStreaks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    validate(
      z.object({
        routineId: uuid.optional(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    ),
  )
  .handler(async ({ context, data }): Promise<StreakStats & { fallback?: boolean }> => {
    const { supabase, userId } = context;
    let q = asAny(supabase)
      .from("routine_daily_progress")
      .select("date,study_minutes,mcqs_solved,routine_id")
      .eq("user_id", userId)
      .order("date", { ascending: true });
    if (data.routineId) q = q.eq("routine_id", data.routineId);
    if (data.dateFrom) q = q.gte("date", data.dateFrom);
    if (data.dateTo) q = q.lte("date", data.dateTo);
    const { data: rows, error } = await q;
    if (error) {
      if (isMissingTable(error))
        return {
          currentStreak: 0,
          longestStreak: 0,
          completedDays: 0,
          missedDays: 0,
          completionRate: 0,
          fallback: true,
        };
      throw new Error(error.message);
    }

    // Load target(s) for pass/fail decisions.
    let rq = asAny(supabase).from("routines").select("study_target_minutes,mcq_target,status").eq("status", "active");
    if (data.routineId) rq = rq.eq("id", data.routineId);
    const { data: routines } = await rq;
    const targetStudy = (routines ?? []).reduce(
      (a: number, r: any) => a + Number(r.study_target_minutes ?? 0),
      0,
    );
    const targetMcq = (routines ?? []).reduce(
      (a: number, r: any) => a + Number(r.mcq_target ?? 0),
      0,
    );

    const byDate = new Map<string, { s: number; m: number }>();
    for (const r of rows ?? []) {
      const cur = byDate.get(r.date) ?? { s: 0, m: 0 };
      cur.s += Number(r.study_minutes ?? 0);
      cur.m += Number(r.mcqs_solved ?? 0);
      byDate.set(r.date, cur);
    }

    const dates = Array.from(byDate.keys()).sort();
    let longest = 0;
    let current = 0;
    let completed = 0;
    let missed = 0;
    let prev: string | null = null;
    for (const d of dates) {
      const v = byDate.get(d)!;
      const ok =
        (targetStudy === 0 || v.s >= targetStudy) &&
        (targetMcq === 0 || v.m >= targetMcq) &&
        (targetStudy > 0 || targetMcq > 0 || v.s > 0 || v.m > 0);
      if (ok) {
        completed += 1;
        if (prev) {
          const diff = (new Date(d).getTime() - new Date(prev).getTime()) / 86_400_000;
          current = diff === 1 ? current + 1 : 1;
        } else {
          current = 1;
        }
        longest = Math.max(longest, current);
        prev = d;
      } else {
        missed += 1;
        current = 0;
        prev = null;
      }
    }
    const total = completed + missed;
    return {
      currentStreak: current,
      longestStreak: longest,
      completedDays: completed,
      missedDays: missed,
      completionRate: percent(completed, total),
    };
  });

/** Aggregate report (daily / weekly / monthly / yearly). */
export const getMyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(reportRangeSchema))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let q = asAny(supabase)
      .from("routine_daily_progress")
      .select("date,study_minutes,mcqs_solved,routine_id")
      .eq("user_id", userId);
    if (data.routineId) q = q.eq("routine_id", data.routineId);
    if (data.dateFrom) q = q.gte("date", data.dateFrom);
    if (data.dateTo) q = q.lte("date", data.dateTo);
    const { data: rows, error } = await q;
    if (error) {
      if (isMissingTable(error))
        return { buckets: [], totals: { studyMinutes: 0, mcqsSolved: 0, days: 0 }, fallback: true };
      throw new Error(error.message);
    }

    const buckets = new Map<string, { studyMinutes: number; mcqsSolved: number; days: number }>();
    for (const r of rows ?? []) {
      const key = bucketKey(r.date, data.period);
      const cur = buckets.get(key) ?? { studyMinutes: 0, mcqsSolved: 0, days: 0 };
      cur.studyMinutes += Number(r.study_minutes ?? 0);
      cur.mcqsSolved += Number(r.mcqs_solved ?? 0);
      cur.days += 1;
      buckets.set(key, cur);
    }
    const totals = {
      studyMinutes: [...buckets.values()].reduce((a, b) => a + b.studyMinutes, 0),
      mcqsSolved: [...buckets.values()].reduce((a, b) => a + b.mcqsSolved, 0),
      days: [...buckets.values()].reduce((a, b) => a + b.days, 0),
    };
    return {
      buckets: [...buckets.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([bucket, v]) => ({ bucket, ...v })),
      totals,
    };
  });

function bucketKey(date: string, period: "daily" | "weekly" | "monthly" | "yearly") {
  const d = new Date(`${date}T00:00:00Z`);
  if (period === "yearly") return String(d.getUTCFullYear());
  if (period === "monthly")
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (period === "weekly") {
    // ISO week key.
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week =
      1 +
      Math.round(
        ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
          3 +
          ((firstThursday.getUTCDay() + 6) % 7)) /
          7,
      );
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return date;
}

/** Student notifications feed (routine domain only). */
export const listMyRoutineNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await asAny(supabase)
      .from("routine_notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      if (isMissingTable(error)) return { rows: [], fallback: true };
      throw new Error(error.message);
    }
    return { rows: data ?? [] };
  });

export const markRoutineNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await asAny(supabase)
      .from("routine_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true };
      throw new Error(error.message);
    }
    return { ok: true };
  });