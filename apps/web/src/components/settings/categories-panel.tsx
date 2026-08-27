"use client";

import { CATEGORY_KIND_LABELS } from "@finance/shared";
import {
  ChevronRight,
  LoaderCircle,
  Plus,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select } from "@/components/ui/field";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { ApiError } from "@/lib/api-client";
import {
  categoriesApi,
  type CategoryDto,
  type CategoryNode,
} from "@/lib/masters";
import { cn } from "@/lib/utils";

/** A heading carries its children; one of the things under it does not. */
type Deletable = CategoryDto & { children?: CategoryDto[] };

type FormState =
  | { mode: "create-parent" }
  | { mode: "create-child"; parent: CategoryNode }
  | { mode: "edit"; category: CategoryDto }
  | null;

export function CategoriesPanel({
  initialTree,
}: {
  initialTree: CategoryNode[];
}) {
  const router = useRouter();
  const canWrite = useCan("categories.write");

  const [tree, setTree] = useState(initialTree);
  const [form, setForm] = useState<FormState>(null);

  async function refresh() {
    setTree(await categoriesApi.tree(true));
    router.refresh();
  }

  /*
   * The heading and the things under it go together, so the confirmation says
   * so by name before anybody agrees to it. A heading with nothing under it
   * must not claim otherwise, which is why this is written per row rather than
   * once for the kind.
   */
  const del = useRowDelete<Deletable>({
    kind: "category",
    subject: "category",
    describe: (row) => (
      <>
        <span className="font-medium text-foreground">{row.name}</span>
        <span className="text-muted-foreground">
          {" · "}
          {CATEGORY_KIND_LABELS[row.kind as keyof typeof CATEGORY_KIND_LABELS] ??
            row.kind}
        </span>
      </>
    ),
    consequences: (row) => {
      const children = row.children ?? [];
      return (
        <>
          {children.length > 0 ? (
            <>
              <p>
                {children.length === 1
                  ? "The one thing under this heading goes to the trash with it:"
                  : `All ${children.length} things under this heading go to the trash with it:`}
              </p>
              <ul className="mt-1.5 mb-2 flex flex-col gap-0.5">
                {children.map((child) => (
                  <li
                    key={child.id}
                    className="flex items-center gap-1 text-foreground"
                  >
                    <span className="text-muted-foreground">{row.name}</span>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{child.name}</span>
                  </li>
                ))}
              </ul>
              <p>
                Restoring the heading brings all of them back with it, exactly
                as they were.
              </p>
            </>
          ) : null}
          <p className={children.length > 0 ? "mt-2" : undefined}>
            Payments already filed here keep their amounts and every total stays
            the same — they simply read as Uncategorised until it is restored.
          </p>
        </>
      );
    },
    onDone: () => void refresh(),
  });

  const inGroups = tree.filter((node) => node.kind === "in");
  const outGroups = tree.filter((node) => node.kind !== "in");

  return (
    <>
      <Card>
        <CardHeader
          title="Categories"
          description="Two levels: a heading and the things under it"
          action={
            canWrite ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setForm({ mode: "create-parent" })}
              >
                <Plus className="size-3.5" />
                Add heading
              </Button>
            ) : null
          }
        />
        <CardBody className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            Deliberately not three levels — a third choice at the moment someone
            records a payment reliably produces money filed under the wrong
            heading.
          </p>

          <Group
            title="Money out"
            nodes={outGroups}
            canWrite={canWrite}
            onAddChild={(parent) => setForm({ mode: "create-child", parent })}
            onEdit={(category) => setForm({ mode: "edit", category })}
            onDelete={del.ask}
          />
          <Group
            title="Money in"
            nodes={inGroups}
            canWrite={canWrite}
            onAddChild={(parent) => setForm({ mode: "create-child", parent })}
            onEdit={(category) => setForm({ mode: "edit", category })}
            onDelete={del.ask}
          />
        </CardBody>
      </Card>

      <CategoryForm
        state={form}
        onClose={() => setForm(null)}
        onSaved={refresh}
      />
      {del.dialog}
    </>
  );
}

