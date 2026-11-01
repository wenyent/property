// SVY21 <-> WGS84 (lat/lon) conversion for Singapore.
// URA gives project locations in SVY21 metres; MRT exits come as lat/lon.
// Standard Transverse Mercator formulas with SVY21 parameters.

const a = 6378137;
const f = 1 / 298.257223563;
const oLat = 1.366666, oLon = 103.833333;     // origin
const oN = 38744.572, oE = 28001.642;          // false northing / easting
const k = 1;
const rad = Math.PI / 180;

const b = a * (1 - f);
const e2 = 2 * f - f * f;
const e4 = e2 * e2, e6 = e4 * e2;
const A0 = 1 - e2 / 4 - (e4 * 3) / 64 - (e6 * 5) / 256;
const A2 = (3 / 8) * (e2 + e4 / 4 + (e6 * 15) / 128);
const A4 = (15 / 256) * (e4 + (e6 * 3) / 4);
const A6 = (35 * e6) / 3072;

function meridianDist(latR) {
  return a * (A0 * latR - A2 * Math.sin(2 * latR) + A4 * Math.sin(4 * latR) - A6 * Math.sin(6 * latR));
}
const M0 = meridianDist(oLat * rad);

function toSVY21(lat, lon) {
  const latR = lat * rad;
  const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
  const cos2 = cosLat * cosLat, cos3 = cos2 * cosLat, cos4 = cos3 * cosLat;
  const cos5 = cos4 * cosLat, cos6 = cos5 * cosLat, cos7 = cos6 * cosLat;
  const rho = (a * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const v = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const psi = v / rho;
  const t = Math.tan(latR);
  const w = (lon - oLon) * rad;
  const M = meridianDist(latR);
  const w2 = w * w, w4 = w2 * w2, w6 = w4 * w2, w8 = w6 * w2;
  const t2 = t * t, t4 = t2 * t2, t6 = t4 * t2;
  const psi2 = psi * psi, psi3 = psi2 * psi, psi4 = psi3 * psi;

  const N1 = (w2 / 2) * v * sinLat * cosLat;
  const N2 = (w4 / 24) * v * sinLat * cos3 * (4 * psi2 + psi - t2);
  const N3 = (w6 / 720) * v * sinLat * cos5 *
    (8 * psi4 * (11 - 24 * t2) - 28 * psi3 * (1 - 6 * t2) + psi2 * (1 - 32 * t2) - psi * 2 * t2 + t4);
  const N4 = (w8 / 40320) * v * sinLat * cos7 * (1385 - 3111 * t2 + 543 * t4 - t6);
  const N = oN + k * (M - M0 + N1 + N2 + N3 + N4);

  const E1 = w2 / 6 * cos2 * (psi - t2);
  const E2 = (w4 / 120) * cos4 *
    (4 * psi3 * (1 - 6 * t2) + psi2 * (1 + 8 * t2) - psi * 2 * t2 + t4);
  const E3 = (w6 / 5040) * cos6 * (61 - 479 * t2 + 179 * t4 - t6);
  const E = oE + k * v * w * cosLat * (1 + E1 + E2 + E3);
  return { E, N };
}

function toLatLon(N, E) {
  const Nprime = N - oN;
  const Mprime = M0 + Nprime / k;
  const n = (a - b) / (a + b), n2 = n * n, n3 = n2 * n, n4 = n2 * n2;
  const G = a * (1 - n) * (1 - n2) * (1 + (9 * n2) / 4 + (225 * n4) / 64) * rad;
  const sigma = (Mprime * Math.PI) / (180 * G);
  const latPrime = sigma + ((3 * n) / 2 - (27 * n3) / 32) * Math.sin(2 * sigma)
    + ((21 * n2) / 16 - (55 * n4) / 32) * Math.sin(4 * sigma)
    + ((151 * n3) / 96) * Math.sin(6 * sigma) + ((1097 * n4) / 512) * Math.sin(8 * sigma);
  const sinP = Math.sin(latPrime);
  const rhoP = (a * (1 - e2)) / Math.pow(1 - e2 * sinP * sinP, 1.5);
  const vP = a / Math.sqrt(1 - e2 * sinP * sinP);
  const psiP = vP / rhoP, psiP2 = psiP * psiP, psiP3 = psiP2 * psiP, psiP4 = psiP3 * psiP;
  const tP = Math.tan(latPrime), tP2 = tP * tP, tP4 = tP2 * tP2, tP6 = tP4 * tP2;
  const Eprime = E - oE;
  const x = Eprime / (k * vP), x2 = x * x, x3 = x2 * x, x5 = x3 * x2, x7 = x5 * x2;

  const latFactor = tP / (k * rhoP);
  const L1 = latFactor * ((Eprime * x) / 2);
  const L2 = latFactor * ((Eprime * x3) / 24) * (-4 * psiP2 + 9 * psiP * (1 - tP2) + 12 * tP2);
  const L3 = latFactor * ((Eprime * x5) / 720) *
    (8 * psiP4 * (11 - 24 * tP2) - 12 * psiP3 * (21 - 71 * tP2) + 15 * psiP2 * (15 - 98 * tP2 + 15 * tP4)
      + 180 * psiP * (5 * tP2 - 3 * tP4) + 360 * tP4);
  const L4 = latFactor * ((Eprime * x7) / 40320) * (1385 - 3633 * tP2 + 4095 * tP4 + 1575 * tP6);
  const lat = (latPrime - L1 + L2 - L3 + L4) / rad;

  const secP = 1 / Math.cos(latPrime);
  const X1 = x * secP;
  const X2 = ((x3 * secP) / 6) * (psiP + 2 * tP2);
  const X3 = ((x5 * secP) / 120) * (-4 * psiP3 * (1 - 6 * tP2) + psiP2 * (9 - 68 * tP2) + 72 * psiP * tP2 + 24 * tP4);
  const X4 = ((x7 * secP) / 5040) * (61 + 662 * tP2 + 1320 * tP4 + 720 * tP6);
  const lon = oLon + (X1 - X2 + X3 - X4) / rad;
  return { lat, lon };
}

module.exports = { toSVY21, toLatLon };
