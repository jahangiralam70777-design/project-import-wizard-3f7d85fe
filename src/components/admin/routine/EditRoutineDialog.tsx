import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useAcademicLevels,
  useAcademicSubjects,
  useAcademicChapters,
} from "@/hooks/use-academic-picker";
import {
  adminGetRoutine,
  adminUpdateRoutine,
  adminListRoutineAssignments,
} from "@/lib/admin-routine.functions";
import { StudentPicker } from "./StudentPicker";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

export function EditRoutineDialog({
  routineId,
  open,
  onOpenChange,
  onSaved,
}: {
  routineId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const getFn = useServerFn(adminGetRoutine);
  const listAssignedFn = useServerFn(adminListRoutineAssignments);
  const updateFn = useServerFn(adminUpdateRoutine);

  const { data: routine, isLoading } = useQuery({
    queryKey: ["admin-routine", routineId],
    queryFn: () => getFn({ data: { id: routineId! } }),
    enabled: !!routineId && open,
  });

  const { data: assignments } = useQuery({
    queryKey: ["admin-routine-assignments", routineId],
    queryFn: () =>
      listAssignedFn({
        data: { routineId: routineId!, status: "active", page: 1, pageSize: 200 },
      }),
    enabled: !!routineId && open,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("");
  const [subject, setSubject] = useState("");
  const [chapter, setChapter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [studyHours, setStudyHours] = useState("");
  const [mcqTarget, setMcqTarget] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<"all_students" | "selected_students">(
    "all_students",
  );
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (routine) {
      setName(routine.name);
      setDescription(routine.description ?? "");
      setLevel(routine.scope.level);
      setSubject(routine.scope.subjectId ?? "");
      setChapter(routine.scope.chapterId ?? "");
      setStartDate(routine.startDate ?? "");
      setEndDate(routine.endDate ?? "");
      setStudyHours(String(routine.targets.studyMinutes / 60));
      setMcqTarget(String(routine.targets.mcqCount));
      setDays(routine.activeDays as string[]);
      setAssignmentMode(routine.assignmentMode);
    }
  }, [routine]);

  useEffect(() => {
    const rows = (assignments as any)?.rows ?? [];
    setStudentIds(rows.map((r: any) => r.studentId));
  }, [assignments]);

  const { data: levels = [] } = useAcademicLevels();
  const { data: subjects = [] } = useAcademicSubjects(level || null);
  const { data: chapters = [] } = useAcademicChapters(subject || null);

  const canSubmit = name.trim().length >= 3 && level && days.length > 0 && !submitting;

  function toggleDay(k: string) {
    setDays((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));
  }

  const dedupedStudentIds = useMemo(
    () => Array.from(new Set(studentIds)),
    [studentIds],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit Routine</DialogTitle>
          <DialogDescription>Update scope, targets, days and assignment.</DialogDescription>
        </DialogHeader>

        {isLoading || !routine ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading routine…</p>
        ) : (
          <div className="space-y-6 pt-2">
            <section className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label>Level</Label>
                  <Select
                    value={level}
                    onValueChange={(v) => {
                      setLevel(v);
                      setSubject("");
                      setChapter("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {levels.map((l) => (
                        <SelectItem key={l.code} value={l.code}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject</Label>
                  <Select
                    value={subject}
                    onValueChange={(v) => {
                      setSubject(v);
                      setChapter("");
                    }}
                    disabled={!level}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Chapter</Label>
                  <Select value={chapter} onValueChange={setChapter} disabled={!subject}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      {chapters.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Daily Study Hours</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min={0}
                    value={studyHours}
                    onChange={(e) => setStudyHours(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Daily MCQ Target</Label>
                  <Input
                    type="number"
                    min={0}
                    value={mcqTarget}
                    onChange={(e) => setMcqTarget(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <Label>Active Days</Label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const on = days.includes(d.key);
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => toggleDay(d.key)}
                      className={cn(
                        "min-h-9 rounded-lg border px-3 text-sm",
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
            </section>

            <section className="space-y-3">
              <Label>Assignment Type</Label>
              <RadioGroup
                value={assignmentMode}
                onValueChange={(v) => setAssignmentMode(v as "all_students" | "selected_students")}
                className="grid gap-2 sm:grid-cols-2"
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-3 hover:bg-muted/40">
                  <RadioGroupItem value="all_students" />
                  <div>
                    <p className="text-sm font-medium">All Students</p>
                    <p className="text-xs text-muted-foreground">Every student matching scope.</p>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-3 hover:bg-muted/40">
                  <RadioGroupItem value="selected_students" />
                  <div>
                    <p className="text-sm font-medium">Selected Students</p>
                    <p className="text-xs text-muted-foreground">Only students you pick below.</p>
                  </div>
                </label>
              </RadioGroup>
              {assignmentMode === "selected_students" && (
                <StudentPicker value={dedupedStudentIds} onChange={setStudentIds} />
              )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              if (!routineId) return;
              setSubmitting(true);
              try {
                await updateFn({
                  data: {
                    id: routineId,
                    name: name.trim(),
                    description: description.trim() || null,
                    scope: {
                      level,
                      subjectId: subject || null,
                      chapterId: chapter || null,
                    },
                    startDate: startDate || null,
                    endDate: endDate || null,
                    activeDays: days as any,
                    targets: {
                      studyMinutes: Math.round((Number(studyHours) || 0) * 60),
                      mcqCount: Math.max(0, Math.floor(Number(mcqTarget) || 0)),
                    },
                    assignmentMode,
                    selectedStudentIds:
                      assignmentMode === "selected_students" ? dedupedStudentIds : [],
                  },
                });
                toast.success("Routine updated.");
                onSaved?.();
                onOpenChange(false);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to update routine");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
