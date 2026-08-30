"use client";

// SOT: team-page, role-management, invitations
// WHAT:  members, their roles and branch scope, plus invite links.
// WHY:   RBAC is a PRD requirement and is enforced server-side; this is its UI.
// HOW:   role changes PATCH immediately; invites return a shareable token.
// WHERE: role capabilities in src/lib/resources.ts

import { useState } from "react";
import { Button } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { Icon } from "@/components/global/icon";
import {
  DataTable, ErrorBlock, LoadingBlock, PageHeader, SectionCard,
  StatusPill, Td, Tr,
} from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { CheckboxField, SelectField, TextInput } from "@/components/global/form";
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
  const [copied, setCopied] = useState(false);

  if (users.loading && !users.data) return <LoadingBlock rows={5} />;
  if (users.error) return <ErrorBlock message={users.error} onRetry={users.reload} />;
  const list = users.data ?? [];

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <PageHeader
        title={t("nav.team")}
        subtitle={`${list.length} members`}
        actions={mayManage ? (
          <Button variant="primary" size="sm" onPress={() => { setEmail(""); setRole("viewer"); setBranchIds([]); setOpen(true); }}>
            <Icon name="invite" size={13} />
            {t("team.invite")}
          </Button>
        ) : null}
      />

      <SectionCard flush>
        <DataTable head={["Member", "Role", "Branch access", "Two-factor", ""]}>
          {list.map((u) => (
            <Tr key={u.id}>
              <Td>
                <p className="font-medium text-foreground">{u.name}</p>
                <p className="text-footnote text-muted">{u.email}</p>
              </Td>
              <Td>
                {mayManage && u.role !== "owner" ? (
                  <SelectField
                    ariaLabel={`Role for ${u.email}`}
                    options={ASSIGNABLE.map((r) => ({ id: r, label: ROLE_LABEL[r] ?? r }))}
                    selected={u.role}
                    onSelect={(r) => void api.updateUser(u.id, { role: r }).then(users.reload)}
                    className="w-[168px]"
                  />
                ) : (
                  <StatusPill tone="accent" icon="team">{ROLE_LABEL[u.role] ?? u.role}</StatusPill>
                )}
              </Td>
              <Td className="text-footnote text-muted">
                {u.branch_ids.length
                  ? u.branch_ids.map((id) => (branches.data ?? []).find((b) => b.id === id)?.name).filter(Boolean).join(", ")
                  : "All branches"}
              </Td>
              <Td>
                <StatusPill
                  tone={u.two_factor ? "success" : "neutral"}
                  icon={u.two_factor ? "verified" : "security"}
                >
                  {u.two_factor ? "On" : "Off"}
                </StatusPill>
              </Td>
              <Td>
                {mayManage && u.role !== "owner" ? (
                  <div className="flex justify-end">
                    <Button size="sm" variant="danger-soft" onPress={() => void api.removeUser(u.id).then(users.reload)}>
                      <Icon name="delete" size={13} />
                      Remove
                    </Button>
                  </div>
                ) : null}
              </Td>
            </Tr>
          ))}
        </DataTable>
      </SectionCard>

      {(invites.data ?? []).length > 0 ? (
        <SectionCard flush className="mt-5" title={t("team.pending")}>
          <DataTable head={["Email", "Role", "Created", ""]}>
            {(invites.data ?? []).map((i) => (
              <Tr key={i.id}>
                <Td>{i.email}</Td>
                <Td><StatusPill tone="neutral">{i.role}</StatusPill></Td>
                <Td className="text-footnote text-muted">{timeAgo(i.created_at)}</Td>
                <Td>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => copy(`${window.location.origin}/accept-invite?token=${i.token}`)}
                    >
                      <Icon name={copied ? "check" : "link"} size={13} />
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </DataTable>
        </SectionCard>
      ) : null}

      <FormDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Invite team member"
        description="They set their own password from the link you share."
        icon="addUser"
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
        {role === "branch_manager" && (branches.data ?? []).length > 0 ? (
          <fieldset>
            <legend className="mb-1.5 text-body font-medium text-foreground">Branch access</legend>
            <div className="flex flex-col gap-1.5">
              {(branches.data ?? []).map((b) => (
                <CheckboxField
                  key={b.id}
                  label={b.name}
                  checked={branchIds.includes(b.id)}
                  onChange={(checked) =>
                    setBranchIds((prev) => (checked ? [...prev, b.id] : prev.filter((x) => x !== b.id)))
                  }
                />
              ))}
            </div>
          </fieldset>
        ) : null}
      </FormDialog>

      {inviteLink ? (
        <FormDialog
          isOpen
          onClose={() => setInviteLink(null)}
          title="Invite link"
          description="Share this with your teammate. It can be used once."
          icon="link"
          cancelLabel={t("common.done")}
        >
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Invite link"
              value={inviteLink}
              onFocus={(e) => e.currentTarget.select()}
              className="h-[28px] min-w-0 flex-1 rounded-field border border-field-border bg-field px-2.5 font-mono text-caption text-field-foreground outline-none focus:border-field-border-focus"
            />
            <Button size="sm" variant="outline" onPress={() => copy(inviteLink)}>
              <Icon name={copied ? "check" : "link"} size={13} />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
