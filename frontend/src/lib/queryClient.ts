import { QueryClient } from "@tanstack/react-query";
import axios from "axios";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;

        if (status === 401 || status === 429) {
          return false;
        }

        return failureCount < 1;
      },
      staleTime: 15_000
    }
  }
});
