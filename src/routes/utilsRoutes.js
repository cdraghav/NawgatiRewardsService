import express from 'express';
import { colorDetectionUpload, handleMulterError } from '../lib/upload.js';
import { detectDominantColor } from '../controllers/utilsControllers.js';

const router = express.Router();

router.post(
  '/detect-color',
  colorDetectionUpload.single('image'),
  handleMulterError,
  detectDominantColor
);

export default router;
