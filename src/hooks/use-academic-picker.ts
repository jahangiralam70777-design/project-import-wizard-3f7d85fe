// Small hooks that expose Academic Manager data (Levels / Subjects / Chapters)
// as cascading dropdown sources. Reuses the existing `learning.functions`
// server functions (listLevels, listSubjects, listChapters) which are the
// same source Academic Manager reads from — no duplicated logic.

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSubjects, listChapters } from "@/lib/learning.functions";
import { useLevels, type LevelRow } from "@/hooks/use-levels";

export type SubjectRow = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  level: string | null;
};

export type ChapterRow = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  sort_order: number;
  subject_id: string;
};

export function useAcademicLevels(options?: { includeLocked?: boolean }) {
  return useLevels(options);
}

/** Subjects for a given level code (empty when level is falsy). */
export function useAcademicSubjects(level: string | null | undefined) {
  const fn = useServerFn(listSubjects);
  return useQuery({
    queryKey: ["academic-subjects", level ?? null],
    enabled: !!level,
    queryFn: async () => {
      const rows = (await fn({ data: { level: level! } })) as SubjectRow[];
      return rows ?? [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** All published subjects (across levels). Used by the student picker. */
export function useAllAcademicSubjects() {
  const fn = useServerFn(listSubjects);
  return useQuery({
    queryKey: ["academic-subjects", "__all__"],
    queryFn: async () => {
      const rows = (await fn({ data: {} })) as SubjectRow[];
      return rows ?? [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Chapters for a given subject id. */
export function useAcademicChapters(subjectId: string | null | undefined) {
  const fn = useServerFn(listChapters);
  return useQuery({
    queryKey: ["academic-chapters", subjectId ?? null],
    enabled: !!subjectId,
    queryFn: async () => {
      const rows = (await fn({ data: { subjectId: subjectId! } })) as ChapterRow[];
      return rows ?? [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export type { LevelRow };
