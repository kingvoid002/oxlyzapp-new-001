import os
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import yt_dlp


def search_youtube(query, max_results=15):
    """
    Melakukan pencarian video/audio menggunakan yt-dlp secara aman dan cepat.
    Menggunakan opsi 'extract_flat' agar proses pencarian ringan di Vercel Serverless.
    """
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,  # Hanya mengambil metadata daftar hasil tanpa mengunduh video
    }

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
