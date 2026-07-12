// Client-safe shared types + Zod schemas for the Routine Notification System.
import { z } from "zod";

export const NOTIF_KINDS = ["morning_reminder", "night_progress", "weekly_summary"] as const;
export type NotifKind = (typeof NOTIF_KINDS)[number];

export const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Expected HH:MM");

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().min(1).max(64),
  morning_time: timeString,
  night_time: timeString,
  deliver_notification_center: z.boolean(),
  deliver_live_chat: z.boolean(),
  quiet_start: timeString.optional().nullable(),
  quiet_end: timeString.optional().nullable(),
  weekly_summary_enabled: z.boolean(),
  weekly_summary_day: z.number().int().min(0).max(6),
  weekly_summary_time: timeString,
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const templateUpsertSchema = z.object({
  kind: z.enum(NOTIF_KINDS),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  enabled: z.boolean().default(true),
});

export const tierUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  emoji: z.string().trim().max(8).default(""),
  min_pct: z.number().int().min(0).max(100),
  max_pct: z.number().int().min(0).max(100),
  color: z.string().trim().min(3).max(20),
  sort_order: z.number().int().min(0).max(100).default(0),
});

export const testDeliverySchema = z.object({
  kind: z.enum(NOTIF_KINDS),
  userId: z.string().uuid().optional(),
});

/**
 * Replace {token} placeholders in a template with values from `vars`.
 * Missing tokens are replaced with an empty string.
 */
export function renderTemplate(input: string, vars: Record<string, string | number>): string {
  return input.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** Pick the tier for a given completion pct. */
export function tierForPct(
  pct: number,
  tiers: Array<{ min_pct: number; max_pct: number; label: string; emoji: string; key: string; color: string }>,
): { key: string; label: string; emoji: string; color: string } {
  const t = tiers.find((r) => pct >= r.min_pct && pct <= r.max_pct);
  return t
    ? { key: t.key, label: t.label, emoji: t.emoji, color: t.color }
    : { key: "unknown", label: "—", emoji: "", color: "#64748b" };
}