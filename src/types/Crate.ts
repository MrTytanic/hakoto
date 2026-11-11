export type CrateSettings = {
  name: string;
  description: string | null;
};

export type Crate = CrateSettings & {
  id: number;
  albumIds: string[];
};
