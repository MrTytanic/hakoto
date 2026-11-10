import { useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import ProfileHeader, { ProfileAvatar } from "../components/ProfileHeader";
import type { Profile, ProfileLoadStatus } from "../types/Profile";
import { animationDurations, type AnimationDurationPreference, type TextScalePreference, type ThemePreference } from "../settings";
import StorageSettings from "./StorageSettings";
import "./Settings.css";

type ProfileSettingsProps = {
  profile: Profile;
  profileLoadStatus: ProfileLoadStatus;
  onRetryProfile: () => void;
  onDisplayNameChange: (name: string) => void;
  onProfilePictureChange: (file: File | null) => void;
  isSavingPicture: boolean;
};

type SettingsProps = ProfileSettingsProps & {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  textScale: TextScalePreference;
  onTextScaleChange: (scale: TextScalePreference) => void;
  animationsEnabled: boolean;
  animationDuration: AnimationDurationPreference;
  onAnimationDurationChange: (duration: AnimationDurationPreference) => void;
  onAnimationsEnabledChange: (enabled: boolean) => void;
  alphabeticalDividers: boolean;
  onAlphabeticalDividersChange: (enabled: boolean) => void;
};

const themeOptions = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" }
] as const;

function ProfileSettings({
  profile, profileLoadStatus, onRetryProfile, onDisplayNameChange, onProfilePictureChange, isSavingPicture
}: ProfileSettingsProps) {
  if (profileLoadStatus !== "ready") {
    return (
      <div className="settings-card">
        {profileLoadStatus === "loading" ? (
          <p role="status">Loading your profile…</p>
        ) : (
          <div className="settings-field">
            <p role="alert">Couldn’t load your profile.</p>
            <button type="button" className="settings-upload" onClick={onRetryProfile}>Try again</button>
          </div>
        )}
      </div>
    );
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
          onChange={e => onDisplayNameChange(e.currentTarget.value)}
        />
      </div>

      <div className="settings-field settings-avatar-field" aria-busy={isSavingPicture}>
        <label htmlFor="profile-picture">Profile Picture</label>
        <p id="profile-picture-help">Choose an image to represent your profile. Maximum size: 5 MB.</p>

        <div className="settings-avatar-row">
          <ProfileAvatar picture={profile.profilePicture} preview />

          <div className="settings-avatar-controls">
            <label className="settings-upload">
              <Upload size={15} aria-hidden="true" /> {isSavingPicture ? "Saving picture…" : "Upload Image"}
              <input
                id="profile-picture"
                className="settings-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby="profile-picture-help"
                disabled={isSavingPicture}
                onChange={e => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) onProfilePictureChange(file);
                }}
              />
            </label>

            {profile.profilePicture && (
              <button
                type="button"
                className="settings-remove"
                disabled={isSavingPicture}
                onClick={() => onProfilePictureChange(null)}
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
  theme, onThemeChange, textScale, onTextScaleChange, animationsEnabled, onAnimationsEnabledChange,
  animationDuration, onAnimationDurationChange,
  alphabeticalDividers, onAlphabeticalDividersChange, ...profileSettings
}: SettingsProps) {
  const [previewDuration, setPreviewDuration] = useState<AnimationDurationPreference>();
  return (
    <div className="settings-page">
      <div className="settings-header">
        <ProfileHeader
          profile={profileSettings.profile}
          title="Settings"
          description="Manage your preferences and personalize Hakoto."
        />
      </div>

      <section className="settings-section" aria-labelledby="settings-profile">
        <div className="settings-section-heading">
          <h2 id="settings-profile">Profile</h2>
          <p>Customize your display name and picture.</p>
        </div>
        <ProfileSettings {...profileSettings} />
      </section>

      <section className="settings-section" aria-labelledby="settings-appearance">
        <div className="settings-section-heading">
          <h2 id="settings-appearance">Appearance</h2>
          <p>Choose how Hakoto looks on this device.</p>
        </div>
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
      </section>

      <section className="settings-section" aria-labelledby="settings-collection">
        <div className="settings-section-heading">
          <h2 id="settings-collection">Collection</h2>
          <p>Find and organize your albums.</p>
        </div>
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
      </section>

      <section className="settings-section" aria-labelledby="settings-accessibility">
        <div className="settings-section-heading">
          <h2 id="settings-accessibility">Accessibility</h2>
          <p>Adjust text size and motion on this device.</p>
        </div>
        <div className="settings-card">
          <div className="settings-field">
            <label htmlFor="text-scale">Text size</label>
            <select id="text-scale" value={textScale} onChange={event => onTextScaleChange(event.target.value as TextScalePreference)}>
              {(["90", "100", "115", "130"] as const).map(scale => <option key={scale} value={scale}>{scale}%</option>)}
            </select>
          </div>
          <label className="settings-checkbox settings-motion">
            <input type="checkbox" checked={!animationsEnabled} aria-describedby="motion-help"
              onChange={event => onAnimationsEnabledChange(!event.target.checked)} />
            Disable animations
          </label>
          <p id="motion-help">Animations also follow your device’s reduced motion preference.</p>
          <div className="settings-field settings-motion">
            <label htmlFor="animation-duration">Animation duration</label>
            <div className="settings-duration-control">
              <input id="animation-duration" type="range" min="100" max="500" step="50"
                value={animationDuration} disabled={!animationsEnabled}
                aria-valuetext={`${animationDuration} milliseconds`}
                onChange={event => {
                  const duration = animationDurations.find(value => value === event.target.value);
                  if (duration) {
                    onAnimationDurationChange(duration);
                    setPreviewDuration(duration);
                  }
                }} />
              <output htmlFor="animation-duration">{animationDuration}ms</output>
            </div>
            <div className="settings-motion-preview" aria-hidden="true">
              <span key={previewDuration} className={previewDuration ? "settings-motion-sample" : undefined}
                onAnimationEnd={() => setPreviewDuration(undefined)} />
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-storage">
        <div className="settings-section-heading">
          <h2 id="settings-storage">Storage</h2>
          <p>See how Hakoto stores your data.</p>
        </div>
        <StorageSettings profilePicture={profileSettings.profile.profilePicture} />
      </section>
    </div>
  );
}

export default Settings;
