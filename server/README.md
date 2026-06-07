# StreamLink PC 서버

YouTube 오디오를 집 PC에서 꺼내서 휴대폰으로 보내주는 작은 서버입니다.
(YouTube가 클라우드 서버 IP는 막지만, 집 PC의 일반 인터넷은 막지 않는 점을 이용)

## 처음 한 번만

1. PC에 [Node.js](https://nodejs.org) 설치 (LTS 버전 다운로드 후 설치)

## 사용법

1. 이 폴더의 `start.bat` 더블클릭
   - 처음엔 yt-dlp, cloudflared 도구를 자동으로 내려받습니다 (잠깐 걸림)
2. 검은 창에 `https://무언가.trycloudflare.com` 주소가 나옴
3. 그 주소를 복사
4. 휴대폰에서 StreamLink 앱 열기 -> 오른쪽 위 톱니바퀴(설정) -> 주소 붙여넣기 -> 연결 확인 -> 저장
5. 이제 YouTube URL을 추가하면 백그라운드 재생됨

## 주의

- `start.bat` 창은 끄지 마세요. 끄면 서버가 멈춥니다.
- PC를 껐다 켜면 주소가 바뀝니다. 다시 `start.bat`을 실행하고 새 주소를 앱 설정에 붙여넣으세요.
- **집 WiFi에서 가장 잘 됩니다.** YouTube가 추출한 주소에는 PC의 IP가 들어 있어,
  휴대폰이 같은 WiFi(같은 공인 IP)일 때 가장 안정적입니다.
  밖에서 데이터로 쓰면 가끔 재생이 막힐 수 있습니다.
