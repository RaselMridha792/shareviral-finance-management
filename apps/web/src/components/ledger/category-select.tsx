"use client";

import type { CategoryKind } from "@finance/shared";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select } from "@/components/ui/field";
import {
  SearchableSelect,
  type SelectOption,
} from "@/components/ui/searchable-select";
import { ApiError } from "@/lib/api-client";
import { categoriesApi, type CategoryNode } from "@/lib/masters";

/**
 * The category box, with search and a way to add one without leaving the form.
 *
 * Headings and their children flatten into one searchable list. A heading is
 * selectable in its own right — filing something under "Office & premises" when
 * none of its children fit is a legitimate answer, and forcing a child would
 * only produce a junk one.
 *
 * Adding is a small form rather than a bare text box, because a category is
 * more than its name: which heading it belongs under decides where it shows up
 * in every report afterwards, and neither the parent nor the in/out side can be
 * changed later — doing so would silently reclassify every entry already filed
 * against it. So both are asked once, here, while the person still knows what
 * they meant.
 */
export function CategorySelect({
  name,
  value,
  onChange,
  categories,
  kind,
  onCreated,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  /** Already filtered to the side of the ledger the form is on. */
  categories: CategoryNode[];
  /** The side a newly created category is put on. */
  kind: CategoryKind;
  /** Hands back the whole tree so the caller can refresh its own copy. */
  onCreated?: (created: { id: string; name: string }) => void | Promise<void>;
  invalid?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState("");

  const options = useMemo<SelectOption[]>(() => {
    const rows: SelectOption[] = [];
    for (const group of categories) {
      rows.push({
        value: group.id,
        label: `${group.name} (general)`,
        group: group.name,
      });
      for (const child of group.children) {
        if (!child.isActive) continue;
        rows.push({ value: child.id, label: child.name, group: group.name });
      }
    }
    return rows;
  }, [categories]);

  return (
    <>
      <SearchableSelect
        name={name}
        value={value}
        onChange={onChange}
        options={options}
        invalid={invalid}
        placeholder="Choose a category"
        searchPlaceholder="Type to find a category…"
        emptyLabel="No category matches that."
        createLabel="Add a category"
        onCreate={(query) => {
          setPrefill(query);
          setAdding(true);
        }}
      />

      <NewCategoryDrawer
        open={adding}
        initialName={prefill}
        parents={categories}
        kind={kind}
        onClose={() => setAdding(false)}
        onCreated={async (created) => {
          setAdding(false);
          await onCreated?.(created);
          onChange(created.id);
        }}
      />
    </>
  );
}

/**
 * Creating a heading, from wherever somebody is when they find it missing.
 *
 * Exported because the Expenses screen's "add category" opens the same drawer
 * — a heading created from a transaction form and one created from the expense
 * overview must be the same thing, and two drawers asking for a name, a
 * parent and a colour would drift the first time one of them gained a field.
 */
export function NewCategoryDrawer({
  open,
  initialName,
  parents,
  kind,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialName: string;
  parents: CategoryNode[];
  kind: CategoryKind;
  onClose: () => void;
  onCreated: (created: { id: string; name: string }) => void | Promise<void>;
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
    const parentId = String(data.get("parentId") ?? "");

    try {
      const created = await categoriesApi.create({
        name: String(data.get("name")).trim(),
        // Empty means a new heading of its own rather than a child.
        parentId: parentId || null,
        kind,
        color: String(data.get("color")),
        sortOrder: 0,
      });
      await onCreated(created);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not add that category.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add a category"
      description="Where this heading sits decides where it appears in every report."
    >
      {/*
        Remounted on each open via `key`, so the fields carry whatever was
        typed into the search box that opened it and nothing from last time.
      */}
      <form
        key={`${open}-${initialName}`}
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Name" required error={fieldErrors.name}>
          <Input
            name="name"
            required
            autoFocus
            defaultValue={initialName}
            placeholder="Courier and postage"
          />
        </Field>

        <Field
          label="Under"
          error={fieldErrors.parentId}
          hint="Leave as a heading of its own only if nothing above fits — this cannot be changed later."
        >
          <Select name="parentId" defaultValue="">
            <option value="">A heading of its own</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Colour"
          error={fieldErrors.color}
          hint="Used in the charts."
        >
          <Input
            name="color"
            type="color"
            defaultValue="#4f46e5"
            className="h-10 w-20 p-1"
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            Add it
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
