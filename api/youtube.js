module.exports = async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const { Innertube } = await import('youtubei.js');
    console.log('Innertube imported');

    const yt = await Innertube.create({ cache: false, generate_session_locally: true });
    console.log('Innertube created');

    const info = await yt.getBasicInfo(id, 'TV_EMBEDDED');
    console.log('got basic info, formats:', info.streaming_data?.adaptive_formats?.length);

    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    console.log('format chosen:', format?.mime_type, format?.url?.slice(0, 80));

    if (!format?.url) throw new Error('오디오 포맷 없음');

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ url: format.url, mimeType: format.mime_type });
  } catch (err) {
    console.error('youtubei error:', err.message, err.stack);
    return res.status(502).json({ error: 'YouTube 오디오를 가져올 수 없습니다', detail: err.message });
  }
};
