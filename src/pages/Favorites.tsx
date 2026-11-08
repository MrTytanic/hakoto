import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import "./Favorites.css";

function Favorites({ profile }: { profile: Profile }) {
  return (
    <div className="favorites-page">
      <ProfileHeader profile={profile} title="Favorites" />
    </div>
  );
}

export default Favorites;
