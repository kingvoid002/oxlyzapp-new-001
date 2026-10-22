/**
 * OXLYZ AUDIO PLAYER CONTROLLER (player.js)
 * Mengelola pemutaran streaming audio yt-dlp, antrean (queue), dan state pemutar.
 */

const OxlyzPlayer = (() => {
    // Referensi Elemen DOM Pemutar
    const audioElement = document.getElementById('oxlyz-audio');
    const playPauseButtons = document.querySelectorAll('#btn-play-pause, #btn-fs-play-pause');
    const playPauseIcons = document.querySelectorAll('#icon-play-pause, #icon-fs-play-pause');
    const seekSliders = document.querySelectorAll('#seek-slider, #fs-seek-slider');
    const progressFills = document.querySelectorAll('.progress-fill');
    const volumeSliders = document.querySelectorAll('#volume-slider');
    const volumeIcons = document.querySelectorAll('#icon-volume');
    
    // UI Metadata Elements
    const playerThumbs = document.querySelectorAll('#player-thumb, #fs-player-thumb');
    const playerTitles = document.querySelectorAll('#player-title, #fs-player-title');
    const playerArtists = document.querySelectorAll('#player-artist, #fs-player-artist');
    const timeCurrents = document.querySelectorAll('#time-current, #fs-time-current');
    const timeTotals = document.querySelectorAll('#time-total, #fs-time-total');
    const likeButtons = document.querySelectorAll('#btn-player-like, #btn-fs-like');
    const loadingIndicators = document.querySelectorAll('#player-loading-indicator');

    // State Pemutar
    let queue = [];
    let currentIndex = -1;
    let currentTrack = null;
    let isPlaying = false;
    let isShuffle = false;
    let repeatMode = 0; // 0: Off, 1: Repeat All, 2: Repeat One
    let isMuted = false;
    let previousVolume = 1;

    // ==================== 1. INISIALISASI & EVENT LISTENERS ====================
    const initPlayer = () => {
        if (!audioElement) return;

        // Event: Update waktu pemutaran & progress bar
        audioElement.addEventListener('timeupdate', () => {
            const current = audioElement.currentTime;
            const duration = audioElement.duration || 0;
            const percent = duration > 0 ? (current / duration) * 100 : 0;

            seekSliders.forEach(slider => { slider.value = percent; });
            progressFills.forEach(fill => { fill.style.width = `${percent}%`; });

            timeCurrents.forEach(el => { el.textContent = formatTime(current); });
            timeTotals.forEach(el => { el.textContent = formatTime(duration); });
        });

        // Event: Lagu selesai diputar
        audioElement.addEventListener('ended', () => {
            if (repeatMode === 2 && currentTrack) {
                audioElement.currentTime = 0;
                audioElement.play().catch(e => console.warn("Repeat one error:", e));
            } else {
                nextTrack();
            }
        });

        // Event: Error pemutaran audio
        audioElement.addEventListener('error', (e) => {
            console.error("Audio playback error:", e);
            showToast("Gagal memutar aliran audio lagu ini.", "error");
            setLoadingState(false);
            setPlayState(false);
        });

        // Kontrol Play / Pause
        playPauseButtons.forEach(btn => {
            btn.addEventListener('click', togglePlayPause);
        });

        // Kontrol Seek Bar
        seekSliders.forEach(slider => {
            slider.addEventListener('input', (e) => {
                const duration = audioElement.duration || 0;
                const seekTime = (e.target.value / 100) * duration;
                if (!isNaN(seekTime)) {
                    audioElement.currentTime = seekTime;
                }
            });
        });

        // Kontrol Tombol Next & Prev
        document.querySelectorAll('#btn-next, #btn-fs-next').forEach(btn => {
            btn.addEventListener('click', nextTrack);
        });

        document.querySelectorAll('#btn-prev, #btn-fs-prev').forEach(btn => {
            btn.addEventListener('click', prevTrack);
        });

        // Kontrol Volume
        volumeSliders.forEach(slider => {
            slider.addEventListener('input', (e) => {
                const vol = parseFloat(e.target.value);
                audioElement.volume = vol;
                isMuted = (vol === 0);
                updateVolumeIcon(vol);
            });
        });

        const muteButtons = document.querySelectorAll('#btn-mute');
        muteButtons.forEach(btn => {
            btn.addEventListener('click', toggleMute);
        });

        // Kontrol Shuffle
        document.querySelectorAll('#btn-shuffle, #btn-fs-shuffle').forEach(btn => {
            btn.addEventListener('click', toggleShuffle);
        });

        // Kontrol Repeat
        document.querySelectorAll('#btn-repeat, #btn-fs-repeat').forEach(btn => {
            btn.addEventListener('click', toggleRepeat);
        });

        // Tombol Antrean (Queue Drawer)
        const btnToggleQueue = document.getElementById('btn-toggle-queue');
        const queueDrawer = document.getElementById('queue-drawer');
        const btnCloseQueue = document.getElementById('btn-close-queue');

        if (btnToggleQueue && queueDrawer) {
            btnToggleQueue.addEventListener('click', () => {
                queueDrawer.classList.toggle('hidden');
                renderQueueDrawer();
            });
        }
        if (btnCloseQueue && queueDrawer) {
            btnCloseQueue.addEventListener('click', () => {
                queueDrawer.classList.add('hidden');
            });
        }

        // Expand / Collapse Fullscreen Player
        const btnExpand = document.getElementById('btn-expand-player');
        const btnCloseFs = document.getElementById('btn-close-fs-player');
        const fsPlayer = document.getElementById('fullscreen-player');
        const infoTrigger = document.getElementById('player-info-trigger');

        if (btnExpand && fsPlayer) {
            btnExpand.addEventListener('click', () => fsPlayer.classList.remove('hidden'));
        }
        if (infoTrigger && fsPlayer && window.innerWidth <= 768) {
            infoTrigger.addEventListener('click', (e) => {
                if (!e.target.closest('button')) {
                    fsPlayer.classList.remove('hidden');
                }
            });
        }
        if (btnCloseFs && fsPlayer) {
            btnCloseFs.addEventListener('click', () => fsPlayer.classList.add('hidden'));
        }
    };

    // ==================== 2. PEMUTARAN LAGU UTAMA ====================
    const playTrackList = async (trackList, startIndex = 0) => {
        if (!trackList || trackList.length === 0) return;
        queue = [...trackList];
        currentIndex = startIndex;
        await loadAndPlayCurrentTrack();
    };

    const loadAndPlayCurrentTrack = async () => {
        if (currentIndex < 0 || currentIndex >= queue.length) return;
        currentTrack = queue[currentIndex];

        // Perbarui UI Metadata Sementara
        updateMetadataUI(currentTrack);
        setLoadingState(true);
        highlightActiveTrackInList();

        try {
            // Ambil URL Aliran Audio langsung dari Endpoint /api/stream
            const streamData = await OxlyzAPI.getAudioStream(currentTrack.video_id);
            
            if (!streamData || !streamData.stream_url) {
                throw new Error("URL stream tidak valid.");
            }

            // Update metadata akurat dari yt-dlp backend
            currentTrack.stream_url = streamData.stream_url;
            currentTrack.duration = streamData.duration || currentTrack.duration;
            currentTrack.thumbnail = streamData.thumbnail || currentTrack.thumbnail;

            audioElement.src = streamData.stream_url;
            audioElement.load();
            
            await audioElement.play();
            setPlayState(true);
            setLoadingState(false);

            // Catat riwayat pemutaran ke PostgreSQL (Recently Played & Play Count)
            OxlyzAPI.recordPlay(currentTrack);

            // Perbarui antrean jika drawer terbuka
            renderQueueDrawer();

        } catch (e) {
            console.error("Gagal memuat lagu:", e);
            showToast(`Gagal memuat lagu: ${e.message}`, "error");
            setLoadingState(false);
            setPlayState(false);
        }
    };

    const togglePlayPause = () => {
        if (!currentTrack) {
            if (queue.length > 0) {
                loadAndPlayCurrentTrack();
            }
            return;
        }

        if (audioElement.paused) {
            audioElement.play().then(() => {
                setPlayState(true);
            }).catch(err => {
                console.error("Resume error:", err);
            });
        } else {
            audioElement.pause();
            setPlayState(false);
        }
    };

    const nextTrack = () => {
        if (queue.length === 0) return;

        if (isShuffle) {
            currentIndex = Math.floor(Math.random() * queue.length);
        } else {
            currentIndex++;
            if (currentIndex >= queue.length) {
                if (repeatMode === 1) {
                    currentIndex = 0; // Ulangi dari awal antrean
                } else {
                    currentIndex = queue.length - 1;
                    audioElement.pause();
                    setPlayState(false);
                    return;
                }
            }
        }
        loadAndPlayCurrentTrack();
    };

    const prevTrack = () => {
        if (queue.length === 0) return;
        if (audioElement.currentTime > 3) {
            audioElement.currentTime = 0;
            return;
        }

        currentIndex--;
        if (currentIndex < 0) {
            currentIndex = 0;
        }
        loadAndPlayCurrentTrack();
    };

    // ==================== 3. KONTROL TAMBAHAN (SHUFFLE & REPEAT) ====================
    const toggleShuffle = () => {
        isShuffle = !isShuffle;
        document.querySelectorAll('#btn-shuffle, #btn-fs-shuffle').forEach(btn => {
            if (isShuffle) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        showToast(isShuffle ? "Mode Acak (Shuffle) Aktif" : "Mode Acak Dinonaktifkan");
    };

    const toggleRepeat = () => {
        repeatMode = (repeatMode + 1) % 3;
        const repeatBtns = document.querySelectorAll('#btn-repeat, #btn-fs-repeat');
        
        repeatBtns.forEach(btn => {
            const icon = btn.querySelector('i');
            if (repeatMode === 0) {
                btn.classList.remove('active');
                if (icon) icon.className = "fa-solid fa-repeat";
                showToast("Pengulangan Dinonaktifkan");
            } else if (repeatMode === 1) {
                btn.classList.add('active');
                if (icon) icon.className = "fa-solid fa-repeat";
                showToast("Ulangi Semua (Repeat All)");
            } else if (repeatMode === 2) {
                btn.classList.add('active');
                if (icon) icon.className = "fa-solid fa-repeat-1";
                showToast("Ulangi Satu Lagu (Repeat One)");
            }
        });
    };

    const toggleMute = () => {
        if (isMuted) {
            audioElement.volume = previousVolume > 0 ? previousVolume : 1;
            volumeSliders.forEach(s => s.value = audioElement.volume);
            isMuted = false;
        } else {
            previousVolume = audioElement.volume;
            audioElement.volume = 0;
            volumeSliders.forEach(s => s.value = 0);
            isMuted = true;
        }
        updateVolumeIcon(audioElement.volume);
    };

    const updateVolumeIcon = (vol) => {
        volumeIcons.forEach(icon => {
            if (vol === 0) {
                icon.className = "fa-solid fa-volume-xmark";
            } else if (vol < 0.5) {
                icon.className = "fa-solid fa-volume-low";
            } else {
                icon.className = "fa-solid fa-volume-high";
            }
        });
    };

    // ==================== 4. UI HELPER & UPDATERS ====================
    const setPlayState = (playing) => {
        isPlaying = playing;
        playPauseIcons.forEach(icon => {
            icon.className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
        });
    };

    const setLoadingState = (loading) => {
        loadingIndicators.forEach(ind => {
            if (loading) ind.classList.remove('hidden');
            else ind.classList.add('hidden');
        });
    };

    const updateMetadataUI = (track) => {
        playerTitles.forEach(el => { el.textContent = track.title; });
        playerArtists.forEach(el => { el.textContent = track.artist || 'Unknown Artist'; });
        playerThumbs.forEach(img => {
            img.src = track.thumbnail || './assets/img/default-cover.jpg';
        });

        // Periksa status Like lagu
        // (Status akan diperbarui otomatis oleh app.js saat render ulang)
    };

    const highlightActiveTrackInList = () => {
        if (!currentTrack) return;
        document.querySelectorAll('.track-item').forEach(item => {
            if (item.getAttribute('data-video-id') === currentTrack.video_id) {
                item.classList.add('playing');
            } else {
                item.classList.remove('playing');
            }
        });
    };

    const renderQueueDrawer = () => {
        const container = document.getElementById('queue-list-container');
        if (!container) return;

        if (queue.length === 0) {
            container.innerHTML = `
                <div class="empty-state-box">
                    <i class="fa-solid fa-music"></i>
                    <p>Antrean musik masih kosong.</p>
                </div>`;
            return;
        }

        container.innerHTML = queue.map((track, index) => `
            <div class="track-item ${index === currentIndex ? 'playing' : ''}" data-queue-index="${index}">
                <div class="track-thumb-wrapper">
                    <img src="${track.thumbnail || './assets/img/default-cover.jpg'}" alt="Cover" onerror="this.src='./assets/img/default-cover.jpg'">
                </div>
                <div class="track-info">
                    <h4 class="track-title">${track.title}</h4>
                    <p class="track-artist">${track.artist || 'Unknown Artist'}</p>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.track-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.getAttribute('data-queue-index'));
                if (!isNaN(idx)) {
                    currentIndex = idx;
                    loadAndPlayCurrentTrack();
                }
            });
        });
    };

    const formatTime = (secs) => {
        if (isNaN(secs) || secs < 0) return '0:00';
        const mins = Math.floor(secs / 60);
        const remSecs = Math.floor(secs % 60);
        return `${mins}:${remSecs < 10 ? '0' : ''}${remSecs}`;
    };

    // Jalankan inisialisasi saat DOM siap
    document.addEventListener('DOMContentLoaded', initPlayer);

    return {
        playTrackList,
        togglePlayPause,
        nextTrack,
        prevTrack,
        getCurrentTrack: () => currentTrack,
        getQueue: () => queue
    };
})();
