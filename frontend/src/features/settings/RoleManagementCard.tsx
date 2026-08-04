import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { createRole, deleteRole, listPermissions, updateRole } from '@/features/settings/api';
import type { Permission, Role } from '@/features/settings/api';
import { ApiError } from '@/lib/api/client';

type RoleForm = {
  code: string;
  name: string;
  description: string;
  permission_codes: string[];
};

const EMPTY_FORM: RoleForm = { code: '', name: '', description: '', permission_codes: [] };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function formForRole(role: Role): RoleForm {
  return {
    code: role.code,
    name: role.name,
    description: role.description ?? '',
    permission_codes: role.permission_codes,
  };
}

/** Owner-facing custom role editor; system roles remain read-only. */
export function RoleManagementCard({ roles }: { roles: Role[] }) {
  const queryClient = useQueryClient();
  const permissionsQuery = useQuery({
    queryKey: ['tenant', 'permissions'],
    queryFn: listPermissions,
    staleTime: 5 * 60_000,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RoleForm>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refreshRoles = () => queryClient.invalidateQueries({ queryKey: ['tenant', 'roles'] });
  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? updateRole(editingId, {
            name: form.name.trim(),
            description: form.description.trim() || null,
            permission_codes: form.permission_codes,
          })
        : createRole({
            code: form.code.trim(),
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            permission_codes: form.permission_codes,
          }),
    onSuccess: () => {
      void refreshRoles();
      setEditingId(null);
      setForm(EMPTY_FORM);
      setFormError(null);
      setMessage(editingId ? 'Role updated.' : 'Role created.');
    },
    onError: (error) => setFormError(errorMessage(error, 'Could not save the role.')),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => {
      void refreshRoles();
      setMessage('Role deleted.');
      setFormError(null);
    },
    onError: (error) => setMessage(errorMessage(error, 'Could not delete the role.')),
  });

  const permissions = permissionsQuery.data ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!editingId && !form.code.trim()) || !form.name.trim()) {
      setFormError(editingId ? 'Role name is required.' : 'Role code and name are required.');
      return;
    }
    setMessage(null);
    setFormError(null);
    saveMutation.mutate();
  }

  function togglePermission(code: string) {
    const selected = form.permission_codes.includes(code);
    setForm({
      ...form,
      permission_codes: selected
        ? form.permission_codes.filter((permission) => permission !== code)
        : [...form.permission_codes, code],
    });
  }

  return (
    <Card title="Custom roles / भूमिका">
      {message ? (
        <p role="status" className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {message}
        </p>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Role code"
            disabled={editingId !== null}
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
          <Input
            label="Role name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Description
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Permissions</legend>
          {permissionsQuery.isPending ? (
            <p className="text-sm text-slate-500">Loading permissions…</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {permissions.map((permission: Permission) => (
              <label key={permission.code} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.permission_codes.includes(permission.code)}
                  onChange={() => togglePermission(permission.code)}
                />
                <span>
                  <span className="block font-medium">{permission.name}</span>
                  <span className="text-xs text-slate-500">{permission.code}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {formError ? (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : editingId ? 'Update role' : 'Create role'}
          </Button>
          {editingId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
                setFormError(null);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold">Configured roles</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {roles.map((role) => (
            <li key={role.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {role.name} <span className="text-slate-500">({role.code})</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {role.permission_codes.length} permission(s)
                  </p>
                </div>
                {role.is_system ? (
                  <span className="text-xs text-slate-500">System role</span>
                ) : (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingId(role.id);
                        setForm(formForRole(role));
                        setMessage(null);
                        setFormError(null);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete the ${role.name} role?`)) {
                          deleteMutation.mutate(role.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
