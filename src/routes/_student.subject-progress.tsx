import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const StudentSubjectProgressFlow = lazy(() =>
  import("@/components/dashboard/subject-progress/StudentSubjectProgressFlow").then((m) => ({
    default: m.StudentSubjectProgressFlow,
  })),
);

export const Route = createFileRoute("/_student/subject-progress")({
  component: StudentSubjectProgressPage,
  head: () => ({
    meta: [
      { title: "Subject Progress · CA Aspire BD" },
      {
        name: "description",
        content:
          "Track your chapter-wise study progress across every subject — slides, book, MCQ practice and overall completion.",
      },
    ],
  }),
});

function StudentSubjectProgressPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      <StudentSubjectProgressFlow />
    </Suspense>
  );
}
