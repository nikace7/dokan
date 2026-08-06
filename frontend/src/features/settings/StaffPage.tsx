import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/features/auth/useAuth';
import {
  assignStaffRole,
  createStaff,
  listBranches,
  listRoles,
  listStaff,
} from '@/features/settings/api';
import type { CreateStaffPayload } from '@/features/settings/api';
import { RoleManagementCard } from '@/features/settings/RoleManagementCard';
import { ApiError } from '@/lib/api/client';
import { hasPermission } from '@/lib/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function emptyForm(): CreateStaffPayload {
  return { phone: '', full_name: '', email: '', password: '', role: '' };
}

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

const inlineSelectClasses =
  'rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** Owner-facing staff account and existing-role assignment screen. */
export function StaffPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'user.manage');
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({
    queryKey: ['tenant', 'roles'],
    queryFn: listRoles,
    enabled: canManage,
    staleTime: 5 * 60_000,
  });
  const branchesQuery = useQuery({
    queryKey: ['tenant', 'branches'],
    queryFn: listBranches,
    enabled: canManage,
    staleTime: 5 * 60_000,
  });
  const staffQuery = useQuery({
    queryKey: ['tenant', 'staff'],
    queryFn: listStaff,
    enabled: canManage,
  });
  const [form, setForm] = useState<CreateStaffPayload>(emptyForm);
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  const [branchSelections, setBranchSelections] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createStaff,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenant', 'staff'] });
      setForm(emptyForm());
      setFormError(null);
      setStatusMessage('Staff account created.');
    },
    onError: (error) => setFormError(errorMessage(error, 'Could not create the staff account.')),
  });

  const assignMutation = useMutation({
    mutationFn: ({ userId, role, branch }: { userId: string; role: string; branch: string }) =>
      assignStaffRole(userId, role, branch || null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenant', 'staff'] });
      setStatusMessage('Role assigned.');
    },
    onError: (error) => setStatusMessage(errorMessage(error, 'Could not assign the role.')),
  });

  if (!canManage) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <Card title="Staff & roles / कर्मचारी">
          <p className="text-sm text-muted-foreground">
            Only the shop owner can manage staff accounts.
          </p>
        </Card>
      </main>
    );
  }

  const roles = rolesQuery.data?.data ?? [];
  const branches = branchesQuery.data?.data ?? [];
  const staff = staffQuery.data?.data ?? [];
  const queryError = rolesQuery.error ?? staffQuery.error;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.phone.trim() || !form.full_name.trim() || !form.password || !form.role) {
      setFormError('Phone, full name, password, and role are required.');
      return;
    }
    setStatusMessage(null);
    setFormError(null);
    createMutation.mutate({
      ...form,
      phone: form.phone.trim(),
      full_name: form.full_name.trim(),
      email: form.email?.trim() || undefined,
    });
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}
      {queryError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage(queryError, 'Could not load staff settings.')}
        </p>
      ) : null}

      <Card title="Add staff / कर्मचारी थप्नुहोस्">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Full name"
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
            <Input
              label="Initial password"
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-52 flex-col gap-1.5 text-sm font-medium">
              Role
              <select
                aria-label="Role"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
                className={`${selectClasses} font-normal`}
              >
                <option value="">Select a role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} ({role.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-52 flex-col gap-1.5 text-sm font-medium">
              Initial branch
              <select
                aria-label="Initial branch"
                value={form.branch ?? ''}
                onChange={(event) => setForm({ ...form, branch: event.target.value || null })}
                className={`${selectClasses} font-normal`}
              >
                <option value="">All branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={createMutation.isPending || roles.length === 0}>
              {createMutation.isPending ? 'Creating…' : 'Create staff'}
            </Button>
          </div>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          {roles.length === 0 && !rolesQuery.isPending ? (
            <p className="text-sm text-warning">Create a role before adding staff.</p>
          ) : null}
        </form>
      </Card>
      {branchesQuery.error ? (
        <p role="status" className="text-sm text-warning">
          Branches could not be loaded; role assignments will apply to all branches.
        </p>
      ) : null}

      <Card title="Staff accounts">
        {staffQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading staff…</p>
        ) : null}
        {!staffQuery.isPending && staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff accounts yet.</p>
        ) : null}
        {staff.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {staff.map((member) => {
              const selectedRole = roleSelections[member.id] ?? '';
              const selectedBranch = branchSelections[member.id] ?? '';
              return (
                <li key={member.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-sm font-medium">{member.full_name}</p>
                    <p className="text-sm text-muted-foreground">{member.phone}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {member.roles.length > 0
                      ? member.roles
                          .map((role) => `${role.code} @ ${role.branch_code ?? 'all branches'}`)
                          .join(', ')
                      : 'No role'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <select
                      aria-label={`Role for ${member.full_name}`}
                      value={selectedRole}
                      onChange={(event) =>
                        setRoleSelections({
                          ...roleSelections,
                          [member.id]: event.target.value,
                        })
                      }
                      className={inlineSelectClasses}
                    >
                      <option value="">Select</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.code}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Branch for ${member.full_name}`}
                      value={selectedBranch}
                      onChange={(event) =>
                        setBranchSelections({
                          ...branchSelections,
                          [member.id]: event.target.value,
                        })
                      }
                      className={inlineSelectClasses}
                    >
                      <option value="">All branches</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.code}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!selectedRole || assignMutation.isPending}
                      onClick={() =>
                        assignMutation.mutate({
                          userId: member.id,
                          role: selectedRole,
                          branch: selectedBranch,
                        })
                      }
                    >
                      Assign
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>

      <Card title="Available roles">
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles configured.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => (
              <li key={role.id} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">
                  {role.name} <span className="text-muted-foreground">({role.code})</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {role.permission_codes.length > 0
                    ? role.permission_codes.join(', ')
                    : 'No permissions'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RoleManagementCard roles={roles} />
    </main>
  );
}
