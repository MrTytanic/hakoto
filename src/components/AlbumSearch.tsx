import type { RefObject } from "react";
import { Search, X } from "lucide-react";

export default function AlbumSearch({ id, label = "Search albums", query, onChange, inputRef, disabled = false }: {
  id: string;
  label?: string;
  query: string;
  onChange: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}) {
  return (
    <div className="album-form-field collection-search">
      <label htmlFor={id}>{label}</label>
      <div className="collection-search-input">
        <Search className="collection-search-icon" size={16} aria-hidden="true" />
        <input id={id} type="search" ref={inputRef} value={query} disabled={disabled}
          onChange={event => onChange(event.target.value)} placeholder="Title or artist" />
        {query && !disabled && (
          <button type="button" aria-label="Clear search" onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}><X size={16} aria-hidden="true" /></button>
        )}
      </div>
    </div>
  );
}
