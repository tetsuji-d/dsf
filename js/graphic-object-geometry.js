export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function resizeGraphicFrame(f, corner, dx, dy, aspect = false) {
  const a = f.rotation * Math.PI / 180, x = dx * Math.cos(a) + dy * Math.sin(a), y = -dx * Math.sin(a) + dy * Math.cos(a);
  const sx = corner.includes("w") ? -1 : 1, sy = corner.includes("n") ? -1 : 1;
  let w = clamp(f.width + x * sx, 1, 3600), h = clamp(f.height + y * sy, 1, 6400);
  if (aspect) {
    w = Math.min(w, 6400 * f.width / f.height);
    h = w * f.height / f.width;
  }
  const cx = (w - f.width) * sx / 2, cy = (h - f.height) * sy / 2;
  return { ...f, width: w, height: h, x: clamp(f.x + f.width / 2 + cx * Math.cos(a) - cy * Math.sin(a) - w / 2, -3600, 3600), y: clamp(f.y + f.height / 2 + cx * Math.sin(a) + cy * Math.cos(a) - h / 2, -6400, 6400) };
}
export function rotateGraphicFrame(f, startAngle, angle, snap = false) {
  let r = f.rotation + (angle - startAngle) * 180 / Math.PI;
  if (snap) r = Math.round(r / 15) * 15;
  return { ...f, rotation: ((r + 180) % 360 + 360) % 360 - 180 };
}
export function cropGraphicFrame(f, oldCrop, crop, flipX = false, flipY = false) {
  const sx = f.width / oldCrop.width, sy = f.height / oldCrop.height;
  const w = crop.width * sx, h = crop.height * sy;
  const x = (flipX ? oldCrop.x + oldCrop.width - crop.x - crop.width : crop.x - oldCrop.x) * sx;
  const y = (flipY ? oldCrop.y + oldCrop.height - crop.y - crop.height : crop.y - oldCrop.y) * sy;
  const dx = x + w / 2 - f.width / 2, dy = y + h / 2 - f.height / 2, a = f.rotation * Math.PI / 180;
  return { ...f, x: f.x + f.width / 2 + dx * Math.cos(a) - dy * Math.sin(a) - w / 2, y: f.y + f.height / 2 + dx * Math.sin(a) + dy * Math.cos(a) - h / 2, width: w, height: h };
}
