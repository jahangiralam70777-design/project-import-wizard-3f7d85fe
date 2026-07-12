/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin-facing server functions for the Routine Management module.
//
// Every endpoint:
//   - Requires authentication (requireSupabaseAuth) AND the "manage_content"
//     admin permission via assertPermission. Denial is logged by that helper.
//   - Validates input with zod (see routine-shared.ts).
//   - Records an activity log entry for state-changing operations in
//     public.routine_activity_log.
//   - Handles missing-table (42P01) gracefully so the UI keeps functioning
//     before the SQL phase lands.
//
// This module is intentionally self-contained: it never reads/writes MCQ,
// Quiz, Mock, Custom Exam, Wrong Questions, Bookmarks, or existing analytics
// tables.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPermission } from "@/lib/admin-permissions";
import { validate } from "@/lib/validate";
import {
  isMissingTable,
  listFiltersSchema,
  reviewActionSchema,
  reviewListSchema,
  routineCreateSchema,
  routineUpdateSchema,
  uuid,
  type PagedResult,
  type RoutineDTO,
} from "@/lib/routine-shared";

const PERM = "manage_content";
const asAny = (x: unknown) => x as any;

function mapRoutine(row: any): RoutineDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    scope: {
      level: row.scope_level ?? "",
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
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
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
    /* best-effort */
  }
}

async function enqueueNotifications(
  supabase: any,
  userIds: string[],
  type: string,
  title: string,
  body: string,
  metadata: Record<string, unknown>,
) {
  if (userIds.length === 0) return;
  const rows = userIds.map((uid) => ({
    user_id: uid,
    type,
    title,
    body,
    metadata,
  }));
  try {
    await asAny(supabase).from("routine_notifications").insert(rows);
  } catch {
    /* best-effort — provider fan-out is future work */
  }
}

async function resolveAudience(
  supabase: any,
  scope: { level: string; subjectId: string | null; chapterId: string | null },
): Promise<string[]> {
  try {
    const { data } = await asAny(supabase)
      .from("profiles")
      .select("id,level")
      .eq("level", scope.level);
    return (data ?? []).map((r: any) => r.id as string);
  } catch {
    return [];
  }
}

// ---------------- CRUD ----------------

export const adminListRoutines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(listFiltersSchema))
  .handler(async ({ context, data }): Promise<PagedResult<RoutineDTO>> => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.list");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = asAny(context.supabase)
      .from("routines")
      .select("*", { count: "exact" })
      .order(data.sortBy, { ascending: data.sortDir === "asc" })
      .range(from, to);
    if (data.status) q = q.eq("status", data.status);
    if (data.level) q = q.eq("scope_level", data.level);
    if (data.subjectId) q = q.eq("scope_subject_id", data.subjectId);
    if (data.chapterId) q = q.eq("scope_chapter_id", data.chapterId);
    if (data.dateFrom) q = q.gte("start_date", data.dateFrom);
    if (data.dateTo) q = q.lte("end_date", data.dateTo);
    if (data.search) q = q.ilike("name", `%${data.search}%`);
    const { data: rows, error, count } = await q;
    if (error) {
      if (isMissingTable(error))
        return { rows: [], count: 0, page: data.page, pageSize: data.pageSize, fallback: true };
      throw new Error(error.message);
    }
    return {
      rows: (rows ?? []).map(mapRoutine),
      count: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const adminGetRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }): Promise<RoutineDTO | null> => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.read");
    const { data: row, error } = await asAny(context.supabase)
      .from("routines")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return null;
      throw new Error(error.message);
    }
    return row ? mapRoutine(row) : null;
  });

/** Guard against creating a second overlapping ACTIVE routine for the same exact scope. */
async function assertNoDuplicateActiveScope(
  supabase: any,
  scope: { level: string; subjectId: string | null; chapterId: string | null },
  excludeId?: string,
) {
  let q = asAny(supabase)
    .from("routines")
    .select("id")
    .eq("status", "active")
    .eq("scope_level", scope.level);
  q = scope.subjectId ? q.eq("scope_subject_id", scope.subjectId) : q.is("scope_subject_id", null);
  q = scope.chapterId ? q.eq("scope_chapter_id", scope.chapterId) : q.is("scope_chapter_id", null);
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q.limit(1);
  if (error) {
    if (isMissingTable(error)) return;
    throw new Error(error.message);
  }
  if ((data ?? []).length > 0) {
    throw new Error(
      "An active routine already exists for this exact scope. Disable it first or duplicate as a draft.",
    );
  }
}

