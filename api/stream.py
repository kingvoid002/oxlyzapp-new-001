import os
import json
import base64
import tempfile
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import yt_dlp


def get_cookies_file():
    """
    Membuat file cookies sementara dari environment variable YOUTUBE_COOKIES_B64.
    Mengembalikan path file atau None jika env var tidak ada.
    """
    cookies_b64 = os.environ.get("YOUTUBE_COOKIES_B64", "")
    if not cookies_b64:
        return None
    try:
        cookies_content = base64.b64decode(cookies_b64).decode("utf-8")
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
        tmp.write(cookies_content)
        tmp.close()
        return tmp.name
    except Exception:
        return None


def extract_audio_stream(video_id):
    """
    Mengekstrak URL aliran audio langsung (m4a/webm) terbaik dari YouTube
    menggunakan yt-dlp agar kompatibel penuh dengan HTML5 Audio dan Android WebView.
    """
    target_url = f"https://www.youtube.com/watch?v={video_id}"

    cookies_file = get_cookies_file()

    # Mengutamakan format m4a (AAC) dan webm (Opus) protokol HTTPS langsung (bukan m3u8)
    # agar dapat langsung diputar oleh tag <audio> di semua perangkat.
    po_token = os.environ.get("YOUTUBE_PO_TOKEN", "")
    visitor_data = os.environ.get("YOUTUBE_VISITOR_DATA", "")

    ydl_opts = {
        'format': 'bestaudio[ext=m4a][protocol^=http]/bestaudio[ext=webm][protocol^=http]/bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'geo_bypass': True,
        'nocheckcertificate': True,
        'extract_flat': False,
        # Simulasikan browser biasa agar tidak diblokir YouTube
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    }

    if cookies_file:
        ydl_opts['cookiefile'] = cookies_file

    # PO Token untuk bypass datacenter block (opsional tapi sangat membantu)
    if po_token and visitor_data:
        ydl_opts['extractor_args'] = {
            'youtube': {
                'po_token': [f'web+{po_token}'],
                'player_client': ['web'],
            }
        }
        ydl_opts['http_headers']['X-Goog-Visitor-Id'] = visitor_data

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target_url, download=False)

            # URL stream utama yang dipilih oleh format selector yt-dlp
            stream_url = info.get('url')
            ext = info.get('ext', 'm4a')
            abr = info.get('abr', 128)

            # Cadangan jika URL utama tidak langsung berada di root dictionary
            if not stream_url and 'formats' in info:
                audio_formats = [
                    f for f in info['formats']
                    if f.get('acodec') != 'none' and f.get('vcodec') == 'none' and f.get('url')
                ]
                if audio_formats:
                    # Urutkan berdasarkan bitrate audio (abr) tertinggi
                    audio_formats.sort(key=lambda x: x.get('abr') or 0, reverse=True)
                    best_audio = audio_formats[0]
                    stream_url = best_audio.get('url')
                    ext = best_audio.get('ext', 'm4a')
                    abr = best_audio.get('abr', 128)
                elif info['formats']:
                    stream_url = info['formats'][-1].get('url')

            if not stream_url:
                raise ValueError("URL aliran audio tidak ditemukan untuk lagu ini.")

            # Menentukan MIME type agar browser dan WebView mengenali format audio
            mime_type = "audio/mp4" if ext == "m4a" else f"audio/{ext}"

            thumbnail = info.get('thumbnail', '')
            if not thumbnail:
                thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

            return {
                "video_id": info.get('id', video_id),
                "title": info.get('title', 'Unknown Title'),
                "artist": info.get('uploader') or info.get('channel') or 'Unknown Artist',
                "duration": int(info.get('duration') or 0),
                "thumbnail": thumbnail,
                "stream_url": stream_url,
                "mime_type": mime_type,
                "ext": ext,
                "bitrate": round(float(abr or 128))
            }

    except Exception as e:
        raise RuntimeError(f"Gagal mengekstrak stream audio: {str(e)}")


class handler(BaseHTTPRequestHandler):
    """
    Vercel Serverless Function Handler untuk endpoint /api/stream
    Contoh penggunaan:
    - GET /api/stream?video_id=dQw4w9WgXcQ                -> Mengembalikan JSON
    - GET /api/stream?video_id=dQw4w9WgXcQ&mode=redirect  -> Redirect langsung ke file audio
    """

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Cache selama 30 menit agar perpindahan lagu yang sama lebih cepat
        self.send_header("Cache-Control", "s-maxage=1800, stale-while-revalidate")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self._send_json(200, {"status": "ok"})

    def do_GET(self):
        parsed_url = urlparse(self.path)
        params = parse_qs(parsed_url.query)

        # Menerima parameter 'video_id' atau 'id'
        video_id_list = params.get("video_id") or params.get("id") or []
        mode = params.get("mode", ["json"])[0].lower()

        if not video_id_list or not video_id_list[0].strip():
            self._send_json(400, {
                "status": "error",
                "message": "Parameter 'video_id' wajib diisi (Contoh: /api/stream?video_id=dQw4w9WgXcQ)."
            })
            return

        video_id = video_id_list[0].strip()

        try:
            stream_data = extract_audio_stream(video_id)

            if mode == "redirect":
                # Mengalihkan langsung ke URL stream untuk digunakan langsung pada <audio src="...">
                self.send_response(302)
                self.send_header("Location", stream_data["stream_url"])
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                return

            self._send_json(200, {
                "status": "success",
                "data": stream_data
            })

        except Exception as e:
            self._send_json(500, {
                "status": "error",
                "message": str(e)
            })
