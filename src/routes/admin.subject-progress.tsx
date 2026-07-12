import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const SubjectProgressManagerFlow = lazy(() =>
  import("@/components/admin/subject-progress/SubjectProgressManagerFlow").then((m) => ({
    default: m.SubjectProgressManagerFlow,
  })),
);

export const Route = createFileRoute("/admin/subject-progress")({
  component: AdminSubjectProgressPage,
  head: () => ({
    meta: [
      { title: "Subject Progress Manager · CA Aspire BD Admin" },
      {
        name: "description",
        content:
          "Monitor chapter-wise student progress across subjects — completion rates, activity and per-student detail.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function AdminSubjectProgressPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      <SubjectProgressManagerFlow />
    </Suspense>
  );
}
