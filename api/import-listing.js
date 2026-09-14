const ALLOWED_HOSTS = [
  'realestate.com.au',
  'www.realestate.com.au',
  'domain.com.au',
  'www.domain.com.au',
  'raineandhorne.com.au',
  'www.raineandhorne.com.au',
];

function decode(value = '') {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function findDescription(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDescription(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const type = Array.isArray(value['@type']) ? value['@type'].join(' ') : String(value['@type'] || '');
  if (/Residence|House|Apartment|Product|RealEstateListing|Accommodation/i.test(type) && value.description) {
    return decode(String(value.description));
  }
  for (const child of Object.values(value)) {
    const found = findDescription(child);
    if (found) return found;
  }
  return '';
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decode(match[1]);
  }
  return '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  let target;
  try { target = new URL(String(req.query.url || '')); }
  catch { return res.status(400).json({ error: 'Enter a valid listing URL.' }); }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.includes(target.hostname.toLowerCase())) {
    return res.status(400).json({ error: 'Use a Raine & Horne, Domain or realestate.com.au listing link.' });
  }

  try {
    const response = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; EvanGamkrelidzeWebsite/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error(`Listing page returned ${response.status}`);
    const html = await response.text();
    if (html.length > 5000000) throw new Error('Listing page was too large');

    let description = '';
    const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const script of scripts) {
      try {
        description = findDescription(JSON.parse(script[1]));
        if (description) break;
      } catch { /* Some portals include invalid JSON-LD; continue to metadata. */ }
    }
    description ||= meta(html, 'og:description') || meta(html, 'description');
    if (!description || description.length < 40) {
      return res.status(422).json({ error: 'This listing page did not expose an importable description.' });
    }
    return res.status(200).json({ description: description.slice(0, 12000), source: target.toString() });
  } catch (error) {
    return res.status(502).json({ error: `The listing site blocked the import or could not be reached: ${error.message}` });
  }
}
