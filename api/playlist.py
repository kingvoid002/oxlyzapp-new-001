import os
import sys
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Memastikan modul db.py di folder yang sama dapat diimpor dengan aman di Vercel
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

try:
    from api.db import execute_query, ensure_user_exists
except ImportError:
    from db import execute_query, ensure_user_exists


def get_user_playlists(user_id):
    """Mengambil semua daftar playlist milik pengguna beserta jumlah lagunya."""
    query = """
        SELECT 
            p.id,
            p.user_id,
            p.name,
            p.description,
            p.cover_url,
            p.created_at,
            COUNT(pi.id) AS track_count
        FROM playlists p
        LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
        WHERE p.user_id = %s
        GROUP BY p.id
        ORDER BY p.created_at DESC;
    """
    return execute_query(query, (user_id,), fetch_all=True) or []


def get_playlist_detail(playlist_id):
    """Mengambil informasi detail satu playlist beserta seluruh daftar lagu di dalamnya."""
    playlist_query = "SELECT * FROM playlists WHERE id = %s;"
    playlist_info = execute_query(playlist_query, (playlist_id,), fetch_one=True)

    if not playlist_info:
        return None

    items_query = """
        SELECT id, playlist_id, video_id, title, artist, duration, thumbnail, added_at
        FROM playlist_items
        WHERE playlist_id = %s
        ORDER BY added_at DESC;
    """
    items = execute_query(items_query, (playlist_id,), fetch_all=True) or []
    playlist_info["tracks"] = items
    return playlist_info


def get_favorite_tracks(user_id):
    """Mengambil seluruh lagu yang ditandai sebagai favorit oleh pengguna."""
    query = """
        SELECT id, video_id, title, artist, duration, thumbnail, play_count, last_played
        FROM saved_tracks
        WHERE user_id = %s AND is_favorite = TRUE
        ORDER BY last_played DESC;
    """
    return execute_query(query, (user_id,), fetch_all=True) or []


def get_recent_tracks(user_id, limit=25):
    """Mengambil riwayat lagu yang baru saja diputar oleh pengguna."""
    query = """
        SELECT id, video_id, title, artist, duration, thumbnail, is_favorite, play_count, last_played
        FROM saved_tracks
        WHERE user_id = %s
        ORDER BY last_played DESC
        LIMIT %s;
    """
    return execute_query(query, (user_id, limit), fetch_all=True) or []


def create_playlist(user_id, name, description="", cover_url=""):
    """Membuat playlist baru untuk pengguna."""
    ensure_user_exists(user_id)
    query = """
        INSERT INTO playlists (user_id, name, description, cover_url)
        VALUES (%s, %s, %s, %s)
        RETURNING id, user_id, name, description, cover_url, created_at;
    """
    return execute_query(query, (user_id, name, description, cover_url), fetch_one=True, commit=True)


def add_track_to_playlist(playlist_id, track_data):
    """
    Menambahkan lagu ke dalam playlist.
    Jika sampul (cover_url) playlist masih kosong, otomatis gunakan thumbnail lagu pertama.
    """
    video_id = track_data.get("video_id")
    title = track_data.get("title", "Unknown Title")
    artist = track_data.get("artist", "Unknown Artist")
    duration = int(track_data.get("duration", 0))
    thumbnail = track_data.get("thumbnail", "")

    insert_query = """
        INSERT INTO playlist_items (playlist_id, video_id, title, artist, duration, thumbnail)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (playlist_id, video_id) DO NOTHING
        RETURNING id, playlist_id, video_id, title, artist, duration, thumbnail, added_at;
    """
    item = execute_query(
        insert_query,
        (playlist_id, video_id, title, artist, duration, thumbnail),
        fetch_one=True,
        commit=True
    )

    if thumbnail:
        update_cover_query = """
            UPDATE playlists
            SET cover_url = %s
            WHERE id = %s AND (cover_url IS NULL OR cover_url = '');
        """
        execute_query(update_cover_query, (thumbnail, playlist_id), commit=True)

    return item


