#!/usr/bin/env node
/*
 * Compare every field we store against the Hubble API, optionally apply.
 *
 * Usage:
 *   node scripts/syncHubbleDiscounts.js                 # dry-run, prints diff
 *   node scripts/syncHubbleDiscounts.js --apply         # overwrite DB with Hubble values
 *   node scripts/syncHubbleDiscounts.js --json          # machine-readable output
 *
 * Required env (same as the service):
 *   HUBBLE_CLIENT_ID, HUBBLE_CLIENT_SECRET
 *   NAWGATI_POSTGRES_HOST, NAWGATI_POSTGRES_PORT, NAWGATI_POSTGRES_DB,
 *   NAWGATI_POSTGRES_USER, NAWGATI_POSTGRES_PASSWORD
 */

import { voucherDb } from "../db.js";
import { getHubbleToken } from "./hubble.js";
import { HUBBLE_PARTNERS_PRODUCTS_URL } from "./constants.js";
import { buildPartialUpdate } from "./voucherFieldSanitizers.js";
import axios from "axios";

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return { apply: flags.has("--apply"), json: flags.has("--json") };
}

// -------- value normalization -----------------------------------------------

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Matches the create/update path which uses parseInt(value) — truncates,
// does not round. Keeps DB writes and the diff symmetric.
const intOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

// Matches voucherBrandsController: lowercases each, expands
// "online_and_offline" into both online + offline, dedupes, returns sorted.
const normalizeRedemptionTypes = (arr) => {
  const set = new Set();
  for (const raw of arr) {
    const t = String(raw).toLowerCase().trim();
    if (t === "online_and_offline") {
      set.add("online");
      set.add("offline");
    } else if (t === "online" || t === "offline") {
      set.add(t);
    }
    // Anything else is intentionally dropped — that's also what the
    // controller does at write time.
  }
  return [...set].sort();
};

const strOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const lowerOrNull = (v) => {
  const s = strOrNull(v);
  return s ? s.toLowerCase() : null;
};

/**
 * Coerce a value coming from either pg, Hubble, or a JS literal into an array
 * of strings. pg's node driver sometimes hands us text[] as a literal string
 * like `{a,b,"with space"}` (especially via outer queries / json projections),
 * which `Array.isArray` rejects — handle that form too.
 */
function toArray(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "" || s === "{}" || s === "[]") return [];
    // Postgres array literal: {a,b,"c, d"}
    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1);
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '"' && inner[i - 1] !== "\\") {
          inQuotes = !inQuotes;
          continue;
        }
        if (ch === "," && !inQuotes) {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      if (cur.length > 0 || inner.length > 0) out.push(cur);
      return out.map((x) => x.replace(/\\"/g, '"'));
    }
    // JSON array
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [v];
  }
  return [v];
}

const sortedStrArray = (v) =>
  [...toArray(v).map((x) => String(x))].sort();

const sortedNumArray = (v) =>
  [...toArray(v).map((x) => Number(x)).filter(Number.isFinite)].sort(
    (a, b) => a - b,
  );

// Matches the create path which writes denominations via parseInt(d) into int[].
const sortedIntArray = (v) =>
  [...toArray(v)
    .map((x) => parseInt(String(x), 10))
    .filter(Number.isFinite)].sort((a, b) => a - b);

// JSON.stringify preserves key insertion order, so naive equality false-flags
// identical objects whose keys arrived in a different order
// (e.g. {App, Website} vs {Website, App}). Canonicalize first.
function canon(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canon);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
  return out;
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// -------- field map: how to read each field from Hubble + DB ----------------

/**
 * Each field describes:
 *   key      — short identifier used in the diff payload
 *   label    — human label
 *   column   — DB column to update
 *   pgType   — postgres cast for parameterized update (e.g. "text", "int", "text[]")
 *   fromDb   — read normalized value out of our row
 *   fromHub  — read normalized value out of a Hubble brand
 *   toPg     — convert hubble value into something pg can accept for this column
 */
