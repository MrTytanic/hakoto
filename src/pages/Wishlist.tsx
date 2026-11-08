import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import "./Wishlist.css";

function Wishlist({ profile }: { profile: Profile }) {
  return (
    <div className="wishlist-page">
      <ProfileHeader profile={profile} title="Wishlist" />
    </div>
  );
}

export default Wishlist;
