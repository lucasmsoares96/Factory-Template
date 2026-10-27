import { useInfiniteQuery } from "@tanstack/react-query";
import { listMembers } from "../../gen/clients/listMembers.ts";
import { listMembersQueryKey } from "../../gen/hooks/useListMembers.ts";

/**
 * The Company's Members, page by page, as the Company page loads them: one
 * cache shared by the Members table and the transfer's list of Members, so a
 * change to either reloads both.
 */
export function useMembers(companyId: string) {
  const path = { companyId };
  return useInfiniteQuery({
    queryKey: [...listMembersQueryKey({ path }), "pages"],
    queryFn: ({ pageParam }) => listMembers({ path, query: pageParam ? { cursor: pageParam } : {} }),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