const FIELDS = [
  {
    key: "discount_percentage",
    label: "Discount %",
    column: "discount_percentage",
    pgType: "numeric",
    fromDb: (r) => numOrNull(r.discount_percentage),
    fromHub: (b) => numOrNull(b.discountPercentage),
    toPg: (v) => v,
  },
  {
    key: "status",
    label: "Status",
    column: "status",
    pgType: "text",
    fromDb: (r) => lowerOrNull(r.status),
    fromHub: (b) => lowerOrNull(b.status),
    toPg: (v) => v,
  },
  {
    key: "denomination_type",
    label: "Denomination type",
    column: "denomination_type",
    pgType: "text",
    fromDb: (r) => lowerOrNull(r.denomination_type),
    fromHub: (b) => lowerOrNull(b.denominationType),
    toPg: (v) => v,
  },
  {
    key: "min_amount_p",
    label: "Min amount",
    column: "min_amount_p",
    pgType: "int",
    fromDb: (r) => intOrNull(r.min_amount_p),
    fromHub: (b) => intOrNull(b.amountRestrictions?.minAmount),
    toPg: (v) => intOrNull(v),
  },
  {
    key: "max_amount_p",
    label: "Max amount",
    column: "max_amount_p",
    pgType: "int",
    fromDb: (r) => intOrNull(r.max_amount_p),
    fromHub: (b) => intOrNull(b.amountRestrictions?.maxAmount),
    toPg: (v) => intOrNull(v),
  },
  {
    key: "denominations",
    label: "Denominations",
    column: "denominations",
    pgType: "int[]",
    fromDb: (r) => sortedIntArray(r.denominations),
    fromHub: (b) =>
      sortedIntArray(b.amountRestrictions?.denominations || b.denominations || []),
    toPg: (v) => v,
  },
  {
    key: "voucher_expiry_in_months",
    label: "Expiry (months)",
    column: "voucher_expiry_in_months",
    pgType: "int",
    fromDb: (r) => intOrNull(r.voucher_expiry_in_months),
    fromHub: (b) => intOrNull(b.voucherExpiryInMonths),
    toPg: (v) => intOrNull(v),
  },
  {
    key: "redemption_types",
    label: "Redemption types",
    column: "redemption_types",
    pgType: "text[]",
    fromDb: (r) => normalizeRedemptionTypes(toArray(r.redemption_types)),
    fromHub: (b) => {
      const arr = Array.isArray(b.redemptionTypes)
        ? b.redemptionTypes
        : b.redemptionType
          ? [b.redemptionType]
          : [];
      return normalizeRedemptionTypes(arr);
    },
    toPg: (v) => v,
  },
  {
    key: "tnc_url",
    label: "T&C URL",
    column: "tnc_url",
    pgType: "text",
    fromDb: (r) => strOrNull(r.tnc_url),
    fromHub: (b) => strOrNull(b.termsAndConditionsUrl || b.tncUrl),
    toPg: (v) => v,
  },
  {
    key: "tnc",
    label: "Terms",
    column: "tnc",
    pgType: "text[]",
    fromDb: (r) => sortedStrArray(r.tnc || []),
    fromHub: (b) => sortedStrArray(b.termsAndConditions || []),
    toPg: (v) => v,
  },
  {
    key: "usage_instructions",
    label: "How to use",
    column: "usage_instructions",
    pgType: "jsonb",
    // Why split compare vs display:
    //   - Hubble groups steps by `retailModeName` per brand ("Website"/"App"
    //     for AJIO, "App"/"Website" for Amazon, etc.) — the same label maps to
    //     different channels across brands, so it's not a stable classifier.
    //   - Our DB stores `{ONLINE, OFFLINE}` (frontend writes via
    //     usageinstructionsONLINE[]/OFFLINE[]).
    // Equality runs on the flat sorted set of instruction strings so neither
    // bucket-name nor ordering differences false-flag. The displayed value
    // keeps the *real* structure each side uses, so the dashboard can render
    // "Website: …", "App: …" exactly as Hubble groups them.
    fromDb: (r) => {
      let u = r.usage_instructions;
      if (typeof u === "string") {
        try { u = JSON.parse(u); } catch { u = {}; }
      }
      if (!u || typeof u !== "object") return {};
      const out = {};
      for (const [k, v] of Object.entries(u)) out[k] = sortedStrArray(v);
      return out;
    },
    fromHub: (b) => {
      // Preserve Hubble's grouping by `retailModeName`. Fall back to the
      // older flat `usageInstructions` shape only if howToUseInstructions
      // is absent.
      const out = {};
      if (Array.isArray(b.howToUseInstructions)) {
        for (const item of b.howToUseInstructions) {
          if (!item || typeof item !== "object") continue;
          const name = String(item.retailModeName || "").trim();
          if (!name) continue;
          const steps =
            item.instructions ||
            item.steps ||
            item.howToUseInstructions ||
            item.howToUseInstructionsList ||
            [];
          out[name] = sortedStrArray([
            ...(out[name] || []),
            ...toArray(steps).map((s) => String(s)),
          ]);
        }
        return out;
      }
      const legacy = b.usageInstructions;
      if (legacy && typeof legacy === "object") {
        for (const [k, v] of Object.entries(legacy)) out[k] = sortedStrArray(v);
      }
      return out;
    },
    // No `compare` helper — equality runs on the structured form directly.
    // That intentionally surfaces brands like AJIO where the bucket layout
    // (Hubble: Website/App via retailModeName) differs from how we store
    // it (ONLINE/OFFLINE). The panel renders each side's actual grouping so
    // you can see exactly how Hubble organises the instructions.
    // When applying a fix we still need the {ONLINE, OFFLINE} bucketing the
    // controller expects. Classify each Hubble entry by `retailMode` (the
    // actual ONLINE/OFFLINE flag); ignore retailModeName for write since its
    // values aren't channels. Items whose retailMode is missing get dropped.
    toPg: (_diffValue, hubbleBrand) => {
      const out = { ONLINE: [], OFFLINE: [] };
      const arr = Array.isArray(hubbleBrand?.howToUseInstructions)
        ? hubbleBrand.howToUseInstructions
        : [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const mode = String(item.retailMode || item.mode || "")
          .trim()
          .toUpperCase();
        if (mode !== "ONLINE" && mode !== "OFFLINE") continue;
        const steps = item.instructions || item.steps || [];
        for (const s of toArray(steps)) out[mode].push(String(s));
      }
      // Legacy fallback if Hubble only ships the flat shape.
      if (out.ONLINE.length === 0 && out.OFFLINE.length === 0) {
        const legacy = hubbleBrand?.usageInstructions;
        if (legacy && typeof legacy === "object") {
          if (legacy.ONLINE) out.ONLINE = toArray(legacy.ONLINE).map(String);
          if (legacy.OFFLINE) out.OFFLINE = toArray(legacy.OFFLINE).map(String);
        }
      }
      return JSON.stringify(out);
    },
  },
];

