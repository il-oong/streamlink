const APIS = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://api.piped.projectsegfau.lt',
];

module.exports = async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  for (const base of APIS) {
    try {
      const r = await fetch(`${base}/streams/${id}`, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const stream = (data.audioStreams || [])
        .filter(s => s.url && s.mimeType)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (stream?.url) {
        res.setHeader('Cache-Control', 's-maxage=300');
        return res.status(200).json({ url: stream.url, mimeType: stream.mimeType });
      }
    } catch {}
  }

  res.status(502).json({ error: 'YouTube 오디오를 가져올 수 없습니다' });
};
