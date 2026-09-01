"use client";

import {
  ROLES,
  ROLE_LABELS,
  USER_STATUS_LABELS,
  suggestPassword,
  type Role,
  type UserDto,
  type UserStatus,
} from "@finance/shared";
import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldAlert,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useSession } from "@/components/auth/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { BulkBar } from "@/components/ui/bulk-bar";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Pagination } from "@/components/ui/pagination";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
  TickCell,
  TickHead,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useBulkSelect } from "@/components/ui/use-bulk-select";
import { ApiError, trashApi } from "@/lib/api-client";
import { pageCount, serial } from "@/lib/pagination";
import { usersApi } from "@/lib/users";

/** What each role can actually do, in one line, at the moment you assign it. */
const ROLE_SUMMARY: Record<Role, string> = {
  super_admin: "Everything, including these accounts and Settings",
  ceo: "Sees everything. Changes nothing.",
  admin: "All the day-to-day work, but not Settings or accounts",
  finance: "Money, payroll and tax",
  hr: "The team directory. Never salary.",
  cfo: "The same as Admin. Money, payroll, tax and the challans.",
};

export function UsersPanel({ initialUsers }: { initialUsers: UserDto[] }) {
  const me = useSession();
  const toast = useToast();
  const [users, setUsers] = useState(initialUsers);
  const [page, setPage] = useState(1);
  /*
   * The whole set, not the rows on screen.
   *
   * The server component hands this panel `initialUsers` as a plain array, so
   * the envelope's `total` does not survive the prop — twenty rows arriving
   * could be twenty people or the first twenty of sixty, and the array cannot
   * say which. These start as what the seed can prove and are replaced by the
   * count the API reports on the first load below.
   */
  const [total, setTotal] = useState(initialUsers.length);
  const [totalPages, setTotalPages] = useState(() =>
    pageCount(initialUsers.length),
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [resetting, setResetting] = useState<UserDto | null>(null);
  const [deactivating, setDeactivating] = useState<UserDto | null>(null);
  const [deactivatePending, setDeactivatePending] = useState(false);
  /*
   * Ticking, and the one row that never gets a tick.
   *
   * The owner: *"problem nai tick bosao super admin e to remove korbe r CFO and
   * admin"* — the person doing the removing is a super admin, removing other
   * people, so a tick column here is safe.
   *
   * `bulkRows` is everyone EXCEPT the signed-in account, because the Delete
   * button on your own row is already withheld — deleting the sign-in you are
   * using is a locked door with the key inside. #4's rule is that a bulk action
   * can only ever offer what the single-row action already offers, so a header
   * tick meaning "every row on this page" must not quietly include the one row
   * whose button is missing.
   *
   * Nobody can empty the table either way: `assertSuperAdminRemains` refuses,
   * after the write and inside the transaction, any request that would leave no
   * active super admin at all.
   */
  const bulkRows = users.filter((user) => user.id !== me?.id);
  const bulk = useBulkSelect(bulkRows);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkAsking, setBulkAsking] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const del = useRowDelete<UserDto>({
    kind: "user",
    subject: "sign-in",
    describe: (user) => (
      <div className="flex flex-col">
        <span className="font-medium">{user.fullName}</span>
        <span className="text-xs text-muted-foreground">
          {user.email} · {user.role}
        </span>
      </div>
    ),
    consequences: (
      <p>
        They are signed out everywhere and the account leaves this list. What
        they did stays in{" "}
        <span className="font-medium text-foreground">
          Settings &rarr; What changed
        </span>{" "}
        — an audit trail that forgets who did something is not one. For
        somebody who has merely left,{" "}
        <span className="font-medium text-foreground">deactivate instead</span>:
        it closes the door just as firmly and is one click to undo.
      </p>
    ),
    onDone: () => void refresh(),
  });

  // Click Next twice quickly and two requests are in flight; the slower one
  // can answer last. Only the newest request is allowed to set the rows, so
  // page 1 cannot land on top of the page 2 you are looking at.
  const latest = useRef(0);

  const load = useCallback(async (target: number) => {
    const ticket = ++latest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await usersApi.list({ page: target });
      if (ticket !== latest.current) return;
      setUsers(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      if (ticket !== latest.current) return;
      setLoadError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the accounts.",
      );
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(page);
  }, [load, page]);

  /** Reload the page being looked at — an edit or a reset does not move a row. */
  async function refresh() {
    await load(page);
  }

  /**
   * After adding someone, show page one.
   *
   * The list is newest first, so a new account is the top row of page one —
   * which is not where you were standing if you were three pages deep, and an
   * admin who cannot see the person they just added tends to add them twice.
   */
  async function refreshFromFirstPage() {
    if (page === 1) {
      await load(1);
      return;
    }
    setPage(1); // the effect above fetches it
  }

  /**
   * The same change the edit drawer's Status field makes, one click sooner.
   *
   * It goes through `usersApi.update` with the status the Select submits, so
   * there is one code path that takes somebody's access away and one audit
   * trail behind it — the row button is a shortcut, not a second mechanism.
   */
  async function deactivate() {
    if (!deactivating) return;
    const { id, fullName } = deactivating;
    setDeactivatePending(true);
    try {
      await usersApi.update(id, { status: "disabled" });
      setDeactivating(null);
      await refresh();
      toast.show(`${fullName} can no longer sign in.`);
    } catch (caught) {
      toast.show(
        caught instanceof ApiError
          ? caught.message
          : "Could not disable that account.",
        "error",
      );
    } finally {
      setDeactivatePending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Who can sign in, and as what. A role decides what somebody sees and
          can change — the API enforces it, so a hidden menu is never the only
          thing standing between HR and a salary figure.
        </p>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Add someone
        </Button>
      </div>

      <Card className="overflow-hidden">
        <TableScroll>
          {/* Only once something is ticked; otherwise the panel is unchanged. */}
          <BulkBar
            count={bulk.count}
            noun="sign-in"
            pending={bulkPending}
            onClear={bulk.clear}
            onTrash={() => {
              setBulkError(null);
              setBulkAsking(true);
            }}
          />
          <table className="table-data min-w-[820px] text-sm">
            <thead>
              <tr>
                <TickHead state={bulk.headerState} onChange={bulk.allOnPage} />
                <SerialHead />
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Last signed in</Th>
                <Th>Email</Th>
                <RowActionsHead deletable />
              </tr>
            </thead>
            <tbody>
              {loadError ? (
                // A request that failed and a company with nobody in it are
                // different facts, and only one of them is reassuring.
                <TableMessageRow colSpan={8} tone="error">
                  {loadError}
                </TableMessageRow>
              ) : users.length === 0 ? (
                <TableMessageRow colSpan={8}>
                  {loading
                    ? "Loading…"
                    : total === 0
                      ? "Nobody can sign in yet."
                      : "Nothing on this page."}
                </TableMessageRow>
              ) : (
                users.map((user, index) => (
                  <tr key={user.id} className="row-finance">
                    {user.id === me?.id ? (
                      /* Your own row has no tick, because it has no Delete
                         button. An empty cell rather than a disabled tick: a
                         control you can see and cannot use invites the click
                         that teaches you it does nothing. */
                      <td />
                    ) : (
                      <TickCell
                        checked={bulk.isTicked(user.id)}
                        onChange={() => bulk.toggle(user.id)}
                        label={user.fullName}
                      />
                    )}
                    {/* Counted across pages: the first row of page two is 21,
                        not a second row wearing the number 1. */}
                    <SerialCell n={serial(page, index)} />
                    <td>
                      <span className="font-medium">{user.fullName}</span>
                      {user.id === me?.id ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          you
                        </span>
                      ) : null}
                      {user.mustChangePassword ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-warning">
                          <ShieldAlert className="size-3" />
                          must change password
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Badge
                        tone={
                          user.role === "super_admin" ? "primary" : "neutral"
                        }
                      >
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          user.status === "active"
                            ? "positive"
                            : user.status === "disabled"
                              ? "negative"
                              : "warning"
                        }
                      >
                        {USER_STATUS_LABELS[user.status]}
                      </Badge>
                    </td>
                    <td className="num text-muted-foreground">
                      {user.lastLoginAt
                        ? user.lastLoginAt.slice(0, 10)
                        : "never"}
                    </td>
                    <td className="text-muted-foreground">{user.email}</td>
                    <RowActions
                      onEdit={() => setEditing(user)}
                      second="deactivate"
                      // No handler where the action is not available — their
                      // own account, or one that is already disabled — so the
                      // button renders disabled rather than leaving a hole
                      // where every other row has controls.
                      onSecond={
                        user.id === me.id || user.status === "disabled"
                          ? undefined
                          : () => setDeactivating(user)
                      }
                      // Not your own account. Deleting the sign-in you are
                      // using is a locked door with the key inside, and the
                      // server refusing it afterwards is a worse way to find
                      // that out than the button never being live.
                      onDelete={user.id === me.id ? undefined : () => del.ask(user)}
                      extra={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-1.5"
                          onClick={() => setResetting(user)}
                          aria-label={`Set a new password for ${user.fullName}`}
                          title="Set a new password"
                        >
                          <KeyRound className="size-3.5" />
                        </Button>
                      }
                    />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      {/* A sibling of the card, never inside the empty branch above: the page
          with no rows on it is the page you most need the Previous button. */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="person"
        nounPlural="people"
        onPage={setPage}
      />

      <CreateUserForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await refreshFromFirstPage();
        }}
      />
      <EditUserForm
        user={editing}
        isSelf={editing?.id === me?.id}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
      <ResetPasswordForm
        user={resetting}
        onClose={() => setResetting(null)}
        onSaved={async () => {
          setResetting(null);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={deactivating !== null}
        title="Disable this account?"
        destructive
        confirmLabel="Deactivate"
        pending={deactivatePending}
        body={
          deactivating
            ? `${deactivating.fullName} is signed out everywhere at once and cannot sign in again until somebody sets their status back to Active.`
            : ""
        }
        onConfirm={deactivate}
        onCancel={() => setDeactivating(null)}
      />
      {del.dialog}

      {/*
        The ticked ones, together.

        All-or-nothing, like every other bulk trash here — and with one refusal
        the others do not have: `assertSuperAdminRemains` runs after the write
        and inside the transaction, so a selection that would leave no active
        super admin is refused and NOTHING moves. Before that guard, ticking two
        super admins deleted both, because the per-row check ran before either
        write and each still saw the other.
      */}
      <DeleteDialog
        open={bulkAsking}
        subject="sign-in"
        count={bulk.count}
        summary={
          <>
            {bulk.selected
              .slice(0, 5)
              .map((user) => user.fullName)
              .join(", ")}
            {bulk.count > 5 ? ` and ${bulk.count - 5} more` : ""}
          </>
        }
        consequences={
          <p>
            They can no longer sign in, and the trash can put them back. What
            they recorded stays exactly where it is — an entry belongs to the
            company, not to the account that typed it.
          </p>
        }
        pending={bulkPending}
        error={bulkError}
        onCancel={() => setBulkAsking(false)}
        onConfirm={(reason) => {
          setBulkPending(true);
          setBulkError(null);
          void trashApi
            .removeMany(
              "user",
              bulk.selected.map((user) => user.id),
              reason,
            )
            .then(() => {
              setBulkAsking(false);
              bulk.clear();
              void load(page);
            })
            .catch((err: unknown) =>
              setBulkError(
                err instanceof ApiError ? err.message : "That did not work.",
              ),
            )
            .finally(() => setBulkPending(false));
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A password field that suggests one and lets you copy it.
 *
 * Shown as plain text on purpose: the person setting it has to be able to read
 * it back to whoever it belongs to. Hiding it behind dots here would just mean
 * they type something they already use somewhere else.
 */
function PasswordField({
  name,
  label = "Password",
  error,
}: {
  name: string;
  label?: string;
  error?: string[];
}) {
  const [value, setValue] = useState(() => suggestPassword());
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the value is on screen and can be selected.
    }
  }

  return (
    <Field
      label={label}
      required
      error={error}
      hint="At least 12 characters. Hand this over once — they must change it when they first sign in."
    >
      <div className="flex gap-2">
        <Input
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="num"
          autoComplete="new-password"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => setValue(suggestPassword())}
        >
          New
        </Button>
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </Field>
  );
}

function RoleSelect({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: Role;
}) {
  const [role, setRole] = useState<Role>(defaultValue ?? "finance");

  return (
    <Field label="Role" required hint={ROLE_SUMMARY[role]}>
      <Select
        name={name}
        value={role}
        onChange={(event) => setRole(event.target.value as Role)}
      >
        {ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
    >
      {message}
    </p>
  );
}

/* -------------------------------------------------------------------------- */

function CreateUserForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      await usersApi.create({
        email: String(data.get("email") ?? "").trim(),
        fullName: String(data.get("fullName") ?? "").trim(),
        role: String(data.get("role")) as Role,
        password: String(data.get("password") ?? ""),
        mustChangePassword: true,
      });
      await onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not create that account.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Add someone">
      <form
        id="user-create"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Full name" required error={fieldErrors.fullName}>
          <Input name="fullName" autoFocus />
        </Field>
        <Field label="Email" required error={fieldErrors.email}>
          <Input name="email" type="email" autoComplete="off" />
        </Field>
        <RoleSelect name="role" />
        <PasswordField name="password" error={fieldErrors.password} />
        <ErrorNote message={error} />
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="user-create"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Create
        </Button>
      </div>
    </Drawer>
  );
}

function EditUserForm({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: UserDto | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!user) return;
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await usersApi.update(user.id, {
        fullName: String(data.get("fullName") ?? "").trim(),
        role: String(data.get("role")) as Role,
        status: String(data.get("status")) as UserStatus,
      });
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={user !== null}
      onClose={onClose}
      title={user ? user.fullName : ""}
    >
      {user ? (
        <form
          id="user-edit"
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          <Field label="Full name" required>
            <Input name="fullName" defaultValue={user.fullName} />
          </Field>

          <Field label="Email" hint="Fixed — create a new account to change it">
            <Input value={user.email} readOnly disabled />
          </Field>

          <RoleSelect name="role" defaultValue={user.role} />

          <Field
            label="Status"
            hint={
              isSelf
                ? "Careful: this is your own account."
                : "Disabling signs them out everywhere immediately."
            }
          >
            <Select name="status" defaultValue={user.status}>
              {Object.entries(USER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          {isSelf ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              Changing your own role or status takes effect at once. Lower your
              own role and you may not be able to undo it.
            </p>
          ) : null}

          <ErrorNote message={error} />
        </form>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="user-edit"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </Drawer>
  );
}

function ResetPasswordForm({
  user,
  onClose,
  onSaved,
}: {
  user: UserDto | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!user) return;
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      await usersApi.resetPassword(user.id, {
        newPassword: String(data.get("newPassword") ?? ""),
        mustChangePassword: true,
      });
      await onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not set that password.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={user !== null}
      onClose={onClose}
      title={user ? `New password for ${user.fullName}` : ""}
    >
      {user ? (
        <form id="user-pw" onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Every session for {user.email} ends the moment this is saved, and
            they will be asked to choose their own password when they next sign
            in.
          </p>
          <PasswordField
            name="newPassword"
            label="New password"
            error={fieldErrors.newPassword}
          />
          <ErrorNote message={error} />
        </form>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="user-pw"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Set password
        </Button>
      </div>
    </Drawer>
  );
}
