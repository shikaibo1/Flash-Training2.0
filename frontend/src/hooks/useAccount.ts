import { createContext, useContext } from "react";
import type { Account } from "../lib/api";

export const AccountContext = createContext<{ account: Account; logout: () => Promise<void> } | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("学习页面需要已登录的账号。");
  return value;
}
