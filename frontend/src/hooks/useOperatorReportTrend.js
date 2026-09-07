import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

const storageKey = ({ reportType, period, segment, snapshotVersion }) => (
  `vpdk:report-trend:${reportType}:${period}:${segment}:${snapshotVersion}`
);

export function useOperatorReportTrend({
  reportType,
  period = "month",
  segment = "overall",
  segmentLabel = "",
  snapshotVersion = "",
  snapshotUpdatedAt = "",
  metrics = [],
  enabled = true,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const normalizedMetrics = useMemo(() => (
    (Array.isArray(metrics) ? metrics : []).filter((metric) => (
      metric && metric.key && metric.label && metric.value !== null && metric.value !== undefined && Number.isFinite(Number(metric.value))
    )).map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: Number(metric.value),
      unit: metric.unit || "number",
    }))
  ), [metrics]);

  useEffect(() => {
    if (!enabled || !reportType) return;
    let cancelled = false;
    setLoading(true);
    api.get("/analytics/operator-report-trends", {
      params: { report_type: reportType, period, segment, limit: 30 },
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
  }, [enabled, period, reportType, segment]);

  useEffect(() => {
    if (!enabled || !reportType || !snapshotVersion || !normalizedMetrics.length) return;
    const key = storageKey({ reportType, period, segment, snapshotVersion });
    if (typeof window !== "undefined" && window.sessionStorage.getItem(key)) return;

    api.post("/analytics/operator-report-snapshot", {
      snapshot_version: snapshotVersion,
      snapshot_updated_at: snapshotUpdatedAt,
      report_type: reportType,
      period,
      segment,
      segment_label: segmentLabel || segment,
      metrics: normalizedMetrics,
    }, { timeout: 30000 })
      .then((response) => {
        if (typeof window !== "undefined") window.sessionStorage.setItem(key, "1");
        const dateKey = response?.data?.date_key || "";
        setRecords((current) => {
          const nextRecord = {
            date_key: dateKey || undefined,
            snapshot_version: snapshotVersion,
            snapshot_updated_at: dateKey || snapshotUpdatedAt,
            last_refresh_at: snapshotUpdatedAt,
            report_type: reportType,
            period,
            segment,
            segment_label: segmentLabel || segment,
            metrics: normalizedMetrics,
          };
          const sameDayIndex = dateKey ? (current || []).findIndex((item) => item?.date_key === dateKey || item?.snapshot_updated_at === dateKey) : -1;
          if (sameDayIndex >= 0) {
            const next = [...current];
            next[sameDayIndex] = nextRecord;
            return next.slice(-30);
          }
          if ((current || []).some((item) => item?.snapshot_version === snapshotVersion)) return current;
          return [...(current || []), nextRecord].slice(-30);
        });
      })
      .catch(() => {});
  }, [enabled, normalizedMetrics, period, reportType, segment, segmentLabel, snapshotUpdatedAt, snapshotVersion]);

  return { records, loading };
}

export default useOperatorReportTrend;