function Group({
  title,
  nodes,
  canWrite,
  onAddChild,
  onEdit,
  onDelete,
}: {
  title: string;
  nodes: CategoryNode[];
  canWrite: boolean;
  onAddChild: (parent: CategoryNode) => void;
  onEdit: (category: CategoryDto) => void;
  onDelete: (category: Deletable) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-3">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              "rounded-lg border border-border",
              !node.isActive && "opacity-55",
            )}
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ background: node.color }}
              />
              <span className="text-sm font-semibold">{node.name}</span>
              {!node.isActive ? <Badge>inactive</Badge> : null}
              <span className="ml-auto flex items-center gap-1">
                {canWrite ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onEdit(node)}
                    >
                      <SquarePen className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAddChild(node)}
                    >
                      <Plus className="size-3.5" />
                      Sub-category
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move to trash"
                      title={
                        node.children.length > 0
                          ? `Move to trash with its ${node.children.length} sub-categories`
                          : "Move to trash"
                      }
                      onClick={() => onDelete(node)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                ) : null}
              </span>
            </div>

            {node.children.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                No sub-categories — payments can still be filed under the
                heading itself.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-x-1 gap-y-1 px-3 py-3">
                {node.children.map((child) => (
                  <li key={child.id} className="group/chip flex items-center">
                    <button
                      type="button"
                      onClick={() => canWrite && onEdit(child)}
                      disabled={!canWrite}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-2 py-1 text-sm transition",
                        canWrite
                          ? "cursor-pointer hover:bg-surface-muted"
                          : "cursor-default",
                        !child.isActive && "opacity-55 line-through",
                      )}
                    >
                      <ChevronRight className="size-3 text-muted-foreground" />
                      {child.name}
                    </button>
                    {canWrite ? (
                      <button
                        type="button"
                        aria-label={`Move ${child.name} to trash`}
                        title={`Move ${child.name} to trash`}
                        onClick={() => onDelete(child)}
                        className="cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition hover:text-negative focus-visible:opacity-100 group-hover/chip:opacity-100"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CategoryForm({
  state,
  onClose,
  onSaved,
}: {
  state: FormState;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (!state) return null;

  const editing = state.mode === "edit";
  const existing = state.mode === "edit" ? state.category : undefined;
  const parent = state.mode === "create-child" ? state.parent : undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const color = String(data.get("color") ?? "#4f46e5");

    try {
      if (existing) {
        await categoriesApi.update(existing.id, {
          name,
          color,
          isActive: data.get("isActive") === "on",
        });
      } else {
        await categoriesApi.create({
          name,
          color,
          kind: parent
            ? (parent.kind as "in" | "out")
            : (String(data.get("kind") ?? "out") as "in" | "out"),
          parentId: parent?.id ?? null,
          sortOrder: 0,
        });
      }
      await onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not save.");
      }
    } finally {
      setPending(false);
    }
  }

  const title = editing
    ? "Edit category"
    : parent
      ? `Add under ${parent.name}`
      : "Add a heading";

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      description={
        editing
          ? "Which side of the ledger it sits on cannot change — that would reclassify everything already filed under it."
          : undefined
      }
    >
      <form
        id="category-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Name" required error={fieldErrors.name}>
          <Input name="name" defaultValue={existing?.name} required autoFocus />
        </Field>

        {!editing && !parent ? (
          <Field label="Side of the ledger" required>
            <Select name="kind" defaultValue="out">
              <option value="out">{CATEGORY_KIND_LABELS.out}</option>
              <option value="in">{CATEGORY_KIND_LABELS.in}</option>
            </Select>
          </Field>
        ) : null}

        {/* Sub-categories inherit the heading's colour so a chart slice and its
            breakdown always agree. */}
        {!parent && !existing?.parentId ? (
          <Field
            label="Colour"
            hint="Used in charts, shared with its sub-categories"
          >
            <input
              name="color"
              type="color"
              defaultValue={existing?.color ?? "#4f46e5"}
              className="h-10 w-20 cursor-pointer rounded-lg border border-border bg-surface-muted p-1"
            />
          </Field>
        ) : (
          <input
            type="hidden"
            name="color"
            value={parent?.color ?? existing?.color ?? "#4f46e5"}
          />
        )}

        {editing ? (
          <label className="flex items-center gap-2.5 text-sm">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={existing?.isActive}
              className="size-4 accent-primary"
            />
            Active — available when recording a payment
          </label>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="category-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {editing ? "Save changes" : "Add"}
        </Button>
      </div>
    </Drawer>
  );
}
