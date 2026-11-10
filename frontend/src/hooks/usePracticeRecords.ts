import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { practiceApi } from "../lib/api";
import { parseTimestamp } from "../lib/stats";

export function usePracticeRecords() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["practice-records"],
    queryFn: () => practiceApi.getRecords("default_user"),
    staleTime: 30000,
    retry: 1,
  });
  useEffect(() => {
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ["practice-records"] });
    };
    window.addEventListener("practice:record-saved", refresh);
    window.addEventListener("practice:record-deleted", refresh);
    return () => {
      window.removeEventListener("practice:record-saved", refresh);
      window.removeEventListener("practice:record-deleted", refresh);
    };
  }, [client]);
  return {
    ...query,
    records:
      query.data?.records
        .slice()
        .sort(
          (a, b) =>
            parseTimestamp(b.end_time).getTime() -
            parseTimestamp(a.end_time).getTime(),
        ) || [],
  };
}
