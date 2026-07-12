import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const StudentRoutineFlow = lazy(() =>
  import("@/components/dashboard/routine/StudentRoutineFlow").then((m) => ({
    default: m.StudentRoutineFlow,
  })),
);

export const Route = createFileRoute("/_student/routine")({
  component: StudentRoutinePage,
  head: () => ({
    meta: [
      { title: "Routine · CA Aspire BD" },
      {
        name: "description",
        content:
          "Track your daily study routine — targets, progress, calendar, achievements and manual study entry.",
      },
    ],
  }),
});

function StudentRoutinePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      <StudentRoutineFlow />
    </Suspense>
  );
}