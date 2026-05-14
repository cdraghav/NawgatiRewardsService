import axios from "axios";
import { getHubbleToken } from "../lib/hubble.js";
import { voucherDb } from "../db.js";
import { zendutyRequest } from "../lib/zenduty.js";
import { HUBBLE_PARTNERS_PRODUCTS_URL } from "../lib/constants.js";

export const getActiveBrands = async (req, res) => {
  try {
    const token = await getHubbleToken();
    const response = await axios.get(
      HUBBLE_PARTNERS_PRODUCTS_URL,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const allBrands = response.data.data || [];

    const existingVendorIds = await voucherDb.query(
      'SELECT DISTINCT(vendor_id) FROM voucher_brands WHERE is_deleted = false'
    );

    const existingVendorIdSet = new Set(
      existingVendorIds.rows.map(row => row.vendor_id)
    );

    const availableBrands = allBrands.filter(
      brand => !existingVendorIdSet.has(brand.id)
    );

    return res.json({
      success: true,
      data: {
        ...response.data,
        data: availableBrands,
        total: availableBrands.length,
        totalFromHubble: allBrands.length,
        alreadyImported: allBrands.length - availableBrands.length,
      },
    });
    
  } catch (err) {
    console.error("Error fetching active brands:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch active brands",
      error: err.message,
    });
  }
};

export const handleBrandUpdated = async (req, res) => {
  try {
    const {
      id: vendorId,
      denominationType,
      status,
      denominations,
      amountRestrictions,
    } = req.body;

    const existingBrand = await voucherDb.query(
      'SELECT id FROM voucher_brands WHERE vendor_id = $1 AND is_deleted = false',
      [vendorId]
    );

    if (existingBrand.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Brand not found in database',
      });
    }

    const brandId = existingBrand.rows[0].id;

    await voucherDb.query(
      `UPDATE voucher_brands 
       SET 
         status = $2,
         denomination_type = $3,
         denominations = $4,
         min_amount_p = $5,
         max_amount_p = $6,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        brandId,
        status,
        denominationType,
        denominations,
        amountRestrictions?.minOrderAmount || null,
        amountRestrictions?.maxOrderAmount || null,
      ]
    );


    return res.status(200).json({
      success: true,
      message: 'Brand updated successfully',
    });

  } catch (err) {
    console.error('Error updating brand from webhook:', err);
    return res.status(200).json({
      success: false,
      message: 'Error processing webhook',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};
export const syncHubbleDiscounts = async (req, res) => {
  try {
    const { diffAll, applyChanges } = await import(
      "../../scripts/syncHubbleDiscounts.js"
    );
    const apply = req.query.apply === "true" || req.body?.apply === true;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((n) => Number(n)).filter(Number.isFinite)
      : null;
    const fields = Array.isArray(req.body?.fields)
      ? req.body.fields.map((s) => String(s))
      : null;

    const diff = await diffAll();
    let applied = null;
    if (apply) applied = await applyChanges(diff.changed, ids, fields);

    // Strip the internal _hubbleBrand carrier — only used for the apply path.
    const clientChanged = diff.changed.map(({ _hubbleBrand, ...rest }) => rest);
    return res.json({
      success: true,
      data: { ...diff, changed: clientChanged, applied },
    });
  } catch (err) {
    console.error("Error syncing Hubble data:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to sync Hubble data",
      error: err.message,
    });
  }
};

export const handleWalletLowBalance = async (req, res) => {
  try {
    const { balance, threshold } = req.body;

    // await voucherDb.query(
    //   `INSERT INTO wallet_balance_alerts (balance, threshold, created_at)
    //    VALUES ($1, $2, CURRENT_TIMESTAMP)`,
    //   [balance, threshold]
    // );

    const payload = {
      alert_type: 'low_balance',
      title: 'Wallet Low Balance Alert',
      description: `The wallet balance has dropped below the safe threshold.\n\n**Details:**\n- Current Balance: ₹${balance}\n- Threshold: ₹${threshold}\n\nImmediate attention is recommended to avoid service disruption.`,
    };

    await zendutyRequest(payload);

    return res.status(200).json({
      success: true,
      message: 'Low balance alert processed successfully.',
    });

  } catch (err) {
    console.error('Error processing low balance webhook:', err);
    return res.status(200).json({
      success: false,
      message: 'Error processing webhook',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

