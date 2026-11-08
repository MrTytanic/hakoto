import { UserRound } from "lucide-react";
import type { Profile } from "../types/Profile";
import "./ProfileHeader.css";

export function ProfileAvatar({
  picture,
  preview = false
}: {
  picture: Profile["profilePicture"];
  preview?: boolean;
}) {
  return (
    <div className={preview ? "profile-avatar profile-avatar-preview" : "profile-avatar"}>
      {picture ? (
        <img src={picture} alt={preview ? "Profile preview" : ""} />
      ) : (
        <UserRound size={preview ? 32 : 26} strokeWidth={1.5} aria-hidden="true" />
      )}
    </div>
  );
}

export default function ProfileHeader({
  profile,
  title,
  description
}: {
  profile: Profile;
  title: string;
  description?: string;
}) {
  const name = profile.displayName.trim();

  return (
    <header className="profile-header">
      <ProfileAvatar picture={profile.profilePicture} />
      <div className="profile-header-text">
        <h1>{name ? `${name}'s ${title}` : `Your ${title}`}</h1>
        {description && <p>{description}</p>}
      </div>
    </header>
  );
}
