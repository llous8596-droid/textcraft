// Helper Upstash Redis via REST API
const getUrl = () => process.env.UPSTASH_REDIS_REST_URL;
const getToken = () => process.env.UPSTASH_REDIS_REST_TOKEN;

export async function kvGet(key) {
  try {
    const res = await fetch(`${getUrl()}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const data = await res.json();
    if (data.result === null || data.result === undefined) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch (e) {
    console.error('kvGet error:', e);
    return null;
  }
}

export async function kvSet(key, value) {
  try {
    const serialized = JSON.stringify(value);
    const res = await fetch(`${getUrl()}/set/${encodeURIComponent(key)}/${encodeURIComponent(serialized)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const data = await res.json();
    return data.result === 'OK';
  } catch (e) {
    console.error('kvSet error:', e);
    return false;
  }
}

export async function kvKeys(pattern) {
  try {
    const res = await fetch(`${getUrl()}/keys/${encodeURIComponent(pattern)}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const data = await res.json();
    return data.result || [];
  } catch (e) {
    console.error('kvKeys error:', e);
    return [];
  }
}
