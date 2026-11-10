export type Profile = {
  displayName: string;
  profilePicture: string | null;
};

export type ProfileLoadStatus = "loading" | "ready" | "error";
