import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { adminRoutineHistory } from "@/lib/admin-routine.functions";

export function RoutineHistoryDialog({
  routineId,
  open,
  onOpenChange,
}: {
  routineId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const historyFn = useServerFn(adminRoutineHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-routine-history", routineId],
    queryFn: () => historyFn({ data: { id: routineId! } }),
    enabled: !!routineId && open,
  });
  const rows: any[] = (data as any)?.rows ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Routine History</DialogTitle>
          <DialogDescription>Full audit trail of changes to this routine.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 pt-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No history entries yet for this routine.
          </p>
        ) : (
          <ol className="space-y-2 pt-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border/60 bg-card/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">{r.action}</Badge>
                  <time className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </time>
                </div>
                {r.description && (
                  <p className="mt-1 text-sm">{r.description}</p>
                )}
                {r.metadata && Object.keys(r.metadata).length > 0 && (
                  <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                    {JSON.stringify(r.metadata, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
