import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { achievementApi } from '../lib/api';
import { useAccount } from './useAccount';

export function useAchievements() {
  const { account } = useAccount();
  const client = useQueryClient();
  const key = ['achievements', account.user_id];
  const query = useQuery({ queryKey: key, queryFn: achievementApi.sync, staleTime: 30_000, retry: 1 });
  const seen = useMutation({ mutationFn: achievementApi.seen,
    onSuccess: async data => {
      client.setQueryData(key, data);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  return { ...query, seen };
}
