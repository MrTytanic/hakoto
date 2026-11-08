import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import "./Statistics.css";

function Statistics({ profile }: { profile: Profile }) {
  return (
    <div className="statistics-page">
      <ProfileHeader profile={profile} title="Statistics" />
    </div>
  );
}

export default Statistics;
