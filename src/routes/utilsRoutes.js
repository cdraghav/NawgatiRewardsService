import express from 'express';
import { colorDetectionUpload, handleMulterError } from '../lib/upload';
import { detectDominantColor } from '../controllers/utilsControllers';

const router = express.Router();

router.post(
  '/detect-color',
  colorDetectionUpload.single('image'),
  handleMulterError,
  detectDominantColor
);

export default router;
