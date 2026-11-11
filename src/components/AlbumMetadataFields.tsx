import { useId } from "react";
import type { Album } from "../types/Album";

export type AlbumMetadata = Pick<Album, "condition" | "recordType" | "discSize">;

const NOTES_LIMIT = 1000;

export function albumReleaseDraft(album?: Album) {
  return {
    releaseYear: album?.releaseYear?.toString() ?? "",
    originalReleaseYear: album?.originalReleaseYear?.toString() ?? "",
    dateAcquired: album?.dateAcquired ?? "",
    notes: album?.notes ?? ""
  };
}

type AlbumReleaseDraft = ReturnType<typeof albumReleaseDraft>;

export function albumReleaseMetadata(draft: AlbumReleaseDraft) {
  return {
    releaseYear: draft.releaseYear ? Number(draft.releaseYear) : null,
    originalReleaseYear: draft.originalReleaseYear ? Number(draft.originalReleaseYear) : null,
    dateAcquired: draft.dateAcquired || null,
    notes: draft.notes || null
  };
}

export function AlbumReleaseFields({ value, onChange, disabled }: {
  value: AlbumReleaseDraft;
  onChange: (value: AlbumReleaseDraft) => void;
  disabled: boolean;
}) {
  const id = useId();
  const years = [
    { key: "originalReleaseYear", label: "Original release year" },
    { key: "releaseYear", label: "Edition release year" }
  ] as const;

  return (
    <>
      <div className="album-form-row">
        {years.map(({ key, label }) => (
          <div className="album-form-field" key={key}>
            <label htmlFor={id + key}>{label}</label>
            <input id={id + key} type="number" min={1} max={9999} step={1}
              value={value[key]} disabled={disabled}
              onChange={event => onChange({ ...value, [key]: event.target.value })} />
          </div>
        ))}
      </div>
      <div className="album-form-field">
        <label htmlFor={id + "acquired"}>Date acquired</label>
        <input id={id + "acquired"} type="date" min="0001-01-01" max="9999-12-31"
          value={value.dateAcquired} disabled={disabled}
          onChange={event => onChange({ ...value, dateAcquired: event.target.value })} />
      </div>
      <div className="album-form-field">
        <label htmlFor={id + "notes"}>Notes</label>
        <textarea id={id + "notes"} rows={3} maxLength={NOTES_LIMIT} value={value.notes}
          disabled={disabled} aria-describedby={id + "count"}
          onChange={event => onChange({ ...value, notes: event.target.value })} />
        <small className="album-notes-count" id={id + "count"}>{value.notes.length} / 1,000 characters</small>
      </div>
    </>
  );
}

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
