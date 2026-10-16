import { useAuth } from '@/auth/AuthProvider';
import { tradePack, type TradePack } from '@/lib/trades';

/** Words, starter content and tools for the signed-in company's trade. */
export function useTrade(): TradePack {
  const { workspace } = useAuth();
  return tradePack(workspace?.org.trade);
}
