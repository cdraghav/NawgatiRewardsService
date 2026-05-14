/*
 * Single source of truth for sanitizing voucher_brands column values before
 * write. Used by:
 *   - voucherBrandsController.updateVoucher (PUT /api/voucher/:id)
 *   - voucherBrandsController.createVoucher (POST /api/voucher) — for the
 *     fields that benefit from it
 *   - scripts/syncHubbleDiscounts.js applyChanges (Fix via Hubble sync)
 *
 * Each sanitizer receives a raw value (could be from req.body, from a
 * computed Hubble translation, or from anywhere else) and returns either
 *   - { value, pgCast }  — write this; pgCast may be omitted
 *   - undefined          — column should NOT be updated (the caller didn't
 *                          provide a value for it)
 *
 * Returning `{ value: null }` explicitly clears the column to NULL.
 */

const strOrUndef = (v) => (v === undefined ? undefined : v === null ? null : String(v));

const intOrNull = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

const floatOrNull = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const toIntArrayOrNull = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Array.isArray(v)) return null;
  return v.map((d) => parseInt(d, 10)).filter(Number.isFinite);
};

const toStrArrayOrNull = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Array.isArray(v)) return null;
  return v.map((s) => String(s));
};

// Matches createVoucher: lowercase, expand "online_and_offline", dedupe.
const sanitizeRedemptionTypes = (v) => {
  if (v === undefined) return undefined;
  if (v === null || !Array.isArray(v) || v.length === 0) return null;
  const set = new Set();
  for (const raw of v) {
    const t = String(raw).toLowerCase().trim();
    if (t === "online_and_offline") {
      set.add("online");
      set.add("offline");
    } else if (t === "online" || t === "offline") {
      set.add(t);
    }
  }
  return [...set];
};

// Accept any keyed object (legacy {ONLINE, OFFLINE}, or new Hubble shape
// like {Website: […], App: […]} grouped by retailModeName). Preserve
// whatever keys come in; values must be string arrays.
const sanitizeUsageInstructions = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    try { v = JSON.parse(s); } catch { return null; }
  }
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const [key, val] of Object.entries(v)) {
    const k = String(key).trim();
    if (!k) continue;
    if (Array.isArray(val) && val.length > 0) {
      out[k] = val.map(String);
    }
  }
  return out;
};

/**
 * Map from DB column → sanitizer. Each entry returns `{value, pgCast?}` or
 * undefined.
 */
export const COLUMN_SANITIZERS = {
  status: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  brand_name: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  brand_desc: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  denomination_type: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  logo_url: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  cover_image_url: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  banner_image_url: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  color_code: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  min_amount_p: (v) => {
    const n = intOrNull(v);
    return n === undefined ? undefined : { value: n, pgCast: "int" };
  },
  max_amount_p: (v) => {
    const n = intOrNull(v);
    return n === undefined ? undefined : { value: n, pgCast: "int" };
  },
  denominations: (v) => {
    const arr = toIntArrayOrNull(v);
    return arr === undefined ? undefined : { value: arr, pgCast: "int[]" };
  },
  tnc_url: (v) => {
    const s = strOrUndef(v);
    return s === undefined ? undefined : { value: s };
  },
  tnc: (v) => {
    const arr = toStrArrayOrNull(v);
    return arr === undefined ? undefined : { value: arr, pgCast: "text[]" };
  },
  usage_instructions: (v) => {
    const obj = sanitizeUsageInstructions(v);
    return obj === undefined
      ? undefined
      : { value: obj === null ? null : JSON.stringify(obj), pgCast: "jsonb" };
  },
  voucher_expiry_in_months: (v) => {
    const n = intOrNull(v);
    return n === undefined ? undefined : { value: n, pgCast: "int" };
  },
  discount_percentage: (v) => {
    const n = floatOrNull(v);
    return n === undefined ? undefined : { value: n, pgCast: "numeric" };
  },
  redemption_types: (v) => {
    const arr = sanitizeRedemptionTypes(v);
    return arr === undefined ? undefined : { value: arr, pgCast: "text[]" };
  },
};

/**
 * Given an object keyed by DB column → raw value, produce the SQL fragments
 * and bound values for a partial UPDATE. Columns whose sanitizer returns
 * `undefined` are skipped — that's how a caller indicates "don't touch this
 * column".
 *
 * @returns { sets: string[], values: any[] }
 */
export function buildPartialUpdate(rawByColumn) {
  const sets = [];
  const values = [];
  for (const [column, raw] of Object.entries(rawByColumn)) {
    const sanitizer = COLUMN_SANITIZERS[column];
    if (!sanitizer) continue;
    const result = sanitizer(raw);
    if (result === undefined) continue;
    const cast = result.pgCast ? `::${result.pgCast}` : "";
    values.push(result.value);
    sets.push(`${column} = $${values.length}${cast}`);
  }
  return { sets, values };
}
