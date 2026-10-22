import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Mengambil URL koneksi PostgreSQL dari Environment Variables Vercel
DATABASE_URL = os.environ.get("DATABASE_URL")


def get_db_connection():
    """
    Membuat dan mengembalikan koneksi ke database PostgreSQL.
    Menggunakan RealDictCursor agar hasil query otomatis berbentuk dictionary (JSON-friendly).
    """
    if not DATABASE_URL:
        raise ValueError("Environment variable DATABASE_URL belum diatur di Vercel.")
    
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    return conn


def execute_query(query, params=None, fetch_one=False, fetch_all=False, commit=False):
    """
    Fungsi pembantu (helper) untuk menjalankan query SQL dengan aman.
    Otomatis menutup cursor dan koneksi setelah selesai digunakan.
    """
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(query, params or ())

        result = None
        if fetch_one:
            result = cursor.fetchone()
        elif fetch_all:
            result = cursor.fetchall()

        if commit:
            conn.commit()

        return result

    except Exception as e:
        if conn:
            conn.rollback()
        raise e

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def init_db():
    """
    Membuat struktur tabel awal (users, saved_tracks, playlists, playlist_items)
    jika tabel-tabel tersebut belum ada di dalam database PostgreSQL.
    """
    schema_queries = [
        # 1. Tabel Users (berbasis Device ID / User ID agar langsung aktif di WebView)
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id VARCHAR(64) PRIMARY KEY,
            username VARCHAR(100) DEFAULT 'Oxlyz Listener',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # 2. Tabel Saved Tracks (Lagu Favorit & Riwayat Pemutaran / Recently Played)
        """
        CREATE TABLE IF NOT EXISTS saved_tracks (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            video_id VARCHAR(32) NOT NULL,
            title TEXT NOT NULL,
            artist TEXT DEFAULT 'Unknown Artist',
            duration INTEGER DEFAULT 0,
            thumbnail TEXT,
            is_favorite BOOLEAN DEFAULT FALSE,
            play_count INTEGER DEFAULT 1,
            last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, video_id)
        );
        """,
        
        # 3. Tabel Playlists (Daftar Putar Kustom)
        """
        CREATE TABLE IF NOT EXISTS playlists (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            description TEXT DEFAULT '',
            cover_url TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # 4. Tabel Playlist Items (Isi Lagu di dalam Playlist)
        """
        CREATE TABLE IF NOT EXISTS playlist_items (
            id SERIAL PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            video_id VARCHAR(32) NOT NULL,
            title TEXT NOT NULL,
            artist TEXT DEFAULT 'Unknown Artist',
            duration INTEGER DEFAULT 0,
            thumbnail TEXT,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(playlist_id, video_id)
        );
        """
    ]

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        for query in schema_queries:
            cursor.execute(query)
        conn.commit()
        return {"status": "success", "message": "Seluruh tabel database Oxlyz berhasil diinisialisasi."}
    except Exception as e:
        if conn:
            conn.rollback()
        raise e
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def ensure_user_exists(user_id, username="Oxlyz Listener"):
    """
    Memastikan user_id sudah terdaftar di tabel users sebelum menyimpan lagu atau playlist.
    """
    query = """
        INSERT INTO users (user_id, username)
        VALUES (%s, %s)
        ON CONFLICT (user_id) DO NOTHING;
    """
    execute_query(query, (user_id, username), commit=True)


class handler(BaseHTTPRequestHandler):
    """
    Vercel Serverless Function Handler untuk mengecek status koneksi database
    atau menjalankan inisialisasi tabel melalui URL:
    - GET /api/db              -> Cek status koneksi database
    - GET /api/db?action=init  -> Membuat tabel otomatis di PostgreSQL
    """

    def _send_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self._send_response(200, {"status": "ok"})

    def do_GET(self):
        parsed_url = urlparse(self.path)
        query_params = parse_qs(parsed_url.query)
        action = query_params.get("action", ["status"])[0]

        try:
            if action == "init":
                result = init_db()
                self._send_response(200, result)
            else:
                # Tes koneksi dasar ke PostgreSQL
                db_Check = execute_query("SELECT version() AS db_version, NOW() AS server_time;", fetch_one=True)
                self._send_response(200, {
                    "status": "connected",
                    "application": "Oxlyz Database Service",
                    "data": db_Check
                })
        except Exception as e:
            self._send_response(500, {
                "status": "error",
                "message": str(e)
            })
