import { useState, type ChangeEvent, type FormEvent } from "react";
import { Plus, Disc3, X, ImagePlus } from "lucide-react";
import type { Profile } from "../types/Profile";
import type { Album } from "../types/Album";
import "./Collection.css";

const formats = [
  "CD",
  "Vinyl (12-inch LP)",
  "Vinyl (10-inch)",
  "Vinyl (7-inch / Single)",
  "Cassette",
  "8-Track Cartridge",
  "MiniDisc",
  "SACD",
  "DVD-Audio",
  "Reel-to-Reel",
  "Flexi Disc",
  "Shellac (78 RPM)",
  "Other"
];

function Collection({ profile }: { profile: Profile }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [format, setFormat] = useState("CD");
  const [releaseYear, setReleaseYear] = useState("");
  const [artwork, setArtwork] = useState<string | null>(null);

  function handleArtwork(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      alert("Please select a PNG, JPG, or WebP image.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Artwork must be smaller than 5 MB.");
      return;
    }

    setArtwork(URL.createObjectURL(file));
    e.target.value = "";
  }

  function resetForm() {
    setTitle("");
    setArtist("");
    setFormat("CD");
    setReleaseYear("");
    setArtwork(null);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim() || !artist.trim()) return;

    const album: Album = {
      id: crypto.randomUUID(),
      title: title.trim(),
      artist: artist.trim(),
      format,
      releaseYear,
      artwork
    };

    setAlbums(prev => [...prev, album]);
    resetForm();
    setIsModalOpen(false);
  }

  return (
    <div className="collection-page">
      <div className="collection-top">
        <div className="collection-header">
          <div className="collection-avatar">
            {profile.profilePicture
              ? <img src={profile.profilePicture} alt="Profile" />
              : <Disc3 size={26} strokeWidth={1.5} />}
          </div>

          <h1>
            {profile.displayName.trim()
              ? `${profile.displayName.trim()}'s Collection`
              : "Your Collection"}
          </h1>
        </div>

        <button
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
          <button onClick={() => setIsModalOpen(true)}>
            <Plus size={16} /> Add Your First Album
          </button>
        </div>
      ) : (
        <div className="album-grid">
          {albums.map(album => (
            <div className="album-card" key={album.id}>
              <div className="album-artwork">
                {album.artwork
                  ? <img src={album.artwork} alt={`${album.title} cover`} />
                  : <Disc3 size={40} strokeWidth={1.2} />}
              </div>

              <h3>{album.title}</h3>
              <p>{album.artist}</p>
              <span>{album.format}</span>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div
          className="album-modal-overlay"
          onMouseDown={e => {
            if (e.target === e.currentTarget) {
              setIsModalOpen(false);
            }
          }}
        >
          <div className="album-modal" role="dialog" aria-modal="true" aria-labelledby="add-album-title">
            <div className="album-modal-header">
              <h2 id="add-album-title">Add Album</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setIsModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
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
                    {formats.map(item => (
                      <option key={item} value={item}>{item}</option>
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
                <label className="album-artwork-upload" htmlFor="album-artwork">
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
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>

                <button type="submit" className="album-submit">
                  Add to Collection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Collection;