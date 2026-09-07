import { useEffect, useState } from "react";
import api from "@/lib/api";

export function useTeamReportTrend({
  reportType,
  period = "month",
  teamId = "",
  enabled = true,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !reportType || !teamId) {
      setRecords([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api.get("/analytics/team-report-trends", {
      params: { report_type: reportType, period, team_id: teamId, limit: 30 },
      timeout: 30000,
    })
      .then((response) => {
        if (!cancelled) setRecords(Array.isArray(response.data?.records) ? response.data.records : []);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, period, reportType, teamId]);

  return { records, loading };
}

export default useTeamReportTrend;