def toggle_favorite_track(user_id, track_data):
    """Menambah atau menghapus status favorit pada sebuah lagu."""
    ensure_user_exists(user_id)
    video_id = track_data.get("video_id")
    title = track_data.get("title", "Unknown Title")
    artist = track_data.get("artist", "Unknown Artist")
    duration = int(track_data.get("duration", 0))
    thumbnail = track_data.get("thumbnail", "")

    query = """
        INSERT INTO saved_tracks (user_id, video_id, title, artist, duration, thumbnail, is_favorite, play_count)
        VALUES (%s, %s, %s, %s, %s, %s, TRUE, 1)
        ON CONFLICT (user_id, video_id)
        DO UPDATE SET
            is_favorite = NOT saved_tracks.is_favorite,
            title = EXCLUDED.title,
            artist = EXCLUDED.artist,
            thumbnail = EXCLUDED.thumbnail
        RETURNING video_id, title, artist, is_favorite;
    """
    return execute_query(
        query,
        (user_id, video_id, title, artist, duration, thumbnail),
        fetch_one=True,
        commit=True
    )


def record_track_play(user_id, track_data):
    """Mencatat riwayat pemutaran lagu dan menambah jumlah play_count."""
    ensure_user_exists(user_id)
    video_id = track_data.get("video_id")
    title = track_data.get("title", "Unknown Title")
    artist = track_data.get("artist", "Unknown Artist")
    duration = int(track_data.get("duration", 0))
    thumbnail = track_data.get("thumbnail", "")

    query = """
        INSERT INTO saved_tracks (user_id, video_id, title, artist, duration, thumbnail, is_favorite, play_count, last_played)
        VALUES (%s, %s, %s, %s, %s, %s, FALSE, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, video_id)
        DO UPDATE SET
            play_count = saved_tracks.play_count + 1,
            last_played = CURRENT_TIMESTAMP,
            title = EXCLUDED.title,
            artist = EXCLUDED.artist,
            thumbnail = EXCLUDED.thumbnail
        RETURNING video_id, play_count, is_favorite, last_played;
    """
    return execute_query(
        query,
        (user_id, video_id, title, artist, duration, thumbnail),
        fetch_one=True,
        commit=True
    )


def delete_playlist(playlist_id, user_id):
    """Menghapus playlist milik pengguna beserta seluruh isinya (CASCADE)."""
    query = "DELETE FROM playlists WHERE id = %s AND user_id = %s RETURNING id;"
    return execute_query(query, (playlist_id, user_id), fetch_one=True, commit=True)


def remove_track_from_playlist(playlist_id, video_id):
    """Menghapus satu lagu tertentu dari dalam playlist."""
    query = "DELETE FROM playlist_items WHERE playlist_id = %s AND video_id = %s RETURNING id;"
    return execute_query(query, (playlist_id, video_id), fetch_one=True, commit=True)


