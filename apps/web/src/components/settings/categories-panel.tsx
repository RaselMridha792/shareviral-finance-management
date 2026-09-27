"use client";

import { ArrowDownLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowDownLeft";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { TagIcon } from "@phosphor-icons/react/dist/ssr/Tag";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { CATEGORY_KIND_LABELS } from "@finance/shared";
import { ChevronRight, LoaderCircle } from "lucide-react";
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
          icon={TagIcon}
          description="Two levels: a heading and the things under it"
          action={
            canWrite ? (
              <Button
                size="md"
                variant="primary"
                className="gap-1.75 px-3.25 text-[13px]"
                onClick={() => setForm({ mode: "create-parent" })}
              >
                <PlusIcon weight="duotone" size={15} />
                Add heading
              </Button>
            ) : null
          }
        />
        <CardBody className="flex flex-col gap-2.5 px-5 py-4">
          <p className="text-[13px] text-(--sv-muted)">
            Deliberately not three levels — a third choice at the moment someone
            records a payment reliably produces money filed under the wrong
            heading.
          </p>

          <Group
            title="Money out"
            side="out"
            nodes={outGroups}
            canWrite={canWrite}
            onAddChild={(parent) => setForm({ mode: "create-child", parent })}
            onEdit={(category) => setForm({ mode: "edit", category })}
            onDelete={del.ask}
          />
          <Group
            title="Money in"
            side="in"
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

/**
 * A 30px icon tile in a heading's top row: the subtle ground, tinted under the
 * pointer.
 */
const TILE =
  "grid size-7.5 shrink-0 cursor-pointer place-items-center rounded-lg bg-(--sv-subtle) transition-colors duration-300";

function Group({
  title,
  side,
  nodes,
  canWrite,
  onAddChild,
  onEdit,
  onDelete,
}: {
  title: string;
  side: "in" | "out";
  nodes: CategoryNode[];
  canWrite: boolean;
  onAddChild: (parent: CategoryNode) => void;
  onEdit: (category: CategoryDto) => void;
  onDelete: (category: Deletable) => void;
}) {
  if (nodes.length === 0) return null;

  const SideIcon = side === "in" ? ArrowDownLeftIcon : ArrowUpRightIcon;

  return (
    <section className="flex flex-col gap-2.5">
      <h3
        className={cn(
          "flex items-center gap-2 text-[11px] font-extrabold tracking-[0.14em] uppercase",
          side === "in" ? "mt-2.5 text-(--sv-pos)" : "mt-1.5 text-(--sv-neg)",
        )}
      >
        <SideIcon weight="duotone" size={15} />
        {title}
      </h3>
      {nodes.map((node) => (
        <div
          key={node.id}
          className={cn(
            // `sv-chip` is only the 1px line edge — a border-colour utility
            // would lose to globals.css's `* { border-color }`. `sv-chip-hover`
            // turns that edge violet-soft under the pointer, as the handoff does.
            "sv-chip sv-chip-hover overflow-hidden rounded-[11px]",
            !node.isActive && "opacity-55",
          )}
        >
          <div className="flex items-center gap-2.5 bg-(--sv-subtle) px-3.5 py-2.75">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: node.color }}
            />
            <span className="min-w-0 text-[14.5px] font-extrabold">
              {node.name}
            </span>
            {!node.isActive ? <Badge>inactive</Badge> : null}
            <span className="ml-auto flex items-center gap-2.5">
              {canWrite ? (
                <>
                  <button
                    type="button"
                    title="Edit"
                    aria-label={`Edit ${node.name}`}
                    onClick={() => onEdit(node)}
                    className={cn(
                      TILE,
                      "text-(--sv-violet) hover:bg-(--sv-violet-tint)",
                    )}
                  >
                    <PencilSimpleIcon weight="duotone" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddChild(node)}
                    className="sv-button-quiet inline-flex h-7.5 shrink-0 cursor-pointer items-center gap-1.25 rounded-lg bg-(--sv-surface) px-2.5 text-xs font-extrabold"
                  >
                    <PlusIcon
                      weight="duotone"
                      size={13}
                      className="text-(--sv-violet)"
                    />
                    Sub-category
                  </button>
                  <button
                    type="button"
                    aria-label="Move to trash"
                    title={
                      node.children.length > 0
                        ? `Move to trash with its ${node.children.length} sub-categories`
                        : "Move to trash"
                    }
                    onClick={() => onDelete(node)}
                    className={cn(
                      TILE,
                      "text-(--sv-neg) hover:bg-(--sv-neg-tint)",
                    )}
                  >
                    <TrashIcon weight="duotone" size={14} />
                  </button>
                </>
              ) : null}
            </span>
          </div>

          {node.children.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[13px] text-(--sv-muted)">
              No sub-categories — payments can still be filed under the heading
              itself.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5 px-3.5 py-2.75">
              {node.children.map((child) => (
                <li key={child.id} className="group/chip relative flex">
                  <button
                    type="button"
                    onClick={() => canWrite && onEdit(child)}
                    disabled={!canWrite}
                    className={cn(
                      "sv-chip rounded-full bg-(--sv-surface) px-2.75 py-1.25 text-[13px] transition-colors duration-200",
                      canWrite
                        ? "cursor-pointer hover:bg-(--sv-violet-tint) hover:text-(--sv-violet-ink)"
                        : "cursor-default",
                      !child.isActive && "line-through opacity-55",
                    )}
                  >
                    {child.name}
                  </button>
                  {/* On the pill's corner rather than inside it, so showing
                      it under the pointer never re-wraps the row. */}
                  {canWrite ? (
                    <button
                      type="button"
                      aria-label={`Move ${child.name} to trash`}
                      title={`Move ${child.name} to trash`}
                      onClick={() => onDelete(child)}
                      className="sv-chip absolute -top-1.5 -right-1.5 grid size-4.5 cursor-pointer place-items-center rounded-full bg-(--sv-surface) text-(--sv-neg) opacity-0 transition hover:bg-(--sv-neg-tint) focus-visible:opacity-100 group-hover/chip:opacity-100"
                    >
                      <TrashIcon weight="duotone" size={10} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
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
