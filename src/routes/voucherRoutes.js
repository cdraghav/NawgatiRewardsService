import express from 'express';
import {
  createVoucher,
  updateVoucher,
  deleteVoucher,
  getVouchers,
  getVoucherById,
} from '../controllers/voucherBrandsController.js';
import {
  listVoucherCategories,
  getVoucherCategoryById,
  createVoucherCategory,
  updateVoucherCategory,
  deleteVoucherCategory,
} from '../controllers/voucherCategoryControllers.js';
import { handleMulterError, uploadVoucherImages, validateTransparency } from '../lib/upload.js';
import { getActiveBrands, handleBrandUpdated, handleWalletLowBalance } from "../controllers/hubbleBrandControllers.js";

const router = express.Router();

router.get("/hubble-brands", getActiveBrands);
router.post('/hubble/update-voucher', handleBrandUpdated);
router.post('/hubble/low-balance', handleWalletLowBalance);

router.get('/categories', listVoucherCategories);
router.get('/categories/:id', getVoucherCategoryById);
router.post('/categories', createVoucherCategory);
router.put('/categories/:id', updateVoucherCategory);
router.delete('/categories/:id', deleteVoucherCategory);

router.get('/', getVouchers);
router.get('/:id', getVoucherById);
router.post(
  '/',
  uploadVoucherImages.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]),
  handleMulterError,
  validateTransparency,
  createVoucher
);

router.put(
  '/:id',
  uploadVoucherImages.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]),
  handleMulterError,
  updateVoucher
);
router.delete('/:id', deleteVoucher);

export default router;
