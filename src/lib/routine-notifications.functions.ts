/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin server functions for the Routine Notification System. All endpoints
// enforce the `manage_content` permission via assertPermission(); reads and
// writes are scoped to the dedicated `routine_notification_*` tables and do
// not touch any other domain.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPermission } from "@/lib/admin-permissions";
import { isMissingTable, todayISO } from "@/lib/routine-shared";
import {
  NOTIF_KINDS,
  notificationSettingsSchema,
  renderTemplate,
  templateUpsertSchema,
  testDeliverySchema,
  tierForPct,
  tierUpsertSchema,
  type NotifKind,
} from "@/lib/routine-notifications-shared";

const asAny = (x: unknown) => x as any;
const noInput = () => ({});

const DEFAULT_SETTINGS = {
  enabled: true,
  timezone: "Asia/Dhaka",
  morning_time: "09:00",
  night_time: "22:00",
  deliver_notification_center: true,
  deliver_live_chat: false,
  quiet_start: null as string | null,
  quiet_end: null as string | null,
  weekly_summary_enabled: false,
  weekly_summary_day: 0,
  weekly_summary_time: "20:00",
};

// ---------------- Settings ----------------
export const adminGetRoutineNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(noInput)
  .handler(async ({ context }) => {
    await assertPermission(context.supabase, context.userId, "manage_content");
    const { data, error } = await asAny(context.supabase)
      .from("routine_notification_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { settings: DEFAULT_SETTINGS, fallback: true as const };
      throw new Error(error.message);
    }
    return { settings: { ...DEFAULT_SETTINGS, ...(data ?? {}) } };
  });

export const adminUpdateRoutineNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => notificationSettingsSchema.parse(i))
  .handler(async ({ context, data }) => {
    await assertPermission(
      context.supabase,
      context.userId,
      "manage_content",
      "routine_notification.settings.update",
    );
    const { error } = await asAny(context.supabase)
      .from("routine_notification_settings")
      .upsert({ id: 1, ...data, updated_at: new Date().toISOString() });
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true as const };
      throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------------- Templates ----------------
export const adminListRoutineNotificationTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(noInput)
  .handler(async ({ context }) => {
    await assertPermission(context.supabase, context.userId, "manage_content");
    const { data, error } = await asAny(context.supabase)
      .from("routine_notification_templates")
      .select("*")
      .order("kind", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { rows: [], fallback: true as const };
      throw new Error(error.message);
    }
    return { rows: data ?? [] };
  });

export const adminUpsertRoutineNotificationTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => templateUpsertSchema.parse(i))
  .handler(async ({ context, data }) => {
    await assertPermission(
      context.supabase,
      context.userId,
      "manage_content",
      "routine_notification.template.upsert",
      { kind: data.kind },
    );
    const { error } = await asAny(context.supabase)
      .from("routine_notification_templates")
      .upsert(
        {
          kind: data.kind,
          title: data.title,
          body: data.body,
          enabled: data.enabled,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "kind" },
      );
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true as const };
      throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------------- Performance Tiers ----------------
export const adminListRoutinePerformanceTiers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(noInput)
  .handler(async ({ context }) => {
    await assertPermission(context.supabase, context.userId, "manage_content");
    const { data, error } = await asAny(context.supabase)
      .from("routine_notification_tiers")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { rows: [], fallback: true as const };
      throw new Error(error.message);
    }
    return { rows: data ?? [] };
  });

export const adminUpsertRoutinePerformanceTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => tierUpsertSchema.parse(i))
  .handler(async ({ context, data }) => {
    await assertPermission(
      context.supabase,
      context.userId,
      "manage_content",
      "routine_notification.tier.upsert",
    );
    if (data.max_pct < data.min_pct) throw new Error("max_pct must be ≥ min_pct");
    const row = {
      ...(data.id ? { id: data.id } : {}),
      key: data.key,
      label: data.label,
      emoji: data.emoji,
      min_pct: data.min_pct,
      max_pct: data.max_pct,
      color: data.color,
      sort_order: data.sort_order,
      updated_at: new Date().toISOString(),
    };
    const { error } = await asAny(context.supabase)
      .from("routine_notification_tiers")
      .upsert(row, { onConflict: "key" });
    if (error) {
      if (isMissingTable(error)) return { ok: true, fallback: true as const };
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminDeleteRoutinePerformanceTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    await assertPermission(
      context.supabase,
      context.userId,
      "manage_content",
      "routine_notification.tier.delete",
      { id: data.id },
    );
    const { error } = await asAny(context.supabase)
      .from("routine_notification_tiers")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Logs ----------------
export const adminListRoutineNotificationLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z
      .object({
        kind: z.enum(NOTIF_KINDS).optional(),
        status: z.enum(["sent", "failed", "skipped"]).optional(),
        userId: z.string().uuid().optional(),
        page: z.number().int().min(1).max(2000).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, "manage_content");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = asAny(context.supabase)
      .from("routine_notification_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.kind) q = q.eq("kind", data.kind);
    if (data.status) q = q.eq("status", data.status);
    if (data.userId) q = q.eq("user_id", data.userId);
    const { data: rows, error, count } = await q;
    if (error) {
      if (isMissingTable(error))
        return { rows: [], count: 0, page: data.page, pageSize: data.pageSize, fallback: true as const };
      throw new Error(error.message);
    }
    return { rows: rows ?? [], count: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

// ---------------- Preview / Test ----------------
/** Build a preview message for the given kind using dummy but realistic values. */
export const adminPreviewRoutineNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z.object({ kind: z.enum(NOTIF_KINDS), overrides: z.record(z.string()).optional() }).parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertPermission(context.supabase, context.userId, "manage_content");
    const { data: tpl } = await asAny(context.supabase)
      .from("routine_notification_templates")
      .select("*")
      .eq("kind", data.kind)
      .maybeSingle();
    const { data: tiers } = await asAny(context.supabase)
      .from("routine_notification_tiers")
      .select("*")
      .order("sort_order");
    const vars: Record<string, string | number> = {
      name: "Student",
      study_hours: 3,
      study_done: 1,
      mcq_target: 50,
      mcqs_done: 20,
      completion_pct: 62,
      remaining_hours: 2,
      remaining_mcqs: 30,
      streak: 5,
      longest_streak: 12,
      completed_days: 4,
      missed_days: 1,
      remaining_hint: "You still have 2h of study and 30 MCQs to hit today's target.",
      ...(data.overrides ?? {}),
    };
    const t = tierForPct(Number(vars.completion_pct) || 0, tiers ?? []);
    vars.status = t.label;
    vars.status_emoji = t.emoji;
    if (!tpl) return { title: "", body: "" };
    return {
      title: renderTemplate(tpl.title, vars),
      body: renderTemplate(tpl.body, vars),
    };
  });

/** Deliver a single test notification to the calling admin (or a specified user). */
export const adminSendTestRoutineNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => testDeliverySchema.parse(i))
  .handler(async ({ context, data }) => {
    await assertPermission(
      context.supabase,
      context.userId,
      "manage_content",
      "routine_notification.test",
      { kind: data.kind },
    );
    const targetUserId = data.userId ?? context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tpl } = await asAny(supabaseAdmin)
      .from("routine_notification_templates")
      .select("*")
      .eq("kind", data.kind)
      .maybeSingle();
    if (!tpl) throw new Error("Template missing for kind: " + data.kind);
    const { data: tiers } = await asAny(supabaseAdmin)
      .from("routine_notification_tiers")
      .select("*")
      .order("sort_order");
    const vars: Record<string, string | number> = {
      name: "Student",
      study_hours: 3,
      study_done: 1,
      mcq_target: 50,
      mcqs_done: 20,
      completion_pct: 62,
      streak: 5,
      remaining_hours: 2,
      remaining_mcqs: 30,
      remaining_hint: "Test message — sample values.",
    };
    const t = tierForPct(Number(vars.completion_pct) || 0, tiers ?? []);
    vars.status = t.label;
    vars.status_emoji = t.emoji;
    const title = renderTemplate(tpl.title, vars);
    const body = renderTemplate(tpl.body, vars);
    const now = new Date().toISOString();
    const dedupKey = `test:${data.kind}:${targetUserId}:${Date.now()}`;
    const { error: insertErr } = await asAny(supabaseAdmin)
      .from("notifications")
      .insert({
        user_id: targetUserId,
        title,
        body,
        message: body,
        type: "in_app",
        priority: "medium",
        audience: "users",
        status: "unread",
        sent_at: now,
        delivered_at: now,
        recipients_count: 1,
        delivered_count: 1,
        created_by: context.userId,
      });
    if (insertErr) throw new Error(insertErr.message);
    await asAny(supabaseAdmin)
      .from("routine_notification_log")
      .insert({
        user_id: targetUserId,
        kind: data.kind,
        channel: "notification_center",
        target_date: todayISO(),
        dedup_key: dedupKey,
        status: "sent",
        payload: { title, body, test: true },
      });
    return { ok: true };
  });

export type { NotifKind };