export const adminCreateRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(routineCreateSchema))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.create", {
      name: data.name,
    });
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      throw new Error("endDate must be on or after startDate");
    }
    await assertNoDuplicateActiveScope(context.supabase, {
      level: data.scope.level,
      subjectId: data.scope.subjectId ?? null,
      chapterId: data.scope.chapterId ?? null,
    });
    const row = {
      name: data.name,
      description: data.description ?? null,
      scope_level: data.scope.level,
      scope_subject_id: data.scope.subjectId ?? null,
      scope_chapter_id: data.scope.chapterId ?? null,
      start_date: data.startDate ?? null,
      end_date: data.endDate ?? null,
      active_days: data.activeDays,
      study_target_minutes: data.targets.studyMinutes,
      mcq_target: data.targets.mcqCount,
      status: "active" as const,
      created_by: context.userId,
    };
    const { data: inserted, error } = await asAny(context.supabase)
      .from("routines")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true, routine: null };
      throw new Error(error.message);
    }
    await logActivity(
      context.supabase,
      context.userId,
      "routine.created",
      "routine",
      inserted?.id ?? null,
      `Created routine '${data.name}'`,
      { scope: data.scope },
    );
    const audience = await resolveAudience(context.supabase, {
      level: data.scope.level,
      subjectId: data.scope.subjectId ?? null,
      chapterId: data.scope.chapterId ?? null,
    });
    await enqueueNotifications(
      context.supabase,
      audience,
      "routine.assigned",
      "New routine assigned",
      `You have been assigned to '${data.name}'.`,
      { routineId: inserted?.id ?? null },
    );
    return { ok: true, routine: inserted ? mapRoutine(inserted) : null };
  });

export const adminUpdateRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(routineUpdateSchema))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.update", {
      id: data.id,
    });
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      throw new Error("endDate must be on or after startDate");
    }
    if (data.scope) {
      await assertNoDuplicateActiveScope(
        context.supabase,
        {
          level: data.scope.level,
          subjectId: data.scope.subjectId ?? null,
          chapterId: data.scope.chapterId ?? null,
        },
        data.id,
      );
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.startDate !== undefined) patch.start_date = data.startDate;
    if (data.endDate !== undefined) patch.end_date = data.endDate;
    if (data.activeDays !== undefined) patch.active_days = data.activeDays;
    if (data.targets !== undefined) {
      patch.study_target_minutes = data.targets.studyMinutes;
      patch.mcq_target = data.targets.mcqCount;
    }
    if (data.scope !== undefined) {
      patch.scope_level = data.scope.level;
      patch.scope_subject_id = data.scope.subjectId ?? null;
      patch.scope_chapter_id = data.scope.chapterId ?? null;
    }
    const { error } = await asAny(context.supabase)
      .from("routines")
      .update(patch)
      .eq("id", data.id);
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true };
      throw new Error(error.message);
    }
    await logActivity(
      context.supabase,
      context.userId,
      "routine.updated",
      "routine",
      data.id,
      `Updated routine`,
      { changed: Object.keys(patch) },
    );
    return { ok: true };
  });

async function setRoutineStatus(
  context: any,
  id: string,
  status: "active" | "disabled" | "archived",
  action: string,
  description: string,
) {
  const { error } = await asAny(context.supabase)
    .from("routines")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (isMissingTable(error)) return { ok: true, fallback: true };
    throw new Error(error.message);
  }
  await logActivity(context.supabase, context.userId, action, "routine", id, description);
  return { ok: true };
}

export const adminEnableRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.enable", { id: data.id });
    return setRoutineStatus(context, data.id, "active", "routine.enabled", "Enabled routine");
  });

export const adminDisableRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.disable", { id: data.id });
    return setRoutineStatus(context, data.id, "disabled", "routine.disabled", "Disabled routine");
  });

export const adminArchiveRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.archive", { id: data.id });
    return setRoutineStatus(context, data.id, "archived", "routine.archived", "Archived routine");
  });

export const adminRestoreRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.restore", { id: data.id });
    return setRoutineStatus(context, data.id, "disabled", "routine.restored", "Restored routine");
  });

