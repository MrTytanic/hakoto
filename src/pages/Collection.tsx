
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Disc3, X, ImagePlus, UserRound } from "lucide-react";
import type { Profile } from "../types/Profile";
import type { Album } from "../types/Album";
import { albumFormats } from "../constants/albumFormats";
import AlbumCard from "../components/albumcard/AlbumCard";
import AlbumDetails from "../components/albumdetails/AlbumDetails";
import "./Collection.css";

type CollectionProps = {
  profile: Profile;
  albums: Album[];
  onAdd: (album: Album) => void;
  onUpdate: (album: Album) => void;
  onDelete: (id: string) => void;
  onNotify?: (message: string, type: "success" | "error") => void;
};

function Collection({
  profile,
  albums,
  onAdd,
  onUpdate,
  onDelete,
  onNotify
}: CollectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [format, setFormat] = useState("CD");
  const [releaseYear, setReleaseYear] = useState("");
  const [artwork, setArtwork] = useState<string | null>(null);

  // Tracks temporary artwork owned by the Add Album form.
  const ownedArtwork = useRef<string | null>(null);

  // Prevents duplicate submissions before React updates isSaving.
  const savingRef = useRef(false);

  const selectedAlbum = albums.find(album => album.id === selectedId);

  // Clean up abandoned artwork when Collection unmounts.
  useEffect(() => {
    return () => {
      if (ownedArtwork.current) {
        URL.revokeObjectURL(ownedArtwork.current);
      }
    };
  }, []);

  function notify(message: string, type: "success" | "error" = "error") {
    onNotify?.(message, type);
  }

  function handleArtwork(e: ChangeEvent<HTMLInputElement>) {
    if (savingRef.current) return;

    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      notify("Please select a PNG, JPG, or WebP image.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      notify("Artwork must be smaller than 5 MB.");
      return;
    }

    // Remove the previous unsaved preview, if any.
    if (ownedArtwork.current) {
      URL.revokeObjectURL(ownedArtwork.current);
    }

    const url = URL.createObjectURL(file);

    ownedArtwork.current = url;
    setArtwork(url);
  }

  function resetForm() {
    // Only revoke artwork still owned by this form.
    if (ownedArtwork.current) {
      URL.revokeObjectURL(ownedArtwork.current);
    }

    ownedArtwork.current = null;

    setTitle("");
    setArtist("");
    setFormat("CD");
    setReleaseYear("");
    setArtwork(null);
  }

  function closeAddModal() {
    if (savingRef.current) return;

    setIsModalOpen(false);
    resetForm();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (savingRef.current || !title.trim() || !artist.trim()) return;

    const album: Album = {
      id: crypto.randomUUID(),
      title: title.trim(),
      artist: artist.trim(),
      format,
      releaseYear,
      artwork,
      favorite: false
    };

    savingRef.current = true;
    setIsSaving(true);

    try {
      // Save album metadata to SQLite through Tauri.
      await invoke<number>("save_album", {
        id: album.id,
        title: album.title,
        artist: album.artist,
        format: album.format,
        releaseYear: album.releaseYear,

        // Blob URLs are temporary. Persistent artwork storage
        // will be implemented separately.
        artwork: null,

        favorite: album.favorite
      });
    } catch (error) {
      console.error("Failed to save album:", error);
      notify("Failed to save album. Please try again.", "error");
      return;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }

    // SQLite confirmed that the album was saved.
    onAdd(album);

    // Transfer artwork ownership to the collection.
    // This prevents resetForm() from deleting the image.
    ownedArtwork.current = null;

    resetForm();
    setIsModalOpen(false);

    notify(`"${album.title}" added to your collection.`, "success");
  }

  return (
    <div className="collection-page">
      <div className="collection-top">
        <div className="collection-header">
          <div className="collection-avatar">
            {profile.profilePicture ? (
              <img src={profile.profilePicture} alt="Profile" />
            ) : (
              <UserRound size={26} strokeWidth={1.5} />
            )}
          </div>

          <h1>
            {profile.displayName.trim()
              ? `${profile.displayName.trim()}'s Collection`
              : "Your Collection"}
          </h1>
        </div>

        <button
          type="button"
          className="collection-add"
          onClick={() => setIsModalOpen(true)}
        >
          <Plus size={17} />
          Add Album
        </button>
      </div>

      {albums.length === 0 ? (
        <div className="collection-empty">
          <Disc3 size={42} strokeWidth={1.2} />
          <h2>Your collection is empty</h2>
          <p>Start building your music collection by adding your first album.</p>

          <button type="button" onClick={() => setIsModalOpen(true)}>
            <Plus size={16} />
            Add Your First Album
          </button>
        </div>
      ) : (
        <div className="album-grid">
          {albums.map(album => (
            <AlbumCard
              key={album.id}
              album={album}
              onClick={() => setSelectedId(album.id)}
            />
          ))}
        </div>
      )}

      {selectedAlbum && (
        <AlbumDetails
          key={selectedAlbum.id}
          album={selectedAlbum}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={() => setSelectedId(null)}
        />
      )}

      {isModalOpen && (
        <div
          className="album-modal-overlay"
          onMouseDown={e => {
            if (e.target === e.currentTarget) closeAddModal();
          }}
        >
          <div
            className="album-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-album-title"
            aria-busy={isSaving}
          >
            <div className="album-modal-header">
              <h2 id="add-album-title">Add Album</h2>

              <button
                type="button"
                aria-label="Close"
                onClick={closeAddModal}
                disabled={isSaving}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <fieldset
                disabled={isSaving}
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <div className="album-form-field">
                  <label htmlFor="album-title">Album Title</label>
                  <input
                    id="album-title"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="album-form-field">
                  <label htmlFor="album-artist">Artist</label>
                  <input
                    id="album-artist"
                    value={artist}
                    onChange={e => setArtist(e.target.value)}
                    required
                  />
                </div>

                <div className="album-form-row">
                  <div className="album-form-field">
                    <label htmlFor="album-format">Format</label>
                    <select
                      id="album-format"
                      value={format}
                      onChange={e => setFormat(e.target.value)}
                    >
                      {albumFormats.map(item => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="album-form-field">
                    <label htmlFor="album-year">Release Year</label>
                    <input
                      id="album-year"
                      type="number"
                      min="1850"
                      max="2100"
                      value={releaseYear}
                      onChange={e => setReleaseYear(e.target.value)}
                    />
                  </div>
                </div>

                <div className="album-form-field">
                  <label htmlFor="album-artwork">Album Artwork</label>

                  <label
                    className="album-artwork-upload"
                    htmlFor="album-artwork"
                  >
                    {artwork ? (
                      <img src={artwork} alt="Artwork preview" />
                    ) : (
                      <>
                        <ImagePlus size={25} />
                        <span>Upload Cover Art</span>
                        <small>PNG, JPG, or WebP (max 5 MB)</small>
                      </>
                    )}
                  </label>

                  <input
                    id="album-artwork"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleArtwork}
                    hidden
                  />
                </div>

                <div className="album-modal-actions">
                  <button
                    type="button"
                    className="album-cancel"
                    onClick={closeAddModal}
                    disabled={isSaving}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="album-submit"
                    disabled={isSaving}
                  >
                    {isSaving ? "Saving..." : "Add to Collection"}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Collection;