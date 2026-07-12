/* eslint-disable @typescript-eslint/no-explicit-any */
// Public cron endpoint for the Routine Notification System.
//
// Auth: Bearer <ROUTINE_NOTIFICATIONS_SECRET> or HMAC-SHA256(x-signature)
// over the literal body "routine-notifications-tick".
//
// Scheduling model: pg_cron pings this endpoint every 15 minutes. The
// endpoint reads the admin-configured morning/night times and only fires
// when the current wall-clock (in the configured timezone) falls within
// a 15-minute window of a scheduled slot. Delivery is deduped per user +
// slot + date, so a repeat call within the same window is safe.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import {
  renderTemplate,
  tierForPct,
  type NotifKind,
} from "@/lib/routine-notifications-shared";

const WINDOW_MINUTES = 15;

async function authorize(request: Request): Promise<boolean> {
  const secret = process.env.ROUTINE_NOTIFICATIONS_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth && auth.replace(/^Bearer\s+/i, "") === secret) return true;
  const sig = request.headers.get("x-signature");
  if (!sig) return false;
  try {
    const expected = createHmac("sha256", secret)
      .update("routine-notifications-tick")
      .digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Extract HH:MM in the given timezone from a Date. */
function nowInTz(tz: string): { date: string; hour: number; minute: number; totalMin: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  return { date, hour, minute, totalMin: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

function withinWindow(nowMin: number, targetMin: number, windowMin = WINDOW_MINUTES) {
  return nowMin >= targetMin && nowMin < targetMin + windowMin;
}

type Settings = {
  enabled: boolean;
  timezone: string;
  morning_time: string;
  night_time: string;
  deliver_notification_center: boolean;
  deliver_live_chat: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  weekly_summary_enabled: boolean;
  weekly_summary_day: number;
  weekly_summary_time: string;
};

async function run() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb: any = supabaseAdmin;

  const { data: settingsRow, error: settingsErr } = await sb
    .from("routine_notification_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (settingsErr) throw new Error(settingsErr.message);
  const settings: Settings | null = settingsRow;
  if (!settings || !settings.enabled) return { skipped: "disabled" };

  const { date: today, totalMin: nowMin } = nowInTz(settings.timezone);

  // Quiet hours (never send in quiet range).
  if (settings.quiet_start && settings.quiet_end) {
    const qs = toMinutes(settings.quiet_start);
    const qe = toMinutes(settings.quiet_end);
    const inQuiet = qs < qe ? nowMin >= qs && nowMin < qe : nowMin >= qs || nowMin < qe;
    if (inQuiet) return { skipped: "quiet_hours" };
  }

  const kinds: NotifKind[] = [];
  if (withinWindow(nowMin, toMinutes(settings.morning_time))) kinds.push("morning_reminder");
  if (withinWindow(nowMin, toMinutes(settings.night_time))) kinds.push("night_progress");
  if (
    settings.weekly_summary_enabled &&
    new Date(`${today}T00:00:00Z`).getUTCDay() === settings.weekly_summary_day &&
    withinWindow(nowMin, toMinutes(settings.weekly_summary_time))
  ) {
    kinds.push("weekly_summary");
  }
  if (kinds.length === 0) return { skipped: "no_slot", now_min: nowMin };

  const { data: tpls } = await sb.from("routine_notification_templates").select("*");
  const tplByKind: Record<string, any> = {};
  for (const t of tpls ?? []) if (t?.enabled !== false) tplByKind[t.kind] = t;

  const { data: tiersRows } = await sb
    .from("routine_notification_tiers")
    .select("*")
    .order("sort_order");
  const tiers = tiersRows ?? [];

  const { data: routines } = await sb.from("routines").select("*").eq("status", "active");
  const activeRoutines = routines ?? [];
  if (activeRoutines.length === 0) return { skipped: "no_active_routines" };

  // Match students by level. Pull profiles once, filter locally.
  const levels = Array.from(new Set(activeRoutines.map((r: any) => r.scope_level).filter(Boolean)));
  const { data: profiles } = await sb
    .from("profiles")
    .select("id,full_name,level")
    .in("level", levels.length ? levels : ["__none__"]);

  const results: any[] = [];
  for (const kind of kinds) {
    const tpl = tplByKind[kind];
    if (!tpl) {
      results.push({ kind, skipped: "template_missing" });
      continue;
    }
    for (const p of profiles ?? []) {
      const routinesForUser = activeRoutines.filter((r: any) => r.scope_level === p.level);
      if (routinesForUser.length === 0) continue;

      // Aggregate today's progress for this user.
      const { data: progressRows } = await sb
        .from("routine_daily_progress")
        .select("study_minutes,mcqs_solved")
        .eq("user_id", p.id)
        .eq("date", today);
      const studyDone = (progressRows ?? []).reduce(
        (a: number, r: any) => a + Number(r.study_minutes ?? 0),
        0,
      );
      const mcqsDone = (progressRows ?? []).reduce(
        (a: number, r: any) => a + Number(r.mcqs_solved ?? 0),
        0,
      );
      const targetStudy = routinesForUser.reduce(
        (a: number, r: any) => a + Number(r.study_target_minutes ?? 0),
        0,
      );
      const targetMcq = routinesForUser.reduce(
        (a: number, r: any) => a + Number(r.mcq_target ?? 0),
        0,
      );
      const totalTarget = targetStudy + targetMcq;
      const totalDone = studyDone + mcqsDone;
      const completionPct =
        totalTarget > 0 ? Math.min(100, Math.round((totalDone / totalTarget) * 100)) : 0;
      const tier = tierForPct(completionPct, tiers);

      // Compute streak (simple: recent completed days).
      const { data: history } = await sb
        .from("routine_daily_progress")
        .select("date,study_minutes,mcqs_solved")
        .eq("user_id", p.id)
        .order("date", { ascending: false })
        .limit(60);
      let streak = 0;
      for (const h of history ?? []) {
        if (Number(h.study_minutes ?? 0) > 0 || Number(h.mcqs_solved ?? 0) > 0) streak += 1;
        else break;
      }

      const vars: Record<string, string | number> = {
        name: p.full_name || "Student",
        study_hours: Math.round((targetStudy / 60) * 10) / 10,
        study_done: Math.round((studyDone / 60) * 10) / 10,
        mcq_target: targetMcq,
        mcqs_done: mcqsDone,
        completion_pct: completionPct,
        remaining_hours: Math.max(0, Math.round(((targetStudy - studyDone) / 60) * 10) / 10),
        remaining_mcqs: Math.max(0, targetMcq - mcqsDone),
        streak,
        longest_streak: streak,
        completed_days: streak,
        missed_days: 0,
        status: tier.label,
        status_emoji: tier.emoji,
        remaining_hint:
          kind === "night_progress"
            ? `Remaining: ${Math.max(0, Math.round(((targetStudy - studyDone) / 60) * 10) / 10)}h and ${Math.max(0, targetMcq - mcqsDone)} MCQs`
            : "",
      };
      const title = renderTemplate(tpl.title, vars);
      const body = renderTemplate(tpl.body, vars);
      const dedupKey = `${kind}:${p.id}:${today}`;

      // Idempotency check.
      const { data: existingLog } = await sb
        .from("routine_notification_log")
        .select("id")
        .eq("dedup_key", dedupKey)
        .maybeSingle();
      if (existingLog) continue;

      const nowIso = new Date().toISOString();
      let deliveredCenter = false;
      let deliveredChat = false;
      let errorText: string | null = null;

      if (settings.deliver_notification_center) {
        const { error: nErr } = await sb.from("notifications").insert({
          user_id: p.id,
          title,
          body,
          message: body,
          type: "in_app",
          priority: kind === "night_progress" ? "medium" : "low",
          audience: "users",
          status: "unread",
          sent_at: nowIso,
          delivered_at: nowIso,
          recipients_count: 1,
          delivered_count: 1,
        });
        if (nErr) errorText = `notification_center: ${nErr.message}`;
        else deliveredCenter = true;
      }

      if (settings.deliver_live_chat) {
        try {
          const { data: conv } = await sb
            .from("live_chat_conversations")
            .select("id")
            .eq("user_id", p.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (conv?.id) {
            await sb.from("live_chat_messages").insert({
              conversation_id: conv.id,
              sender_type: "system",
              body: `${title}\n\n${body}`,
              delivered_at: nowIso,
            });
            deliveredChat = true;
          }
        } catch (e) {
          errorText = `${errorText ?? ""} live_chat: ${(e as Error).message}`.trim();
        }
      }

      // Log the delivery (unique dedup_key). Ignore duplicate insert races.
      await sb.from("routine_notification_log").insert({
        user_id: p.id,
        kind,
        channel: deliveredChat ? "live_chat" : "notification_center",
        target_date: today,
        dedup_key: dedupKey,
        status: errorText ? "failed" : "sent",
        error: errorText,
        payload: {
          title,
          body,
          completion_pct: completionPct,
          tier: tier.key,
          delivered_center: deliveredCenter,
          delivered_chat: deliveredChat,
        },
      });
      results.push({ user_id: p.id, kind, status: errorText ? "failed" : "sent" });
    }
  }
  return { ok: true, delivered: results.length, kinds, results };
}

export const Route = createFileRoute("/api/public/routine-notifications-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorize(request))) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await run();
          return Response.json(result);
        } catch (e) {
          return new Response((e as Error).message, { status: 500 });
        }
      },
    },
  },
});