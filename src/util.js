export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function clean(value, max, multiline = false) {
  let s = String(value ?? "").replace(/\r\n/g, "\n");
  s = multiline ? s.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CANONICAL_HOST = "gutsmartlive.com";

// gutsmartlive.org, www.gutsmartlive.org and www.gutsmartlive.com all forward to gutsmartlive.com.
// Returns the redirect target, or null when the request is already on the main domain.
export function canonicalRedirect(url) {
  const u = new URL(url);
  if (u.hostname === CANONICAL_HOST || !/(^|\.)gutsmartlive\.(com|org)$/.test(u.hostname)) return null;
  u.hostname = CANONICAL_HOST;
  u.protocol = "https:";
  u.port = "";
  return u.toString();
}
