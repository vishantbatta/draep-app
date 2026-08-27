import { strings } from "@/lib/strings";

/** Profile-completion gender choices — mirrors users.gender (male|female|other). */
export const GENDER_OPTIONS = [
  { value: "male", label: strings.dashboard.genderMale },
  { value: "female", label: strings.dashboard.genderFemale },
  { value: "other", label: strings.dashboard.genderOther },
] as const;
