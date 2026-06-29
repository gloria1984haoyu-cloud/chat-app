export const config = { regions: ['hkg1'] };

const FALLBACK_PUBLIC_KEY = 'BMe3CEiLb3zQR7cKQipgVZIMLIHNC0UIHs5eASiUwxd097_FpnmG-j6dTWHUxr8orWRnwXWBh2chcITM4HBHRfg';

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  sendJson(res, 200, { publicKey: process.env.VAPID_PUBLIC_KEY || FALLBACK_PUBLIC_KEY });
}
