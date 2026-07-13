import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  Target,
  ListChecks,
  Timer,
  Flame,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Plus,
  BookOpen,
  CheckCircle2,
  Clock,
  BarChart3,
  CalendarDays,
  Sparkles,
  Percent,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { listMyRoutines, getTodayProgress } from "@/lib/routine.functions";


function CircularProgress({
  value,
  size = 140,
  strokeWidth = 12,
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  label: string;
  sublabel?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (v / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            className="text-muted"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="url(#routineGrad)"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
          <defs>
            <linearGradient id="routineGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--neon-purple, #a855f7)" />
              <stop offset="100%" stopColor="var(--neon-blue, #3b82f6)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="font-display text-3xl font-bold">{v}%</p>
            {sublabel && <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{sublabel}</p>}
          </div>
        </div>
      </div>
      <p className="mt-2 text-sm font-medium">{label}</p>
    </div>
  );
}

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
    <div className="glass shadow-card-soft group relative overflow-hidden rounded-2xl border border-border/60 p-4">
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

function TodayStatusBadge({ status }: { status: "completed" | "in_progress" | "not_started" | "missed" }) {
  const map = {
    completed: {
      label: "Completed",
      className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    },
    in_progress: {
      label: "In Progress",
      className: "bg-sky-500/15 text-sky-500 border-sky-500/30",
    },
    not_started: {
      label: "Not Started",
      className: "bg-muted text-muted-foreground border-border",
    },
    missed: {
      label: "Missed",
      className: "bg-destructive/15 text-destructive border-destructive/30",
    },
  } as const;
  const c = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        c.className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

function ManualStudyEntry() {
  const [duration, setDuration] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const canSubmit = Number(duration) > 0 && title.trim().length > 0;

  return (
    <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-cta-gradient text-white shadow-glow">
          <Plus className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-display text-lg font-bold">Manual Study Entry</h3>
          <p className="text-xs text-muted-foreground">Log an offline session — submits for admin review.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ms-duration">Study Duration (minutes)</Label>
          <Input
            id="ms-duration"
            type="number"
            min={1}
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="e.g. 60"
          />
        </div>
        <div>
          <Label htmlFor="ms-title">Session Title</Label>
          <Input
            id="ms-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Accounting — Chapter 4"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ms-notes">Notes</Label>
          <Textarea
            id="ms-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did you cover?"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          Today's Total: <span className="font-semibold text-foreground">0 min</span>
        </div>
        <Button disabled={!canSubmit}>Submit for Review</Button>
      </div>
    </div>
  );
}

function Calendar() {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthLabel = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });
  const firstDow = cursor.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: Array<{ day: number | null; state?: "completed" | "in_progress" | "missed" | "holiday" | "today" }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday =
      cursor.getFullYear() === today.getFullYear() &&
      cursor.getMonth() === today.getMonth() &&
      d === today.getDate();
    cells.push({ day: d, state: isToday ? "today" : undefined });
  }

  const legend = [
    { label: "Completed", className: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30" },
    { label: "In Progress", className: "bg-sky-500/20 text-sky-500 border-sky-500/30" },
    { label: "Missed", className: "bg-destructive/15 text-destructive border-destructive/30" },
    { label: "Holiday", className: "bg-amber-500/20 text-amber-500 border-amber-500/30" },
    { label: "Today", className: "bg-cta-gradient text-white border-transparent shadow-glow" },
  ];

  return (
    <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg font-bold">{monthLabel}</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => (
          <div
            key={i}
            className={cn(
              "aspect-square rounded-lg border text-xs",
              c.day === null
                ? "border-transparent"
                : c.state === "today"
                  ? "border-transparent bg-cta-gradient text-white shadow-glow"
                  : "border-border/60 bg-card/30 text-muted-foreground",
            )}
          >
            {c.day && (
              <div className="flex h-full flex-col items-center justify-center">
                <span className="font-medium">{c.day}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {legend.map((l) => (
          <span
            key={l.label}
            className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", l.className)}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReportsSection() {
  const [range, setRange] = useState<"daily" | "weekly" | "monthly" | "yearly">("weekly");
  return (
    <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg font-bold">Reports</h3>
        </div>
        <div className="inline-flex rounded-lg border border-border/60 bg-card/40 p-0.5">
          {(["daily", "weekly", "monthly", "yearly"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "min-h-8 rounded-md px-3 text-xs font-medium capitalize transition-colors",
                range === r ? "bg-cta-gradient text-white shadow-glow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <p className="text-xs text-muted-foreground">Study Time</p>
          <p className="mt-1 font-display text-2xl font-bold">0h</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <p className="text-xs text-muted-foreground">MCQs Attempted</p>
          <p className="mt-1 font-display text-2xl font-bold">0</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <p className="text-xs text-muted-foreground">Completion</p>
          <p className="mt-1 font-display text-2xl font-bold">0%</p>
        </div>
      </div>
      <div className="mt-4">
        <EmptyState
          icon={BarChart3}
          title="No report data yet"
          description="Complete routines to see charts and trends here."
          className="border-0 bg-transparent"
        />
      </div>
    </div>
  );
}

export function StudentRoutineFlow() {
  const [tab, setTab] = useState<"today" | "calendar" | "reports" | "achievements">("today");

  const listFn = useServerFn(listMyRoutines);
  const progressFn = useServerFn(getTodayProgress);

  const routinesQ = useQuery({
    queryKey: ["my-routines"],
    queryFn: () => listFn(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const activeRoutine = routinesQ.data?.rows?.[0] ?? null;

  const progressQ = useQuery({
    queryKey: ["routine-today-progress", activeRoutine?.id ?? null],
    queryFn: () => progressFn({ data: activeRoutine ? { routineId: activeRoutine.id } : {} }),
    enabled: !!activeRoutine,
    staleTime: 15_000,
  });

  const loading = routinesQ.isLoading;
  const hasRoutine = !!activeRoutine;

  const today = useMemo(() => {
    const p = progressQ.data;
    const studyGoalMin = p?.targetStudyMinutes ?? activeRoutine?.targets.studyMinutes ?? 0;
    const mcqGoal = p?.targetMcqCount ?? activeRoutine?.targets.mcqCount ?? 0;
    const completedStudyMin = p?.studyMinutes ?? 0;
    const completedMcqs = p?.mcqsSolved ?? 0;
    const studyPct = p?.studyPct ?? 0;
    const mcqPct = p?.mcqPct ?? 0;
    const overallPct = p?.overallPct ?? 0;
    const remainingStudyMin = Math.max(0, studyGoalMin - completedStudyMin);
    const remainingMcqs = Math.max(0, mcqGoal - completedMcqs);
    const status: "completed" | "in_progress" | "not_started" | "missed" =
      overallPct >= 100 ? "completed" : overallPct > 0 ? "in_progress" : "not_started";
    return {
      status,
      studyGoal: +(studyGoalMin / 60).toFixed(1),
      mcqGoal,
      completedMcqs,
      completedStudy: +(completedStudyMin / 60).toFixed(1),
      remainingStudy: +(remainingStudyMin / 60).toFixed(1),
      remainingMcqs,
      studyPct,
      mcqPct,
      overallPct,
    };
  }, [progressQ.data, activeRoutine]);


  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="h-6 w-6 text-primary" />
              Routine
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeRoutine
              ? activeRoutine.name
              : "Your daily study plan — targets, progress and streaks."}
          </p>
          {activeRoutine && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="gap-1">
                <Layers className="h-3 w-3" /> {activeRoutine.scope.level}
              </Badge>
              {activeRoutine.activeDays.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {activeRoutine.activeDays.join(", ")}
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TodayStatusBadge status={today.status} />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : !hasRoutine ? (
        <EmptyState
          icon={CalendarClock}
          title="No routine assigned yet"
          description="Your administrator hasn't assigned a study routine. Check back soon or continue with self-paced practice."
        />
      ) : null}

      {/* Top cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Target} label="Today's Study Goal" value={`${today.studyGoal}h`} tone="info" />
        <StatCard icon={ListChecks} label="Today's MCQ Goal" value={today.mcqGoal} tone="info" />
        <StatCard icon={CheckCircle2} label="Completed MCQs" value={today.completedMcqs} tone="success" />
        <StatCard icon={Timer} label="Study Completed" value={`${today.completedStudy}h`} tone="success" />
        <StatCard icon={Clock} label="Remaining" value={`${today.remainingStudy}h`} tone="warn" />
        <StatCard icon={Percent} label="Completion" value={`${today.overallPct}%`} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="today">
            <Sparkles className="mr-1.5 h-4 w-4" /> Today
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDays className="mr-1.5 h-4 w-4" /> Calendar
          </TabsTrigger>
          <TabsTrigger value="reports">
            <BarChart3 className="mr-1.5 h-4 w-4" /> Reports
          </TabsTrigger>
          <TabsTrigger value="achievements">
            <Trophy className="mr-1.5 h-4 w-4" /> Achievements
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* Progress panel */}
            <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-cta-gradient text-white shadow-glow">
                  <Target className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold">Today's Progress</h3>
                  <p className="text-xs text-muted-foreground">Stay on track with your daily targets.</p>
                </div>
              </div>
              <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                <CircularProgress value={today.overallPct} label="Overall" sublabel="Today" />
                <div className="space-y-4">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">Study</span>
                      <span className="text-muted-foreground">
                        {today.completedStudy}h / {today.studyGoal}h
                      </span>
                    </div>
                    <Progress value={today.studyPct} />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">MCQ</span>
                      <span className="text-muted-foreground">
                        {today.completedMcqs} / {today.mcqGoal}
                      </span>
                    </div>
                    <Progress value={today.mcqPct} />
                  </div>
                </div>
              </div>

              {/* Today's Tasks */}
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <TaskCard
                  icon={Timer}
                  title="Study Hours"
                  value={`${today.completedStudy}h / ${today.studyGoal}h`}
                  done={today.studyPct >= 100}
                />
                <TaskCard
                  icon={ListChecks}
                  title="MCQ Target"
                  value={`${today.completedMcqs} / ${today.mcqGoal}`}
                  done={today.mcqPct >= 100}
                />
                <TaskCard
                  icon={Clock}
                  title="Remaining Study"
                  value={`${today.remainingStudy}h`}
                  done={today.remainingStudy === 0 && today.studyGoal > 0}
                />
                <TaskCard
                  icon={BookOpen}
                  title="Remaining MCQs"
                  value={`${today.remainingMcqs}`}
                  done={today.remainingMcqs === 0 && today.mcqGoal > 0}
                />
              </div>
            </div>

            {/* Manual entry */}
            <ManualStudyEntry />
          </div>
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <Calendar />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <ReportsSection />
        </TabsContent>

        <TabsContent value="achievements" className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard icon={Flame} label="Current Streak" value="0d" tone="warn" />
            <StatCard icon={Trophy} label="Longest Streak" value="0d" tone="warn" />
            <StatCard icon={Percent} label="Completion" value="0%" tone="success" />
            <StatCard icon={Sparkles} label="Best Week" value="0h" tone="info" />
            <StatCard icon={CalendarDays} label="Best Month" value="0h" tone="info" />
          </div>
          <div className="mt-4">
            <EmptyState
              icon={Trophy}
              title="No achievements yet"
              description="Keep completing your daily routine to unlock streaks and milestones."
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TaskCard({
  icon: Icon,
  title,
  value,
  done,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  done: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 transition-colors",
        done
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border/60 bg-card/40",
      )}
    >
      <div
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          done ? "bg-emerald-500/20 text-emerald-500" : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
      {done && <Badge className="bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20">Done</Badge>}
    </div>
  );
}