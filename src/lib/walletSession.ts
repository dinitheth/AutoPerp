export const WALLET_RECONNECT_KEY = "autoperp:wallet:reconnect";

export function setWalletReconnectEnabled(enabled: boolean) {
  if (enabled) {
    localStorage.setItem(WALLET_RECONNECT_KEY, "1");
    return;
  }
  localStorage.removeItem(WALLET_RECONNECT_KEY);
}

export function getWalletReconnectEnabled(): boolean {
  return localStorage.getItem(WALLET_RECONNECT_KEY) === "1";
}