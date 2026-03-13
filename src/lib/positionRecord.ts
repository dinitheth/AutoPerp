export type PositionDirection = "long" | "short";

export interface ParsedPositionRecord {
  id: string;
  marketId: string;
  market: string;
  direction: PositionDirection;
  collateral: number;
  leverage: number;
  entryPrice: number;
  size: number;
  stopLoss: number;
  takeProfit: number;
  rawData?: unknown;
}

function extractFieldValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.replace(/\.(private|public)$/, "").trim();
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.value !== undefined) return extractFieldValue(obj.value);
    return String(raw);
  }
  return String(raw);
}

function cleanNumeric(s: string): string {
  return s
    .replace(/\.(private|public)$/i, "")
    .replace(/u\d+$/i, "")
    .replace(/field$/i, "")
    .replace(/_/g, "")
    .trim();
}

function safeInt(raw: unknown): number {
  const s = cleanNumeric(extractFieldValue(raw));
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function getRecordPlaintext(record: unknown): string | null {
  if (!record) return null;
  if (typeof record === "string") return record;
  if (typeof record !== "object") return null;

  const r = record as Record<string, unknown>;
  const candidates = [r.plaintext, r.recordPlaintext, r.record, r.data];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  return null;
}

function fieldFromPlaintext(plain: string, name: string): string {
  const re = new RegExp(String.raw`${name}\s*:\s*([^,\n}]+)`, "i");
  const m = plain.match(re);
  return m?.[1]?.trim() ?? "";
}

function field(raw: Record<string, unknown>, name: string): unknown {
  if (raw[name] !== undefined) return raw[name];
  if (raw[`${name}.private`] !== undefined) return raw[`${name}.private`];
  if (raw[`${name}.public`] !== undefined) return raw[`${name}.public`];
  const lname = name.toLowerCase();
  for (const k of Object.keys(raw)) {
    if (k.toLowerCase().replace(/\.(private|public)$/, "") === lname) return raw[k];
  }
  return undefined;
}

export function getPositionRecordOwner(rawRecord: unknown): string | null {
  if (!rawRecord) return null;

  const plain = getRecordPlaintext(rawRecord);
  if (plain) {
    const owner = cleanNumeric(fieldFromPlaintext(plain, "owner")) || fieldFromPlaintext(plain, "owner");
    return owner ? owner.replace(/\.(private|public)$/i, "").trim() : null;
  }

  if (typeof rawRecord !== "object") return null;
  const source = rawRecord as Record<string, unknown>;
  const raw = (source.data as Record<string, unknown> | undefined) ?? source;
  const ownerRaw = field(raw, "owner");
  const owner = extractFieldValue(ownerRaw).replace(/\.(private|public)$/i, "").trim();
  return owner || null;
}

export function isLikelyPositionRecord(record: unknown): boolean {
  const plain = getRecordPlaintext(record);
  if (plain) {
    const hasCollateral = /collateral\s*:/i.test(plain);
    const hasEntry = /entry_price\s*:/i.test(plain);
    const hasLiq = /liquidation_price\s*:/i.test(plain) || /LiquidationAuth/i.test(plain);
    return hasCollateral && hasEntry && !hasLiq;
  }

  if (!record || typeof record !== "object") return false;
  const source = record as Record<string, unknown>;
  const raw = (source.data as Record<string, unknown> | undefined) ?? source;
  const hasCollateral =
    raw.collateral !== undefined ||
    raw["collateral.private"] !== undefined ||
    raw["collateral.public"] !== undefined;
  const hasLiq = raw.liquidation_price !== undefined || raw["liquidation_price.private"] !== undefined;
  return hasCollateral && !hasLiq;
}

export function parseAleoPositionRecord(
  record: unknown,
  marketNames: Record<string, string>,
): ParsedPositionRecord | null {
  try {
    const plain = getRecordPlaintext(record);
    if (plain) {
      if (!isLikelyPositionRecord(plain)) return null;

      const marketId = cleanNumeric(fieldFromPlaintext(plain, "market_id"));
      const directionNum = cleanNumeric(fieldFromPlaintext(plain, "direction"));
      const direction: PositionDirection = directionNum === "0" ? "long" : "short";
      const collateralMicro = safeInt(fieldFromPlaintext(plain, "collateral"));
      const collateral = collateralMicro / 1_000_000;
      const leverage = safeInt(fieldFromPlaintext(plain, "leverage"));
      const entryPriceRaw = safeInt(fieldFromPlaintext(plain, "entry_price"));
      const entryPrice = entryPriceRaw / 100_000_000;
      const size = collateral * leverage;
      const stopLoss = safeInt(fieldFromPlaintext(plain, "stop_loss")) / 100_000_000;
      const takeProfit = safeInt(fieldFromPlaintext(plain, "take_profit")) / 100_000_000;
      const posId = cleanNumeric(fieldFromPlaintext(plain, "position_id")) || String(Math.random());

      return {
        id: posId,
        marketId,
        market: marketNames[marketId] ?? `Market ${marketId}`,
        direction,
        collateral,
        leverage,
        entryPrice,
        size,
        stopLoss,
        takeProfit,
        rawData: plain,
      };
    }

    if (!record || typeof record !== "object") return null;
    const source = record as Record<string, unknown>;
    const raw = (source.data as Record<string, unknown> | undefined) ?? source;
    if (!isLikelyPositionRecord(record)) return null;

    const marketId = cleanNumeric(extractFieldValue(field(raw, "market_id")));
    const directionNum = cleanNumeric(extractFieldValue(field(raw, "direction")));
    const direction: PositionDirection = directionNum === "0" ? "long" : "short";
    const collateralMicro = safeInt(field(raw, "collateral"));
    const collateral = collateralMicro / 1_000_000;
    const leverage = safeInt(field(raw, "leverage"));
    const entryPriceRaw = safeInt(field(raw, "entry_price"));
    const entryPrice = entryPriceRaw / 100_000_000;
    const size = collateral * leverage;
    const stopLoss = safeInt(field(raw, "stop_loss")) / 100_000_000;
    const takeProfit = safeInt(field(raw, "take_profit")) / 100_000_000;
    const posId = extractFieldValue(field(raw, "position_id") ?? field(raw, "id") ?? source.id ?? "") || String(Math.random());

    return {
      id: cleanNumeric(posId) || posId,
      marketId,
      market: marketNames[marketId] ?? `Market ${marketId}`,
      direction,
      collateral,
      leverage,
      entryPrice,
      size,
      stopLoss,
      takeProfit,
      rawData: record,
    };
  } catch {
    return null;
  }
}

export function serializePositionRecordInput(rawRecord: unknown): string | null {
  if (typeof rawRecord === "string") {
    const s = rawRecord;
    const looksLikePosition =
      s.includes("owner") && s.includes("position_id") && s.includes("entry_price") && s.includes("collateral");
    return looksLikePosition ? s : null;
  }
  if (!rawRecord || typeof rawRecord !== "object") return null;

  const candidate = rawRecord as Record<string, unknown>;
  const possibleValues = [
    candidate.recordPlaintext,
    candidate.plaintext,
    candidate.record,
    candidate.data,
    rawRecord,
  ];

  for (const value of possibleValues) {
    if (
      typeof value === "string" &&
      value.includes("{") &&
      value.includes("owner") &&
      value.includes("position_id") &&
      value.includes("entry_price") &&
      value.includes("collateral")
    ) {
      return value;
    }
  }

  return null;
}
