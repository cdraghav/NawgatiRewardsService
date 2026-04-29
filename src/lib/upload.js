import multer from "multer";
import multerS3 from "multer-s3";
import { s3Client, S3_BUCKET } from "../config/s3.js";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import sanitize from "sanitize-filename";
import sharp from "sharp";

const allowedMimeTypes = [
  "image/png",
  "image/svg+xml",
];

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only PNG and SVG images are allowed."
      ),
      false
    );
  }
};

const streamToBuffer = async (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};


export const validateTransparency = async (req, res, next) => {
  if (!req.files || (!req.files.logo && !req.files.cover)) {
    return next();
  }

  try {
    const filesToCheck = [];
    if (req.files.logo) filesToCheck.push(...req.files.logo);
    if (req.files.cover) filesToCheck.push(...req.files.cover);

    for (const file of filesToCheck) {
      const fieldLabel = file.fieldname === 'logo' ? 'Logo' : 'Cover image';

      try {
        // 1. Download the file from S3 (applies to both PNG and SVG)
        const command = new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: file.key,
        });

        const response = await s3Client.send(command);
        const buffer = await streamToBuffer(response.Body);

        // 2. Handle SVG validation
        if (file.mimetype === 'image/svg+xml') {
          const svgContent = buffer.toString('utf-8');
          
          // Check for the problematic <image> tag with embedded base64 data
          if (svgContent.includes('<image') && svgContent.includes('data:image')) {
            
            // Delete the invalid file
            await s3Client.send(new DeleteObjectCommand({
              Bucket: S3_BUCKET,
              Key: file.key,
            }));
            
            return res.status(400).json({
              success: false,
              message: `${fieldLabel} is invalid.`,
              details: "SVGs with embedded images (PNG/JPG) are not allowed. Please upload a pure vector SVG or a PNG file.",
            });
          }
          // If it's a valid, pure vector SVG, we're good.
        
        // 3. Handle PNG validation (your existing logic)
        } else if (file.mimetype === 'image/png') {
          const metadata = await sharp(buffer).metadata();
          
          if (!metadata.hasAlpha) {
            
            // Delete the invalid file
            await s3Client.send(new DeleteObjectCommand({
              Bucket: S3_BUCKET,
              Key: file.key,
            }));

            return res.status(400).json({
              success: false,
              message: `${fieldLabel} must have a transparent background`,
              details: "Please upload a PNG image with transparency.",
            });
          }
          // If it's a valid PNG with transparency, we're good.
        }
        
      } catch (fileErr) {
        console.error(`Error processing ${file.fieldname}:`, fileErr);
        
        // Attempt to delete the file if processing failed
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: file.key,
          }));
        } catch (deleteErr) {
          console.error("Error deleting file after processing error:", deleteErr);
        }

        return res.status(400).json({
          success: false,
          message: `Error processing ${file.fieldname}`,
          details: "The uploaded file could not be validated. Please try again with a different image.",
          error: process.env.NODE_ENV === "development" ? fileErr.message : undefined,
        });
      }
    }

    // All files were validated successfully
    next();
  } catch (err) {
    console.error("Error in validateTransparency middleware:", err);
    
    return res.status(500).json({
      success: false,
      message: "Failed to validate images",
      details: "An unexpected error occurred while validating the uploaded images.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

const generateFileName = (fieldname, originalname) => {
  const fileExtension = path.extname(originalname);
  const baseFileName = path.basename(originalname, fileExtension);
  const sanitizedName = sanitize(baseFileName).substring(0, 50);
  const timestamp = Date.now();
  const uniqueId = uuidv4().split("-")[0];
  
  return `${sanitizedName}-${timestamp}-${uniqueId}${fileExtension}`;
};

export const uploadVoucherImages = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, {
        fieldName: file.fieldname,
        originalName: file.originalname,
        uploadedBy: req.user?.id || "unknown",
        uploadedAt: new Date().toISOString(),
        brandName: req.body.brand_name || "unknown",
      });
    },
    key: (req, file, cb) => {
      let folder;
      
      if (file.fieldname === "logo") {
        folder = "vouchers/logo";
      } else if (file.fieldname === "cover") {
        folder = "vouchers/cover-image";
      } else {
        folder = "vouchers/other";
      }
      
      const fileName = generateFileName(file.fieldname, file.originalname);
      const fullPath = `${folder}/${fileName}`;
      
      cb(null, fullPath);
    },
  }),
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large',
        details: 'Maximum file size is 5MB.',
      });
    }
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      details: err.message,
    });
  }
  
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Upload failed',
    });
  }
  
  next();
};

export const colorDetectionUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/png', 'image/svg+xml'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Only PNG and SVG are supported.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});
