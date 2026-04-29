import { voucherDb } from '../db.js';

const CLOUDFRONT_BASE_URL = 'https://dxamcuehe5m0b.cloudfront.net';

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
      usageinstructionsONLINE,
      usageinstructionsOFFLINE,
    } = req.body;

    const uploadedLogo = req.files?.logo?.[0];
    const uploadedCover = req.files?.cover?.[0];

    const logo_url = uploadedLogo 
      ? getCloudFrontUrl(uploadedLogo.key)
      : (logourl || null);
    
    const cover_image_url = uploadedCover 
      ? getCloudFrontUrl(uploadedCover.key)
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

    let parsedUsageInstructions = null;
    if (usageinstructionsONLINE || usageinstructionsOFFLINE) {
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
      (vendor_id, status, brand_name, brand_desc, denomination_type, logo_url, cover_image_url, color_code,
        min_amount_p, max_amount_p, denominations, tnc_url, tnc, usage_instructions,
        voucher_expiry_in_months, discount_percentage, redemption_types, is_deleted)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, false)
      RETURNING *`,
      [
        vendorid,
        status,
        brandname,
        branddesc || null,
        denominationtype,
        logo_url,
        cover_image_url,
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
      usageinstructionsONLINE,
      usageinstructionsOFFLINE,
    } = req.body;

    const uploadedLogo = req.files?.logo?.[0];
    const uploadedCover = req.files?.cover?.[0];

    const logo_url = uploadedLogo 
      ? getCloudFrontUrl(uploadedLogo.key)
      : (logourl || undefined);
    
    const cover_image_url = uploadedCover 
      ? getCloudFrontUrl(uploadedCover.key)
      : (coverurl || undefined);

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

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (status !== undefined) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(status);
    }
    if (brandname !== undefined) {
      updateFields.push(`brand_name = $${paramCount++}`);
      updateValues.push(brandname);
    }
    if (branddesc !== undefined) {
      updateFields.push(`brand_desc = $${paramCount++}`);
      updateValues.push(branddesc);
    }
    if (denominationtype !== undefined) {
      updateFields.push(`denomination_type = $${paramCount++}`);
      updateValues.push(denominationtype);
    }
    if (logo_url !== undefined) {
      updateFields.push(`logo_url = $${paramCount++}`);
      updateValues.push(logo_url);
    }
    if (cover_image_url !== undefined) {
      updateFields.push(`cover_image_url = $${paramCount++}`);
      updateValues.push(cover_image_url);
    }
    if (colorcode !== undefined) {
      updateFields.push(`color_code = $${paramCount++}`);
      updateValues.push(colorcode);
    }
    if (minamountp !== undefined) {
      updateFields.push(`min_amount_p = $${paramCount++}`);
      updateValues.push(parseInt(minamountp));
    }
    if (maxamountp !== undefined) {
      updateFields.push(`max_amount_p = $${paramCount++}`);
      updateValues.push(parseInt(maxamountp));
    }
    if (denominations !== undefined) {
      const denoArray = Array.isArray(denominations) ? denominations.map(d => parseInt(d)) : null;
      updateFields.push(`denominations = $${paramCount++}`);
      updateValues.push(denoArray);
    }
    if (tncurl !== undefined) {
      updateFields.push(`tnc_url = $${paramCount++}`);
      updateValues.push(tncurl);
    }
    if (tnc !== undefined) {
      const tncArray = Array.isArray(tnc) ? tnc : null;
      updateFields.push(`tnc = $${paramCount++}`);
      updateValues.push(tncArray);
    }

    if (usageinstructionsONLINE || usageinstructionsOFFLINE) {
      const parsedUsageInstructions = {};
      if (usageinstructionsONLINE) {
        parsedUsageInstructions.ONLINE = Array.isArray(usageinstructionsONLINE) ? usageinstructionsONLINE : [];
      }
      if (usageinstructionsOFFLINE) {
        parsedUsageInstructions.OFFLINE = Array.isArray(usageinstructionsOFFLINE) ? usageinstructionsOFFLINE : [];
      }
      updateFields.push(`usage_instructions = $${paramCount++}`);
      updateValues.push(parsedUsageInstructions);
    }

    if (voucherexpiryinmonths !== undefined) {
      updateFields.push(`voucher_expiry_in_months = $${paramCount++}`);
      updateValues.push(parseInt(voucherexpiryinmonths));
    }
    if (discountpercentage !== undefined) {
      updateFields.push(`discount_percentage = $${paramCount++}`);
      updateValues.push(parseFloat(discountpercentage));
    }
    
    if (redemptiontypes !== undefined) {
      let parsedRedemptionTypes = null;
      if (Array.isArray(redemptiontypes) && redemptiontypes.length > 0) {
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
      updateFields.push(`redemption_types = $${paramCount++}`);
      updateValues.push(parsedRedemptionTypes);
    }

    if (updateFields.length === 0 && !categoryids) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateValues.push(id);

      const query = `UPDATE voucher_brands SET ${updateFields.join(", ")} WHERE id = $${paramCount} AND is_deleted = false RETURNING *`;
      const result = await voucherDb.query(query, updateValues);

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
