import { Grid2X2, List } from "lucide-react";
import type { CollectionSort } from "../collectionView";
import type { CollectionViewPreference } from "../settings";

export function CollectionSortSelect({ id, sort, onChange, disabled, description }: {
  id: string;
  sort: CollectionSort;
  onChange: (sort: CollectionSort) => void;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <div className="album-form-field">
      <label htmlFor={id}>Sort by</label>
      <select id={id} value={sort} disabled={disabled} aria-describedby={description}
        onChange={event => onChange(event.target.value as CollectionSort)}>
        <option value="collection">Date added</option>
        <option value="title-asc">Title A–Z</option>
        <option value="title-desc">Title Z–A</option>
        <option value="year-newest">Release year (newest)</option>
        <option value="year-oldest">Release year (oldest)</option>
      </select>
    </div>
  );
}

export function CollectionViewToggle({ label, view, onChange }: {
  label: string;
  view: CollectionViewPreference;
  onChange: (view: CollectionViewPreference) => void;
}) {
  return (
    <div className="collection-view-toggle" role="group" aria-label={label}>
      <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => onChange("grid")}>
        <Grid2X2 size={17} aria-hidden="true" />
      </button>
      <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => onChange("list")}>
        <List size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

export function AlbumFormatOptions({ options, formats, onToggle }: {
  options: readonly string[];
  formats: readonly string[];
  onToggle: (format: string, checked: boolean) => void;
}) {
  return (
    <fieldset className="album-format-options">
      <legend>Formats</legend>
      {options.map(format => (
        <label key={format}>
          <input type="checkbox" checked={formats.includes(format)} onChange={event => onToggle(format, event.target.checked)} />
          {format || "Format undecided"}
        </label>
      ))}
    </fieldset>
  );
}
