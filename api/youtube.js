const INVIDIOUS = [
  'https://yewtu.be',
  'https://invidious.projectsegfau.lt',
  'https://inv.riverside.rocks',
  'https://yt.cdaut.de',
  'https://iv.ggtyler.dev',
];

async function tryCobalt(id) {
  try {
    const r = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${id}`,
        downloadMode: 'audio',
        audioFormat: 'best',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if ((data.status === 'redirect' || data.status === 'tunnel') && data.url) return data.url;
  } catch {}
  return null;
}

async function tryInvidious(id) {
  for (const base of INVIDIOUS) {
    try {
      const r = await fetch(`${base}/api/v1/videos/${id}?fields=adaptiveFormats`, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const stream = (data.adaptiveFormats || [])
        .filter(s => s.type?.startsWith('audio/') && s.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (stream?.url) return stream.url;
    } catch {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const url = (await tryCobalt(id)) || (await tryInvidious(id));

  if (url) {
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ url });
  }

  res.status(502).json({ error: 'YouTube 오디오를 가져올 수 없습니다' });
};
