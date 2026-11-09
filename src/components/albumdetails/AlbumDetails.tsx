
import { useRef, useState, type FormEvent } from "react";
import { Disc3, Heart, Pencil, Trash2, X } from "lucide-react";
import type { Album } from "../../types/Album";
import { albumFormats } from "../../constants/albumFormats";
import "./AlbumDetails.css";

type AlbumDetailsProps = {
  album: Album;
  onUpdate: (album: Album) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
};

function AlbumDetails({
  album,
  onUpdate,
  onDelete,
  onClose
}: AlbumDetailsProps) {
  const [editing, setEditing] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Prevent duplicate requests before React rerenders.
  const savingRef = useRef(false);

  const [title, setTitle] = useState(album.title);
  const [artist, setArtist] = useState(album.artist);
  const [format, setFormat] = useState(album.format);
  const [releaseYear, setReleaseYear] = useState(album.releaseYear);

  function closeModal() {
    if (savingRef.current || showDeleteConfirmation) return;
    onClose();
  }

  async function saveChanges(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (savingRef.current || !title.trim() || !artist.trim()) return;

    savingRef.current = true;
    setIsSaving(true);

    try {
      await onUpdate({
        ...album,
        title: title.trim(),
        artist: artist.trim(),
        format,
        releaseYear
      });

      setEditing(false);
    } catch (error) {
      console.error("Failed to update album:", error);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  async function toggleFavorite() {
    if (savingRef.current) return;

    savingRef.current = true;
    setIsSaving(true);

    try {
      await onUpdate({
        ...album,
        favorite: !album.favorite
      });
    } catch (error) {
      console.error("Failed to update favorite:", error);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  async function deleteAlbum() {
    if (savingRef.current) return;

    savingRef.current = true;
    setIsSaving(true);

    try {
      await onDelete(album.id);
      onClose();
    } catch (error) {
      console.error("Failed to delete album:", error);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <div
      className="details-overlay"
      onMouseDown={e => {
        if (
          e.target === e.currentTarget &&
          !showDeleteConfirmation
        ) {
          closeModal();
        }
      }}
    >
      <div
        className="details-modal"
        role="dialog"
        aria-modal={!showDeleteConfirmation}
        aria-labelledby="details-title"
      >
        <div className="details-header">
          <h2 id="details-title">
            {editing ? "Edit Album" : "Album Details"}
          </h2>

          <button
            type="button"
            onClick={closeModal}
            aria-label="Close"
            disabled={isSaving || showDeleteConfirmation}
          >
            <X size={20} />
          </button>
        </div>

        {editing ? (
          <form onSubmit={saveChanges} className="details-form">
            <label htmlFor="edit-title">Album Title</label>
            <input
              id="edit-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={isSaving}
              required
            />

            <label htmlFor="edit-artist">Artist</label>
            <input
              id="edit-artist"
              value={artist}
              onChange={e => setArtist(e.target.value)}
              disabled={isSaving}
              required
            />

            <label htmlFor="edit-format">Format</label>
            <select
              id="edit-format"
              value={format}
              onChange={e => setFormat(e.target.value)}
              disabled={isSaving}
            >
              {albumFormats.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <label htmlFor="edit-year">Release Year</label>
            <input
              id="edit-year"
              type="number"
              min="1850"
              max="2100"
              value={releaseYear}
              onChange={e => setReleaseYear(e.target.value)}
              disabled={isSaving}
            />

            <div className="details-actions">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={isSaving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="details-primary"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="details-content">
              <div className="details-artwork">
                {album.artwork ? (
                  <img
                    src={album.artwork}
                    alt={`${album.title} cover`}
                  />
                ) : (
                  <Disc3 size={48} strokeWidth={1.2} />
                )}
              </div>

              <div className="details-information">
                <h3>{album.title}</h3>
                <p>{album.artist}</p>
                <span>{album.format}</span>

                {album.releaseYear && (
                  <span>{album.releaseYear}</span>
                )}
              </div>
            </div>

            <div className="details-actions">
              <button
                type="button"
                onClick={toggleFavorite}
                disabled={isSaving}
              >
                <Heart
                  size={16}
                  fill={album.favorite ? "currentColor" : "none"}
                  color={album.favorite ? "#fca5a5" : "currentColor"}
                />
                {isSaving
                  ? "Saving..."
                  : album.favorite
                    ? "Unfavorite"
                    : "Favorite"}
              </button>

              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={isSaving}
              >
                <Pencil size={16} />
                Edit
              </button>

              <button
                type="button"
                className="details-delete"
                onClick={() => setShowDeleteConfirmation(true)}
                disabled={isSaving}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      {showDeleteConfirmation && (
        <div className="delete-confirmation-overlay">
          <div
            className="delete-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirmation-title"
            aria-describedby="delete-confirmation-description"
          >
            <div className="delete-confirmation-icon">
              <Trash2 size={22} />
            </div>

            <h3 id="delete-confirmation-title">
              Delete Album?
            </h3>

            <p id="delete-confirmation-description">
              Are you sure you want to delete{" "}
              <strong>{album.title}</strong> from your collection?
              This action cannot be undone.
            </p>

            <div className="delete-confirmation-actions">
              <button
                type="button"
                onClick={() => setShowDeleteConfirmation(false)}
                disabled={isSaving}
              >
                Cancel
              </button>

              <button
                type="button"
                className="delete-confirm-button"
                onClick={deleteAlbum}
                disabled={isSaving}
              >
                {isSaving ? "Deleting..." : "Delete Album"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlbumDetails;