import { useId } from "react";
import type { Album } from "../types/Album";

export type AlbumMetadata = Pick<Album, "condition" | "recordType" | "discSize">;

export function albumMetadata(value: AlbumMetadata, format: string): AlbumMetadata {
  const vinyl = format.startsWith("Vinyl");
  return {
    condition: value.condition || null,
    recordType: vinyl ? value.recordType || null : null,
    discSize: vinyl ? value.discSize || null : null
  };
}

const fields = [
  { key: "condition", label: "Condition", options: ["Mint", "Near Mint", "Very Good+", "Very Good", "Good", "Poor"] },
  { key: "recordType", label: "Record Type", options: ["LP", "EP", "Single", "Other"] },
  { key: "discSize", label: "Disc Size", options: ["7", "10", "12"] }
] as const;

export default function AlbumMetadataFields({ format, value, onChange, disabled }: {
  format: string;
  value: AlbumMetadata;
  onChange: (value: AlbumMetadata) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="album-form-row">
      {(format.startsWith("Vinyl") ? fields : fields.slice(0, 1)).map(({ key, label, options }) => (
        <div className="album-form-field" key={key}>
          <label htmlFor={id + key}>{label}</label>
          <select id={id + key} value={value[key] ?? ""} disabled={disabled}
            onChange={event => onChange({ ...value, [key]: event.target.value || null })}>
            <option value="">Not specified</option>
            {options.map(option => <option key={option} value={option}>{key === "discSize" ? `${option}″` : option}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
