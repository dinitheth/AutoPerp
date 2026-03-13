function extractFieldValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.replace(/\.(private|public)$/i, "").trim();
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.value !== undefined) return extractFieldValue(obj.value);
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

export function getRecordPlaintext(record: unknown): string | null {
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

function parseU64(raw: string): number {
  const n = Number.parseInt(cleanNumeric(raw), 10);
  return Number.isFinite(n) ? n : 0;
}

export function serializeAnyRecordInput(rawRecord: unknown): string | null {
  const plain = getRecordPlaintext(rawRecord);
  if (!plain) return null;
  const looksLikeRecord = plain.includes("{") && plain.includes("owner") && plain.includes("}");
  return looksLikeRecord ? plain : null;
}

function isVaultRecordPlaintext(plain: string): boolean {
  return /owner\s*:/i.test(plain) && /balance\s*:/i.test(plain) && !/pool_id\s*:/i.test(plain) && !/entry_price\s*:/i.test(plain);
}

function isPoolStatePlaintext(plain: string): boolean {
  return /owner\s*:/i.test(plain) && /pool_id\s*:/i.test(plain) && /deposits\s*:/i.test(plain) && /shares\s*:/i.test(plain) && /fees\s*:/i.test(plain) && /open_interest\s*:/i.test(plain) && /position_count\s*:/i.test(plain);
}

function parseOwner(plain: string): string {
  return extractFieldValue(fieldFromPlaintext(plain, "owner")).toLowerCase();
}

function parsePoolId(plain: string): string {
  const v = extractFieldValue(fieldFromPlaintext(plain, "pool_id"));
  return `${cleanNumeric(v)}u8`;
}

export function findVaultRecord(
  records: unknown[],
  owner: string,
): { input: string; balanceMicro: number } | null {
  const normalizedOwner = owner.trim().toLowerCase();
  for (const rec of records) {
    const plain = getRecordPlaintext(rec);
    if (!plain || !isVaultRecordPlaintext(plain)) continue;
    if (parseOwner(plain) !== normalizedOwner) continue;
    const input = serializeAnyRecordInput(plain);
    if (!input) continue;
    const balanceMicro = parseU64(fieldFromPlaintext(plain, "balance"));
    return { input, balanceMicro };
  }
  return null;
}

export function findPoolStateRecord(
  records: unknown[],
  owner: string,
  poolId: string,
): { input: string; feesMicro: number; shares: number } | null {
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedPool = poolId.trim().toLowerCase();
  for (const rec of records) {
    const plain = getRecordPlaintext(rec);
    if (!plain || !isPoolStatePlaintext(plain)) continue;
    if (parseOwner(plain) !== normalizedOwner) continue;
    if (parsePoolId(plain).toLowerCase() !== normalizedPool) continue;
    const input = serializeAnyRecordInput(plain);
    if (!input) continue;
    const feesMicro = parseU64(fieldFromPlaintext(plain, "fees"));
    const shares = parseU64(fieldFromPlaintext(plain, "shares"));
    return { input, feesMicro, shares };
  }
  return null;
}
