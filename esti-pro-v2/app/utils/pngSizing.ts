/** Read a PNG's natural pixel dimensions and fit it inside a point-sized box without distortion. */
export function fitPngWithinBox(bytes: Uint8Array, maxWidth: number, maxHeight: number) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error("Logo must be a valid PNG image.");
  }

  const readUint32 = (offset: number) =>
    bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
  const naturalWidth = readUint32(16);
  const naturalHeight = readUint32(20);
  if (!naturalWidth || !naturalHeight) throw new Error("Logo PNG has invalid dimensions.");

  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}
