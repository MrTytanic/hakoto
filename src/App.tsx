
import { useEffect, useState } from "react";
import type { Profile } from "./types/Profile";
import "./App.css";

import Sidebar from "./components/sidebar/Sidebar";
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

  // Release temporary image URLs when the picture changes or App unmounts.
  useEffect(() => {
    return () => {
      if (profile.profilePicture) URL.revokeObjectURL(profile.profilePicture);
    };
  }, [profile.profilePicture]);

  const pages: Record<string, React.ReactNode> = {
    Collection: <Collection profile={profile} />,
    Shelves: <Shelves profile={profile} />,
    Favorites: <Favorites profile={profile} />,
    Wishlist: <Wishlist profile={profile} />,
    Lists: <Lists profile={profile} />,
    Statistics: <Statistics profile={profile} />,
    Settings: <Settings profile={profile} setProfile={setProfile} />
  };

  return (
    <div className="app-layout">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="main-content">
        {pages[activePage]}
      </main>
    </div>
  );
}

export default App;