class handler(BaseHTTPRequestHandler):
    """
    Vercel Serverless Function Handler untuk endpoint /api/playlist
    Mendukung metode GET, POST, dan DELETE.
    """

    def _send_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        raw_body = self.rfile.read(content_length).decode("utf-8")
        return json.loads(raw_body)

    def do_OPTIONS(self):
        self._send_response(200, {"status": "ok"})

    def do_GET(self):
        parsed_url = urlparse(self.path)
        params = parse_qs(parsed_url.query)

        action = params.get("action", ["overview"])[0]
        user_id = params.get("user_id", ["default_oxlyz_user"])[0]

        try:
            if action == "overview":
                # Mengambil seluruh data pustaka sekaligus agar aplikasi lebih cepat dimuat di HP
                ensure_user_exists(user_id)
                playlists = get_user_playlists(user_id)
                favorites = get_favorite_tracks(user_id)
                history = get_recent_tracks(user_id, limit=20)
                self._send_response(200, {
                    "status": "success",
                    "data": {
                        "playlists": playlists,
                        "favorites": favorites,
                        "history": history
                    }
                })

            elif action == "playlists":
                playlists = get_user_playlists(user_id)
                self._send_response(200, {"status": "success", "data": playlists})

            elif action == "detail":
                playlist_id = params.get("playlist_id", [None])[0]
                if not playlist_id:
                    self._send_response(400, {"status": "error", "message": "Parameter playlist_id wajib diisi."})
                    return

                detail = get_playlist_detail(int(playlist_id))
                if not detail:
                    self._send_response(404, {"status": "error", "message": "Playlist tidak ditemukan."})
                    return

                self._send_response(200, {"status": "success", "data": detail})

            elif action == "favorites":
                favorites = get_favorite_tracks(user_id)
                self._send_response(200, {"status": "success", "data": favorites})

            elif action == "history":
                limit = int(params.get("limit", [25])[0])
                history = get_recent_tracks(user_id, limit=limit)
                self._send_response(200, {"status": "success", "data": history})

            else:
                self._send_response(400, {"status": "error", "message": f"Action GET '{action}' tidak dikenali."})

        except Exception as e:
            self._send_response(500, {"status": "error", "message": str(e)})

    def do_POST(self):
        try:
            body = self._read_json_body()
            action = body.get("action", "")
            user_id = body.get("user_id", "default_oxlyz_user")

            if action == "create_playlist":
                name = body.get("name", "").strip()
                description = body.get("description", "").strip()
                cover_url = body.get("cover_url", "").strip()

                if not name:
                    self._send_response(400, {"status": "error", "message": "Nama playlist tidak boleh kosong."})
                    return

                new_playlist = create_playlist(user_id, name, description, cover_url)
                self._send_response(201, {"status": "success", "data": new_playlist})

            elif action == "add_track":
                playlist_id = body.get("playlist_id")
                track = body.get("track", {})

                if not playlist_id or not track.get("video_id"):
                    self._send_response(400, {"status": "error", "message": "Data playlist_id dan track.video_id wajib diisi."})
                    return

                added_item = add_track_to_playlist(int(playlist_id), track)
                self._send_response(200, {
                    "status": "success",
                    "message": "Lagu berhasil ditambahkan ke playlist.",
                    "data": added_item
                })

            elif action == "toggle_favorite":
                track = body.get("track", {})
                if not track.get("video_id"):
                    self._send_response(400, {"status": "error", "message": "Data track.video_id wajib diisi."})
                    return

                fav_status = toggle_favorite_track(user_id, track)
                self._send_response(200, {"status": "success", "data": fav_status})

            elif action == "record_play":
                track = body.get("track", {})
                if not track.get("video_id"):
                    self._send_response(400, {"status": "error", "message": "Data track.video_id wajib diisi."})
                    return

                play_record = record_track_play(user_id, track)
                self._send_response(200, {"status": "success", "data": play_record})

            elif action == "delete_playlist":
                playlist_id = body.get("playlist_id")
                if not playlist_id:
                    self._send_response(400, {"status": "error", "message": "Parameter playlist_id wajib diisi."})
                    return

                deleted = delete_playlist(int(playlist_id), user_id)
                self._send_response(200, {"status": "success", "deleted": bool(deleted)})

            elif action == "remove_track":
                playlist_id = body.get("playlist_id")
                video_id = body.get("video_id")
                if not playlist_id or not video_id:
                    self._send_response(400, {"status": "error", "message": "Parameter playlist_id dan video_id wajib diisi."})
                    return

                removed = remove_track_from_playlist(int(playlist_id), video_id)
                self._send_response(200, {"status": "success", "removed": bool(removed)})

            else:
                self._send_response(400, {"status": "error", "message": f"Action POST '{action}' tidak dikenali."})

        except Exception as e:
            self._send_response(500, {"status": "error", "message": str(e)})

    def do_DELETE(self):
        parsed_url = urlparse(self.path)
        params = parse_qs(parsed_url.query)

        action = params.get("action", [""])[0]
        user_id = params.get("user_id", ["default_oxlyz_user"])[0]
        playlist_id = params.get("playlist_id", [None])[0]
        video_id = params.get("video_id", [None])[0]

        try:
            if action == "delete_playlist" and playlist_id:
                deleted = delete_playlist(int(playlist_id), user_id)
                self._send_response(200, {"status": "success", "deleted": bool(deleted)})

            elif action == "remove_track" and playlist_id and video_id:
                removed = remove_track_from_playlist(int(playlist_id), video_id)
                self._send_response(200, {"status": "success", "removed": bool(removed)})

            else:
                self._send_response(400, {"status": "error", "message": "Parameter penghapusan tidak lengkap."})

        except Exception as e:
            self._send_response(500, {"status": "error", "message": str(e)})
