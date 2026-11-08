import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import "./Lists.css";

function Lists({ profile }: { profile: Profile }) {
  return (
    <div className="lists-page">
      <ProfileHeader profile={profile} title="Lists" />
    </div>
  );
}

export default Lists;
