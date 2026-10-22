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


def search_youtube(query, max_results=15):
    """
    Melakukan pencarian video/audio menggunakan yt-dlp secara aman dan cepat.
    Menggunakan opsi 'extract_flat' agar proses pencarian ringan di Vercel Serverless.
    """
    cookies_file = get_cookies_file()
    po_token = os.environ.get("YOUTUBE_PO_TOKEN", "")
    visitor_data = os.environ.get("YOUTUBE_VISITOR_DATA", "")

    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    }

    if cookies_file:
        ydl_opts['cookiefile'] = cookies_file

    # Pakai tv_embedded client — paling jarang diblokir YouTube di datacenter
    ydl_opts['extractor_args'] = {
        'youtube': {
            'player_client': ['tv_embedded'],
        }
    }

    if visitor_data:
        ydl_opts['http_headers']['X-Goog-Visitor-Id'] = visitor_data

    if po_token and visitor_data:
        ydl_opts['extractor_args']['youtube']['po_token'] = [f'web+{po_token}']

    search_query = f"ytsearch{max_results}:{query}"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search_query, download=False)
            entries = info.get('entries', [])

            formatted_results = []
            for entry in entries:
                video_id = entry.get('id', '')
                title = entry.get('title', 'Unknown Title')
                
                # yt-dlp terkadang menyatukan channel/uploader, kita pisahkan jika ada
                uploader = entry.get('uploader') or entry.get('channel') or 'Unknown Artist'
                
                duration = entry.get('duration', 0) or 0
                
                # Mengambil thumbnail terbaik dari entry
                thumbnail = entry.get('thumbnail', '')
                if not thumbnail and video_id:
                    thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

                formatted_results.append({
                    "video_id": video_id,
                    "title": title,
                    "artist": uploader,
                    "duration": int(duration),
                    "thumbnail": thumbnail,
                    "url": f"https://www.youtube.com/watch?v={video_id}"
                })

            return formatted_results

    except Exception as e:
        raise RuntimeError(f"Gagal melakukan pencarian yt-dlp: {str(e)}")


class handler(BaseHTTPRequestHandler):
    """
    Vercel Serverless Function Handler untuk endpoint /api/search
    Mendukung metode GET untuk mencari lagu melalui query parameter:
    - GET /api/search?q=nama+lagu
    """

    def _send_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self._send_response(200, {"status": "ok"})

    def do_GET(self):
        parsed_url = urlparse(self.path)
        params = parse_qs(parsed_url.query)

        query_list = params.get("q", [])
        if not query_list or not query_list[0].strip():
            self._send_response(400, {
                "status": "error",
                "message": "Parameter pencarian 'q' wajib diisi (Contoh: /api/search?q=lofi+hip+hop)."
            })
            return

        search_query = query_list[0].strip()
        
        # Batasan maksimal hasil pencarian (default 15, bisa diatur lewat parameter 'limit' jika diperlukan)
        try:
            limit = int(params.get("limit", [15])[0])
        except ValueError:
            limit = 15

        try:
            results = search_youtube(search_query, max_results=limit)
            self._send_response(200, {
                "status": "success",
                "query": search_query,
                "count": len(results),
                "data": results
            })
        except Exception as e:
            self._send_response(500, {
                "status": "error",
                "message": str(e)
            })
