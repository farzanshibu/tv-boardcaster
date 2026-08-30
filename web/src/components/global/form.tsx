"use client";

// SOT: form-primitives, labelled-inputs, select-field, segmented-control, toolbar-search
// WHAT:  typed, always-labelled form controls with macOS control metrics.
// WHY:   HeroUI exposes primitives; wiring label-to-input by hand in 13 views would
//        drift and break the WCAG requirement that every control has a label.
// HOW:   TextField/Select roots come from HeroUI, Label and Input are separate
//        components in v3 (not Field.Label), so this file is the single composition.
//        Sizing follows AppKit: 28px controls, 13px labels, 8px field radius.
// WHERE: HeroUI API notes in web/HEROUI-API-NOTES.md; tokens in src/app/globals.css

import {
  Input, Label, ListBox, ListBoxItem, Select, TextArea, TextField,
} from "@heroui/react";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/global/icon";

export function TextInput({
  label, value, onChange, placeholder, type = "text", onEnter, isDisabled, description,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "password" | "number" | "time" | "date" | "color";
  onEnter?: () => void;
  isDisabled?: boolean;
  description?: string;
}) {
  return (
    <TextField value={value} onChange={onChange} type={type} isDisabled={isDisabled ?? false} className="w-full">
      <Label>{label}</Label>
      <Input
        placeholder={placeholder ?? ""}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
      />
      {description ? <p className="mt-1 text-footnote text-muted">{description}</p> : null}
    </TextField>
  );
}

export function TextAreaInput({
  label, value, onChange, placeholder, rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <TextField value={value} onChange={onChange} className="w-full">
      <Label>{label}</Label>
      <TextArea placeholder={placeholder ?? ""} rows={rows} />
    </TextField>
  );
}

export interface Option {
  id: string;
  label: string;
}

export function SelectField({
  label, options, selected, onSelect, ariaLabel, isDisabled, className,
}: {
  label?: string;
  options: Option[];
  selected: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      aria-label={label ?? ariaLabel ?? "Select"}
      selectedKey={selected}
      onSelectionChange={(key) => onSelect(String(key))}
      isDisabled={isDisabled ?? false}
      className={className ?? "w-full"}
    >
      {label ? <Label>{label}</Label> : null}
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBoxItem key={o.id} id={o.id} textValue={o.label}>
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Two-column field row used across the sheets. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

/**
 * macOS segmented control: a pill track with the selected segment raised.
 * Use for 2 to 4 mutually exclusive options where showing them all beats hiding
 * them behind a dropdown.
 */
export function SegmentedControl<T extends string>({
  options, value, onChange, ariaLabel, className,
}: {
  options: { id: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 rounded-control bg-surface-secondary p-0.5 ring-1 ring-border/70 ${className ?? ""}`}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={`flex h-[24px] items-center gap-1.5 rounded-[4px] px-2.5 text-footnote font-medium transition-colors duration-150 ease-mac ${
              active
                ? "bg-surface text-foreground shadow-raised"
                : "text-muted hover:text-foreground"
            }`}
          >
            {o.icon ? <Icon name={o.icon} size={13} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Toolbar search field, as used in Finder and Mail: rounded well, leading glyph,
 * clear button once there is a query.
 */
export function SearchField({
  value, onChange, placeholder, ariaLabel, className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={`relative flex items-center ${className ?? "w-full max-w-[260px]"}`}>
      <Icon
        name="search"
        size={13}
        className="pointer-events-none absolute inset-inline-start-0 ms-2.5 text-subtle"
      />
      <input
        type="search"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-[28px] w-full rounded-field border border-field-border bg-field ps-8 pe-2.5 text-body text-field-foreground outline-none transition-colors duration-150 ease-mac placeholder:text-field-placeholder hover:border-field-border-hover focus:border-field-border-focus"
      />
    </div>
  );
}

/** Checkbox with a label, sized to the macOS control grid. */
export function CheckboxField({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-body text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[15px] shrink-0 accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );
}

/**
 * File well. The native file input is unstyleable across browsers, so this wraps
 * it in a dashed drop zone that reports the chosen filename.
 */
export function FileField({
  id, label, accept, inputRef, fileName, hint,
}: {
  id: string;
  label: string;
  accept?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  fileName?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body font-medium text-foreground">{label}</label>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-3 rounded-field border border-dashed border-field-border bg-field px-3.5 py-3 transition-colors duration-150 ease-mac hover:border-accent hover:bg-accent-soft/40"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-secondary text-muted">
          <Icon name="uploadCloud" size={16} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-body text-foreground">
            {fileName ?? "Choose a file"}
          </span>
          {hint ? <span className="block truncate text-footnote text-muted">{hint}</span> : null}
        </span>
      </label>
      <input id={id} ref={inputRef} type="file" accept={accept} className="sr-only" />
    </div>
  );
}
