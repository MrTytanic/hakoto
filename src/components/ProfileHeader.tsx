import { UserRound } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArtworkImage } from "./Artwork";
import type { Profile } from "../types/Profile";
import type { Ref } from "react";
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
      <ArtworkImage
        src={picture ? convertFileSrc(picture, "profile-image") : null}
        alt={preview ? "Profile preview" : ""}
        fallback={<UserRound size={preview ? 32 : 26} strokeWidth={1.5} aria-hidden="true" />}
      />
    </div>
  );
}

export default function ProfileHeader({
  profile,
  title,
  description,
  headingRef
}: {
  profile: Profile;
  title: string;
  description?: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const name = profile.displayName.trim();

  return (
    <header className="profile-header">
      <ProfileAvatar picture={profile.profilePicture} />
      <div className="profile-header-text">
        <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{name ? `${name}'s ${title}` : `Your ${title}`}</h1>
        {description && <p>{description}</p>}
      </div>
    </header>
  );
}
