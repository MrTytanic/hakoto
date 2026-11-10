import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Profile, ProfileLoadStatus } from "./types/Profile";
import { encodeArtwork, type ArtworkChange } from "./artwork";
import type { Album } from "./types/Album";
import type { ToastData } from "./components/toast/Toast";
import { alphabeticalDividersPreference, animationsPreference, textScalePreference, resolveTheme, systemThemeQuery, themePreference, type ThemePreference } from "./settings";
import "./App.css";

import Sidebar from "./components/Sidebar/Sidebar";
import Toast from "./components/toast/Toast";
import Collection, { CollectionLoadError, type AlbumLoadStatus } from "./pages/Collection";
import Shelves from "./pages/Shelves";
import Favorites from "./pages/Favorites";
import Wishlist from "./pages/Wishlist";
import Lists from "./pages/Lists";
import Statistics from "./pages/Statistics";
import Settings from "./pages/Settings";

function App() {
  const [activePage, setActivePage] = useState("Collection");
  const [theme, setTheme] = useState(themePreference.read);
  const [textScale, setTextScale] = useState(textScalePreference.read);
  const [animations, setAnimations] = useState(animationsPreference.read);
  useLayoutEffect(() => {
    document.documentElement.dataset.textScale = textScale;
    document.documentElement.dataset.animations = animations;
    textScalePreference.write(textScale);
    animationsPreference.write(animations);
  }, [textScale, animations]);
  const [alphabeticalDividers, setAlphabeticalDividers] = useState(() => alphabeticalDividersPreference.read() === "on");

  useLayoutEffect(() => {
    const systemTheme = window.matchMedia(systemThemeQuery);

    function applyTheme() {
      document.documentElement.dataset.theme = resolveTheme(theme, systemTheme.matches);
    }

    applyTheme();
    if (theme === "system") {
      systemTheme.addEventListener("change", applyTheme);
      return () => systemTheme.removeEventListener("change", applyTheme);
    }
  }, [theme]);

  function changeTheme(preference: ThemePreference) {
    themePreference.write(preference);
    setTheme(preference);
  }

  function changeAlphabeticalDividers(enabled: boolean) {
    alphabeticalDividersPreference.write(enabled ? "on" : "off");
    setAlphabeticalDividers(enabled);
  }

  const [profile, setProfile] = useState<Profile>({
    displayName: "",
    profilePicture: null
  });
  const [profileLoadStatus, setProfileLoadStatus] = useState<ProfileLoadStatus>("loading");
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const profileNameWrites = useRef(Promise.resolve(""));
  const [isSavingPicture, setIsSavingPicture] = useState(false);
  const savingPicture = useRef(false);

  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumLoadStatus, setAlbumLoadStatus] = useState<AlbumLoadStatus>("loading");
  const [albumLoadAttempt, setAlbumLoadAttempt] = useState(0);

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
          setAlbumLoadStatus("ready");
        }
      } catch (error) {
        console.error("Failed to load albums:", error);

        if (!cancelled) {
          setAlbumLoadStatus("error");
        }
      }
    }

    loadAlbums();

    return () => {
      cancelled = true;
    };
  }, [albumLoadAttempt]);

  function retryAlbums() {
    setAlbumLoadStatus("loading");
    setAlbumLoadAttempt(attempt => attempt + 1);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      try {
        const saved = await invoke<Profile>("get_profile");
        if (!cancelled) {
          profileNameWrites.current = Promise.resolve(saved.displayName);
          setProfile(saved);
          setProfileLoadStatus("ready");
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
        if (!cancelled) setProfileLoadStatus("error");
      }
    }
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [profileLoadAttempt]);

  function retryProfile() {
    setProfileLoadStatus("loading");
    setProfileLoadAttempt(attempt => attempt + 1);
  }

  function changeDisplayName(displayName: string) {
    setProfile(prev => ({ ...prev, displayName }));
    // Serialize writes from typing and roll back only the latest edit if it fails.
    const write: Promise<string> = profileNameWrites.current.then(async savedName => {
      try {
        await invoke("set_display_name", { name: displayName });
        return displayName;
      } catch (error) {
        console.error("Failed to save display name:", error);
        if (profileNameWrites.current === write) {
          setProfile(prev => ({ ...prev, displayName: savedName }));
          notify("Could not save your display name.", "error");
        }
        return savedName;
      }
    });
    profileNameWrites.current = write;
  }

  async function changeProfilePicture(file: File | null) {
    if (savingPicture.current) return;
    savingPicture.current = true;
    setIsSavingPicture(true);
    try {
      const change: ArtworkChange = file
        ? { kind: "replace", bytes: await encodeArtwork(file, "Profile picture") }
        : { kind: "remove" };
      const profilePicture = await invoke<string | null>("set_profile_picture", { change });
      setProfile(prev => ({ ...prev, profilePicture }));
    } catch (error) {
      console.error("Failed to save profile picture:", error);
      notify(error instanceof Error ? error.message : "Could not save your profile picture.", "error");
    } finally {
      savingPicture.current = false;
      setIsSavingPicture(false);
    }
  }

  function addAlbum(album: Album) {
    setAlbums(prev => [...prev, album]);
  }

  async function updateAlbum(album: Album, artwork?: ArtworkChange) {
    try {
      const updated = await invoke<Album>("update_album", { album, artwork });
      setAlbums(prev =>
        prev.map(item => item.id === updated.id ? updated : item)
      );
    } catch (error) {
      console.error("Failed to update album:", error);
      notify("Failed to update album. Please try again.", "error");
      throw error;
    }
  }

  async function deleteAlbum(id: string) {
    const album = albums.find(item => item.id === id);

    try {
      const affectedRows = await invoke<number>("delete_album", { id });

      if (affectedRows === 0) {
        throw new Error("Album not found in database.");
      }

      setAlbums(prev => prev.filter(item => item.id !== id));

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
        alphabeticalDividers={alphabeticalDividers}
        loadStatus={albumLoadStatus}
        onRetry={retryAlbums}
        onAdd={addAlbum}
        onUpdate={updateAlbum}
        onDelete={deleteAlbum}
        onNotify={notify}
      />
    ),

    "Shelf Mode": (
      <Shelves
        profile={profile}
        albums={albums}
        alphabeticalDividers={alphabeticalDividers}
        loadStatus={albumLoadStatus}
        onRetry={retryAlbums}
        onAdd={addAlbum}
        onUpdate={updateAlbum}
        onDelete={deleteAlbum}
        onNotify={notify}
      />
    ),

    Favorites: albumLoadStatus === "error" ? <CollectionLoadError onRetry={retryAlbums} /> : (
      <Favorites
        profile={profile}
        albums={albums}
        onUpdate={updateAlbum}
        onDelete={deleteAlbum}
        onNotify={notify}
      />
    ),

    Wishlist: <Wishlist profile={profile} />,
    Lists: <Lists profile={profile} />,
    Statistics: <Statistics profile={profile} />,
    Settings: (
      <Settings
        profile={profile}
        profileLoadStatus={profileLoadStatus}
        onRetryProfile={retryProfile}
        onDisplayNameChange={changeDisplayName}
        onProfilePictureChange={changeProfilePicture}
        isSavingPicture={isSavingPicture}
        theme={theme}
        onThemeChange={changeTheme}
        textScale={textScale}
        onTextScaleChange={setTextScale}
        animationsEnabled={animations === "on"}
        onAnimationsEnabledChange={enabled => setAnimations(enabled ? "on" : "off")}
        alphabeticalDividers={alphabeticalDividers}
        onAlphabeticalDividersChange={changeAlphabeticalDividers}
      />
    )
  };

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
      />

      <main key={activePage} className="main-content page-enter">
        {activePage !== "Collection" && activePage !== "Shelf Mode" && albumLoadStatus === "loading" ? (
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