export const adminDeleteRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.delete", { id: data.id });
    const { error } = await asAny(context.supabase).from("routines").delete().eq("id", data.id);
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true };
      throw new Error(error.message);
    }
    await logActivity(
      context.supabase,
      context.userId,
      "routine.deleted",
      "routine",
      data.id,
      "Deleted routine",
    );
    return { ok: true };
  });

export const adminDuplicateRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.duplicate", { id: data.id });
    const { data: src, error } = await asAny(context.supabase)
      .from("routines")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true, routine: null };
      throw new Error(error.message);
    }
    if (!src) throw new Error("Source routine not found");
    const copy = {
      name: `${src.name} (copy)`,
      description: src.description,
      scope_level: src.scope_level,
      scope_subject_id: src.scope_subject_id,
      scope_chapter_id: src.scope_chapter_id,
      start_date: null,
      end_date: null,
      active_days: src.active_days ?? [],
      study_target_minutes: src.study_target_minutes ?? 0,
      mcq_target: src.mcq_target ?? 0,
      status: "disabled" as const,
      created_by: context.userId,
    };
    const { data: inserted, error: insErr } = await asAny(context.supabase)
      .from("routines")
      .insert(copy)
      .select("*")
      .maybeSingle();
    if (insErr) throw new Error(insErr.message);
    await logActivity(
      context.supabase,
      context.userId,
      "routine.duplicated",
      "routine",
      inserted?.id ?? null,
      `Duplicated routine '${src.name}'`,
      { sourceId: data.id },
    );
    return { ok: true, routine: inserted ? mapRoutine(inserted) : null };
  });

// ---------------- Review queue ----------------

export const adminListReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(reviewListSchema))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.review.list");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = asAny(context.supabase)
      .from("routine_study_sessions")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.status) q = q.eq("status", data.status);
    if (data.dateFrom) q = q.gte("date", data.dateFrom);
    if (data.dateTo) q = q.lte("date", data.dateTo);
    if (data.search) q = q.ilike("title", `%${data.search}%`);
    const { data: rows, error, count } = await q;
    if (error) {
      if (isMissingTable(error))
        return { rows: [], count: 0, page: data.page, pageSize: data.pageSize, fallback: true };
      throw new Error(error.message);
    }
    return { rows: rows ?? [], count: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

export const adminReviewSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(reviewActionSchema))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.review.act", {
      sessionId: data.sessionId,
      action: data.action,
    });
    const nextStatus = data.action === "approve" ? "approved" : "rejected";
    const { data: updated, error } = await asAny(context.supabase)
      .from("routine_study_sessions")
      .update({
        status: nextStatus,
        admin_notes: data.adminNotes ?? null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId)
      .select("id,user_id,routine_id,title")
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true };
      throw new Error(error.message);
    }
    await logActivity(
      context.supabase,
      context.userId,
      data.action === "approve" ? "review.approved" : "review.rejected",
      "routine_study_session",
      data.sessionId,
      `${data.action === "approve" ? "Approved" : "Rejected"} manual study session`,
    );
    if (updated?.user_id) {
      await enqueueNotifications(
        context.supabase,
        [updated.user_id],
        data.action === "approve" ? "review.approved" : "review.rejected",
        data.action === "approve" ? "Study session approved" : "Study session rejected",
        `Your session '${updated.title ?? ""}' was ${nextStatus}.`,
        { sessionId: data.sessionId, routineId: updated.routine_id },
      );
    }
    return { ok: true };
  });

// ---------------- Dashboard / reporting ----------------

export const adminRoutineDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.dashboard");
    const supabase = context.supabase;
    const result = {
      totals: { active: 0, disabled: 0, archived: 0, total: 0 },
      reviews: { pending: 0, approved: 0, rejected: 0 },
      recentActivity: [] as any[],
      fallback: false,
    };
    try {
      const { data: rs, error } = await asAny(supabase).from("routines").select("status");
      if (error) throw error;
      for (const r of rs ?? []) {
        result.totals.total += 1;
        if (r.status === "active") result.totals.active += 1;
        else if (r.status === "disabled") result.totals.disabled += 1;
        else if (r.status === "archived") result.totals.archived += 1;
      }
    } catch (e) {
      if (isMissingTable(e)) result.fallback = true;
      else throw e;
    }
    try {
      const { data: ss, error } = await asAny(supabase)
        .from("routine_study_sessions")
        .select("status");
      if (error) throw error;
      for (const s of ss ?? []) {
        if (s.status === "pending") result.reviews.pending += 1;
        else if (s.status === "approved") result.reviews.approved += 1;
        else if (s.status === "rejected") result.reviews.rejected += 1;
      }
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      result.fallback = true;
    }
    try {
      const { data: acts, error } = await asAny(supabase)
        .from("routine_activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      result.recentActivity = acts ?? [];
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      result.fallback = true;
    }
    return result;
  });