// -------- fetchers ----------------------------------------------------------

async function fetchHubbleBrands() {
  const token = await getHubbleToken();
  const res = await axios.get(HUBBLE_PARTNERS_PRODUCTS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.data || [];
}

async function fetchImportedVouchers() {
  const { rows } = await voucherDb.query(
    `SELECT id, vendor_id, brand_name, status, denomination_type,
            min_amount_p, max_amount_p, denominations,
            tnc_url, tnc, usage_instructions,
            voucher_expiry_in_months, discount_percentage, redemption_types
       FROM voucher_brands
      WHERE is_deleted = false
        AND vendor_id IS NOT NULL`,
  );
  return rows;
}

// -------- diff --------------------------------------------------------------

export async function diffAll() {
  const [hubbleBrands, ourVouchers] = await Promise.all([
    fetchHubbleBrands(),
    fetchImportedVouchers(),
  ]);

  const hubbleById = new Map(hubbleBrands.map((b) => [b.id, b]));

  const changed = [];
  const missingFromHubble = [];

  for (const v of ourVouchers) {
    const hubble = hubbleById.get(v.vendor_id);
    if (!hubble) {
      missingFromHubble.push({
        id: v.id,
        vendorId: v.vendor_id,
        brandName: v.brand_name,
      });
      continue;
    }
    const diffs = [];
    for (const f of FIELDS) {
      const ours = f.fromDb(v);
      const theirs = f.fromHub(hubble);
      const cmpOurs = f.compare ? f.compare(ours) : ours;
      const cmpTheirs = f.compare ? f.compare(theirs) : theirs;
      if (!eq(cmpOurs, cmpTheirs)) {
        diffs.push({ key: f.key, label: f.label, ours, hubble: theirs });
      }
    }
    if (diffs.length > 0) {
      changed.push({
        id: v.id,
        vendorId: v.vendor_id,
        brandName: v.brand_name,
        diffs,
        // Carry the raw Hubble brand so the apply step can read shapes
        // (e.g. howToUseInstructions) that aren't captured in the diff values.
        _hubbleBrand: hubble,
      });
    }
  }

  return {
    summary: {
      checked: ourVouchers.length,
      hubbleBrandsFetched: hubbleBrands.length,
      changedCount: changed.length,
      missingFromHubbleCount: missingFromHubble.length,
    },
    changed,
    missingFromHubble,
  };
}

// Back-compat alias used by older callers.
export const diffDiscounts = diffAll;

// -------- apply -------------------------------------------------------------

/**
 * Apply changes back to the DB.
 *
 * @param changes        full list from diffAll().changed
 * @param idsFilter      optional [voucherId] — restrict to subset
 * @param fieldsFilter   optional [fieldKey]  — restrict to specific fields per voucher
 */
/**
 * Translate a Hubble-shaped value into the raw form the controller-side
 * sanitizer (voucherFieldSanitizers.COLUMN_SANITIZERS) expects. The hubble
 * value comes from the diff record; for fields whose shape on Hubble doesn't
 * match how we store it (usage_instructions), we use the raw brand to
 * reclassify.
 */
function hubbleToControllerValue(fieldKey, diffHubbleValue, hubbleBrand) {
  if (fieldKey === "usage_instructions") {
    // Mirror the create/edit shape: a JSON object keyed by `retailModeName`.
    // The sanitizer preserves whichever keys come in, so once a row is
    // Fixed, the next Sync will compare {Website,App,…} on both sides
    // and stop re-flagging.
    const out = {};
    const arr = Array.isArray(hubbleBrand?.howToUseInstructions)
      ? hubbleBrand.howToUseInstructions
      : [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const name = String(item.retailModeName || "").trim();
      if (!name) continue;
      const steps = item.instructions || item.steps || [];
      if (Array.isArray(steps) && steps.length > 0) {
        out[name] = [...(out[name] || []), ...steps.map((s) => String(s))];
      }
    }
    // Legacy fallback if howToUseInstructions is absent.
    if (Object.keys(out).length === 0) {
      const legacy = hubbleBrand?.usageInstructions;
      if (legacy && typeof legacy === "object") {
        for (const [k, v] of Object.entries(legacy)) {
          if (Array.isArray(v) && v.length > 0) out[k] = v.map(String);
        }
      }
    }
    return out;
  }
  return diffHubbleValue;
}

export async function applyChanges(changes, idsFilter = null, fieldsFilter = null) {
  const targets = (idsFilter && idsFilter.length > 0
    ? changes.filter((c) => idsFilter.includes(c.id))
    : changes
  ).map((c) => ({
    ...c,
    diffs:
      fieldsFilter && fieldsFilter.length > 0
        ? c.diffs.filter((d) => fieldsFilter.includes(d.key))
        : c.diffs,
  }));

  if (targets.length === 0) {
    return { updated: 0, updatedIds: [], failed: [] };
  }

  const client = await voucherDb.getClient();
  const updatedIds = [];
  const failed = [];
  try {
    await client.query("BEGIN");
    for (const c of targets) {
      if (c.diffs.length === 0) continue;

      // Translate every diff into the column→rawValue map the shared
      // sanitizer accepts. This is the same path PUT /api/voucher/:id uses.
      const rawByColumn = {};
      for (const d of c.diffs) {
        rawByColumn[d.key] = hubbleToControllerValue(
          d.key,
          d.hubble,
          c._hubbleBrand,
        );
      }
      const { sets, values } = buildPartialUpdate(rawByColumn);
      if (sets.length === 0) continue;
      values.push(c.id);
      const query = `UPDATE voucher_brands SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} AND is_deleted = false`;

      try {
        const res = await client.query(query, values);
        if (res.rowCount > 0) updatedIds.push(c.id);
        else failed.push({ id: c.id, reason: "no_row_updated" });
      } catch (err) {
        failed.push({ id: c.id, reason: err.message });
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { updated: updatedIds.length, updatedIds, failed };
}

// Back-compat alias used by older callers (discount-only).
export const applyDiscountUpdates = applyChanges;
