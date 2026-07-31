import { useGoogleReportsContext } from "@/context/GoogleReportsContext";

export const useDailyGoogleReports = ({ scheduleLogin = "" } = {}) => (
  useGoogleReportsContext(scheduleLogin)
);
