import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Profile } from "./types/Profile";
import type { Album } from "./types/Album";
import type { ToastData } from "./components/toast/Toast";
import "./App.css";

import Sidebar from "./components/sidebar/Sidebar";
import Toast from "./components/toast/Toast";
import Collection from "./pages/Collection";
import Shelves from "./pages/Shelves";
import Favorites from "./pages/Favorites";
import Wishlist from "./pages/Wishlist";
import Lists from "./pages/Lists";
import Statistics from "./pages/Statistics";
import Settings from "./pages/Settings";

function App() {
  const [activePage, setActivePage] = useState("Collection");

  const [profile, setProfile] = useState<Profile>({
    displayName: "",
    profilePicture: null
  });

  const [albums, setAlbums] = useState<Album[]>([]);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(true);

  const albumsRef = useRef(albums);
  albumsRef.current = albums;

  // Notifications
  const [notifications, setNotifications] = useState<ToastData[]>([]);
  const notificationTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function dismissNotification(id: string) {
    const timer = notificationTimers.current.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      notificationTimers.current.delete(id);
    }

    setNotifications(prev => prev.filter(item => item.id !== id));
  }

  function notify(message: string, type: "success" | "error" = "success") {
    const id = crypto.randomUUID();

    setNotifications(prev => [...prev, { id, message, type }]);

    const timer = setTimeout(() => {
      setNotifications(prev => prev.filter(item => item.id !== id));
      notificationTimers.current.delete(id);
    }, 4000);

    notificationTimers.current.set(id, timer);
  }

  // Cleanup notification timers when App unmounts.
  useEffect(() => {
    const timers = notificationTimers.current;

    return () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Load saved albums from SQLite on startup.
  useEffect(() => {
    let cancelled = false;

    async function loadAlbums() {
      try {
        const savedAlbums = await invoke<Album[]>("get_albums");

        if (!cancelled) {
          setAlbums(savedAlbums);
        }
      } catch (error) {
        console.error("Failed to load albums:", error);

        if (!cancelled) {
          notify("Failed to load your saved albums.", "error");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAlbums(false);
        }
      }
    }

    loadAlbums();

    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup previous profile pictures.
  useEffect(() => {
    return () => {
      if (profile.profilePicture?.startsWith("blob:")) {
        URL.revokeObjectURL(profile.profilePicture);
      }
    };
  }, [profile.profilePicture]);

  // Cleanup album artwork when App unmounts.
  useEffect(() => {
    return () => {
      albumsRef.current.forEach(album => {
        if (album.artwork?.startsWith("blob:")) {
          URL.revokeObjectURL(album.artwork);
        }
      });
    };
  }, []);

  function addAlbum(album: Album) {
    setAlbums(prev => [...prev, album]);
  }

 async function updateAlbum(updated: Album) {
  console.log("Updating album:", updated);
    const affectedRows = await invoke<number>("update_album", {
      id: updated.id,
      title: updated.title,
      artist: updated.artist,
      format: updated.format,
      releaseYear: updated.releaseYear,
      artwork: null,
      favorite: updated.favorite,
    });

    if (affectedRows === 0) {
      throw new Error("Album not found in database.");
    }

    setAlbums(prev =>
      prev.map(album => album.id === updated.id ? updated : album)
    );
  }

  async function deleteAlbum(id: string) {
  const album = albums.find(item => item.id === id);

  try {
    const affectedRows = await invoke<number>("delete_album", { id });

    if (affectedRows === 0) {
      throw new Error("Album not found in database.");
    }

    setAlbums(prev => prev.filter(item => item.id !== id));

    if (album?.artwork?.startsWith("blob:")) {
      URL.revokeObjectURL(album.artwork);
    }

    if (album) {
      notify(`"${album.title}" removed from your collection.`, "success");
    }
  } catch (error) {
    console.error("Failed to delete album:", error);
    notify("Failed to delete album. Please try again.", "error");
    throw error;
  }
}

  const pages: Record<string, React.ReactNode> = {
    Collection: (
      <Collection
        profile={profile}
        albums={albums}
        onAdd={addAlbum}
        onUpdate={updateAlbum}
        onDelete={deleteAlbum}
        onNotify={notify}
      />
    ),

    Shelves: <Shelves profile={profile} />,

    Favorites: (
      <Favorites
        profile={profile}
        albums={albums}
        onUpdate={updateAlbum}
        onDelete={deleteAlbum}
      />
    ),

    Wishlist: <Wishlist profile={profile} />,
    Lists: <Lists profile={profile} />,
    Statistics: <Statistics profile={profile} />,
    Settings: <Settings profile={profile} setProfile={setProfile} />
  };

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
      />

      <main className="main-content">
        {isLoadingAlbums ? (
          <div role="status" aria-live="polite">
            Loading your collection...
          </div>
        ) : (
          pages[activePage]
        )}
      </main>

      <Toast
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}

export default App;