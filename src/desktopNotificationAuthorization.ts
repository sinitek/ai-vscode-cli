export type DesktopNotificationAuthorization = {
  platform: NodeJS.Platform;
  status: "not-determined" | "authorized" | "denied" | "disabled" | "not-required" | "unavailable";
  detail?: string;
};
