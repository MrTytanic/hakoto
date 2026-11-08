import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import "./Collection.css";

function Collection({ profile }: { profile: Profile }) {
  return (
    <div className="collection-page">
      <ProfileHeader profile={profile} title="Collection" />
    </div>
  );
}

export default Collection;
