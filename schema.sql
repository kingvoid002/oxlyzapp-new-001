-- ==========================================================================
-- OXLYZ MUSIC DATABASE SCHEMA (schema.sql)
-- PostgreSQL Database Definition
-- ==========================================================================

-- 1. TABEL USERS
-- Menyimpan identitas pengguna berdasarkan Device ID unik yang digenerate di browser/WebView
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) DEFAULT 'Oxlyz Listener',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indeks untuk mempercepat pencarian user
CREATE INDEX IF NOT EXISTS idx_users_id ON users(user_id);


-- 2. TABEL SAVED TRACKS
-- Menyimpan lagu favorit (Liked Songs) dan riwayat pemutaran (Recently Played)
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
    CONSTRAINT unique_user_track UNIQUE (user_id, video_id)
);

-- Indeks untuk mempercepat pengambilan lagu favorit dan riwayat berdasarkan waktu putar
CREATE INDEX IF NOT EXISTS idx_saved_tracks_user_fav ON saved_tracks(user_id, is_favorite);
CREATE INDEX IF NOT EXISTS idx_saved_tracks_last_played ON saved_tracks(user_id, last_played DESC);


-- 3. TABEL PLAYLISTS
-- Menyimpan daftar putar (playlist kustom) buatan pengguna
CREATE TABLE IF NOT EXISTS playlists (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indeks untuk mempercepat pengambilan playlist milik user tertentu
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);


-- 4. TABEL PLAYLIST ITEMS
-- Menyimpan daftar lagu yang dimasukkan ke dalam setiap playlist
CREATE TABLE IF NOT EXISTS playlist_items (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    video_id VARCHAR(32) NOT NULL,
    title TEXT NOT NULL,
    artist TEXT DEFAULT 'Unknown Artist',
    duration INTEGER DEFAULT 0,
    thumbnail TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_playlist_track UNIQUE (playlist_id, video_id)
);

-- Indeks untuk mempercepat pengambilan lagu di dalam suatu playlist
CREATE INDEX IF NOT EXISTS idx_playlist_items_pid ON playlist_items(playlist_id);
