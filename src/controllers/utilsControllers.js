import { extractDominantColorFromBuffer } from '../lib/extractDominantColor.js';

export const detectDominantColor = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const filename = req.file.originalname;

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image file - buffer is empty',
      });
    }

    const colorData = await extractDominantColorFromBuffer(fileBuffer, mimeType);

    res.status(200).json({
      success: true,
      data: {
        dominantColor: colorData.dominantColor,
        palette: colorData.palette,
        filename: filename,
        isSvg: colorData.isSvg,
      },
    });
  } catch (err) {
    console.error('Error detecting dominant color:', err);
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to detect dominant color from image',
      error: err.message,
    });
  }
};
