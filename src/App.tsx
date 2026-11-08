import { useState } from "react";
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

  const pages: Record<string, React.ReactNode> = {
    "Collection": <Collection />,
    "Shelves": <Shelves />,
    "Favorites": <Favorites />,
    "Lists": <Lists />,
    "Wishlist": <Wishlist />,
    "Statistics": <Statistics />,
    "Settings": <Settings />
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