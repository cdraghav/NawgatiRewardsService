import sharp from 'sharp';
import xml2js from 'xml2js';

const extractColorFromSVG = async (svgBuffer) => {
  try {
    const svgString = svgBuffer.toString('utf-8');
    const parser = new xml2js.Parser();
    const svgObject = await parser.parseStringPromise(svgString);

    const colors = [];

    const extractFromElement = (element) => {
      if (!element) return;

      if (Array.isArray(element)) {
        element.forEach(el => extractFromElement(el));
        return;
      }

      if (element.$ && element.$.fill) {
        const fill = element.$.fill;
        if (fill && fill !== 'none' && fill !== 'transparent') {
          colors.push(fill);
        }
      }

      if (element.$ && element.$.stroke) {
        const stroke = element.$.stroke;
        if (stroke && stroke !== 'none' && stroke !== 'transparent') {
          colors.push(stroke);
        }
      }

      for (const key in element) {
        if (key !== '$' && Array.isArray(element[key])) {
          extractFromElement(element[key]);
        }
      }
    };

    if (svgObject && svgObject.svg) {
      extractFromElement(svgObject.svg);
    }

    if (colors.length === 0) {

      return '#000000';
    }

    const dominantColor = colors.find(c => c && c !== 'none' && c !== 'transparent') || '#000000';
    
    let normalizedColor = dominantColor;
    if (dominantColor.startsWith('#')) {
      normalizedColor = dominantColor.length === 7 ? dominantColor : dominantColor.slice(0, 7);
    } else if (dominantColor.toLowerCase().startsWith('rgb')) {
      const rgbMatch = dominantColor.match(/\d+/g);
      if (rgbMatch && rgbMatch.length >= 3) {
        const [r, g, b] = rgbMatch.slice(0, 3);
        normalizedColor = '#' + [r, g, b].map(x => {
          const hex = parseInt(x).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        }).join('').toUpperCase();
      }
    }

    return normalizedColor;
  } catch (err) {
    console.error('Error parsing SVG:', err);
    throw new Error(`Failed to extract color from SVG: ${err.message}`);
  }
};

export const extractDominantColorFromBuffer = async (imageBuffer, mimeType) => {
  try {
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Invalid or empty image buffer');
    }



    if (mimeType === 'image/svg+xml') {

      const dominantColor = await extractColorFromSVG(imageBuffer);
      
      return {
        dominantColor,
        palette: {
          vibrant: dominantColor,
          darkVibrant: null,
          lightVibrant: null,
          muted: null,
          darkMuted: null,
          lightMuted: null,
        },
        isSvg: true,
      };
    }

    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(mimeType)) {
      throw new Error(`Unsupported image format: ${mimeType}`);
    }

    const metadata = await sharp(imageBuffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image dimensions');
    }

    const resizedBuffer = await sharp(imageBuffer)
      .resize(100, 100, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: false });



    let r = 0, g = 0, b = 0;
    const pixelCount = resizedBuffer.length / 3;

    if (pixelCount === 0) {
      throw new Error('No pixels extracted from image');
    }



    for (let i = 0; i < resizedBuffer.length; i += 3) {
      r += resizedBuffer[i];
      g += resizedBuffer[i + 1];
      b += resizedBuffer[i + 2];
    }

    r = Math.round(r / pixelCount);
    g = Math.round(g / pixelCount);
    b = Math.round(b / pixelCount);

    const toHex = (n) => {
      const hex = n.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    const dominantColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();




    return {
      dominantColor,
      palette: {
        vibrant: dominantColor,
        darkVibrant: null,
        lightVibrant: null,
        muted: null,
        darkMuted: null,
        lightMuted: null,
      },
      isSvg: false,
    };
  } catch (err) {
    console.error('Error extracting color:', err);
    throw new Error(err.message);
  }
};
