"use client";

// SOT: form-primitives, labelled-inputs, select-field
// WHAT:  typed, always-labelled form controls composed from HeroUI + React Aria.
// WHY:   HeroUI exposes primitives; wiring label-to-input by hand in 13 views would
//        drift and break the WCAG requirement that every control has a label.
// HOW:   TextField/Select roots come from HeroUI, Label and Input are separate
//        components in v3 (not Field.Label), so this file is the single composition.
// WHERE: HeroUI API notes in web/HEROUI-API-NOTES.md

import {
  Input, Label, ListBox, ListBoxItem, Select, TextArea, TextField,
} from "@heroui/react";
import type { ReactNode } from "react";

export function TextInput({
  label, value, onChange, placeholder, type = "text", onEnter, isDisabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "password" | "number" | "time" | "date" | "color";
  onEnter?: () => void;
  isDisabled?: boolean;
}) {
  return (
    <TextField value={value} onChange={onChange} type={type} isDisabled={isDisabled ?? false} className="w-full">
      <Label>{label}</Label>
      <Input
        placeholder={placeholder ?? ""}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
      />
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

/** Two-column field row used across the modals. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}
