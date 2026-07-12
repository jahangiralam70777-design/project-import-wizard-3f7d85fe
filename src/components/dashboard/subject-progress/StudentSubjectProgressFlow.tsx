import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Search,
  Filter,
  ArrowUpDown,
  ChevronDown,
  Check,
  Sparkles,
  Layers,
  CheckCircle2,
  Clock,
  Circle,
  Lock,
  Percent,
  ListChecks,
  BookOpen,
  Presentation,
  GraduationCap,
  RefreshCw,
  TrendingUp,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAllAcademicSubjects, useAcademicChapters } from "@/hooks/use-academic-picker";


/* ------------------------------------------------------------------ */
/* Types (UI-only; backend will hydrate these later)                   */
/* ------------------------------------------------------------------ */

type ManualStatus = "not_started" | "in_progress" | "completed";

export type ChapterRow = {
  id: string;
  name: string;
  classStatus: ManualStatus;
  slidesStatus: ManualStatus;
  bookStatus: ManualStatus;
  mcqCompleted: number;
  mcqTotal: number;
};

export type SubjectOption = {
  id: string;
  name: string;
  level?: string;
};

/* ------------------------------------------------------------------ */
/* Local UI atoms                                                      */
/* ------------------------------------------------------------------ */

function CircularProgress({
  value,
  size = 160,
  strokeWidth = 14,
  sublabel,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  sublabel?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const radius = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (v / 100) * circ;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="spg-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--neon-blue, #60a5fa)" />
            <stop offset="100%" stopColor="var(--neon-purple, #a855f7)" />
          </linearGradient>
        </defs>
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
          stroke="url(#spg-ring)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          fill="none"
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-display text-4xl font-bold tracking-tight">{v}%</p>
          {sublabel && (
            <p className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              {sublabel}
            </p>
          )}
        </div>
      </div>
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
  tone?: "default" | "success" | "warn" | "info" | "violet";
}) {
  const toneClass =
    tone === "success"
      ? "from-emerald-500/20 to-emerald-500/5 text-emerald-500"
      : tone === "warn"
        ? "from-amber-500/20 to-amber-500/5 text-amber-500"
        : tone === "info"
          ? "from-sky-500/20 to-sky-500/5 text-sky-500"
          : tone === "violet"
            ? "from-fuchsia-500/20 to-fuchsia-500/5 text-fuchsia-500"
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
          <p className="mt-1 truncate font-display text-2xl font-bold tracking-tight">
            {value}
          </p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted",
            toneClass,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

const STATUS_META: Record<
  ManualStatus,
  { label: string; badge: string; dot: string; icon: React.ComponentType<{ className?: string }> }
> = {
  not_started: {
    label: "Not Started",
    badge: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/60",
    icon: Circle,
  },
  in_progress: {
    label: "In Progress",
    badge: "bg-sky-500/15 text-sky-500 border-sky-500/30",
    dot: "bg-sky-500",
    icon: Clock,
  },
  completed: {
    label: "Completed",
    badge: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    dot: "bg-emerald-500",
    icon: CheckCircle2,
  },
};

function StatusPill({ status }: { status: ManualStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        meta.badge,
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function StatusSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: ManualStatus;
  onChange: (next: ManualStatus) => void;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ManualStatus)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-9 w-[150px] rounded-xl border-border/70 bg-background/50 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(STATUS_META) as ManualStatus[]).map((k) => {
          const m = STATUS_META[k];
          const Icon = m.icon;
          return (
            <SelectItem key={k} value={k}>
              <span className="inline-flex items-center gap-2">
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function MobileTrackField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Completion math (deterministic, no fake data)                       */
/* ------------------------------------------------------------------ */

function statusPct(s: ManualStatus) {
  return s === "completed" ? 100 : s === "in_progress" ? 50 : 0;
}

function chapterCompletion(row: ChapterRow) {
  const classP = statusPct(row.classStatus);
  const slidesP = statusPct(row.slidesStatus);
  const bookP = statusPct(row.bookStatus);
  const mcqP = row.mcqTotal > 0 ? (row.mcqCompleted / row.mcqTotal) * 100 : 0;
  const avg = (classP + slidesP + bookP + mcqP) / 4;
  // Snap to the requested 0/25/50/75/100 buckets for display.
  const snapped = [0, 25, 50, 75, 100].reduce((a, b) =>
    Math.abs(b - avg) < Math.abs(a - avg) ? b : a,
  );
  return { raw: avg, snapped };
}

function bucketLabel(snapped: number) {
  if (snapped >= 100) return "Completed";
  if (snapped >= 25) return "In Progress";
  return "Not Started";
}

/* ------------------------------------------------------------------ */
/* Subject picker (searchable command dropdown)                        */
/* ------------------------------------------------------------------ */

function SubjectPicker({
  subjects,
  value,
  onChange,
  loading,
}: {
  subjects: SubjectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = subjects.find((s) => s.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={loading}
          className={cn(
            "glass shadow-card-soft group flex w-full items-center justify-between gap-3 rounded-2xl border border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[380px]",
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cta-gradient text-white shadow-glow">
              <BookOpenCheck className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Subject
              </span>
              <span className="block truncate font-display text-base font-bold">
                {loading ? "Loading…" : current ? current.name : "Select a subject"}
              </span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(90vw,380px)] p-0">
        <Command>
          <CommandInput placeholder="Search subjects…" />
          <CommandList>
            <CommandEmpty>No subjects found.</CommandEmpty>
            <CommandGroup>
              {subjects.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.name} ${s.level ?? ""}`}
                  onSelect={() => {
                    onChange(s.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{s.name}</span>
                    {s.level && (
                      <Badge variant="secondary" className="ml-1 text-[10px]">
                        {s.level}
                      </Badge>
                    )}
                  </span>
                  {value === s.id && <Check className="h-4 w-4 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics — subject timeline (uses only real chapter data)          */
/* ------------------------------------------------------------------ */

function ProgressTimeline({ rows }: { rows: ChapterRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="font-display text-lg font-bold">Progress Timeline</h3>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
        {rows.map((r) => {
          const c = chapterCompletion(r).snapped;
          return (
            <div key={r.id} className="contents">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <Progress value={c} className="mt-1 h-1.5" />
              </div>
              <span className="self-center text-xs font-semibold tabular-nums text-muted-foreground">
                {c}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-2xl lg:col-span-1" />
        <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main flow                                                           */
/* ------------------------------------------------------------------ */

export function StudentSubjectProgressFlow() {
  // Real subject list comes from Academic Manager (published subjects only).
  const { data: subjectsData = [], isLoading: subjectsLoading } = useAllAcademicSubjects();
  const subjects: SubjectOption[] = useMemo(
    () =>
      subjectsData.map((s) => ({
        id: s.id,
        name: s.name,
        level: s.level ?? undefined,
      })),
    [subjectsData],
  );

  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);

  // Chapters for the selected subject come from Academic Manager.
  const { data: chaptersData = [], isLoading: chaptersLoading } =
    useAcademicChapters(selectedSubjectId);

  // Local UI state — mirrors chapters and lets the student flip manual tracks
  // client-side. Backend persistence is wired separately by the
  // subject-progress functions and can hydrate these rows later.
  const [rows, setRows] = useState<ChapterRow[]>([]);

  useEffect(() => {
    setRows(
      chaptersData.map((c) => ({
        id: c.id,
        name: c.name,
        classStatus: "not_started" as ManualStatus,
        slidesStatus: "not_started" as ManualStatus,
        bookStatus: "not_started" as ManualStatus,
        mcqCompleted: 0,
        mcqTotal: 0,
      })),
    );
  }, [chaptersData]);

  const loading = subjectsLoading;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "completed" | "in_progress" | "not_started">("all");
  const [sortBy, setSortBy] = useState<"name" | "highest" | "lowest" | "recent">("name");


  const summary = useMemo(() => {
    const total = rows.length;
    let completed = 0;
    let sum = 0;
    rows.forEach((r) => {
      const c = chapterCompletion(r).snapped;
      sum += c;
      if (c >= 100) completed += 1;
    });
    const avg = total ? Math.round(sum / total) : 0;
    return {
      total,
      completed,
      remaining: total - completed,
      averageProgress: avg,
      overall: avg,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => (q ? r.name.toLowerCase().includes(q) : true));
    out = out.filter((r) => {
      if (filter === "all") return true;
      const bucket = bucketLabel(chapterCompletion(r).snapped);
      if (filter === "completed") return bucket === "Completed";
      if (filter === "in_progress") return bucket === "In Progress";
      return bucket === "Not Started";
    });
    out = [...out].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "highest")
        return chapterCompletion(b).raw - chapterCompletion(a).raw;
      if (sortBy === "lowest")
        return chapterCompletion(a).raw - chapterCompletion(b).raw;
      return 0; // "recent" — placeholder ordering until backend supplies updatedAt
    });
    return out;
  }, [rows, query, filter, sortBy]);

  const currentStudyStatus =
    summary.total === 0
      ? "Not Started"
      : summary.completed === summary.total
        ? "All Complete"
        : summary.averageProgress >= 50
          ? "On Track"
          : "Getting Started";

  const setRowStatus = (
    id: string,
    key: "classStatus" | "slidesStatus" | "bookStatus",
    next: ManualStatus,
  ) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: next } : r)));
  };

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Chapter Tracker
          </div>
          <h1 className="truncate font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Subject Progress
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track your chapter-wise study progress.
          </p>
        </div>
      </header>

      {/* Subject picker + hero card */}
      <section className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <SubjectPicker
          subjects={subjects}
          value={selectedSubjectId}
          onChange={setSelectedSubjectId}
        />
        <div className="glass shadow-card-soft relative overflow-hidden rounded-2xl border border-border/60 p-4 sm:p-5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cta-gradient opacity-20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="grid items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <CircularProgress value={summary.overall} sublabel="Overall" />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-transparent bg-cta-gradient text-white shadow-glow">
                  {currentStudyStatus}
                </Badge>
                <Badge variant="secondary" className="text-[11px]">
                  {summary.completed}/{summary.total || 0} chapters complete
                </Badge>
              </div>
              <h2 className="truncate font-display text-xl font-bold sm:text-2xl">
                {selectedSubjectId
                  ? subjects.find((s) => s.id === selectedSubjectId)?.name ?? "Subject Overview"
                  : "Select a subject to begin"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Overall completion is calculated from Class, Slides, Book and MCQ Practice across
                every chapter in this subject.
              </p>
              <div className="pt-1">
                <Progress value={summary.overall} className="h-2" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Summary premium cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={Percent}
          label="Overall Completion"
          value={`${summary.overall}%`}
          hint="Weighted across all tracks"
          tone="violet"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed Chapters"
          value={summary.completed}
          hint={summary.total ? `of ${summary.total}` : "—"}
          tone="success"
        />
        <StatCard
          icon={Clock}
          label="Remaining"
          value={summary.remaining}
          hint={summary.total ? `of ${summary.total}` : "—"}
          tone="warn"
        />
        <StatCard
          icon={Layers}
          label="Total Chapters"
          value={summary.total}
          hint="In this subject"
          tone="info"
        />
        <StatCard
          icon={Activity}
          label="Average Progress"
          value={`${summary.averageProgress}%`}
          hint="Per chapter mean"
        />
      </section>

      {/* Analytics */}
      {!selectedSubjectId ? (
        <EmptyState
          icon={BookOpenCheck}
          title="No subject selected"
          description="Pick a subject from the selector above to see its chapters, analytics and overall completion."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No chapters yet"
          description="Chapters for this subject will appear here as soon as they are published by your academic team."
        />
      ) : (
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="glass shadow-card-soft grid place-items-center rounded-2xl border border-border/60 p-5 lg:col-span-1">
            <CircularProgress value={summary.overall} sublabel="Subject" />
          </div>
          <div className="lg:col-span-2">
            <ProgressTimeline rows={rows} />
          </div>
        </section>
      )}

      {/* Toolbar */}
      <section className="glass shadow-card-soft rounded-2xl border border-border/60 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative block min-w-0">
            <span className="sr-only">Search chapters</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chapter…"
              className="h-10 rounded-xl pl-9"
            />
          </label>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="h-10 w-[160px] rounded-xl" aria-label="Filter chapters">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="not_started">Not Started</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-10 w-[190px] rounded-xl" aria-label="Sort chapters">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Chapter Name</SelectItem>
                <SelectItem value="highest">Highest Progress</SelectItem>
                <SelectItem value="lowest">Lowest Progress</SelectItem>
                <SelectItem value="recent">Recently Updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Chapter table */}
      <section
        className="glass shadow-card-soft overflow-hidden rounded-2xl border border-border/60"
        aria-label="Chapter progress table"
      >
        {!selectedSubjectId ? (
          <EmptyState
            icon={BookOpenCheck}
            title="No subject selected"
            description="Choose a subject to load its chapters."
            className="rounded-none border-0"
          />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={Search}
            title={rows.length === 0 ? "No chapters" : "No matching chapters"}
            description={
              rows.length === 0
                ? "Chapters will show up here once your subject is populated."
                : "Try clearing the search or a different filter."
            }
            className="rounded-none border-0"
          />
        ) : (
          <>
            {/* Desktop / laptop table */}
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[880px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="w-[26%] px-4 py-3">Chapter</th>
                    <th className="w-[13%] px-3 py-3">Class</th>
                    <th className="w-[13%] px-3 py-3">Slides</th>
                    <th className="w-[13%] px-3 py-3">Book</th>
                    <th className="w-[17%] whitespace-nowrap px-3 py-3">MCQ Practice</th>
                    <th className="w-[18%] px-4 py-3">Chapter Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const { snapped } = chapterCompletion(r);
                    const mcqPct =
                      r.mcqTotal > 0 ? Math.round((r.mcqCompleted / r.mcqTotal) * 100) : 0;
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-border/60 transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 align-middle">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                              <BookOpen className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{r.name}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <StatusSelect
                            value={r.classStatus}
                            onChange={(v) => setRowStatus(r.id, "classStatus", v)}
                            ariaLabel={`Class status for ${r.name}`}
                          />
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <StatusSelect
                            value={r.slidesStatus}
                            onChange={(v) => setRowStatus(r.id, "slidesStatus", v)}
                            ariaLabel={`Slides status for ${r.name}`}
                          />
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <StatusSelect
                            value={r.bookStatus}
                            onChange={(v) => setRowStatus(r.id, "bookStatus", v)}
                            ariaLabel={`Book status for ${r.name}`}
                          />
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="secondary"
                                className="inline-flex shrink-0 items-center gap-1 border-transparent bg-muted/70 px-1.5 py-0 text-[10px] uppercase tracking-wider"
                              >
                                <Lock className="h-3 w-3" />
                                Auto
                              </Badge>
                              <span className="text-xs font-semibold tabular-nums text-foreground">
                                {mcqPct}%
                              </span>
                            </div>
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
                              {r.mcqCompleted}/{r.mcqTotal} solved
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-3">
                            <Progress value={snapped} className="h-2 min-w-[80px] flex-1" />
                            <Badge
                              className={cn(
                                "min-w-[52px] shrink-0 justify-center tabular-nums",
                                snapped >= 100
                                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500"
                                  : snapped >= 25
                                    ? "border-sky-500/30 bg-sky-500/15 text-sky-500"
                                    : "border-border bg-muted text-muted-foreground",
                              )}
                              variant="secondary"
                            >
                              {snapped}%
                            </Badge>
                            {snapped >= 100 && (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile / tablet cards */}
            <ul className="divide-y divide-border/60 md:hidden" role="list">
              {filteredRows.map((r) => {
                const { snapped } = chapterCompletion(r);
                const mcqPct =
                  r.mcqTotal > 0 ? Math.round((r.mcqCompleted / r.mcqTotal) * 100) : 0;
                return (
                  <li key={r.id} className="space-y-3 p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <BookOpen className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold leading-snug">{r.name}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <Progress value={snapped} className="h-2 flex-1" />
                          <Badge
                            className={cn(
                              "min-w-[48px] shrink-0 justify-center tabular-nums text-xs",
                              snapped >= 100
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500"
                                : snapped >= 25
                                  ? "border-sky-500/30 bg-sky-500/15 text-sky-500"
                                  : "border-border bg-muted text-muted-foreground",
                            )}
                            variant="secondary"
                          >
                            {snapped}%
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 sm:grid-cols-3">
                      <MobileTrackField label="Class">
                        <StatusSelect
                          value={r.classStatus}
                          onChange={(v) => setRowStatus(r.id, "classStatus", v)}
                          ariaLabel={`Class status for ${r.name}`}
                        />
                      </MobileTrackField>
                      <MobileTrackField label="Slides">
                        <StatusSelect
                          value={r.slidesStatus}
                          onChange={(v) => setRowStatus(r.id, "slidesStatus", v)}
                          ariaLabel={`Slides status for ${r.name}`}
                        />
                      </MobileTrackField>
                      <MobileTrackField label="Book">
                        <StatusSelect
                          value={r.bookStatus}
                          onChange={(v) => setRowStatus(r.id, "bookStatus", v)}
                          ariaLabel={`Book status for ${r.name}`}
                        />
                      </MobileTrackField>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="inline-flex shrink-0 items-center gap-1 border-transparent bg-background/70 px-1.5 py-0 text-[10px] uppercase tracking-wider"
                        >
                          <Lock className="h-3 w-3" />
                          Auto Sync
                        </Badge>
                        <span className="min-w-0 truncate text-xs font-medium">MCQ Practice</span>
                      </div>
                      <div className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                        <span className="text-sm font-semibold text-foreground">{mcqPct}%</span>
                        <span className="text-[11px] text-muted-foreground">
                          ({r.mcqCompleted}/{r.mcqTotal})
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>

        )}
      </section>

      {/* Mobile-only legend for MCQ read-only */}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        MCQ Practice is read-only — it syncs automatically from your practice activity.
      </p>
    </div>
  );
}
