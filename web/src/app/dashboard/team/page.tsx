"use client";

// SOT: team-page, role-management, invitations
// WHAT:  members, their roles and branch scope, plus invite links.
// WHY:   RBAC is a PRD requirement and is enforced server-side; this is its UI.
// HOW:   role changes PATCH immediately; invites return a shareable token.
// WHERE: role capabilities in src/lib/resources.ts

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { DataTable, ErrorBlock, LoadingBlock, PageHeader, SectionCard, Td } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField, TextInput } from "@/components/global/form";
import type { Role } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", admin: "Admin", branch_manager: "Branch Manager",
  content_editor: "Content Editor", viewer: "Viewer",
};
const ASSIGNABLE: Role[] = ["admin", "branch_manager", "content_editor", "viewer"];

export default function TeamPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const users = useQuery(() => api.users());
  const branches = useQuery(() => api.branches());
  const mayManage = can(permission("team", "create"));
  const invites = useQuery(() => (mayManage ? api.invites() : Promise.resolve([])), [mayManage]);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  if (users.loading && !users.data) return <LoadingBlock label={t("common.loading")} />;
  if (users.error) return <ErrorBlock message={users.error} onRetry={users.reload} />;
  const list = users.data ?? [];

  return (
    <div>
      <PageHeader
        title={t("nav.team")}
        subtitle={`${list.length} members`}
        actions={mayManage ? (
          <Button variant="primary" onPress={() => { setEmail(""); setRole("viewer"); setBranchIds([]); setOpen(true); }}>
            {t("team.invite")}
          </Button>
        ) : null}
      />

      <SectionCard>
        <DataTable head={["Member", "Role", "Branch access", "2FA", ""]}>
          {list.map((u) => (
            <tr key={u.id}>
              <Td>
                <p className="font-medium">{u.name}</p>
                <p className="text-xs text-muted">{u.email}</p>
              </Td>
              <Td>
                {mayManage && u.role !== "owner" ? (
                  <SelectField
                    ariaLabel={`Role for ${u.email}`}
                    options={ASSIGNABLE.map((r) => ({ id: r, label: ROLE_LABEL[r] ?? r }))}
                    selected={u.role}
                    onSelect={(r) => void api.updateUser(u.id, { role: r }).then(users.reload)}
                    className="w-44"
                  />
                ) : (
                  <Chip variant="soft" color="accent">{ROLE_LABEL[u.role] ?? u.role}</Chip>
                )}
              </Td>
              <Td className="text-muted">
                {u.branch_ids.length
                  ? u.branch_ids.map((id) => (branches.data ?? []).find((b) => b.id === id)?.name).filter(Boolean).join(", ")
                  : "All"}
              </Td>
              <Td>
                <Chip variant="soft" color={u.two_factor ? "success" : "default"}>{u.two_factor ? "on" : "off"}</Chip>
              </Td>
              <Td>
                {mayManage && u.role !== "owner" ? (
                  <Button size="sm" variant="danger-soft" onPress={() => void api.removeUser(u.id).then(users.reload)}>
                    Remove
                  </Button>
                ) : null}
              </Td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>

      {(invites.data ?? []).length > 0 ? (
        <SectionCard className="mt-5" title={t("team.pending")}>
          <DataTable head={["Email", "Role", "Created", ""]}>
            {(invites.data ?? []).map((i) => (
              <tr key={i.id}>
                <Td>{i.email}</Td>
                <Td><Chip variant="soft">{i.role}</Chip></Td>
                <Td className="text-muted">{timeAgo(i.created_at)}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => void navigator.clipboard?.writeText(`${window.location.origin}/accept-invite?token=${i.token}`)}
                  >
                    Copy link
                  </Button>
                </Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      ) : null}

      <FormDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Invite team member"
        confirmLabel="Send invite"
        onConfirm={async () => {
          const r = await api.invite(email, role, branchIds);
          setInviteLink(`${window.location.origin}/accept-invite?token=${r.invite_token}`);
          users.reload();
          invites.reload();
        }}
      >
        <TextInput label="Email" value={email} onChange={setEmail} type="email" placeholder="colleague@company.com" />
        <SelectField
          label="Role"
          options={ASSIGNABLE.map((r) => ({ id: r, label: ROLE_LABEL[r] ?? r }))}
          selected={role}
          onSelect={(r) => setRole(r as Role)}
        />
        <fieldset>
          <legend className="mb-1 text-sm text-muted">Branch access (for Branch Managers)</legend>
          <div className="flex flex-col gap-1">
            {(branches.data ?? []).map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={branchIds.includes(b.id)}
                  onChange={(e) => setBranchIds((prev) => (e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id)))}
                />
                {b.name}
              </label>
            ))}
          </div>
        </fieldset>
      </FormDialog>

      {inviteLink ? (
        <FormDialog isOpen onClose={() => setInviteLink(null)} title="Invite link" description="Share this link with your teammate.">
          <input readOnly value={inviteLink} className="w-full rounded-lg border border-border bg-field p-2 text-sm" />
        </FormDialog>
      ) : null}
    </div>
  );
}
