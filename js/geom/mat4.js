// Row-major 4x4 matrices as flat arrays of 16 (three.js Matrix4.set order).
import { sind, cosd } from './shape.js';

export const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul4(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
    r[i * 4 + j] = s;
  }
  return r;
}
export const translate4 = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
export const scale4 = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
export function rotX(a) { const c = cosd(a), s = sind(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
export function rotY(a) { const c = cosd(a), s = sind(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }
export function rotZ(a) { const c = cosd(a), s = sind(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
// OpenSCAD rotate([x,y,z]) = Rz * Ry * Rx
export const rotXYZ = (x, y, z) => mul4(rotZ(z), mul4(rotY(y), rotX(x)));
export function rotAxis(a, [x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  const c = cosd(a), s = sind(a), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1];
}
export function mirror4([x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  return [
    1 - 2 * x * x, -2 * x * y, -2 * x * z, 0,
    -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0,
    -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0,
    0, 0, 0, 1];
}
export const apply4 = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11]];

// The 2D affine this 3D transform induces on flat geometry, or null if it
// tips the XY plane out of itself.
export function to2D(m) {
  const eps = 1e-9;
  if (Math.abs(m[2]) > eps || Math.abs(m[6]) > eps || Math.abs(m[8]) > eps || Math.abs(m[9]) > eps) return null;
  return [m[0], m[4], m[1], m[5], m[3], m[7]];
}
