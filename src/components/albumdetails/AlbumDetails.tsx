
import { useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { Disc3, Heart, Pencil, Trash2, X } from "lucide-react";
import type { Album } from "../../types/Album";
import { albumFormats } from "../../constants/albumFormats";
import { artworkUrl, encodeArtwork, type ArtworkChange } from "../../artwork";
import { ArtworkImage, ArtworkPicker } from "../Artwork";
import { findDuplicateAlbum } from "../../duplicateAlbums";
import AlbumMetadataFields, { AlbumReleaseFields, albumMetadata, albumReleaseDraft, albumReleaseMetadata } from "../AlbumMetadataFields";
import Modal from "../Modal";
import "./AlbumDetails.css";

type AlbumDetailsProps = {
  album: Album;
  albums: readonly Album[];
  initialAction?: "edit" | "delete";
  onUpdate: (album: Album, artwork?: ArtworkChange) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  fallbackFocus: RefObject<HTMLElement | null>;
};

function AlbumDetails({
  album,
  albums,
  initialAction,
  onUpdate,
  onDelete,
  onClose,
  fallbackFocus
}: AlbumDetailsProps) {
  const wishlist = album.ownership === "wishlist";
  const [editing, setEditing] = useState(initialAction === "edit");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(initialAction === "delete");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const editTitle = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  // Prevent duplicate requests before React rerenders.
  const savingRef = useRef(false);

  const [title, setTitle] = useState(album.title);
  const [artist, setArtist] = useState(album.artist);
  const [format, setFormat] = useState(album.format);
  const [release, setRelease] = useState(() => albumReleaseDraft(album));

  const [metadata, setMetadata] = useState(() => albumMetadata(album));

  const duplicate = useMemo(() => editing && findDuplicateAlbum(albums, { id: album.id, title, artist, format }),
    [editing, albums, album.id, title, artist, format]);

  const [artwork, setArtwork] = useState<File | null>();

  function startEditing() {
    setError("");
    setTitle(album.title);
    setArtist(album.artist);
    setFormat(album.format);
    setRelease(albumReleaseDraft(album));
    setMetadata(albumMetadata(album));
    setArtwork(undefined);
    setEditing(true);
    requestAnimationFrame(() => editTitle.current?.focus());
  }

  function finishEditing() {
    setError("");
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  function closeModal() {
    if (savingRef.current || showDeleteConfirmation) return;
    onClose();
  }

  function closeDeleteConfirmation() {
    if (savingRef.current) return;
    setError("");
    setShowDeleteConfirmation(false);
  }

  async function saveChanges(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (savingRef.current) return;
    if (!title.trim() || !artist.trim()) {
      setError("Enter an album title and artist.");
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setError("");

    try {
      let change: ArtworkChange | undefined;
      if (artwork === null) {
        change = { kind: "remove" };
      } else if (artwork) {
        change = { kind: "replace", bytes: await encodeArtwork(artwork) };
      }

      await onUpdate({
        ...album,
        title: title.trim(),
        artist: artist.trim(),
        format,
        ...albumReleaseMetadata(release),
        ...albumMetadata(metadata, format === album.format ? undefined : format)
      }, change);

      finishEditing();
    } catch (error) {
      setError(`Couldn’t save changes. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  async function toggleFavorite() {
    if (savingRef.current) return;

    savingRef.current = true;
    setIsSaving(true);
    setError("");

    try {
      await onUpdate({
        ...album,
        favorite: !album.favorite
      });
    } catch (error) {
      setError(`Couldn’t update favorite. ${String(error)}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  async function deleteAlbum() {
    if (savingRef.current) return;

    savingRef.current = true;
    setIsSaving(true);
    setError("");

    try {
      await onDelete(album.id);
      onClose();
    } catch (error) {
      setError(`Couldn’t delete this album. ${String(error)}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <>
      <Modal
        className="details-modal"
        aria-labelledby="details-title"
        aria-busy={isSaving && !showDeleteConfirmation}
        fallbackFocus={fallbackFocus}
        onDismiss={closeModal}
        dismissOnBackdrop
      >
        <div className="details-header">
          <h2 className="section-title" id="details-title">
            {editing ? "Edit Album" : "Album Details"}
          </h2>

          <button
            type="button"
            onClick={closeModal}
            className="modal-close"
            aria-label="Close album details"
            disabled={isSaving || showDeleteConfirmation}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {editing ? (
          <form onSubmit={saveChanges} className="details-form">
            <label htmlFor="edit-title">Album Title</label>
            <input
              id="edit-title"
              maxLength={500}
              ref={editTitle}
              data-initial-focus
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={isSaving}
              required
            />

            <label htmlFor="edit-artist">Artist</label>
            <input
              id="edit-artist"
              maxLength={300}
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
              {wishlist && <option value="">Format undecided</option>}
              {!albumFormats.includes(album.format) && (!wishlist || album.format) && <option value={album.format}>{album.format}</option>}
              {albumFormats.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            {duplicate && <p className="duplicate-warning" role="status">An album with this title, artist, and format already exists. You can still save another copy or edition.</p>}
            <AlbumMetadataFields format={format} value={metadata} onChange={setMetadata} disabled={isSaving} />
            <p className="album-date-note">Date added: {album.dateAdded ?? "Unknown"}</p>
            <AlbumReleaseFields value={release} onChange={setRelease} disabled={isSaving} wishlist={wishlist} />

            <ArtworkPicker
              artwork={artwork}
              filename={album.artwork}
              disabled={isSaving}
              onChange={setArtwork}
              onError={setError}
            />

            {error && <p className="app-modal-error" role="alert">{error}</p>}
            <div className="details-actions">
              <button
                type="button"
                onClick={finishEditing}
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
                <ArtworkImage
                  src={artworkUrl(album.artwork)}
                  alt={`Cover art for ${album.title} by ${album.artist}`}
                  fallback={<Disc3 size={48} strokeWidth={1.2} aria-hidden="true" />}
                />
              </div>

              <div className="details-information">
                <h3>{album.title}</h3>
                <p>{album.artist}</p>
                <span>{album.format || "Format undecided"}</span>

                {album.condition && <span>{album.condition}</span>}
                {album.recordType && <span>{album.recordType}</span>}
                {album.discSize && <span>{album.discSize}″</span>}
                {album.dateAdded && <span>Added {album.dateAdded}</span>}
                {album.dateAcquired && <span>Acquired {album.dateAcquired}</span>}
                {album.originalReleaseYear && <span>Original release {album.originalReleaseYear}</span>}
                {album.releaseYear && <span>Edition release {album.releaseYear}</span>}
              </div>
            </div>

            {album.notes && <p className="details-notes"><strong>Notes</strong><br />{album.notes}</p>}

            {error && !showDeleteConfirmation && <p className="app-modal-error" role="alert">{error}</p>}
            <div className="details-actions">
              {!wishlist && <button
                type="button"
                onClick={toggleFavorite}
                disabled={isSaving}
              >
                <Heart
                  size={16}
                  aria-hidden="true"
                  fill={album.favorite ? "currentColor" : "none"}
                  color={album.favorite ? "var(--danger)" : "currentColor"}
                />
                {isSaving
                  ? "Saving..."
                  : album.favorite
                    ? "Unfavorite"
                    : "Favorite"}
              </button>}

              <button
                type="button"
                ref={editButton}
                onClick={startEditing}
                disabled={isSaving}
              >
                <Pencil size={16} aria-hidden="true" />
                Edit
              </button>

              <button
                type="button"
                className="details-delete"
                onClick={() => { setError(""); setShowDeleteConfirmation(true); }}
                disabled={isSaving}
              >
                <Trash2 size={16} aria-hidden="true" />
                Delete
              </button>
            </div>
          </>
        )}
      </Modal>

      {showDeleteConfirmation && (
        <Modal
          className="delete-confirmation"
          role="alertdialog"
          aria-labelledby="delete-confirmation-title"
          aria-describedby="delete-confirmation-description"
          aria-busy={isSaving}
          onDismiss={closeDeleteConfirmation}
        >
          <div className="delete-confirmation-icon" aria-hidden="true">
            <Trash2 size={22} />
          </div>

          <h3 className="section-title" id="delete-confirmation-title">
            Delete Album?
          </h3>

          <p id="delete-confirmation-description">
            Are you sure you want to delete{" "}
            <strong>{album.title}</strong> from your {wishlist ? "wishlist" : "collection"}?
          </p>

          {error && <p className="app-modal-error" role="alert">{error}</p>}
          <div className="delete-confirmation-actions">
            <button
              type="button"
              data-initial-focus
              onClick={closeDeleteConfirmation}
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
        </Modal>
      )}
    </>
  );
}

export default AlbumDetails;
