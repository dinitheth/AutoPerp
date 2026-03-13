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

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed.replace(/[_,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractRecordHeight(record: unknown): number {
  if (!record || typeof record !== "object") return 0;
  const obj = record as Record<string, unknown>;
  const directCandidates = [
    obj.blockHeight,
    obj.height,
    obj.recordHeight,
    obj.inclusionHeight,
    obj.createdAt,
    obj.updatedAt,
    obj.timestamp,
  ];

  for (const candidate of directCandidates) {
    const n = readNumber(candidate);
    if (n !== null) return n;
  }

  const nestedCandidates = [obj.metadata, obj.meta, obj.record];
  for (const candidate of nestedCandidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const nested = candidate as Record<string, unknown>;
    const n =
      readNumber(nested.blockHeight) ??
      readNumber(nested.height) ??
      readNumber(nested.recordHeight) ??
      readNumber(nested.timestamp);
    if (n !== null) return n;
  }

  return 0;
}

function isRecordSpent(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const obj = record as Record<string, unknown>;

  const directBools = [obj.spent, obj.isSpent, obj.consumed, obj.isConsumed];
  for (const candidate of directBools) {
    if (typeof candidate === "boolean") return candidate;
  }

  const statusCandidates = [obj.status, obj.state];
  for (const candidate of statusCandidates) {
    if (typeof candidate === "string" && /spent|consumed/i.test(candidate)) return true;
  }

  const nestedCandidates = [obj.metadata, obj.meta, obj.record];
  for (const candidate of nestedCandidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const nested = candidate as Record<string, unknown>;
    if (typeof nested.spent === "boolean") return nested.spent;
    if (typeof nested.isSpent === "boolean") return nested.isSpent;
    if (typeof nested.status === "string" && /spent|consumed/i.test(nested.status)) return true;
  }

  return false;
}

function pickBestCandidate<T extends { spent: boolean; height: number; order: number }>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.spent !== b.spent) return a.spent ? 1 : -1;
    if (a.height !== b.height) return b.height - a.height;
    return b.order - a.order;
  });
  return sorted[0] ?? null;
}

export function findVaultRecord(
  records: unknown[],
  owner: string,
): { input: string; balanceMicro: number } | null {
  const normalizedOwner = owner.trim().toLowerCase();
  const candidates: Array<{ input: string; balanceMicro: number; spent: boolean; height: number; order: number }> = [];

  for (let index = 0; index < records.length; index += 1) {
    const rec = records[index];
    const plain = getRecordPlaintext(rec);
    if (!plain || !isVaultRecordPlaintext(plain)) continue;
    if (parseOwner(plain) !== normalizedOwner) continue;
    const input = serializeAnyRecordInput(plain);
    if (!input) continue;
    const balanceMicro = parseU64(fieldFromPlaintext(plain, "balance"));
    candidates.push({
      input,
      balanceMicro,
      spent: isRecordSpent(rec),
      height: extractRecordHeight(rec),
      order: index,
    });
  }

  const best = pickBestCandidate(candidates);
  if (!best) return null;
  return { input: best.input, balanceMicro: best.balanceMicro };
}

export function findPoolStateRecord(
  records: unknown[],
  owner: string,
  poolId: string,
): { input: string; feesMicro: number; shares: number } | null {
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedPool = poolId.trim().toLowerCase();
  const candidates: Array<{ input: string; feesMicro: number; shares: number; spent: boolean; height: number; order: number }> = [];

  for (let index = 0; index < records.length; index += 1) {
    const rec = records[index];
    const plain = getRecordPlaintext(rec);
    if (!plain || !isPoolStatePlaintext(plain)) continue;
    if (parseOwner(plain) !== normalizedOwner) continue;
    if (parsePoolId(plain).toLowerCase() !== normalizedPool) continue;
    const input = serializeAnyRecordInput(plain);
    if (!input) continue;
    const feesMicro = parseU64(fieldFromPlaintext(plain, "fees"));
    const shares = parseU64(fieldFromPlaintext(plain, "shares"));
    candidates.push({
      input,
      feesMicro,
      shares,
      spent: isRecordSpent(rec),
      height: extractRecordHeight(rec),
      order: index,
    });
  }

  const best = pickBestCandidate(candidates);
  if (!best) return null;
  return { input: best.input, feesMicro: best.feesMicro, shares: best.shares };
}
