export type PluginStatus = "ready" | "district_setup" | "file_handoff";

export type PluginCapability =
  | "roster.read"
  | "course.read"
  | "assignment.write"
  | "gradebook.write"
  | "evidence.export"
  | "sso.launch";

export interface ChalklinePlugin {
  id: string;
  name: string;
  shortName: string;
  category: "LMS" | "SIS" | "Roster & SSO" | "Portable";
  description: string;
  status: PluginStatus;
  color: string;
  mark: string;
  capabilities: PluginCapability[];
  setup: string;
  fallback: string;
  regionNote: string;
}

