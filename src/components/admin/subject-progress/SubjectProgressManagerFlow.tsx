import { useMemo, useState } from "react";
import {
  BookOpenCheck,
  Users,
  Percent,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Search,
  Filter,
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
  Eye,
  Layers,
  CheckCircle2,
  Clock,
  Circle,
  Activity,
  Sparkles,
  BookOpen,
  Lock,
  GraduationCap,
} from "lucide-react";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
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
import { cn } from "@/lib/utils";
import {
  useAcademicLevels,
  useAcademicSubjects,
  useAcademicChapters,
} from "@/hooks/use-academic-picker";


/* ------------------------------------------------------------------ */
/* Types (UI-only)                                                     */
/* ------------------------------------------------------------------ */

type StudentStatus = "on_track" | "behind" | "at_risk" | "complete";

type StudentRow = {
  id: string;
  name: string;
  email?: string;
  level: string;
  subject: string;
  completedChapters: number;
  totalChapters: number;
  averageProgress: number;
  overallProgress: number;
  status: StudentStatus;
  lastUpdated: string | null;
};

/* ------------------------------------------------------------------ */
/* Atoms                                                                */
/* ------------------------------------------------------------------ */

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
  tone?: "default" | "success" | "warn" | "info" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "from-emerald-500/20 to-emerald-500/5 text-emerald-500"
      : tone === "warn"
        ? "from-amber-500/20 to-amber-500/5 text-amber-500"
        : tone === "info"
          ? "from-sky-500/20 to-sky-500/5 text-sky-500"
          : tone === "danger"
            ? "from-rose-500/20 to-rose-500/5 text-rose-500"
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

const STATUS_STYLES: Record<StudentStatus, { label: string; className: string }> = {
  on_track: {
    label: "On Track",
    className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  },
  behind: {
    label: "Behind",
    className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  },
  at_risk: {
    label: "At Risk",
    className: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  },
  complete: {
    label: "Complete",
    className: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  },
};

