import { useQuery } from "@tanstack/react-query";
import { listStrategies } from "../api/endpoints";

export function useStrategies() {
  return useQuery({ queryKey: ["strategies"], queryFn: listStrategies });
}
