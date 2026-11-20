const maxBytes = 128 * 1024;
const validSize = (width, height) => width > 0 && height > 0 && width <= 1024 && height <= 1024;

function png(bytes, data) {
  if (data.getUint32(0) !== 0x89504e47 || data.getUint32(4) !== 0x0d0a1a0a ||
      data.getUint32(8) !== 13 || data.getUint32(12) !== 0x49484452 ||
      !validSize(data.getUint32(16), data.getUint32(20))) return false;
  let hasPixels = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = data.getUint32(offset);
    const tag = data.getUint32(offset + 4);
    offset += 12 + size;
    if (offset > bytes.length || tag === 0x6163544c) return false; // No APNG.
    if (tag === 0x49444154 && size > 0) hasPixels = true;
    if (tag === 0x49454e44) return hasPixels && size === 0 && offset === bytes.length;
  }
  return false;
}

function jpeg(bytes, data) {
  if (data.getUint16(0) !== 0xffd8 || data.getUint16(bytes.length - 2) !== 0xffd9) return false;
  let hasFrame = false;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const tag = bytes[offset++];
    const size = data.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) return false;
    if (tag >= 0xc0 && tag <= 0xc2) {
      if (size < 8 || !validSize(data.getUint16(offset + 5), data.getUint16(offset + 3))) return false;
      hasFrame = true;
    }
    if (tag === 0xda) return size >= 6 && hasFrame && offset + size < bytes.length - 2;
    offset += size;
  }
  return false;
}

function webp(bytes, data) {
  if (data.getUint32(0) !== 0x52494646 || data.getUint32(8) !== 0x57454250 ||
      data.getUint32(4, true) + 8 !== bytes.length) return false;
  // Simple still WebP, in lossy or lossless form. Extended and animated
  // containers are unnecessary for an avatar.
  const size = data.getUint32(16, true);
  if (20 + size + (size & 1) !== bytes.length) return false;
  switch (data.getUint32(12)) {
    case 0x56503820:
      return size >= 10 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a &&
        validSize(data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff);
    case 0x5650384c: {
      if (size < 5 || bytes[20] !== 0x2f) return false;
      const dimensions = data.getUint32(21, true);
      return validSize((dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1);
    }
    default: return false;
  }
}

export function validAvatar(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 24) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  try {
    const raw = atob(match[2]);
    if (raw.length < 24 || raw.length > maxBytes || btoa(raw) !== match[2]) return false;
    const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
    return { png, jpeg, webp }[match[1]](bytes, new DataView(bytes.buffer));
  } catch {
    return false;
  }
}
