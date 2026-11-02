import AppCombobox from "@/components/ui/AppCombobox";

/** A themed dropdown and an editable model name, including custom names. */
export default function ModelNameInput({ value, onChange, models, placeholder, className, label = "模型" }: {
  value: string; onChange: (value: string) => void; models: Array<{id:string;name:string}>;
  placeholder?: string; className?: string; label?: string;
}) {
  return <AppCombobox value={value} onChange={onChange} options={models} placeholder={placeholder} className={className} label={label} />;
}
