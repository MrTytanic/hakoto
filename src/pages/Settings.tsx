import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Upload, Trash2 } from "lucide-react";
import ProfileHeader, { ProfileAvatar } from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import "./Settings.css";

type SettingsProps = {
  profile: Profile;
  setProfile: Dispatch<SetStateAction<Profile>>;
};

function Settings({ profile, setProfile }: SettingsProps) {
  function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      return alert("Please select a PNG, JPG, or WebP image.");

    if (file.size > 5 * 1024 * 1024)
      return alert("Please select an image smaller than 5 MB.");

    const profilePicture = URL.createObjectURL(file);
    setProfile(prev => ({ ...prev, profilePicture }));
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <ProfileHeader
          profile={profile}
          title="Settings"
          description="Manage your preferences and personalize Sleevy."
        />
      </div>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h2>Profile</h2>
          <p>Customize your user profile.</p>
        </div>

        <div className="settings-card">
          <div className="settings-field">
            <label htmlFor="display-name">Display Name</label>
            <p>This name will appear in your page headings.</p>
            <input
              id="display-name"
              type="text"
              placeholder="Enter your display name"
              maxLength={40}
              value={profile.displayName}
              onChange={e => {
                const displayName = e.currentTarget.value;
                setProfile(prev => ({ ...prev, displayName }));
              }}
            />
          </div>

          <div className="settings-field settings-avatar-field">
            <label htmlFor="profile-picture">Profile Picture</label>
            <p>Choose an image to represent your profile. Maximum size: 5 MB.</p>

            <div className="settings-avatar-row">
              <ProfileAvatar picture={profile.profilePicture} preview />

              <div className="settings-avatar-controls">
                <label htmlFor="profile-picture" className="settings-upload">
                  <Upload size={15} /> Upload Image
                </label>

                <input
                  id="profile-picture"
                  className="settings-file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleUpload}
                />

                {profile.profilePicture && (
                  <button
                    type="button"
                    className="settings-remove"
                    onClick={() => setProfile(prev => ({ ...prev, profilePicture: null }))}
                  >
                    <Trash2 size={15} /> Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Settings;
