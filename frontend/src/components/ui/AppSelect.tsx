import { forwardRef, useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size"> & {
  /** Compact picker beside an editable field, such as a custom model name. */
  iconOnly?: boolean;
};
type Choice = { value: string; label: string; disabled: boolean; group: string };
const encode = (value: string) => `value:${value}`;

/** Themed single-select. Retains native form values and existing change handlers. */
const AppSelect = forwardRef<HTMLSelectElement, Props>(function AppSelect(
  { className, children, id, title, style, iconOnly, tabIndex, ...props }, forwardedRef,
) {
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>();
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const native = nativeRef.current;
    if (!native) return;
    const next = Array.from(native.options, option => ({
      value: option.value, label: option.label,
      disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
      group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : "",
    }));
    setChoices(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    setSelected(native.value);
  });

  const groups: Array<{ label: string; items: Choice[] }> = [];
  for (const choice of choices) {
    const last = groups[groups.length - 1];
    if (last?.label === choice.group) last.items.push(choice);
    else groups.push({ label: choice.group, items: [choice] });
  }

  return <>
    <Select.Root value={encode(selected)} disabled={props.disabled} open={open} onOpenChange={next => {
      // Keep menus inside native modal dialogs, which make the rest of the body inert.
      setPortalContainer(triggerRef.current?.closest("dialog") || undefined);
      setOpen(next);
    }} onValueChange={encoded => {
      if (!encoded.startsWith("value:")) return;
      const native = nativeRef.current;
      if (!native) return;
      const value = encoded.slice("value:".length);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(native, value);
      native.dispatchEvent(new Event("change", { bubbles: true }));
      setSelected(native.value);
    }}>
      <Select.Trigger ref={triggerRef} id={id} title={title} style={style} tabIndex={tabIndex}
        aria-label={props["aria-label"] || title} aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]} aria-invalid={props["aria-invalid"]}
        data-app-select="" className={cn("inline-flex min-w-0 items-center justify-between gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-left text-sm text-tx-primary outline-none transition-colors hover:bg-app-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed disabled:opacity-50", className)}>
        {!iconOnly && <span className="min-w-0 flex-1 truncate"><Select.Value>{choices.find(choice => choice.value === selected)?.label || "\u00a0"}</Select.Value></span>}
        <Select.Icon className="ml-auto flex shrink-0 items-center text-tx-tertiary"><ChevronDown size={14} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal container={portalContainer}>
        <Select.Content position="popper" align={iconOnly ? "end" : "start"} sideOffset={5} collisionPadding={12}
          className={cn("z-[2147483000] w-[min(max(10rem,var(--radix-select-trigger-width)),calc(100vw-24px))] max-w-md overflow-hidden rounded-xl border border-app-border p-1 text-sm text-tx-primary shadow-xl", iconOnly && "w-[min(20rem,calc(100vw-24px))]")}
          onKeyDown={event => event.stopPropagation()}
          style={{ backgroundColor: "var(--color-elevated-solid)", maxHeight: "min(320px, var(--radix-select-content-available-height))" }}>
          <Select.ScrollUpButton className="flex h-5 items-center justify-center text-tx-secondary"><ChevronUp size={14} /></Select.ScrollUpButton>
          <Select.Viewport>
            {groups.map((group, groupIndex) => <Select.Group key={groupIndex}>
              {group.label && <Select.Label className="px-2.5 py-1.5 text-xs font-medium text-tx-tertiary">{group.label}</Select.Label>}
              {group.items.map((choice, index) => <Select.Item key={`${choice.value}:${index}`} value={encode(choice.value)} disabled={choice.disabled}
                className="relative flex min-h-9 cursor-default select-none items-center rounded-lg py-2 pl-2.5 pr-8 outline-none data-[highlighted]:bg-app-hover data-[state=checked]:text-accent-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-40">
                <Select.ItemText><span className="whitespace-normal break-words">{choice.label}</span></Select.ItemText>
                <Select.ItemIndicator className="absolute right-2.5"><Check size={14} /></Select.ItemIndicator>
              </Select.Item>)}
            </Select.Group>)}
          </Select.Viewport>
          <Select.ScrollDownButton className="flex h-5 items-center justify-center text-tx-secondary"><ChevronDown size={14} /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
    <select {...props} data-app-select-native="" ref={element => {
      nativeRef.current = element;
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    }} aria-hidden="true" tabIndex={-1} className="sr-only" style={{ display: "none" }}>{children}</select>
  </>;
});

export default AppSelect;