/** Admin — progress across all students (paginated). */
export const adminListStudentProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    validate(
      z.object({
        routineId: uuid.optional(),
        userId: uuid.optional(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        page: z.number().int().min(1).max(2000).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.progress.list");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = asAny(context.supabase)
      .from("routine_daily_progress")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .range(from, to);
    if (data.routineId) q = q.eq("routine_id", data.routineId);
    if (data.userId) q = q.eq("user_id", data.userId);
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

/** Export report rows as JSON (CSV wrapper is a UI concern). */
export const adminExportReport = createServerFn({ method: "POST" })
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
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.export");
    let q = asAny(context.supabase)
      .from("routine_daily_progress")
      .select("*")
      .order("date", { ascending: false })
      .limit(10_000);
    if (data.routineId) q = q.eq("routine_id", data.routineId);
    if (data.dateFrom) q = q.gte("date", data.dateFrom);
    if (data.dateTo) q = q.lte("date", data.dateTo);
    const { data: rows, error } = await q;
    if (error) {
      if (isMissingTable(error)) return { rows: [], fallback: true };
      throw new Error(error.message);
    }
    return { rows: rows ?? [] };
  });

// ---------------- Activity log ----------------

export const adminListActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    validate(
      z.object({
        entityType: z.string().max(64).optional(),
        entityId: uuid.optional(),
        actorId: uuid.optional(),
        page: z.number().int().min(1).max(2000).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.activity.list");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = asAny(context.supabase)
      .from("routine_activity_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.entityType) q = q.eq("entity_type", data.entityType);
    if (data.entityId) q = q.eq("entity_id", data.entityId);
    if (data.actorId) q = q.eq("actor_id", data.actorId);
    const { data: rows, error, count } = await q;
    if (error) {
      if (isMissingTable(error))
        return { rows: [], count: 0, page: data.page, pageSize: data.pageSize, fallback: true };
      throw new Error(error.message);
    }
    return { rows: rows ?? [], count: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

// ---------------- History ----------------

export const adminRoutineHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ id: uuid })))
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, PERM, "routine.history", { id: data.id });
    const { data: rows, error } = await asAny(context.supabase)
      .from("routine_activity_log")
      .select("*")
      .eq("entity_type", "routine")
      .eq("entity_id", data.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTable(error)) return { rows: [], fallback: true };
      throw new Error(error.message);
    }
    return { rows: rows ?? [] };
  });

// ---------------- Manual Study Review Settings ----------------

/** Read the singleton toggle. Any authenticated user may read. */
export const getManualReviewSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await asAny(context.supabase)
      .from("routine_manual_review_settings")
      .select("require_admin_approval, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        return { requireAdminApproval: true, updatedAt: null, updatedBy: null, fallback: true as const };
      }
      throw new Error(error.message);
    }
    return {
      requireAdminApproval: data?.require_admin_approval ?? true,
      updatedAt: data?.updated_at ?? null,
      updatedBy: data?.updated_by ?? null,
      fallback: false as const,
    };
  });

/** Update the singleton toggle. Requires manage_content permission. */
export const updateManualReviewSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validate(z.object({ requireAdminApproval: z.boolean() })))
  .handler(async ({ context, data }) => {
    await assertPermission(
      context.supabase,
      context.userId,
      PERM,
      "routine.manual_review_settings.update",
      { requireAdminApproval: data.requireAdminApproval },
    );
    const { error } = await asAny(context.supabase)
      .from("routine_manual_review_settings")
      .upsert(
        {
          id: true,
          require_admin_approval: data.requireAdminApproval,
          updated_at: new Date().toISOString(),
          updated_by: context.userId,
        },
        { onConflict: "id" },
      );
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true as const };
      throw new Error(error.message);
    }
    return { ok: true, fallback: false as const };
  });
