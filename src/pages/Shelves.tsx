import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import "./Shelves.css";

function Shelves({ profile }: { profile: Profile }) {
  return (
    <div className="shelves-page">
      <ProfileHeader profile={profile} title="Shelves" />
    </div>
  );
}

export default Shelves;
