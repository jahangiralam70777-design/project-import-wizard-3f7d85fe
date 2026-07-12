import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, Save, Send, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminGetRoutineNotificationSettings,
  adminUpdateRoutineNotificationSettings,
  adminListRoutineNotificationTemplates,
  adminUpsertRoutineNotificationTemplate,
  adminListRoutinePerformanceTiers,
  adminUpsertRoutinePerformanceTier,
  adminSendTestRoutineNotification,
  adminPreviewRoutineNotification,
  adminListRoutineNotificationLogs,
} from "@/lib/routine-notifications.functions";
import { NOTIF_KINDS, type NotifKind } from "@/lib/routine-notifications-shared";

const KIND_LABEL: Record<NotifKind, string> = {
  morning_reminder: "Morning Reminder",
  night_progress: "Night Progress",
  weekly_summary: "Weekly Summary",
};

const AVAILABLE_TOKENS = [
  "{name}", "{study_hours}", "{study_done}", "{mcq_target}", "{mcqs_done}",
  "{completion_pct}", "{remaining_hours}", "{remaining_mcqs}", "{streak}",
  "{longest_streak}", "{completed_days}", "{missed_days}", "{status}",
  "{status_emoji}", "{remaining_hint}",
];

export function RoutineNotificationSettings() {
  const qc = useQueryClient();

  const getSettings = useServerFn(adminGetRoutineNotificationSettings);
  const updateSettings = useServerFn(adminUpdateRoutineNotificationSettings);
  const listTemplates = useServerFn(adminListRoutineNotificationTemplates);
  const upsertTemplate = useServerFn(adminUpsertRoutineNotificationTemplate);
  const listTiers = useServerFn(adminListRoutinePerformanceTiers);
  const upsertTier = useServerFn(adminUpsertRoutinePerformanceTier);
  const sendTest = useServerFn(adminSendTestRoutineNotification);
  const preview = useServerFn(adminPreviewRoutineNotification);
  const listLogs = useServerFn(adminListRoutineNotificationLogs);

  const settingsQ = useQuery({
    queryKey: ["routine-notif-settings"],
    queryFn: () => getSettings(),
  });
  const templatesQ = useQuery({
    queryKey: ["routine-notif-templates"],
    queryFn: () => listTemplates(),
  });
  const tiersQ = useQuery({
    queryKey: ["routine-notif-tiers"],
    queryFn: () => listTiers(),
  });
  const logsQ = useQuery({
    queryKey: ["routine-notif-logs"],
    queryFn: () => listLogs({ data: { page: 1, pageSize: 20 } }),
  });

  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (settingsQ.data?.settings && !form) setForm(settingsQ.data.settings);
  }, [settingsQ.data, form]);

  const saveSettings = useMutation({
    mutationFn: (payload: any) => updateSettings({ data: payload }),
    onSuccess: () => {
      toast.success("Notification settings saved");
      qc.invalidateQueries({ queryKey: ["routine-notif-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (kind: NotifKind) => sendTest({ data: { kind } }),
    onSuccess: () => {
      toast.success("Test notification sent to your inbox");
      qc.invalidateQueries({ queryKey: ["routine-notif-logs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (settingsQ.isLoading || !form) {
    return <Skeleton className="h-[400px] w-full rounded-2xl" />;
  }

  const setF = (k: string, v: unknown) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      {/* Master switch + times */}
      <section className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
        <header className="mb-4 flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Routine Notification Settings</h3>
          {settingsQ.data?.fallback && (
            <Badge variant="secondary" className="ml-2">
              Storage not provisioned
            </Badge>
          )}
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3">
            <div>
              <Label className="text-sm font-medium">Automatic notifications</Label>
              <p className="text-xs text-muted-foreground">Enable morning / night reminders.</p>
            </div>
            <Switch
              checked={!!form.enabled}
              onCheckedChange={(v) => setF("enabled", v)}
            />
          </div>
          <div>
            <Label>Timezone</Label>
            <Input
              value={form.timezone ?? ""}
              onChange={(e) => setF("timezone", e.target.value)}
              placeholder="e.g. Asia/Dhaka"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Morning reminder time
            </Label>
            <Input
              type="time"
              value={String(form.morning_time ?? "").slice(0, 5)}
              onChange={(e) => setF("morning_time", e.target.value)}
            />
          </div>
          <div>
            <Label className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Night progress time
            </Label>
            <Input
              type="time"
              value={String(form.night_time ?? "").slice(0, 5)}
              onChange={(e) => setF("night_time", e.target.value)}
            />
          </div>
          <div>
            <Label>Quiet hours start (optional)</Label>
            <Input
              type="time"
              value={String(form.quiet_start ?? "").slice(0, 5)}
              onChange={(e) => setF("quiet_start", e.target.value || null)}
            />
          </div>
          <div>
            <Label>Quiet hours end (optional)</Label>
            <Input
              type="time"
              value={String(form.quiet_end ?? "").slice(0, 5)}
              onChange={(e) => setF("quiet_end", e.target.value || null)}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3">
            <Label>Deliver to Notification Center</Label>
            <Switch
              checked={!!form.deliver_notification_center}
              onCheckedChange={(v) => setF("deliver_notification_center", v)}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3">
            <Label>Deliver to Live Chat inbox</Label>
            <Switch
              checked={!!form.deliver_live_chat}
              onCheckedChange={(v) => setF("deliver_live_chat", v)}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3">
            <Label>Weekly summary enabled</Label>
            <Switch
              checked={!!form.weekly_summary_enabled}
              onCheckedChange={(v) => setF("weekly_summary_enabled", v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Weekly day</Label>
              <Select
                value={String(form.weekly_summary_day ?? 0)}
                onValueChange={(v) => setF("weekly_summary_day", Number(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                    <SelectItem key={d} value={String(i)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Weekly time</Label>
              <Input
                type="time"
                value={String(form.weekly_summary_time ?? "").slice(0, 5)}
                onChange={(e) => setF("weekly_summary_time", e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => saveSettings.mutate(form)}
            disabled={saveSettings.isPending}
          >
            <Save className="mr-1.5 h-4 w-4" />
            {saveSettings.isPending ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      </section>

      {/* Templates */}
      <section className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Message Templates</h3>
            <p className="text-xs text-muted-foreground">
              Placeholders:{" "}
              <code className="text-[10px]">{AVAILABLE_TOKENS.join(" ")}</code>
            </p>
          </div>
        </header>
        <div className="grid gap-3">
          {NOTIF_KINDS.map((k) => (
            <TemplateEditor
              key={k}
              kind={k}
              label={KIND_LABEL[k]}
              template={
                (templatesQ.data?.rows ?? []).find((t: any) => t.kind === k) ?? null
              }
              onSave={async (payload) => {
                await upsertTemplate({ data: payload });
                toast.success(`${KIND_LABEL[k]} template saved`);
                qc.invalidateQueries({ queryKey: ["routine-notif-templates"] });
              }}
              onPreview={async () => {
                const p = await preview({ data: { kind: k } });
                toast.message(p.title, { description: p.body });
              }}
              onTest={() => testMut.mutate(k)}
              testing={testMut.isPending}
            />
          ))}
        </div>
      </section>

      {/* Tiers */}
      <section className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
        <header className="mb-3">
          <h3 className="text-lg font-semibold">Performance Tiers</h3>
          <p className="text-xs text-muted-foreground">
            Defines how the night progress reminder labels a student's completion.
          </p>
        </header>
        {tiersQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left">Label</th>
                  <th className="px-3 py-2 text-left">Range %</th>
                  <th className="px-3 py-2 text-left">Emoji</th>
                  <th className="px-3 py-2 text-left">Color</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {(tiersQ.data?.rows ?? []).map((t: any) => (
                  <TierRow
                    key={t.id}
                    row={t}
                    onSave={async (payload) => {
                      await upsertTier({ data: payload });
                      toast.success("Tier saved");
                      qc.invalidateQueries({ queryKey: ["routine-notif-tiers"] });
                    }}
                  />
                ))}
                {(!tiersQ.data?.rows || tiersQ.data.rows.length === 0) && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-sm text-muted-foreground">
                      No tiers configured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Logs */}
      <section className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
        <header className="mb-3">
          <h3 className="text-lg font-semibold">Delivery Log</h3>
          <p className="text-xs text-muted-foreground">Recent 20 automatic deliveries.</p>
        </header>
        {logsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (logsQ.data?.rows ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Kind</th>
                  <th className="px-3 py-2 text-left">Channel</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {(logsQ.data?.rows ?? []).map((row: any) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{KIND_LABEL[row.kind as NotifKind] ?? row.kind}</td>
                    <td className="px-3 py-2">{row.channel}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.user_id?.slice(0, 8)}…</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          row.status === "sent"
                            ? "secondary"
                            : row.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TemplateEditor({
  kind,
  label,
  template,
  onSave,
  onPreview,
  onTest,
  testing,
}: {
  kind: NotifKind;
  label: string;
  template: any;
  onSave: (p: { kind: NotifKind; title: string; body: string; enabled: boolean }) => Promise<void>;
  onPreview: () => void;
  onTest: () => void;
  testing: boolean;
}) {
  const [title, setTitle] = useState(template?.title ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [enabled, setEnabled] = useState<boolean>(template?.enabled ?? true);
  useEffect(() => {
    setTitle(template?.title ?? "");
    setBody(template?.body ?? "");
    setEnabled(template?.enabled ?? true);
  }, [template?.id, template?.updated_at]);

  return (
    <div className="rounded-xl border border-border/50 bg-muted/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{label}</Badge>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-xs text-muted-foreground">
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onPreview}>
            Preview
          </Button>
          <Button size="sm" variant="secondary" onClick={onTest} disabled={testing}>
            <Send className="mr-1.5 h-3.5 w-3.5" /> Send Test
          </Button>
          <Button
            size="sm"
            onClick={() => onSave({ kind, title, body, enabled })}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <div>
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Body</Label>
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function TierRow({
  row,
  onSave,
}: {
  row: any;
  onSave: (payload: any) => Promise<void>;
}) {
  const [state, setState] = useState(row);
  useEffect(() => setState(row), [row.id, row.updated_at]);
  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(row),
    [state, row],
  );
  return (
    <tr>
      <td className="px-3 py-2 font-mono text-xs">{state.key}</td>
      <td className="px-3 py-2">
        <Input
          className="h-8"
          value={state.label ?? ""}
          onChange={(e) => setState({ ...state, label: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            max={100}
            className="h-8 w-16"
            value={state.min_pct ?? 0}
            onChange={(e) => setState({ ...state, min_pct: Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="number"
            min={0}
            max={100}
            className="h-8 w-16"
            value={state.max_pct ?? 0}
            onChange={(e) => setState({ ...state, max_pct: Number(e.target.value) })}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <Input
          className="h-8 w-16"
          value={state.emoji ?? ""}
          onChange={(e) => setState({ ...state, emoji: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <Input
          className="h-8 w-24"
          value={state.color ?? ""}
          onChange={(e) => setState({ ...state, color: e.target.value })}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty}
          onClick={() =>
            onSave({
              id: state.id,
              key: state.key,
              label: state.label,
              emoji: state.emoji ?? "",
              min_pct: Number(state.min_pct),
              max_pct: Number(state.max_pct),
              color: state.color,
              sort_order: Number(state.sort_order ?? 0),
            })
          }
        >
          Save
        </Button>
      </td>
    </tr>
  );
}