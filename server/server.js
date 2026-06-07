const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 3001;
const YTDLP = path.join(__dirname, 'yt-dlp.exe');

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function extractAudio(videoUrl) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      ['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-warnings', '--no-playlist', videoUrl],
      { timeout: 25000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr.trim().split('\n').pop() || err.message));
        const url = stdout.trim().split('\n')[0];
        if (!url.startsWith('http')) return reject(new Error('URL 추출 실패'));
        resolve(url);
      }
    );
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/youtube') {
    const id = url.searchParams.get('id');
    if (!id) return sendJson(res, 400, { error: 'id required' });
    try {
      const streamUrl = await extractAudio(`https://www.youtube.com/watch?v=${id}`);
      console.log(`[OK] ${id}`);
      return sendJson(res, 200, { url: streamUrl });
    } catch (err) {
      console.error(`[ERR] ${id}:`, err.message);
      return sendJson(res, 502, { error: 'YouTube 오디오를 가져올 수 없습니다', detail: err.message });
    }
  }

  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end();
});

server.listen(PORT, () => {
  console.log(`StreamLink 서버 실행 중: http://localhost:${PORT}`);
});
