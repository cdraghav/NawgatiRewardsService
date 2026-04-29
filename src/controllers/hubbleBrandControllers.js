import axios from "axios";
import { getHubbleToken } from "../lib/hubble";
import { voucherDb } from "../db";
import { zendutyRequest } from "../lib/zenduty";

export const getActiveBrands = async (req, res) => {
  try {
    const token = await getHubbleToken();

    const response = await axios.get(
      "https://api.dev.myhubble.money/v1/partners/products",
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
      console.log(`Brand with vendor_id ${vendorId} not found. Skipping update.`);
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

    console.log(`Successfully updated brand with vendor_id: ${vendorId}`);

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

