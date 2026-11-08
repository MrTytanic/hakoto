
import { useState, type FormEvent } from "react";
import { Disc3, Heart, Pencil, Trash2, X } from "lucide-react";
import type { Album } from "../../types/Album";
import { albumFormats } from "../../constants/albumFormats";
import "./AlbumDetails.css";

type AlbumDetailsProps = {
  album: Album;
  onUpdate: (album: Album) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

function AlbumDetails({ album, onUpdate, onDelete, onClose }: AlbumDetailsProps) {
  const [editing, setEditing] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  const [title, setTitle] = useState(album.title);
  const [artist, setArtist] = useState(album.artist);
  const [format, setFormat] = useState(album.format);
  const [releaseYear, setReleaseYear] = useState(album.releaseYear);

  function saveChanges(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim() || !artist.trim()) return;

    onUpdate({
      ...album,
      title: title.trim(),
      artist: artist.trim(),
      format,
      releaseYear
    });

    setEditing(false);
  }

  function deleteAlbum() {
    onDelete(album.id);
    onClose();
  }

  return (
    <div
      className="details-overlay"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !showDeleteConfirmation) {
          onClose();
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
            onClick={onClose}
            aria-label="Close"
            disabled={showDeleteConfirmation}
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
              required
            />

            <label htmlFor="edit-artist">Artist</label>
            <input
              id="edit-artist"
              value={artist}
              onChange={e => setArtist(e.target.value)}
              required
            />

            <label htmlFor="edit-format">Format</label>
            <select
              id="edit-format"
              value={format}
              onChange={e => setFormat(e.target.value)}
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
            />

            <div className="details-actions">
              <button
                type="button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>

              <button type="submit" className="details-primary">
                Save Changes
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
                onClick={() =>
                  onUpdate({
                    ...album,
                    favorite: !album.favorite
                  })
                }
              >
                <Heart
                  size={16}
                  fill={album.favorite ? "currentColor" : "none"}
                  color={album.favorite ? "#fca5a5" : "currentColor"}
                />
                {album.favorite ? "Unfavorite" : "Favorite"}
              </button>

              <button
                type="button"
                onClick={() => setEditing(true)}
              >
                <Pencil size={16} />
                Edit
              </button>

              <button
                type="button"
                className="details-delete"
                onClick={() => setShowDeleteConfirmation(true)}
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
              >
                Cancel
              </button>

              <button
                type="button"
                className="delete-confirm-button"
                onClick={deleteAlbum}
              >
                Delete Album
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlbumDetails;