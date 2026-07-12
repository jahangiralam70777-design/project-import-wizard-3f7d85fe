import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const RoutineManagerFlow = lazy(() =>
  import("@/components/admin/routine/RoutineManagerFlow").then((m) => ({
    default: m.RoutineManagerFlow,
  })),
);

export const Route = createFileRoute("/admin/routine")({
  component: AdminRoutinePage,
  head: () => ({
    meta: [
      { title: "Routine Manager · CA Aspire BD Admin" },
      {
        name: "description",
        content:
          "Create and manage study routines for students — targets, active days, scope and manual study review.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function AdminRoutinePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      <RoutineManagerFlow />
    </Suspense>
  );
}