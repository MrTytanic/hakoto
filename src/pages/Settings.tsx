import { useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { Upload, Trash2 } from "lucide-react";
import ProfileHeader, { ProfileAvatar } from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import type { ThemePreference } from "../settings";
import "./Settings.css";

type SettingsProps = {
  profile: Profile;
  setProfile: Dispatch<SetStateAction<Profile>>;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  alphabeticalDividers: boolean;
  onAlphabeticalDividersChange: (enabled: boolean) => void;
};

const sections = [
  { title: "Profile", description: "Customize your display name and picture." },
  { title: "Appearance", description: "Choose how Hakoto looks on this device." },
  { title: "Collection", description: "Find and organize your albums." },
  { title: "Storage", description: "See how Hakoto stores your data." }
] as const;

const themeOptions = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" }
] as const;

function ProfileSettings({ profile, setProfile }: Pick<SettingsProps, "profile" | "setProfile">) {
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
        <p id="profile-picture-help">Choose an image to represent your profile. Maximum size: 5 MB.</p>

        <div className="settings-avatar-row">
          <ProfileAvatar picture={profile.profilePicture} preview />

          <div className="settings-avatar-controls">
            <label className="settings-upload">
              <Upload size={15} aria-hidden="true" /> Upload Image
              <input
                id="profile-picture"
                className="settings-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby="profile-picture-help"
                onChange={handleUpload}
              />
            </label>

            {profile.profilePicture && (
              <button
                type="button"
                className="settings-remove"
                onClick={() => setProfile(prev => ({ ...prev, profilePicture: null }))}
              >
                <Trash2 size={15} aria-hidden="true" /> Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Settings({
  profile, setProfile, theme, onThemeChange, alphabeticalDividers, onAlphabeticalDividersChange
}: SettingsProps) {
  const [section, setSection] = useState<(typeof sections)[number]>(sections[0]);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <ProfileHeader
          profile={profile}
          title="Settings"
          description="Manage your preferences and personalize Hakoto."
        />
      </div>

      <nav className="settings-navigation" aria-label="Settings sections">
        {sections.map(item => (
          <button
            key={item.title}
            type="button"
            aria-current={section === item ? "true" : undefined}
            aria-controls="settings-panel"
            onClick={() => setSection(item)}
          >
            {item.title}
          </button>
        ))}
      </nav>

      <section id="settings-panel" className="settings-section" aria-labelledby="settings-section-title">
        <div className="settings-section-heading">
          <h2 id="settings-section-title">{section.title}</h2>
          <p>{section.description}</p>
        </div>

        {section.title === "Profile" && <ProfileSettings profile={profile} setProfile={setProfile} />}

        {section.title === "Appearance" && (
          <div className="settings-card">
            <fieldset className="settings-theme" aria-describedby="theme-help">
              <legend>Theme</legend>
              <p id="theme-help">System follows your device’s light or dark appearance.</p>
              <div className="settings-theme-options">
                {themeOptions.map(option => (
                  <label key={option.value}>
                    <input
                      type="radio"
                      name="theme"
                      value={option.value}
                      checked={theme === option.value}
                      onChange={() => onThemeChange(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {section.title === "Collection" && (
          <div className="settings-card">
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={alphabeticalDividers}
                aria-describedby="alphabetical-dividers-help"
                onChange={e => onAlphabeticalDividersChange(e.currentTarget.checked)}
              />
              Alphabetical Dividers
            </label>
            <p id="alphabetical-dividers-help">
              Group albums by the first letter of their title. Sorting by release year temporarily hides the dividers.
            </p>
          </div>
        )}

        {section.title === "Storage" && (
          <div className="settings-card">
            <p>Your albums and artwork are stored locally on this device. Your theme preference is also saved locally.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export default Settings;
