/**
 * OXLYZ API CLIENT (api.js)
 * Mengelola komunikasi asinkron (Fetch) ke Vercel Serverless Backend & PostgreSQL
 */

const OxlyzAPI = (() => {
    // Menghasilkan atau mengambil Unique Device ID untuk identitas pengguna di PostgreSQL
    const getDeviceId = () => {
        let deviceId = localStorage.getItem('oxlyz_device_id');
        if (!deviceId) {
            deviceId = 'user_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('oxlyz_device_id', deviceId);
        }
        return deviceId;
    };

    const USER_ID = getDeviceId();

    /**
     * Helper umum untuk melakukan pemanggilan Fetch API
     */
    const request = async (endpoint, options = {}) => {
        try {
            const response = await fetch(endpoint, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || `HTTP Error ${response.status}`);
            }
            return data;
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    };

    return {
        getUserId: () => USER_ID,

        // 1. Pencarian Lagu via yt-dlp (/api/search)
        searchTracks: async (query, limit = 15) => {
            if (!query || !query.trim()) return [];
            const encodedQuery = encodeURIComponent(query.trim());
            const res = await request(`/api/search?q=${encodedQuery}&limit=${limit}`);
            return res.data || [];
        },

        // 2. Ekstraksi Aliran Audio via yt-dlp (/api/stream)
        getAudioStream: async (videoId) => {
            if (!videoId) throw new Error("Video ID wajib disertakan.");
            const res = await request(`/api/stream?video_id=${videoId}&mode=json`);
            return res.data;
        },

        // 3. Mengambil Keseluruhan Data Pustaka (Playlists, Favorites, History) (/api/playlist)
        getLibraryOverview: async () => {
            try {
                const res = await request(`/api/playlist?action=overview&user_id=${USER_ID}`);
                return res.data || { playlists: [], favorites: [], history: [] };
            } catch (e) {
                console.warn("Gagal memuat pustaka dari server, menggunakan cache lokal:", e);
                return { playlists: [], favorites: [], history: [] };
            }
        },

        // 4. Mengambil Detail Satu Playlist Beserta Lagu di dalamnya
        getPlaylistDetail: async (playlistId) => {
            const res = await request(`/api/playlist?action=detail&playlist_id=${playlistId}`);
            return res.data;
        },

        // 5. Membuat Playlist Baru
        createPlaylist: async (name, description = "", coverUrl = "") => {
            const res = await request('/api/playlist', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'create_playlist',
                    user_id: USER_ID,
                    name,
                    description,
                    cover_url: coverUrl
                })
            });
            return res.data;
        },

        // 6. Menambahkan Lagu ke Playlist
        addTrackToPlaylist: async (playlistId, track) => {
            const res = await request('/api/playlist', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'add_track',
                    playlist_id: playlistId,
                    track: {
                        video_id: track.video_id,
                        title: track.title,
                        artist: track.artist,
                        duration: track.duration,
                        thumbnail: track.thumbnail
                    }
                })
            });
            return res.data;
        },

        // 7. Menambah / Menghapus Status Favorit Lagu (Liked Songs)
        toggleFavorite: async (track) => {
            const res = await request('/api/playlist', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'toggle_favorite',
                    user_id: USER_ID,
                    track: {
                        video_id: track.video_id,
                        title: track.title,
                        artist: track.artist,
                        duration: track.duration,
                        thumbnail: track.thumbnail
                    }
                })
            });
            return res.data;
        },

        // 8. Mencatat Riwayat Pemutaran (Recently Played)
        recordPlay: async (track) => {
            if (!track || !track.video_id) return;
            try {
                await request('/api/playlist', {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'record_play',
                        user_id: USER_ID,
                        track: {
                            video_id: track.video_id,
                            title: track.title,
                            artist: track.artist,
                            duration: track.duration,
                            thumbnail: track.thumbnail
                        }
                    })
                });
            } catch (e) {
                // Gagal catat riwayat tidak boleh mengganggu pemutaran musik
                console.warn("Gagal mencatat riwayat play:", e);
            }
        },

        // 9. Menghapus Playlist
        deletePlaylist: async (playlistId) => {
            const res = await request(`/api/playlist?action=delete_playlist&playlist_id=${playlistId}&user_id=${USER_ID}`, {
                method: 'DELETE'
            });
            return res.deleted;
        },

        // 10. Menghapus Lagu dari Playlist
        removeTrackFromPlaylist: async (playlistId, videoId) => {
            const res = await request(`/api/playlist?action=remove_track&playlist_id=${playlistId}&video_id=${videoId}`, {
                method: 'DELETE'
            });
            return res.removed;
        },

        // 11. Inisialisasi Database PostgreSQL (Opsional / Admin Trigger)
        initDatabase: async () => {
            const res = await request('/api/db?action=init');
            return res;
        }
    };
})();