function StatusBadge({ status }: { status: StudentStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        s.className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
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
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

function StudentDetailsView({
  student,
  onBack,
}: {
  student: StudentRow;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        breadcrumbs={[
          { label: "Admin", to: "/admin" },
          { label: "Subject Progress Manager", to: "/admin/subject-progress" },
          { label: student.name },
        ]}
        title={student.name}
        subtitle={
          <>
            {student.level} · {student.subject}
          </>
        }
        actions={
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Button>
        }
      />

      {/* Student Information */}
      <section className="glass shadow-card-soft rounded-2xl border border-border/60 p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cta-gradient text-white shadow-glow">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-display text-xl font-bold">{student.name}</h2>
              {student.email && (
                <p className="truncate text-sm text-muted-foreground">{student.email}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{student.level}</Badge>
                <Badge variant="secondary">{student.subject}</Badge>
                <StatusBadge status={student.status} />
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Overall
            </p>
            <p className="font-display text-3xl font-bold tabular-nums">{student.overallProgress}%</p>
          </div>
        </div>
        <div className="mt-4">
          <Progress value={student.overallProgress} className="h-2" />
        </div>
      </section>

      {/* Subject summary cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Layers}
          label="Total Chapters"
          value={student.totalChapters}
          tone="info"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={student.completedChapters}
          hint={`${student.totalChapters - student.completedChapters} remaining`}
          tone="success"
        />
        <StatCard
          icon={Activity}
          label="Average Progress"
          value={`${student.averageProgress}%`}
          tone="info"
        />

        <StatCard
          icon={Percent}
          label="Overall Progress"
          value={`${student.overallProgress}%`}
        />
      </section>

      {/* Chapter progress + chart placeholders (no fake data) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg font-bold">Chapter Progress</h3>
          </div>
          <EmptyState
            icon={Layers}
            title="No chapter data"
            description="Per-chapter progress will appear here once the tracking backend is connected."
          />
        </div>
        <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg font-bold">Progress Chart</h3>
          </div>
          <EmptyState
            icon={Activity}
            title="No trend yet"
            description="Weekly progress trend will render here."
          />
        </div>
      </div>

      <div className="glass shadow-card-soft rounded-2xl border border-border/60 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg font-bold">Activity Timeline</h3>
        </div>
        <EmptyState
          icon={Activity}
          title="No activity"
          description="Study activity events will appear here in chronological order."
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main manager                                                        */
/* ------------------------------------------------------------------ */

export function SubjectProgressManagerFlow() {
  const loading = false;

  // No mock data — backend will hydrate.
  const [rows] = useState<StudentRow[]>([]);

  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [chapterFilter, setChapterFilter] = useState<string>("all");
  const [progressFilter, setProgressFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Academic Manager as the single source of truth for scope filters.
  const { data: levels = [] } = useAcademicLevels();
  const { data: subjects = [] } = useAcademicSubjects(
    levelFilter === "all" ? null : levelFilter,
  );
  const { data: chapters = [] } = useAcademicChapters(
    subjectFilter === "all" ? null : subjectFilter,
  );


  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const dashboard = useMemo(() => {
    const totalStudents = rows.length;
    const avg =
      totalStudents === 0
        ? 0
        : Math.round(rows.reduce((s, r) => s + r.overallProgress, 0) / totalStudents);
    const bySubject = new Map<string, { sum: number; n: number }>();
    rows.forEach((r) => {
      const acc = bySubject.get(r.subject) ?? { sum: 0, n: 0 };
      acc.sum += r.overallProgress;
      acc.n += 1;
      bySubject.set(r.subject, acc);
    });
    let best: { name: string; avg: number } | null = null;
    let worst: { name: string; avg: number } | null = null;
    bySubject.forEach((v, name) => {
      const a = Math.round(v.sum / v.n);
      const nextBest: { name: string; avg: number } = { name, avg: a };
      if (!best || a > best.avg) best = nextBest;
      if (!worst || a < worst.avg) worst = nextBest;
    });

    const behind = rows.filter((r) => r.status === "behind" || r.status === "at_risk").length;
    return {
      totalStudents,
      avg,
      best: best as { name: string; avg: number } | null,
      worst: worst as { name: string; avg: number } | null,
      behind,
    };

  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.email ?? ""} ${r.subject}`.toLowerCase().includes(q)) return false;
      if (levelFilter !== "all" && r.level !== levelFilter) return false;
      if (subjectFilter !== "all" && r.subject !== subjectFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (progressFilter !== "all") {
        const p = r.overallProgress;
        if (progressFilter === "0-25" && !(p <= 25)) return false;
        if (progressFilter === "25-50" && !(p > 25 && p <= 50)) return false;
        if (progressFilter === "50-75" && !(p > 50 && p <= 75)) return false;
        if (progressFilter === "75-100" && !(p > 75)) return false;
      }
      return true;
    });
  }, [rows, query, levelFilter, subjectFilter, progressFilter, statusFilter]);

  if (loading) return <LoadingSkeleton />;

  if (selected) {
    return <StudentDetailsView student={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Subject Progress Manager" }]}
        title={
          <span className="inline-flex items-center gap-2">
            <BookOpenCheck className="h-6 w-6 text-primary" />
            Subject Progress Manager
          </span>
        }
        subtitle="Monitor chapter-wise student progress across subjects and levels."
        actions={
          <>
            <Button variant="outline" className="gap-2" aria-label="Export as CSV">
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" className="gap-2" aria-label="Export as Excel">
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
            <Button variant="outline" className="gap-2" aria-label="Export as PDF">
              <FileText className="h-4 w-4" />
              PDF
            </Button>
          </>
        }
      />

      {/* Dashboard cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={Users}
          label="Students Tracked"
          value={dashboard.totalStudents}
          tone="info"
        />
        <StatCard
          icon={Percent}
          label="Overall Completion"
          value={`${dashboard.avg}%`}
          tone="default"
        />
        <StatCard
          icon={TrendingUp}
          label="Best Performing"
          value={dashboard.best ? dashboard.best.name : "—"}
          hint={dashboard.best ? `${dashboard.best.avg}% average` : "Awaiting data"}
          tone="success"
        />
        <StatCard
          icon={TrendingDown}
          label="Lowest Performing"
          value={dashboard.worst ? dashboard.worst.name : "—"}
          hint={dashboard.worst ? `${dashboard.worst.avg}% average` : "Awaiting data"}
          tone="warn"
        />
        <StatCard
          icon={AlertTriangle}
          label="Behind Schedule"
          value={dashboard.behind}
          hint="Students needing attention"
          tone="danger"
        />
      </section>

      {/* Toolbar */}
      <section className="glass shadow-card-soft rounded-2xl border border-border/60 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_repeat(4,auto)]">
          <label className="relative block min-w-0">
            <span className="sr-only">Search students</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by student, subject…"
              className="h-10 rounded-xl pl-9"
            />
          </label>
          <Select
            value={levelFilter}
            onValueChange={(v) => {
              setLevelFilter(v);
              setSubjectFilter("all");
              setChapterFilter("all");
            }}
          >
            <SelectTrigger className="h-10 w-full min-w-[140px] rounded-xl md:w-[150px]" aria-label="Filter by level">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              {levels.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={subjectFilter}
            onValueChange={(v) => {
              setSubjectFilter(v);
              setChapterFilter("all");
            }}
            disabled={levelFilter === "all"}
          >
            <SelectTrigger className="h-10 w-full min-w-[150px] rounded-xl md:w-[170px]" aria-label="Filter by subject">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={chapterFilter}
            onValueChange={setChapterFilter}
            disabled={subjectFilter === "all"}
          >
            <SelectTrigger className="h-10 w-full min-w-[150px] rounded-xl md:w-[170px]" aria-label="Filter by chapter">
              <SelectValue placeholder="Chapter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Chapters</SelectItem>
              {chapters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={progressFilter} onValueChange={setProgressFilter}>
            <SelectTrigger className="h-10 w-full min-w-[150px] rounded-xl md:w-[160px]" aria-label="Filter by progress">
              <SelectValue placeholder="Progress" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Progress</SelectItem>
              <SelectItem value="0-25">0 – 25%</SelectItem>
              <SelectItem value="25-50">25 – 50%</SelectItem>
              <SelectItem value="50-75">50 – 75%</SelectItem>
              <SelectItem value="75-100">75 – 100%</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-full min-w-[140px] rounded-xl md:w-[150px]" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="on_track">On Track</SelectItem>
              <SelectItem value="behind">Behind</SelectItem>
              <SelectItem value="at_risk">At Risk</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Student progress table */}
      <section
        className="glass shadow-card-soft overflow-hidden rounded-2xl border border-border/60"
        aria-label="Student progress table"
      >
        {filteredRows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={rows.length === 0 ? "No students tracked yet" : "No matching students"}
            description={
              rows.length === 0
                ? "Once students start tracking subject progress, they will appear in this list."
                : "Adjust the search or filters to broaden your view."
            }
            className="rounded-none border-0"
          />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Level</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Avg. Progress</th>
                  <th className="px-4 py-3">Overall</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border/60 transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cta-gradient text-white shadow-glow">
                          <GraduationCap className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.name}</p>
                          {r.email && (
                            <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{r.level}</Badge>
                    </td>
                    <td className="px-4 py-3">{r.subject}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {r.completedChapters}/{r.totalChapters}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{r.averageProgress}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={r.overallProgress} className="h-2 w-28" />
                        <span className="w-10 text-right text-xs font-semibold tabular-nums">
                          {r.overallProgress}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.lastUpdated ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => setSelectedId(r.id)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        MCQ Practice completion is calculated automatically from student practice activity and is
        never editable manually.
      </p>
    </div>
  );
}
