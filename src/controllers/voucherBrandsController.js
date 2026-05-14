import { voucherDb } from '../db.js';
import { CLOUDFRONT_BASE_URL } from '../lib/constants.js';
import { buildPartialUpdate } from '../lib/voucherFieldSanitizers.js';

const getCloudFrontUrl = (s3Key) => {
  if (!s3Key) return null;
  return `${CLOUDFRONT_BASE_URL}/${s3Key}`;
};

export const createVoucher = async (req, res) => {
  try {
    const {
      vendorid,
      status,
      brandname,
      branddesc,
      denominationtype,
      colorcode,
      minamountp,
      maxamountp,
      denominations,
      tncurl,
      tnc,
      voucherexpiryinmonths,
      discountpercentage,
      redemptiontypes,
      categoryids,
      logourl,
      usageinstructions,
      usageinstructionsONLINE,
      usageinstructionsOFFLINE,
    } = req.body;

    const uploadedLogo = req.files?.logo?.[0];
    const uploadedCover = req.files?.cover?.[0];
    const uploadedBanner = req.files?.banner?.[0];

    const logo_url = uploadedLogo
      ? getCloudFrontUrl(uploadedLogo.key)
      : (logourl || null);

    const cover_image_url = uploadedCover
      ? getCloudFrontUrl(uploadedCover.key)
      : null;

    const banner_image_url = uploadedBanner
      ? getCloudFrontUrl(uploadedBanner.key)
      : null;

    const parsedCategoryIds = categoryids 
      ? (Array.isArray(categoryids) ? categoryids.map(id => parseInt(id)) : null)
      : null;

    if (!vendorid) {
      return res.status(400).json({
        success: false,
        message: "vendorid is required",
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "status is required",
      });
    }

    if (!brandname) {
      return res.status(400).json({
        success: false,
        message: "brandname is required",
      });
    }

    if (!denominationtype) {
      return res.status(400).json({
        success: false,
        message: "denominationtype is required",
      });
    }

    if (!colorcode) {
      return res.status(400).json({
        success: false,
        message: "colorcode is required",
      });
    }

    if (!discountpercentage || parseFloat(discountpercentage) <= 0) {
      return res.status(400).json({
        success: false,
        message: "discountpercentage is required and must be greater than 0",
      });
    }

    if (!logo_url) {
      return res.status(400).json({
        success: false,
        message: "logo is required",
      });
    }

    if (!cover_image_url) {
      return res.status(400).json({
        success: false,
        message: "cover image is required",
      });
    }

    if (!banner_image_url) {
      return res.status(400).json({
        success: false,
        message: "banner image is required",
      });
    }

    if (!parsedCategoryIds || parsedCategoryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "at least one category is required",
      });
    }

    const existingVoucher = await voucherDb.query(
      'SELECT id, brand_name FROM voucher_brands WHERE vendor_id = $1 AND is_deleted = false',
      [vendorid]
    );

    if (existingVoucher.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Duplicate voucher not allowed. A voucher for "${existingVoucher.rows[0].brand_name}" with this vendor ID already exists.`,
      });
    }

    const parsedDenominations = denominations 
      ? (Array.isArray(denominations) ? denominations.map(d => parseInt(d)) : null)
      : null;

    const parsedTnc = tnc 
      ? (Array.isArray(tnc) ? tnc : null)
      : null;

    // Prefer the new JSON-encoded `usageinstructions` keyed by retailModeName
    // (e.g. {"Website": [...], "App": [...]}). Fall back to the legacy
    // ONLINE/OFFLINE form fields for older callers.
    let parsedUsageInstructions = null;
    if (usageinstructions) {
      try {
        const parsed =
          typeof usageinstructions === "string"
            ? JSON.parse(usageinstructions)
            : usageinstructions;
        if (parsed && typeof parsed === "object") {
          parsedUsageInstructions = {};
          for (const [k, v] of Object.entries(parsed)) {
            parsedUsageInstructions[k] = Array.isArray(v) ? v : [];
          }
        }
      } catch {
        parsedUsageInstructions = null;
      }
    } else if (usageinstructionsONLINE || usageinstructionsOFFLINE) {
      parsedUsageInstructions = {};
      if (usageinstructionsONLINE) {
        parsedUsageInstructions.ONLINE = Array.isArray(usageinstructionsONLINE) ? usageinstructionsONLINE : [];
      }
      if (usageinstructionsOFFLINE) {
        parsedUsageInstructions.OFFLINE = Array.isArray(usageinstructionsOFFLINE) ? usageinstructionsOFFLINE : [];
      }
    }

    let parsedRedemptionTypes = null;
    if (redemptiontypes && Array.isArray(redemptiontypes) && redemptiontypes.length > 0) {
      const typesSet = new Set();
      
      redemptiontypes.forEach(type => {
        const lowerType = type.toLowerCase();
        if (lowerType === "online_and_offline") {
          typesSet.add("online");
          typesSet.add("offline");
        } else if (lowerType === "online" || lowerType === "offline") {
          typesSet.add(lowerType);
        }
      });
      
      parsedRedemptionTypes = Array.from(typesSet);
    }

    const result = await voucherDb.query(
      `INSERT INTO voucher_brands
      (vendor_id, status, brand_name, brand_desc, denomination_type, logo_url, cover_image_url, banner_image_url, color_code,
        min_amount_p, max_amount_p, denominations, tnc_url, tnc, usage_instructions,
        voucher_expiry_in_months, discount_percentage, redemption_types, is_deleted)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, false)
      RETURNING *`,
      [
        vendorid,
        status,
        brandname,
        branddesc || null,
        denominationtype,
        logo_url,
        cover_image_url,
        banner_image_url,
        colorcode,
        minamountp ? parseInt(minamountp) : null,
        maxamountp ? parseInt(maxamountp) : null,
        parsedDenominations,
        tncurl || null,
        parsedTnc,
        parsedUsageInstructions,
        voucherexpiryinmonths ? parseInt(voucherexpiryinmonths) : null,
        parseFloat(discountpercentage),
        parsedRedemptionTypes,
      ]
    );

    const voucherBrand = result.rows[0];

    const categoryInserts = parsedCategoryIds.map((category_id) =>
      voucherDb.query(
        'INSERT INTO voucher_brand_categories (voucher_brand_id, category_id, is_deleted) VALUES ($1, $2, false) ON CONFLICT (voucher_brand_id, category_id) DO NOTHING',
        [voucherBrand.id, category_id]
      )
    );
    await Promise.all(categoryInserts);

    res.status(201).json({ success: true, data: voucherBrand });
  } catch (err) {
    console.error("Error creating voucher brand:", err);
    res.status(500).json({
      success: false,
      message: "Database error occurred",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const updateVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      brandname,
      branddesc,
      denominationtype,
      colorcode,
      minamountp,
      maxamountp,
      denominations,
      tncurl,
      tnc,
      voucherexpiryinmonths,
      discountpercentage,
      redemptiontypes,
      categoryids,
      logourl,
      coverurl,
      bannerurl,
      usageinstructions,
      usageinstructionsONLINE,
      usageinstructionsOFFLINE,
    } = req.body;

    const uploadedLogo = req.files?.logo?.[0];
    const uploadedCover = req.files?.cover?.[0];
    const uploadedBanner = req.files?.banner?.[0];

    const logo_url = uploadedLogo
      ? getCloudFrontUrl(uploadedLogo.key)
      : (logourl || undefined);

    const cover_image_url = uploadedCover
      ? getCloudFrontUrl(uploadedCover.key)
      : (coverurl || undefined);

    const banner_image_url = uploadedBanner
      ? getCloudFrontUrl(uploadedBanner.key)
      : (bannerurl || undefined);

    if (discountpercentage !== undefined && parseFloat(discountpercentage) <= 0) {
      return res.status(400).json({
        success: false,
        message: "discountpercentage must be greater than 0",
      });
    }

    if (categoryids !== undefined) {
      const parsedCategoryIds = Array.isArray(categoryids) ? categoryids.map(id => parseInt(id)) : [];
      if (parsedCategoryIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "at least one category is required",
        });
      }
    }

    // Build a raw-value-per-column map and let the shared sanitizers handle
    // parsing, casts and `undefined` → "don't touch" semantics. This is the
    // ONLY place that controllers should describe field naming — sanitation
    // lives in voucherFieldSanitizers.js so the sync apply path uses the
    // same logic.
    let rawUsageInstructions;
    if (req.body.usage_instructions !== undefined) {
      // Direct jsonb payload (sync Fix path).
      rawUsageInstructions = req.body.usage_instructions;
    } else if (usageinstructions !== undefined) {
      // New shape from the import / edit form: a JSON object keyed by
      // retailModeName (Hubble's grouping). Pass through to the sanitizer.
      rawUsageInstructions =
        typeof usageinstructions === "string"
          ? (() => { try { return JSON.parse(usageinstructions); } catch { return null; } })()
          : usageinstructions;
    } else if (usageinstructionsONLINE !== undefined || usageinstructionsOFFLINE !== undefined) {
      // Legacy split-array payload.
      rawUsageInstructions = {
        ONLINE: Array.isArray(usageinstructionsONLINE) ? usageinstructionsONLINE : [],
        OFFLINE: Array.isArray(usageinstructionsOFFLINE) ? usageinstructionsOFFLINE : [],
      };
    }

    const rawByColumn = {
      status,
      brand_name: brandname,
      brand_desc: branddesc,
      denomination_type: denominationtype,
      logo_url,
      cover_image_url,
      banner_image_url,
      color_code: colorcode,
      min_amount_p: minamountp,
      max_amount_p: maxamountp,
      denominations,
      tnc_url: tncurl,
      tnc,
      usage_instructions: rawUsageInstructions,
      voucher_expiry_in_months: voucherexpiryinmonths,
      discount_percentage: discountpercentage,
      redemption_types: redemptiontypes,
    };

    const { sets, values } = buildPartialUpdate(rawByColumn);

    if (sets.length === 0 && !categoryids) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    if (sets.length > 0) {
      values.push(id);
      const query = `UPDATE voucher_brands SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} AND is_deleted = false RETURNING *`;
      const result = await voucherDb.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Voucher brand not found",
        });
      }
    }

    if (categoryids) {
      const newCategoryIds = Array.isArray(categoryids) ? categoryids.map(id => parseInt(id)) : [];
      
      const existingCategoriesResult = await voucherDb.query(
        'SELECT category_id FROM voucher_brand_categories WHERE voucher_brand_id = $1 AND is_deleted = false',
        [id]
      );
      const existingCategoryIds = existingCategoriesResult.rows.map(row => row.category_id);

      const categoriesToAdd = newCategoryIds.filter(catId => !existingCategoryIds.includes(catId));
      const categoriesToRemove = existingCategoryIds.filter(catId => !newCategoryIds.includes(catId));

      if (categoriesToAdd.length > 0) {
        const categoryInserts = categoriesToAdd.map((category_id) =>
          voucherDb.query(
            'INSERT INTO voucher_brand_categories (voucher_brand_id, category_id, is_deleted) VALUES ($1, $2, false) ON CONFLICT (voucher_brand_id, category_id) DO UPDATE SET is_deleted = false',
            [id, category_id]
          )
        );
        await Promise.all(categoryInserts);
      }

      if (categoriesToRemove.length > 0) {
        const categoryRemoves = categoriesToRemove.map((category_id) =>
          voucherDb.query(
            'UPDATE voucher_brand_categories SET is_deleted = true WHERE voucher_brand_id = $1 AND category_id = $2',
            [id, category_id]
          )
        );
        await Promise.all(categoryRemoves);
      }
    }

    const finalQuery = `
      SELECT vb.*,
        array_agg(DISTINCT vc.id) FILTER (WHERE vc.id IS NOT NULL AND vbc.is_deleted = false) as category_ids,
        array_agg(DISTINCT vc.name) FILTER (WHERE vc.name IS NOT NULL AND vbc.is_deleted = false) as category_names
      FROM voucher_brands vb
      LEFT JOIN voucher_brand_categories vbc ON vb.id = vbc.voucher_brand_id
      LEFT JOIN voucher_categories vc ON vbc.category_id = vc.id
      WHERE vb.id = $1 AND vb.is_deleted = false
      GROUP BY vb.id
    `;
    const finalResult = await voucherDb.query(finalQuery, [id]);
    
    res.status(200).json({ success: true, data: finalResult.rows[0] });
  } catch (err) {
    console.error("Error updating voucher brand:", err);
    res.status(500).json({
      success: false,
      message: "Database error occurred",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};


export const deleteVoucher = async (req, res) => {
  try {
    const { id } = req.params;

    await voucherDb.query('UPDATE voucher_brand_categories SET is_deleted = true WHERE voucher_brand_id = $1', [id]);

    const result = await voucherDb.query(
      "UPDATE voucher_brands SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_deleted = false RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Voucher brand not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Voucher brand deleted successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error deleting voucher brand:", err);
    res.status(500).json({
      success: false,
      message: "Database error occurred",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getVouchers = async (req, res) => {
  try {
    const { vendor_id, status } = req.query;

    const categoriesResult = await voucherDb.query(
      'SELECT * FROM voucher_categories WHERE is_deleted = false ORDER BY id ASC'
    );
    const categories = categoriesResult.rows;

    if (categories.length === 0) {
      return res.status(200).json({
        success: true,
        data: {},
        message: "No categories found",
      });
    }

    let query = `
      SELECT DISTINCT vb.*,
        array_agg(DISTINCT vc.id) FILTER (WHERE vc.id IS NOT NULL AND vbc.is_deleted = false) as category_ids,
        array_agg(DISTINCT vc.name) FILTER (WHERE vc.name IS NOT NULL AND vbc.is_deleted = false) as category_names
      FROM voucher_brands vb
      LEFT JOIN voucher_brand_categories vbc ON vb.id = vbc.voucher_brand_id AND vbc.is_deleted = false
      LEFT JOIN voucher_categories vc ON vbc.category_id = vc.id AND vc.is_deleted = false
      WHERE vb.is_deleted = false
    `;
    const queryParams = [];
    let paramCount = 1;

    if (vendor_id) {
      query += ` AND vb.vendor_id = $${paramCount++}`;
      queryParams.push(vendor_id);
    }

    if (status) {
      query += ` AND vb.status = $${paramCount++}`;
      queryParams.push(status);
    }

    query += " GROUP BY vb.id ORDER BY vb.created_at DESC";

    const result = await voucherDb.query(query, queryParams);

    const vouchersWithCategories = result.rows.map(voucher => ({
      ...voucher,
      categories: voucher.category_ids ? voucher.category_ids.map((id, index) => ({
        id,
        name: voucher.category_names[index]
      })) : []
    }));

    const groupedData = {};
    
    categories.forEach(category => {
      const categoryVouchers = vouchersWithCategories.filter(voucher =>
        voucher.category_ids && voucher.category_ids.includes(category.id)
      );
      
      groupedData[category.name] = {
        image_url: category.image_url,
        vouchers: categoryVouchers,
      };
    });

    res.status(200).json({
      success: true,
      data: groupedData,
    });
  } catch (err) {
    console.error("Error fetching vouchers:", err);
    res.status(500).json({
      success: false,
      message: "Database error occurred",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getVoucherById = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT vb.*,
        array_agg(DISTINCT vc.id) FILTER (WHERE vc.id IS NOT NULL AND vbc.is_deleted = false) as category_ids,
        array_agg(DISTINCT vc.name) FILTER (WHERE vc.name IS NOT NULL AND vbc.is_deleted = false) as category_names
      FROM voucher_brands vb
      LEFT JOIN voucher_brand_categories vbc ON vb.id = vbc.voucher_brand_id AND vbc.is_deleted = false
      LEFT JOIN voucher_categories vc ON vbc.category_id = vc.id AND vc.is_deleted = false
      WHERE vb.id = $1 AND vb.is_deleted = false
      GROUP BY vb.id
    `;

    const result = await voucherDb.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Voucher brand not found",
      });
    }

    const voucher = result.rows[0];
    const voucherWithCategories = {
      ...voucher,
      categories: voucher.category_ids ? voucher.category_ids.map((id, index) => ({
        id,
        name: voucher.category_names[index]
      })) : []
    };

    res.status(200).json({ success: true, data: voucherWithCategories });
  } catch (err) {
    console.error("Error fetching voucher brand:", err);
    res.status(500).json({
      success: false,
      message: "Database error occurred",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};
