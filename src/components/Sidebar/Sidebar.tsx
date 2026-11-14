import { useState } from "react";
import {
  Library, Layers3, Heart, Bookmark,
  Archive, ChartNoAxesColumn, Settings,
  PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import "./Sidebar.css";
import hakotoLogo from "../../assets/hakoto.svg";

const navigation = [
  { label: "Collection", icon: Library },
  { id: "Shelf Mode", label: "Shelves", icon: Layers3 },
  { label: "Favorites", icon: Heart },
  { label: "Crates", icon: Archive },
  { label: "Wishlist", icon: Bookmark },
  { label: "Statistics", icon: ChartNoAxesColumn }
];

type SidebarProps = {
  activePage: string;
  setActivePage: (page: string) => void;
};

function Sidebar({ activePage, setActivePage }: SidebarProps) {
  const [mode, setMode] = useState<"initial" | "expanded" | "collapsed">("initial");
  const isExpanded = mode !== "collapsed";

  const toggleSidebar = () => setMode(prev => prev === "collapsed" ? "expanded" : "collapsed");

  return (
    <nav
      className={`sidebar ${isExpanded ? "expanded" : "collapsed"}`}
      data-reveal-labels={mode === "expanded" ? "" : undefined}
      aria-label="Main navigation"
    >
      <div className="sidebar-header">
        {isExpanded && (
          <div className="sidebar-brand">
            <img
              src={hakotoLogo}
              alt=""
              className="sidebar-brand-icon"
            />
            <span className="sidebar-logo">hakoto</span>
          </div>
        )}

        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={isExpanded}
          title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isExpanded ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
        </button>
      </div>

      <div className="sidebar-navigation">
        {navigation.map(({ label, id = label, icon: Icon }) => (
          <button
            key={id}
            className={`sidebar-button ${activePage === id ? "active" : ""}`}
            onClick={() => setActivePage(id)}
            aria-label={label}
            title={label}
            aria-current={activePage === id ? "page" : undefined}
          >
            <Icon size={20} strokeWidth={1.8} />
            {isExpanded && <span className="sidebar-label">{label}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          className={`sidebar-button ${activePage === "Settings" ? "active" : ""}`}
          onClick={() => setActivePage("Settings")}
          title="Settings"
          aria-current={activePage === "Settings" ? "page" : undefined}
        >
          <Settings size={20} strokeWidth={1.8} />
          {isExpanded && <span className="sidebar-label">Settings</span>}
        </button>
      </div>
    </nav>
  );
}

export default Sidebar;
