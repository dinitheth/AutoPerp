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

    await reauthorizeWallet(disconnect, connect);
    return await requestRecords(program, includePlaintext);
  }
}
