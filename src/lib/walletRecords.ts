import { Network } from "@provablehq/aleo-types";

type RequestRecordsFn = (program: string, includePlaintext?: boolean) => Promise<unknown[]>;
type ConnectFn = (network: Network) => Promise<void>;
type DisconnectFn = () => Promise<void>;

let reauthInFlight: Promise<void> | null = null;

export function isProgramNotAllowedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /program\s+not\s+allowed/i.test(message);
}

async function reauthorizeWallet(disconnect?: DisconnectFn, connect?: ConnectFn): Promise<void> {
  if (!disconnect || !connect) return;
  if (!reauthInFlight) {
    reauthInFlight = (async () => {
      await disconnect();
      await connect(Network.TESTNET);
    })().finally(() => {
      reauthInFlight = null;
    });
  }
  await reauthInFlight;
}

export async function requestProgramRecords(
  requestRecords: RequestRecordsFn,
  program: string,
  includePlaintext = true,
  disconnect?: DisconnectFn,
  connect?: ConnectFn,
): Promise<unknown[]> {
  try {
    return await requestRecords(program, includePlaintext);
  } catch (error) {
    if (!isProgramNotAllowedError(error)) {
      throw error;
    }

    // Avoid auto re-auth loops from polling/background fetches.
    // Wallet reconnect should be explicitly user-initiated from UI.
    throw error;
  }
}

export async function requestProgramRecordsAny(
  requestRecords: RequestRecordsFn,
  programs: string[],
  includePlaintext = true,
  disconnect?: DisconnectFn,
  connect?: ConnectFn,
): Promise<unknown[]> {
  const uniquePrograms = Array.from(
    new Set(programs.map((p) => p.trim()).filter(Boolean)),
  );

  const merged: unknown[] = [];
  let lastError: unknown = null;

  for (const program of uniquePrograms) {
    try {
      const records = await requestProgramRecords(
        requestRecords,
        program,
        includePlaintext,
        disconnect,
        connect,
      );
      if (Array.isArray(records) && records.length > 0) {
        merged.push(...records);
      }
    } catch (error) {
      lastError = error;
      if (isProgramNotAllowedError(error)) continue;
    }
  }

  if (merged.length > 0) return merged;
  if (lastError) throw lastError;
  return [];
}
