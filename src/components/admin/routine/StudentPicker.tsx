import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminListStudentsForAssignment } from "@/lib/admin-routine.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type Student = {
  id: string;
  displayName: string | null;
  email: string | null;
  level: string | null;
};

export function StudentPicker({
  value,
  onChange,
  levelFilter,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  levelFilter?: string | null;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const listFn = useServerFn(adminListStudentsForAssignment);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-routine-students", debounced, levelFilter ?? "all"],
    queryFn: () =>
      listFn({
        data: {
          search: debounced.trim() || undefined,
          level: levelFilter || undefined,
          page: 1,
          pageSize: 200,
        },
      }),
    staleTime: 30_000,
  });

  const rows: Student[] = (data as any)?.rows ?? [];
  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  const selectAllVisible = () => {
    const next = new Set(selected);
    rows.forEach((r) => next.add(r.id));
    onChange(Array.from(next));
  };
  const clearAll = () => onChange([]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search students by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Badge variant="secondary" className="whitespace-nowrap">
          {value.length} selected
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={selectAllVisible}>
          Select all visible
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
          Clear all
        </Button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-card/40">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No students match your search.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((s) => {
              const on = selected.has(s.id);
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40",
                    on && "bg-primary/5",
                  )}
                  onClick={() => toggle(s.id)}
                >
                  <Checkbox checked={on} onCheckedChange={() => toggle(s.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {s.displayName || s.email || s.id}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.email ?? "—"}
                      {s.level ? ` · ${s.level}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {isLoading && (
        <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading students…
        </p>
      )}
    </div>
  );
}
