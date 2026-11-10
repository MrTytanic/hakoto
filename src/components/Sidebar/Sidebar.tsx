import { useState } from "react";
import {
  Disc3, Library, Layers3, Heart, Bookmark,
  ListMusic, ChartNoAxesColumn, Settings,
  PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import "./Sidebar.css";

const navigation = [
  { label: "Collection", icon: Library },
  { label: "Shelf Mode", icon: Layers3 },
  { label: "Favorites", icon: Heart },
  { label: "Lists", icon: ListMusic },
  { label: "Wishlist", icon: Bookmark },
  { label: "Statistics", icon: ChartNoAxesColumn }
];

type SidebarProps = {
  activePage: string;
  setActivePage: (page: string) => void;
};

function Sidebar({ activePage, setActivePage }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleSidebar = () => setIsExpanded(prev => !prev);

  return (
    <nav className={`sidebar ${isExpanded ? "expanded" : "collapsed"}`} aria-label="Main navigation">
      <div className="sidebar-header">
        {isExpanded && (
          <div className="sidebar-brand">
            <Disc3 size={23} strokeWidth={1.8} />
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
        {navigation.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={`sidebar-button ${activePage === label ? "active" : ""}`}
            onClick={() => setActivePage(label)}
            title={label}
            aria-current={activePage === label ? "page" : undefined}
          >
            <Icon size={20} strokeWidth={1.8} />
            {isExpanded && <span>{label}</span>}
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
          {isExpanded && <span>Settings</span>}
        </button>
      </div>
    </nav>
  );
}

export default Sidebar;
