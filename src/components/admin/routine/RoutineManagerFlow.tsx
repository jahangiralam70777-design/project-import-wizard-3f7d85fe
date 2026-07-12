import { useMemo, useState } from "react";
import {
  CalendarClock,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Pencil,
  Copy,
  Archive,
  ToggleLeft,
  ToggleRight,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Layers,
  BookOpen,
  ClipboardCheck,
  Percent,
  ListChecks,
  ShieldCheck,
  Target,
} from "lucide-react";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import { RoutineNotificationSettings } from "./RoutineNotificationSettings";
import {
  useAcademicLevels,
  useAcademicSubjects,
  useAcademicChapters,
} from "@/hooks/use-academic-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getManualReviewSettings,
  updateManualReviewSettings,
  adminCreateRoutine,
  adminListRoutines,
} from "@/lib/admin-routine.functions";
import { toast } from "sonner";


type RoutineRow = {
  id: string;
  name: string;
  level: string;
  subject: string | null;
  chapter: string | null;
  studyTarget: number;
  mcqTarget: number;
  activeDays: string[];
  status: "active" | "inactive" | "archived";
  createdAt: string;
};

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warn" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "from-emerald-500/20 to-emerald-500/5 text-emerald-500"
      : tone === "warn"
        ? "from-amber-500/20 to-amber-500/5 text-amber-500"
        : tone === "info"
          ? "from-sky-500/20 to-sky-500/5 text-sky-500"
          : "from-primary/20 to-primary/5 text-primary";
  return (
    <div className="glass shadow-card-soft group relative overflow-hidden rounded-2xl border border-border/60 p-4 transition-transform hover:-translate-y-0.5">
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br opacity-70 blur-2xl",
          toneClass,
        )}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 truncate font-display text-2xl font-bold tracking-tight">{value}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted", toneClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RoutineRow["status"] }) {
  const map = {
    active: { label: "Active", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
    inactive: { label: "Inactive", className: "bg-muted text-muted-foreground border-border" },
    archived: { label: "Archived", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  } as const;
  const c = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        c.className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

function CreateRoutineDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");
  const [subject, setSubject] = useState("");
  const [chapter, setChapter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [studyHours, setStudyHours] = useState("");
  const [mcqTarget, setMcqTarget] = useState("");
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [mandatory, setMandatory] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const { data: levels = [], isLoading: levelsLoading } = useAcademicLevels();
  const { data: subjects = [], isLoading: subjectsLoading } = useAcademicSubjects(level || null);
  const { data: chapters = [], isLoading: chaptersLoading } = useAcademicChapters(subject || null);

  const createFn = useServerFn(adminCreateRoutine);

  const nameError = name.length > 0 && name.trim().length < 3;
  const canSubmit =
    name.trim().length >= 3 && level.length > 0 && days.length > 0 && !submitting;


  function toggleDay(k: string) {
    setDays((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));
  }

  function reset() {
    setName("");
    setLevel("");
    setSubject("");
    setChapter("");
    setStartDate("");
    setEndDate("");
    setStudyHours("");
    setMcqTarget("");
    setGoal("");
    setDays([]);
    setMandatory(true);
    setEnabled(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Create Routine</DialogTitle>
          <DialogDescription>
            Design a study routine — assign scope, targets and active days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Basic Information */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Basic Information
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="r-name">
                  Routine Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="r-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Level 1 · Weekday Booster"
                  aria-invalid={nameError || undefined}
                />
                {nameError && (
                  <p className="mt-1 text-xs text-destructive">Name must be at least 3 characters.</p>
                )}
              </div>
              <div>
                <Label>
                  Level <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={level}
                  onValueChange={(v) => {
                    setLevel(v);
                    setSubject("");
                    setChapter("");
                  }}
                  disabled={levelsLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={levelsLoading ? "Loading…" : "Select level"} />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        {levelsLoading ? "Loading levels…" : "No levels available"}
                      </SelectItem>
                    ) : (
                      levels.map((l) => (
                        <SelectItem key={l.code} value={l.code}>
                          {l.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Subject (Optional)</Label>
                <Select
                  value={subject}
                  onValueChange={(v) => {
                    setSubject(v);
                    setChapter("");
                  }}
                  disabled={!level || subjectsLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !level
                          ? "Select a level first"
                          : subjectsLoading
                            ? "Loading…"
                            : "Select subject"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        {subjectsLoading ? "Loading subjects…" : "No subjects available"}
                      </SelectItem>
                    ) : (
                      subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>Chapter (Optional)</Label>
                <Select
                  value={chapter}
                  onValueChange={setChapter}
                  disabled={!subject || chaptersLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !subject
                          ? "Select a subject first"
                          : chaptersLoading
                            ? "Loading…"
                            : "Select chapter"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {chapters.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        {chaptersLoading ? "Loading chapters…" : "No chapters available"}
                      </SelectItem>
                    ) : (
                      chapters.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="r-start">Start Date (Optional)</Label>
                <Input
                  id="r-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="r-end">End Date (Optional)</Label>
                <Input
                  id="r-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <p className="sm:col-span-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Leave both dates empty to keep this routine active until manually disabled.
              </p>
            </div>
          </section>

          {/* Target Settings */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Target Settings
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="r-hours">Daily Study Hours</Label>
                <Input
                  id="r-hours"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  value={studyHours}
                  onChange={(e) => setStudyHours(e.target.value)}
                  placeholder="e.g. 2"
                />
              </div>
              <div>
                <Label htmlFor="r-mcq">Daily MCQ Target</Label>
                <Input
                  id="r-mcq"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={mcqTarget}
                  onChange={(e) => setMcqTarget(e.target.value)}
                  placeholder="e.g. 50"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="r-goal">Study Goal Description</Label>
                <Textarea
                  id="r-goal"
                  rows={3}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="What should students achieve with this routine?"
                />
              </div>
            </div>
          </section>

          {/* Active Days */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Active Days
            </h3>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const on = days.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    aria-pressed={on}
                    className={cn(
                      "min-h-9 rounded-lg border px-3 text-sm transition-colors",
                      on
                        ? "border-primary bg-cta-gradient text-white shadow-glow"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDays(DAYS.map((d) => d.key))}
              >
                Everyday
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDays(["mon", "tue", "wed", "thu", "fri"])}
              >
                Weekdays
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDays(["sat", "sun"])}
              >
                Weekends
              </Button>
            </div>
          </section>

          {/* Routine Settings */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Routine Settings
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Mandatory</p>
                  <p className="text-xs text-muted-foreground">Students cannot skip this routine.</p>
                </div>
                <Switch checked={mandatory} onCheckedChange={setMandatory} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Enabled</p>
                  <p className="text-xs text-muted-foreground">Routine is live for students.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              setSubmitting(true);
              try {
                const studyMinutes = Math.round((Number(studyHours) || 0) * 60);
                const mcqCount = Math.max(0, Math.floor(Number(mcqTarget) || 0));
                const res = await createFn({
                  data: {
                    name: name.trim(),
                    description: goal.trim() ? goal.trim() : null,
                    scope: {
                      level,
                      subjectId: subject || null,
                      chapterId: chapter || null,
                    },
                    startDate: startDate || null,
                    endDate: endDate || null,
                    activeDays: days as any,
                    targets: { studyMinutes, mcqCount },
                  },
                });
                if ((res as any)?.fallback) {
                  toast.warning(
                    "Routine saved locally — database migration not yet applied.",
                  );
                } else {
                  toast.success("Routine created successfully.");
                }
                onCreated?.();
                onOpenChange(false);
              } catch (e) {
                const msg = e instanceof Error ? e.message : "Failed to create routine";
                toast.error(msg);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Saving…" : "Create Routine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoutineDetailsSheet({
  routine,
  onOpenChange,
}: {
  routine: RoutineRow | null;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={!!routine} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-display text-xl">
            {routine?.name ?? "Routine Details"}
          </SheetTitle>
          <SheetDescription>Full scope, targets and timeline.</SheetDescription>
        </SheetHeader>
        {routine && (
          <div className="mt-4 space-y-5">
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Assigned Scope
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1">
                  <Layers className="h-3 w-3" /> {routine.level}
                </Badge>
                {routine.subject && (
                  <Badge variant="secondary" className="gap-1">
                    <BookOpen className="h-3 w-3" /> {routine.subject}
                  </Badge>
                )}
                {routine.chapter && (
                  <Badge variant="secondary" className="gap-1">
                    <ClipboardCheck className="h-3 w-3" /> {routine.chapter}
                  </Badge>
                )}
              </div>
            </section>
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Targets
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border/60 bg-card/40 p-3">
                  <p className="text-xs text-muted-foreground">Study Hours</p>
                  <p className="mt-1 font-display text-lg font-bold">{routine.studyTarget}h</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/40 p-3">
                  <p className="text-xs text-muted-foreground">MCQ Target</p>
                  <p className="mt-1 font-display text-lg font-bold">{routine.mcqTarget}</p>
                </div>
              </div>
            </section>
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active Days
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const on = routine.activeDays.includes(d.key);
                  return (
                    <span
                      key={d.key}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs",
                        on
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground",
                      )}
                    >
                      {d.label}
                    </span>
                  );
                })}
              </div>
            </section>
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status & Timeline
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={routine.status} />
                <span className="text-xs text-muted-foreground">
                  Created {new Date(routine.createdAt).toLocaleDateString()}
                </span>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function RoutineManagerFlow() {
  const [tab, setTab] = useState<"list" | "review" | "notifications">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [details, setDetails] = useState<RoutineRow | null>(null);
  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState("all");
  const [filterSubject, setFilterSubject] = useState("all");
  const [filterChapter, setFilterChapter] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState("");

  const { data: filterLevels = [] } = useAcademicLevels();
  const { data: filterSubjects = [] } = useAcademicSubjects(
    filterLevel === "all" ? null : filterLevel,
  );
  const { data: filterChapters = [] } = useAcademicChapters(
    filterSubject === "all" ? null : filterSubject,
  );

  const listFn = useServerFn(adminListRoutines);
  const queryClient = useQueryClient();
  const listKey = useMemo(
    () => [
      "admin-routines",
      { search, filterLevel, filterSubject, filterChapter, filterStatus, filterDate },
    ],
    [search, filterLevel, filterSubject, filterChapter, filterStatus, filterDate],
  );

  const { data: listResp, isLoading: loading } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      listFn({
        data: {
          search: search.trim() || undefined,
          status: filterStatus === "all" ? undefined : (filterStatus as any),
          level: filterLevel === "all" ? undefined : filterLevel,
          subjectId: filterSubject === "all" ? undefined : filterSubject,
          chapterId: filterChapter === "all" ? undefined : filterChapter,
          dateFrom: filterDate || undefined,
          page: 1,
          pageSize: 50,
          sortBy: "created_at",
          sortDir: "desc",
        },
      }),
  });

  const routines: RoutineRow[] = useMemo(() => {
    const rows = (listResp as any)?.rows ?? [];
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      level: r.scope?.level ?? "",
      subject: r.scope?.subjectId ?? null,
      chapter: r.scope?.chapterId ?? null,
      studyTarget: Math.round(((r.targets?.studyMinutes ?? 0) / 60) * 10) / 10,
      mcqTarget: r.targets?.mcqCount ?? 0,
      activeDays: r.activeDays ?? [],
      status:
        r.status === "disabled"
          ? "inactive"
          : (r.status as RoutineRow["status"]) ?? "active",
      createdAt: r.createdAt,
    }));
  }, [listResp]);
  const filtered = routines;
  const submissions: Array<{
    id: string;
    studentName: string;
    routine: string;
    duration: number;
    submittedAt: string;
    status: "pending" | "approved" | "rejected";
  }> = [];

  const stats = {
    total: routines.length,
    active: routines.filter((r) => r.status === "active").length,
    inactive: routines.filter((r) => r.status === "inactive").length,
    levelWise: 0,
    subjectWise: 0,
    completion: 0,
    activeToday: 0,
    pendingReviews: submissions.filter((s) => s.status === "pending").length,
  };

  function resetFilters() {
    setSearch("");
    setFilterLevel("all");
    setFilterSubject("all");
    setFilterChapter("all");
    setFilterStatus("all");
    setFilterDate("");
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" />
            Routine Manager
          </span>
        }
        subtitle="Create and manage study routines for students."
        breadcrumbs={[
          { label: "Admin", to: "/admin" },
          { label: "Academic Manager", to: "/admin/academic-manager" },
          { label: "Routine Manager" },
        ]}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTab("review")}>
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              Review Submissions
              {stats.pendingReviews > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 px-1.5 text-[10px]">
                  {stats.pendingReviews}
                </Badge>
              )}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create Routine
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
        <StatCard icon={CalendarClock} label="Total Routines" value={stats.total} />
        <StatCard icon={CheckCircle2} label="Active" value={stats.active} tone="success" />
        <StatCard icon={XCircle} label="Inactive" value={stats.inactive} tone="warn" />
        <StatCard icon={Layers} label="Level-wise" value={stats.levelWise} tone="info" />
        <StatCard icon={BookOpen} label="Subject-wise" value={stats.subjectWise} tone="info" />
        <StatCard icon={Percent} label="Completion Rate" value={`${stats.completion}%`} tone="success" />
        <StatCard icon={Users} label="Today's Active Students" value={stats.activeToday} />
        <StatCard icon={ClipboardCheck} label="Pending Reviews" value={stats.pendingReviews} tone="warn" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "review" | "notifications")}>
        <TabsList>
          <TabsTrigger value="list">
            <ListChecks className="mr-1.5 h-4 w-4" /> Routines
          </TabsTrigger>
          <TabsTrigger value="review">
            <ShieldCheck className="mr-1.5 h-4 w-4" /> Manual Study Review
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="mr-1.5 h-4 w-4" /> Notification Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-3 sm:p-4">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,140px))_auto] md:items-center">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search routines…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select
                value={filterLevel}
                onValueChange={(v) => {
                  setFilterLevel(v);
                  setFilterSubject("all");
                  setFilterChapter("all");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {filterLevels.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filterSubject}
                onValueChange={(v) => {
                  setFilterSubject(v);
                  setFilterChapter("all");
                }}
                disabled={filterLevel === "all"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Subject" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subjects</SelectItem>
                  {filterSubjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filterChapter}
                onValueChange={setFilterChapter}
                disabled={filterSubject === "all"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chapter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Chapters</SelectItem>
                  {filterChapters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Reset
              </Button>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-[200px_auto]">
              <Input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                aria-label="Created after"
              />
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                Filter by created date
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="glass shadow-card-soft overflow-hidden rounded-2xl border border-border/60">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No routines yet"
                description="Create your first study routine to get started. Students will see it under their Routine dashboard."
                action={
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Create Routine
                  </Button>
                }
                className="border-0 bg-transparent"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/60 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Routine</th>
                      <th className="px-4 py-3 text-left font-semibold">Level</th>
                      <th className="px-4 py-3 text-left font-semibold">Subject</th>
                      <th className="px-4 py-3 text-left font-semibold">Chapter</th>
                      <th className="px-4 py-3 text-left font-semibold">Study</th>
                      <th className="px-4 py-3 text-left font-semibold">MCQ</th>
                      <th className="px-4 py-3 text-left font-semibold">Active Days</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                      <th className="px-4 py-3 text-left font-semibold">Created</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filtered.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        <td className="px-4 py-3">{r.level}</td>
                        <td className="px-4 py-3">{r.subject ?? "—"}</td>
                        <td className="px-4 py-3">{r.chapter ?? "—"}</td>
                        <td className="px-4 py-3">{r.studyTarget}h</td>
                        <td className="px-4 py-3">{r.mcqTarget}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-0.5">
                            {DAYS.map((d) => (
                              <span
                                key={d.key}
                                className={cn(
                                  "rounded px-1 text-[10px]",
                                  r.activeDays.includes(d.key)
                                    ? "bg-primary/15 text-primary"
                                    : "text-muted-foreground/50",
                                )}
                              >
                                {d.label[0]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <RowAction icon={Eye} label="Preview" onClick={() => setDetails(r)} />
                            <RowAction icon={Pencil} label="Edit" />
                            <RowAction icon={Copy} label="Duplicate" />
                            <RowAction
                              icon={r.status === "active" ? ToggleRight : ToggleLeft}
                              label={r.status === "active" ? "Disable" : "Enable"}
                            />
                            <RowAction icon={Archive} label="Archive" />
                            <RowAction icon={Trash2} label="Delete" destructive />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="review" className="mt-4 space-y-4">
          <ManualReviewSettingsPanel />
          {submissions.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No submissions to review"
              description="Manual study session submissions from students will appear here for approval."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {submissions.map((s) => (
                <div
                  key={s.id}
                  className="glass shadow-card-soft rounded-2xl border border-border/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.studentName}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.routine}</p>
                    </div>
                    <Badge variant="secondary">{s.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> {s.duration} min
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Target className="h-3.5 w-3.5" />
                      {new Date(s.submittedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm">
                      <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive">
                      <XCircle className="mr-1.5 h-4 w-4" /> Reject
                    </Button>
                    <Button size="sm" variant="ghost">
                      <Eye className="mr-1.5 h-4 w-4" /> View Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>


        <TabsContent value="notifications" className="mt-4">
          <RoutineNotificationSettings />
        </TabsContent>
      </Tabs>

      <CreateRoutineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["admin-routines"] })}
      />
      <RoutineDetailsSheet routine={details} onOpenChange={(v) => !v && setDetails(null)} />
    </div>
  );
}

function RowAction({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        destructive && "hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
function ManualReviewSettingsPanel() {
  const qc = useQueryClient();
  const getFn = useServerFn(getManualReviewSettings);
  const updateFn = useServerFn(updateManualReviewSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["routine-manual-review-settings"],
    queryFn: () => getFn(),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (requireAdminApproval: boolean) =>
      updateFn({ data: { requireAdminApproval } }),
    onSuccess: (_res, requireAdminApproval) => {
      qc.invalidateQueries({ queryKey: ["routine-manual-review-settings"] });
      toast.success(
        requireAdminApproval
          ? "Manual study entries now require admin approval."
          : "Manual study entries are now auto-approved on submission.",
      );
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Failed to update setting";
      toast.error(msg);
    },
  });

  const enabled = data?.requireAdminApproval ?? true;
  const updatedAt = data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : null;

  return (
    <section
      aria-label="Manual Study Review Settings"
      className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-semibold sm:text-base">
              Require Admin Approval for Manual Study Entries
            </h3>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] uppercase tracking-wider",
                enabled
                  ? "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              )}
            >
              {isLoading ? "Loading…" : enabled ? "Review ON" : "Auto-Approve"}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {enabled
              ? "Student manual study submissions land in this Review queue for admin approval or rejection."
              : "Student manual study submissions are auto-approved at submission time. No review queue action is required."}
          </p>
          {updatedAt && (
            <p className="text-[11px] text-muted-foreground/80">Last updated · {updatedAt}</p>
          )}
        </div>
        <div className="flex items-center gap-3 self-start sm:self-center">
          <span className="text-xs text-muted-foreground">
            {enabled ? "Approval required" : "Auto-approve"}
          </span>
          <Switch
            checked={enabled}
            disabled={isLoading || mutation.isPending}
            onCheckedChange={(v) => mutation.mutate(v)}
            aria-label="Toggle admin approval for manual study entries"
          />
        </div>
      </div>
    </section>
  );
}
