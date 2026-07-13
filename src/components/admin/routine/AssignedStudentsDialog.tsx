import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, UserMinus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  adminListRoutineAssignments,
  adminRemoveRoutineAssignment,
} from "@/lib/admin-routine.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const PAGE_SIZE = 20;

export function AssignedStudentsDialog({
  routineId,
  routineName,
  open,
  onOpenChange,
}: {
  routineId: string | null;
  routineName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "removed" | "all">("active");
  const debounced = useDebouncedValue(search, 250);

  const qc = useQueryClient();
  const listFn = useServerFn(adminListRoutineAssignments);
  const removeFn = useServerFn(adminRemoveRoutineAssignment);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-routine-assignments", routineId, debounced, status, page],
    queryFn: () =>
      listFn({
        data: {
          routineId: routineId!,
          search: debounced.trim() || undefined,
          status,
          page,
          pageSize: PAGE_SIZE,
        },
      }),
    enabled: !!routineId && open,
  });

  const removeMut = useMutation({
    mutationFn: (assignmentId: string) => removeFn({ data: { assignmentId } }),
    onSuccess: () => {
      toast.success("Assignment removed.");
      qc.invalidateQueries({ queryKey: ["admin-routine-assignments", routineId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to remove"),
  });

  const rows: any[] = (data as any)?.rows ?? [];
  const total = (data as any)?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Assigned Students</DialogTitle>
          <DialogDescription>{routineName}</DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {(["active", "removed", "all"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "ghost"}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {s === "all" ? "All" : s === "active" ? "Active" : "Removed"}
            </Button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-border/60">
          {isLoading ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No assignments found.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Student</th>
                  <th className="px-3 py-2 text-left">Level</th>
                  <th className="px-3 py-2 text-left">Assigned</th>
                  <th className="px-3 py-2 text-left">Progress</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.displayName ?? r.email ?? r.studentId}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.email ?? "—"}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.level ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.assignedAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="min-w-[120px]">
                        <div className="flex items-center justify-between text-xs">
                          <span>{r.completionPct}%</span>
                          <span className="text-muted-foreground">
                            {r.studyMinutes}m · {r.mcqsSolved} MCQs
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.min(100, r.completionPct)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={r.status === "active" ? "secondary" : "outline"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status === "active" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeMut.mutate(r.id)}
                          disabled={removeMut.isPending}
                        >
                          <UserMinus className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages} · {total} total
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
