# Routine Manager: Actions + Student Assignment

This is a large change (new DB table, ~10 new server fns, 3 new UI panels, edits to Create/Edit/Student flows). I want your sign-off on scope + approach before touching code so I don't half-build any of it.

## Root causes (verified from code)

1. **Action buttons dead** — `RoutineManagerFlow.tsx` renders `<RowAction>` for Edit / Duplicate / Enable / Disable / Archive / Delete with NO `onClick`. Only "Preview" is wired (opens the details sheet). History / Export / Restore aren't even rendered. Delete does **not** actually work either — it has no handler.
2. **No student assignment concept** — routine visibility is purely scope-matched (`profiles.level === routines.scope_level`) in `listMyRoutines`. There is no `routine_assignments` table and no way to target specific students.
3. **"No routine assigned yet"** — for students whose profile `level` doesn't equal any active routine's `scope_level`, the empty state is *correct*. But there's no explicit-assignment override, so admins can't fix it per-student.

## Scope of changes

### 1. New SQL migration (single file, `supabase/manual_apply/20260716_routine_assignments.sql`)

```sql
create table public.routine_assignments (
  id uuid pk default gen_random_uuid(),
  routine_id uuid not null references routines(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id),
  assignment_type text check (in 'all_students'|'selected_students'),
  status text default 'active' check (in 'active'|'removed'),
  created_at, updated_at,
  unique(routine_id, student_id)
);
-- indexes on routine_id, student_id
-- GRANT select/insert/update/delete to authenticated; ALL to service_role
-- RLS: students select own (auth.uid()=student_id); routine admins full via is_routine_admin(auth.uid())
-- ALTER routines add column assignment_mode text default 'all_students' check (in 'all_students'|'selected_students')
```

### 2. Backend server fns (`src/lib/admin-routine.functions.ts`)

Add: `adminUpdateRoutine`, `adminDuplicateRoutine`, `adminSetRoutineStatus` (active/disabled/archived — covers Enable/Disable/Archive/Restore), `adminDeleteRoutine`, `adminGetRoutineHistory` (from existing `routine_audit_log`), `adminExportRoutines` (CSV), `adminListStudents` (searchable, filter by level, paginated), `adminSetRoutineAssignments` (replace set), `adminListRoutineAssignments` (with progress % joined from routine_study_sessions).

Update `adminCreateRoutine` to accept `assignmentMode` + `studentIds[]` and insert rows into `routine_assignments`.

### 3. Student side (`src/lib/routine.functions.ts`)

Rewrite `listMyRoutines`: return routines where
- `routine_assignments` has active row for `auth.uid()` (explicit selected), OR
- `routine.assignment_mode = 'all_students'` AND scope matches student's level (existing behavior)

### 4. UI

- **RoutineManagerFlow.tsx** — wire every `RowAction` onClick to real handlers, add missing Restore/History/Export buttons, add confirm dialogs, add `EditRoutineDialog`, `RoutineHistoryDialog`, `AssignedStudentsDialog`. Extend `CreateRoutineDialog` with Assignment Type radio + searchable multi-select student picker (Select All / Clear All).
- **StudentRoutineFlow.tsx** — no change; already reads `listMyRoutines` per previous fix.

### 5. Files touched (~10)

- NEW `supabase/manual_apply/20260716_routine_assignments.sql`
- NEW `src/components/admin/routine/EditRoutineDialog.tsx`
- NEW `src/components/admin/routine/AssignedStudentsDialog.tsx`
- NEW `src/components/admin/routine/StudentPicker.tsx`
- NEW `src/components/admin/routine/RoutineHistoryDialog.tsx`
- EDIT `src/components/admin/routine/RoutineManagerFlow.tsx`
- EDIT `src/lib/admin-routine.functions.ts`
- EDIT `src/lib/routine.functions.ts`
- EDIT `src/lib/routine-shared.ts` (schemas for assignment + update/duplicate)

## Effort / risk

Realistically **~1500–2000 lines** across new + edited files. I can ship it end-to-end in this thread, but it will span multiple long messages and I want to confirm two things before starting:

1. **Migration must be applied manually.** I'll write it under `supabase/manual_apply/`; you'll need to paste it into Supabase SQL editor for the assignment features to actually work. Until it's applied, the code will detect the missing table (via existing `isMissingTable` helper) and fall back to scope-only behavior. Confirm this is OK.
2. **CSV Export** — I'll implement it as a client-side CSV download of the currently filtered routines (id, name, level, subject, chapter, targets, days, status, created). Anything richer (all students' progress per routine) is a bigger separate task. OK?

Reply **"go"** to proceed with the full plan above, or tell me which parts to cut.
