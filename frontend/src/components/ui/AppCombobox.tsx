import { useRef } from "react";
import AppSelect from "./AppSelect";

/** Free text with the same themed picker used by fixed-choice fields. */
export default function AppCombobox({ value, onChange, options, placeholder, className, label, id, disabled }: {
  value: string; onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  label: string; id?: string; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const choices = [...new Map(options.map(option => [option.id, option])).values()];
  return <span className="relative block min-w-0">
    <input ref={inputRef} id={id} aria-label={label} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value)} placeholder={placeholder} className={`${className || ""} pr-10`} />
    <AppSelect iconOnly aria-label={`${label}列表`} value="" disabled={disabled || !choices.length}
      onChange={event => { if (event.target.value) { onChange(event.target.value); requestAnimationFrame(() => inputRef.current?.focus()); } }}
      className="absolute inset-y-0 right-0 w-9 justify-center rounded-l-none border-0 bg-transparent p-0 pr-3 text-tx-secondary">
      <option value="" disabled>{placeholder || label}</option>
      {choices.map(option => <option key={option.id} value={option.id}>{option.name || option.id}</option>)}
    </AppSelect>
  </span>;
}
