import { voucherDb } from '../db.js';

export const listVoucherCategories = async (req, res) => {
  try {
    const query = `
      SELECT vc.*, 
        COUNT(vbc.voucher_brand_id) FILTER (WHERE vbc.is_deleted = false) as voucher_count
      FROM voucher_categories vc
      LEFT JOIN voucher_brand_categories vbc ON vc.id = vbc.category_id
      WHERE vc.is_deleted = false
      GROUP BY vc.id
      ORDER BY vc.id ASC
    `;
    
    const result = await voucherDb.query(query);
    
    res.json({ 
      success: true, 
      data: result.rows.map(row => ({
        ...row,
        voucher_count: parseInt(row.voucher_count)
      }))
    });
  } catch (err) {
    console.error("Error fetching voucher categories:", err);
    res.status(500).json({ 
      success: false, 
      message: "Database error occurred",
      error: err.message,
    });
  }
};

export const getVoucherCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await voucherDb.query(
      'SELECT * FROM voucher_categories WHERE id = $1 AND is_deleted = false',
      [id]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Error fetching voucher category:", err);
    res.status(500).json({ 
      success: false, 
      message: "Database error occurred",
      error: err.message,
    });
  }
};

export const createVoucherCategory = async (req, res) => {
  try {
    let { name, image_url } = req.body;

    name = name?.trim().toLowerCase();

    if (!name || !image_url) {
      return res.status(400).json({
        success: false,
        message: "name and image_url are required",
      });
    }

    const existing = await voucherDb.query(
      `SELECT * FROM voucher_categories 
       WHERE LOWER(TRIM(name)) = LOWER($1) AND is_deleted = false`,
      [name]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "A category with this name already exists",
      });
    }

    const result = await voucherDb.query(
      `INSERT INTO voucher_categories (name, image_url, is_deleted)
       VALUES ($1, $2, false)
       RETURNING *`,
      [name, image_url]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error creating voucher category:", err);
    res.status(500).json({
      success: false,
      message: "Database error occurred",
      error: err.message
    });
  }
};


export const updateVoucherCategory = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, image_url } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      name = name.trim().toLowerCase();

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "name cannot be empty",
        });
      }

      const existing = await voucherDb.query(
        `SELECT id FROM voucher_categories
         WHERE LOWER(TRIM(name)) = LOWER($1)
         AND is_deleted = false
         AND id <> $2`,
        [name, id]
      );

      if (existing.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: "A category with this name already exists",
        });
      }

      fields.push(`name = $${idx++}`);
      values.push(name);
    }

    if (image_url !== undefined) {
      fields.push(`image_url = $${idx++}`);
      values.push(image_url);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided to update",
      });
    }

    values.push(id);
    const query = `
      UPDATE voucher_categories
      SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${idx} AND is_deleted = false
      RETURNING *
    `;

    const result = await voucherDb.query(query, values);

    if (!result.rows[0]) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Error updating voucher category:", err);
    res.status(500).json({
      success: false,
      message: "Database error occurred",
      error: err.message,
    });
  }
};


export const deleteVoucherCategory = async (req, res) => {
  try {
    const { id } = req.params;

    await voucherDb.query('BEGIN');

    try {
      const vouchersOnlyLinkedQuery = `
        SELECT vb.id, vb.brand_name
        FROM voucher_brands vb
        WHERE vb.is_deleted = false
        AND (
          SELECT COUNT(*)
          FROM voucher_brand_categories vbc
          WHERE vbc.voucher_brand_id = vb.id
          AND vbc.is_deleted = false
          AND vbc.category_id = $1
        ) > 0
        AND (
          SELECT COUNT(*)
          FROM voucher_brand_categories vbc
          WHERE vbc.voucher_brand_id = vb.id
          AND vbc.is_deleted = false
        ) = 1
      `;

      const vouchersOnlyLinkedResult = await voucherDb.query(vouchersOnlyLinkedQuery, [id]);
      const vouchersOnlyLinked = vouchersOnlyLinkedResult.rows;

      if (vouchersOnlyLinked.length > 0) {
        await voucherDb.query('ROLLBACK');

        return res.status(400).json({
          success: false,
          message: "Cannot delete category - vouchers are linked only to this category",
          details: `The following ${vouchersOnlyLinked.length} voucher(s) are linked only to this category. Please delete or reassign these vouchers first.`,
          affectedVouchers: vouchersOnlyLinked.map(v => ({
            id: v.id,
            name: v.brand_name,
            message: `"${v.brand_name}" is only linked to this category`
          }))
        });
      }
      const deleteAssociationsResult = await voucherDb.query(
        'UPDATE voucher_brand_categories SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE category_id = $1',
        [id]
      );
      
      const deletedAssociationsCount = deleteAssociationsResult.rowCount
      const result = await voucherDb.query(
        'UPDATE voucher_categories SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_deleted = false RETURNING *',
        [id]
      );
      
      if (!result.rows[0]) {
        await voucherDb.query('ROLLBACK');
        return res.status(404).json({ 
          success: false, 
          message: "Category not found" 
        });
      }

      await voucherDb.query('COMMIT');
      
      res.json({ 
        success: true, 
        message: `Category and ${deletedAssociationsCount} associated links deleted successfully`, 
        data: {
          category: result.rows[0],
          deletedAssociationsCount: deletedAssociationsCount
        }
      });
    } catch (transactionErr) {
      await voucherDb.query('ROLLBACK');
      throw transactionErr;
    }
  } catch (err) {
    console.error("Error deleting voucher category:", err);
    res.status(500).json({ 
      success: false, 
      message: "Database error occurred",
      error: err.message,
    });
  }
};
