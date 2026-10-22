/**
 * OXLYZ ANDROID WEBVIEW BRIDGE (bridge.js)
 * Menghubungkan antarmuka web dengan Java Native Android WebView Interface
 */

const OxlyzBridge = (() => {
    // Memeriksa apakah aplikasi berjalan di dalam Android WebView (terdapat objek AndroidBridge dari Java)
    const isAndroidApp = () => {
        return typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge !== null;
    };

    return {
        /**
         * Memberitahu aplikasi Android bahwa lagu mulai diputar
         * agar Android Service dapat menampilkan kontrol media di Notifikasi / Lock Screen.
         */
        notifyTrackStarted: (track) => {
            if (!isAndroidApp()) return;
            try {
                window.AndroidBridge.onTrackStarted(
                    track.video_id || '',
                    track.title || 'Unknown Title',
                    track.artist || 'Unknown Artist',
                    track.thumbnail || ''
                );
            } catch (e) {
                console.warn("Gagal memanggil Java bridge (onTrackStarted):", e);
            }
        },

        /**
         * Memberitahu aplikasi Android bahwa pemutaran musik dijeda (paused).
         */
        notifyTrackPaused: () => {
            if (!isAndroidApp()) return;
            try {
                window.AndroidBridge.onTrackPaused();
            } catch (e) {
                console.warn("Gagal memanggil Java bridge (onTrackPaused):", e);
            }
        },

        /**
         * Memberitahu aplikasi Android bahwa pemutaran musik dihentikan.
         */
        notifyTrackStopped: () => {
            if (!isAndroidApp()) return;
            try {
                window.AndroidBridge.onTrackStopped();
            } catch (e) {
                console.warn("Gagal memanggil Java bridge (onTrackStopped):", e);
            }
        },

        /**
         * Meminta Android untuk menggetar perangkat (haptic feedback) saat ada interaksi penting.
         */
        triggerHaptic: (durationMs = 35) => {
            if (!isAndroidApp()) return;
            try {
                if (typeof window.AndroidBridge.vibrate === 'function') {
                    window.AndroidBridge.vibrate(durationMs);
                }
            } catch (e) {
                // Haptic opsional, diabaikan jika tidak didukung
            }
        },

        /**
         * Mengambil informasi versi aplikasi Android (jika tersedia).
         */
        getAppVersion: () => {
            if (!isAndroidApp()) return 'Web-Browser';
            try {
                return window.AndroidBridge.getAppVersion() || '1.0.0';
            } catch (e) {
                return '1.0.0';
            }
        }
    };
})();
