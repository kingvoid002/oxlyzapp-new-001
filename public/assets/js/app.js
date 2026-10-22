/**
 * OXLYZ MAIN APPLICATION CONTROLLER (app.js)
 * Mengelola navigasi SPA, render DOM, interaksi pengguna, dan sinkronisasi state.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Referensi Elemen DOM Utama
    const views = document.querySelectorAll('.view-section');
    const navLinks = document.querySelectorAll('.nav-link, .bottom-nav-item');
    const globalSearchInput = document.getElementById('global-search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const btnSyncLibrary = document.getElementById('btn-sync-library');
    const displayUsername = document.getElementById('display-username');

    // State Global Aplikasi
    let currentView = 'view-home';
    let libraryData = { playlists: [], favorites: [], history: [] };
    let searchDebounceTimer = null;

    // Inisialisasi Nama Pengguna dari Device ID
    if (displayUsername) {
        const userId = OxlyzAPI.getUserId();
        displayUsername.textContent = `User_${userId.substring(5, 11)}`;
    }

    // ==================== 1. NAVIGASI SPA (SINGLE PAGE APPLICATION) ====================
    const switchView = (targetViewId, pushHistory = true) => {
        views.forEach(view => {
            if (view.id === targetViewId) {
                view.classList.add('active');
            } else {
                view.classList.remove('active');
            }
        });

        // Perbarui status aktif pada tombol navigasi (Sidebar & Bottom Bar)
        navLinks.forEach(link => {
            if (link.getAttribute('data-target') === targetViewId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        currentView = targetViewId;
        const viewsContainer = document.getElementById('views-container');
        if (viewsContainer) viewsContainer.scrollTop = 0;

        // Pemuatan data spesifik berdasarkan halaman yang dibuka
        if (targetViewId === 'view-library') {
            renderLibraryView();
        } else if (targetViewId === 'view-favorites') {
            renderFavoritesView();
        } else if (targetViewId === 'view-home') {
            loadHomeRecentTracks();
        }
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const target = link.getAttribute('data-target');
            if (target) {
                switchView(target);
            }
        });
    });

    // Delegasi klik untuk tombol berorientasi data-target di dalam konten
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-target]');
        if (btn && !btn.classList.contains('nav-link') && !btn.classList.contains('bottom-nav-item')) {
            const target = btn.getAttribute('data-target');
            if (target) switchView(target);
        }
    });

    // ==================== 2. SINKRONISASI PUSTAKA DARI POSTGRESQL ====================
    const refreshLibraryData = async (showToastFeedback = false) => {
        try {
            libraryData = await OxlyzAPI.getLibraryOverview();
            renderSidebarPlaylists();
            if (currentView === 'view-library') renderLibraryView();
            if (currentView === 'view-favorites') renderFavoritesView();
            if (showToastFeedback) showToast("Pustaka berhasil disinkronkan dengan database.");
        } catch (e) {
            console.error("Gagal menyegarkan pustaka:", e);
            if (showToastFeedback) showToast("Gagal menyinkronkan pustaka.", "error");
        }
    };

    if (btnSyncLibrary) {
        btnSyncLibrary.addEventListener('click', () => refreshLibraryData(true));
    }

    // ==================== 3. RENDER KOMPONEN UI ====================

    // A. Render Sidebar Playlist Cepat
    const renderSidebarPlaylists = () => {
        const listEl = document.getElementById('sidebar-playlist-list');
        if (!listEl) return;

        const playlists = libraryData.playlists || [];
        if (playlists.length === 0) {
            listEl.innerHTML = `<li class="empty-nav-item">Belum ada playlist</li>`;
            return;
        }

        listEl.innerHTML = playlists.map(pl => `
            <li class="playlist-quick-item" data-playlist-id="${pl.id}">
                <i class="fa-solid fa-music"></i>
                <span title="${escapeHtml(pl.name)}">${escapeHtml(pl.name)}</span>
            </li>
        `).join('');

        // Event klik untuk membuka detail playlist
        listEl.querySelectorAll('.playlist-quick-item').forEach(item => {
            item.addEventListener('click', () => {
                const plId = item.getAttribute('data-playlist-id');
                openPlaylistDetail(plId);
            });
        });
    };

    // B. Render Halaman Beranda (Recently Played & Mood Chips)
    const loadHomeRecentTracks = () => {
        const recentContainer = document.getElementById('home-recent-list');
        if (!recentContainer) return;

        const history = libraryData.history || [];
        if (history.length === 0) {
            recentContainer.innerHTML = `
                <div class="empty-state-box">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    <p>Belum ada riwayat pemutaran lagu.</p>
                </div>`;
            return;
        }

        recentContainer.innerHTML = history.slice(0, 10).map(track => `
            <div class="recent-card" data-video-id="${escapeHtml(track.video_id)}">
                <div class="recent-card-cover">
                    <img src="${escapeHtml(track.thumbnail || './assets/img/default-cover.jpg')}" alt="Cover" loading="lazy" onerror="this.src='./assets/img/default-cover.jpg'">
                    <div class="card-play-hover">
                        <i class="fa-solid fa-play"></i>
                    </div>
                </div>
                <h4 class="recent-card-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h4>
                <p class="recent-card-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</p>
            </div>
        `).join('');

        recentContainer.querySelectorAll('.recent-card').forEach((card, index) => {
            card.addEventListener('click', () => {
                if (typeof OxlyzPlayer !== 'undefined') {
                    OxlyzPlayer.playTrackList(history.slice(0, 10), index);
                }
            });
        });
    };

    // Mood Chips (Pencarian Cepat Berdasarkan Genre/Mood)
    document.querySelectorAll('.mood-chip').forEach(chip => {
        chip.addEventListener('click', async () => {
            document.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            const query = chip.getAttribute('data-query');
            if (query && globalSearchInput) {
                globalSearchInput.value = query;
                switchView('view-search');
                await executeSearch(query);
            }
        });
    });

    const btnHeroExplore = document.getElementById('btn-hero-explore');
    if (btnHeroExplore) {
        btnHeroExplore.addEventListener('click', () => {
            switchView('view-search');
            if (globalSearchInput) globalSearchInput.focus();
        });
    }

    // C. Render Halaman Pustaka (Library & Playlists Grid)
    const renderLibraryView = () => {
        const gridEl = document.getElementById('library-playlists-grid');
        const historyEl = document.getElementById('library-history-list');

        if (gridEl) {
            const playlists = libraryData.playlists || [];
            if (playlists.length === 0) {
                gridEl.innerHTML = `
                    <div class="empty-state-box">
                        <i class="fa-solid fa-layer-group"></i>
                        <p>Belum ada playlist kustom. Buat playlist pertamamu sekarang!</p>
                    </div>`;
            } else {
                gridEl.innerHTML = playlists.map(pl => `
                    <div class="playlist-card" data-playlist-id="${pl.id}">
                        <div class="playlist-card-cover">
                            ${pl.cover_url ? `<img src="${escapeHtml(pl.cover_url)}" alt="Cover" onerror="this.style.display='none'">` : `<i class="fa-solid fa-music"></i>`}
                        </div>
                        <div class="playlist-card-info">
                            <h4 title="${escapeHtml(pl.name)}">${escapeHtml(pl.name)}</h4>
                            <p>${pl.track_count || 0} Lagu</p>
                        </div>
                    </div>
                `).join('');

                gridEl.querySelectorAll('.playlist-card').forEach(card => {
                    card.addEventListener('click', () => {
                        openPlaylistDetail(card.getAttribute('data-playlist-id'));
                    });
                });
            }
        }

        if (historyEl) {
            const history = libraryData.history || [];
            renderTrackList(historyEl, history);
        }
    };

    // D. Render Halaman Lagu Disukai (Favorites)
    const renderFavoritesView = () => {
        const favListEl = document.getElementById('favorites-tracks-list');
        const countTextEl = document.getElementById('favorites-count-text');
        const favorites = libraryData.favorites || [];

        if (countTextEl) {
            countTextEl.textContent = `${favorites.length} Lagu tersimpan di database PostgreSQL`;
        }

        if (favListEl) {
            renderTrackList(favListEl, favorites, { showFavoriteToggle: true, emptyMessage: "Belum ada lagu yang ditandai sebagai favorit." });
        }

        const btnPlayAllFav = document.getElementById('btn-play-all-favorites');
        if (btnPlayAllFav) {
            btnPlayAllFav.onclick = () => {
                if (favorites.length > 0 && typeof OxlyzPlayer !== 'undefined') {
                    OxlyzPlayer.playTrackList(favorites, 0);
                } else {
                    showToast("Tidak ada lagu di daftar favorit.");
                }
            };
        }
    };

    // ==================== 4. PENCARIAN MUSIK REAL-TIME (YT-DLP) ====================
    if (globalSearchInput) {
        globalSearchInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val) {
                if (btnClearSearch) btnClearSearch.classList.remove('hidden');
            } else {
                if (btnClearSearch) btnClearSearch.classList.add('hidden');
            }

            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(async () => {
                if (val.length >= 2) {
                    switchView('view-search');
                    await executeSearch(val);
                }
            }, 500);
        });

        globalSearchInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const val = globalSearchInput.value.trim();
                if (val) {
                    clearTimeout(searchDebounceTimer);
                    switchView('view-search');
                    await executeSearch(val);
                }
            }
        });
    }

    if (btnClearSearch) {
        btnClearSearch.addEventListener('click', () => {
            globalSearchInput.value = '';
            btnClearSearch.classList.add('hidden');
            globalSearchInput.focus();
        });
    }

    const executeSearch = async (query) => {
        const container = document.getElementById('search-results-container');
        const loadingBox = document.getElementById('search-loading');
        const titleEl = document.getElementById('search-view-title');
        const subtitleEl = document.getElementById('search-view-subtitle');

        if (titleEl) titleEl.textContent = `Hasil Pencarian: "${query}"`;
        if (subtitleEl) subtitleEl.textContent = `Menemukan audio murni tanpa iklan via yt-dlp`;

        if (loadingBox) loadingBox.classList.remove('hidden');
        if (container) container.innerHTML = '';

        try {
            const results = await OxlyzAPI.searchTracks(query, 20);
            if (loadingBox) loadingBox.classList.add('hidden');

            if (results.length === 0) {
                container.innerHTML = `
                    <div class="empty-state-box">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <p>Tidak ditemukan lagu untuk kata kunci "${escapeHtml(query)}".</p>
                    </div>`;
                return;
            }

            renderTrackList(container, results);
        } catch (e) {
            if (loadingBox) loadingBox.classList.add('hidden');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state-box">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <p>Gagal melakukan pencarian: ${escapeHtml(e.message)}</p>
                    </div>`;
            }
        }
    };

    // ==================== 5. RENDER DAFTAR LAGU (REUSABLE TRACK LIST) ====================
    window.renderTrackList = (containerEl, tracks, options = {}) => {
        if (!containerEl) return;

        if (!tracks || tracks.length === 0) {
            containerEl.innerHTML = `
                <div class="empty-state-box">
                    <i class="fa-solid fa-music"></i>
                    <p>${options.emptyMessage || "Daftar lagu masih kosong."}</p>
                </div>`;
            return;
        }

        containerEl.innerHTML = tracks.map((track, index) => {
            const isFav = (libraryData.favorites || []).some(f => f.video_id === track.video_id);
            const formattedDuration = formatDuration(track.duration);

            return `
                <div class="track-item" data-video-id="${escapeHtml(track.video_id)}" data-index="${index}">
                    <div class="track-thumb-wrapper">
                        <img src="${escapeHtml(track.thumbnail || './assets/img/default-cover.jpg')}" alt="Cover" loading="lazy" onerror="this.src='./assets/img/default-cover.jpg'">
                    </div>
                    <div class="track-info">
                        <h4 class="track-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h4>
                        <p class="track-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</p>
                    </div>
                    <span class="track-duration">${formattedDuration}</span>
                    <div class="track-actions">
                        <button class="icon-btn-sm btn-action-like ${isFav ? 'active' : ''}" title="Sukai Lagu" data-track-id="${escapeHtml(track.video_id)}">
                            <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                        </button>
                        <button class="icon-btn-sm btn-action-add" title="Tambah ke Playlist" data-track-id="${escapeHtml(track.video_id)}">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Event Klik Baris Lagu (Memutar Musik)
        containerEl.querySelectorAll('.track-item').forEach((item, index) => {
            item.addEventListener('click', (e) => {
                // Jangan picu play jika tombol aksi di dalam item diklik
                if (e.target.closest('.track-actions')) return;

                if (typeof OxlyzPlayer !== 'undefined') {
                    OxlyzPlayer.playTrackList(tracks, index);
                }
            });
        });

        // Event Tombol Like (Favorit)
        containerEl.querySelectorAll('.btn-action-like').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const videoId = btn.getAttribute('data-track-id');
                const track = tracks.find(t => t.video_id === videoId);
                if (track) {
                    try {
                        const res = await OxlyzAPI.toggleFavorite(track);
                        await refreshLibraryData();
                        showToast(res.is_favorite ? "Ditambahkan ke Lagu Disukai" : "Dihapus dari Lagu Disukai");
                    } catch (err) {
                        showToast("Gagal memperbarui favorit.", "error");
                    }
                }
            });
        });

        // Event Tombol Tambah ke Playlist
        containerEl.querySelectorAll('.btn-action-add').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const videoId = btn.getAttribute('data-track-id');
                const track = tracks.find(t => t.video_id === videoId);
                if (track) {
                    openAddToPlaylistModal(track);
                }
            });
        });
    };

    // ==================== 6. DETAIL PLAYLIST & MODAL MANAJEMEN ====================
    let activePlaylistId = null;

    const openPlaylistDetail = async (playlistId) => {
        activePlaylistId = playlistId;
        switchView('view-playlist-detail');

        const coverEl = document.getElementById('detail-playlist-cover');
        const nameEl = document.getElementById('detail-playlist-name');
        const descEl = document.getElementById('detail-playlist-desc');
        const countEl = document.getElementById('detail-playlist-count');
        const tracksContainer = document.getElementById('playlist-detail-tracks');

        if (nameEl) nameEl.textContent = "Memuat...";
        if (tracksContainer) tracksContainer.innerHTML = `<div class="loading-placeholder"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Memuat lagu...</span></div>`;

        try {
            const detail = await OxlyzAPI.getPlaylistDetail(playlistId);
            if (!detail) {
                showToast("Playlist tidak ditemukan.", "error");
                switchView('view-library');
                return;
            }

            if (nameEl) nameEl.textContent = detail.name;
            if (descEl) descEl.textContent = detail.description || "Tidak ada deskripsi";
            if (countEl) countEl.textContent = `${(detail.tracks || []).length} Lagu tersimpan`;
            if (coverEl) {
                if (detail.cover_url) {
                    coverEl.innerHTML = `<img src="${escapeHtml(detail.cover_url)}" alt="Cover" onerror="this.style.display='none'">`;
                } else {
                    coverEl.innerHTML = `<i class="fa-solid fa-music"></i>`;
                }
            }

            renderTrackList(tracksContainer, detail.tracks || []);

            const btnPlayPl = document.getElementById('btn-play-playlist');
            if (btnPlayPl) {
                btnPlayPl.onclick = () => {
                    if (detail.tracks && detail.tracks.length > 0 && typeof OxlyzPlayer !== 'undefined') {
                        OxlyzPlayer.playTrackList(detail.tracks, 0);
                    } else {
                        showToast("Playlist ini masih kosong.");
                    }
                };
            }

            const btnDeletePl = document.getElementById('btn-delete-playlist');
            if (btnDeletePl) {
                btnDeletePl.onclick = async () => {
                    if (confirm(`Hapus playlist "${detail.name}" secara permanen?`)) {
                        try {
                            await OxlyzAPI.deletePlaylist(playlistId);
                            await refreshLibraryData();
                            showToast("Playlist berhasil dihapus.");
                            switchView('view-library');
                        } catch (err) {
                            showToast("Gagal menghapus playlist.", "error");
                        }
                    }
                };
            }

        } catch (e) {
            showToast("Gagal memuat detail playlist.", "error");
            switchView('view-library');
        }
    };

    const btnBackLibrary = document.getElementById('btn-back-to-library');
    if (btnBackLibrary) {
        btnBackLibrary.addEventListener('click', () => switchView('view-library'));
    }

    // Modal: Buat Playlist Baru
    const modalCreatePl = document.getElementById('modal-create-playlist');
    const formCreatePl = document.getElementById('form-create-playlist');

    document.querySelectorAll('#btn-sidebar-new-playlist, #btn-library-create-playlist, #btn-hero-create-playlist, #btn-modal-new-playlist').forEach(btn => {
        if (btn) {
            btn.addEventListener('click', () => {
                // Tutup modal add to playlist jika terbuka
                const modalAdd = document.getElementById('modal-add-to-playlist');
                if (modalAdd) modalAdd.classList.add('hidden');

                if (modalCreatePl) modalCreatePl.classList.remove('hidden');
            });
        }
    });

    if (formCreatePl) {
        formCreatePl.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('input-playlist-name');
            const descInput = document.getElementById('input-playlist-desc');

            const name = nameInput.value.trim();
            const desc = descInput.value.trim();

            if (!name) return;

            try {
                await OxlyzAPI.createPlaylist(name, desc);
                nameInput.value = '';
                descInput.value = '';
                if (modalCreatePl) modalCreatePl.classList.add('hidden');
                await refreshLibraryData();
                showToast(`Playlist "${name}" berhasil dibuat.`);
            } catch (err) {
                showToast("Gagal membuat playlist.", "error");
            }
        });
    }

    // Modal: Tambah Lagu ke Playlist
    let trackToAddToPlaylist = null;
    const modalAddToPl = document.getElementById('modal-add-to-playlist');

    const openAddToPlaylistModal = (track) => {
        trackToAddToPlaylist = track;
        const titleEl = document.getElementById('add-track-target-title');
        const choicesEl = document.getElementById('modal-playlist-choices');

        if (titleEl) titleEl.textContent = `Simpan "${track.title}" ke playlist:`;
        if (choicesEl) {
            const playlists = libraryData.playlists || [];
            if (playlists.length === 0) {
                choicesEl.innerHTML = `<p class="empty-nav-item">Belum ada playlist. Buat playlist baru terlebih dahulu.</p>`;
            } else {
                choicesEl.innerHTML = playlists.map(pl => `
                    <div class="playlist-select-item" data-playlist-id="${pl.id}">
                        <span>${escapeHtml(pl.name)}</span>
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>
                `).join('');

                choicesEl.querySelectorAll('.playlist-select-item').forEach(item => {
                    item.addEventListener('click', async () => {
                        const plId = item.getAttribute('data-playlist-id');
                        try {
                            await OxlyzAPI.addTrackToPlaylist(plId, trackToAddToPlaylist);
                            if (modalAddToPl) modalAddToPl.classList.add('hidden');
                            await refreshLibraryData();
                            showToast("Lagu berhasil ditambahkan ke playlist.");
                        } catch (err) {
                            showToast("Gagal menambahkan lagu ke playlist.", "error");
                        }
                    });
                });
            }
        }

        if (modalAddToPl) modalAddToPl.classList.remove('hidden');
    };

    // Tutup Modal
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-modal');
            if (modalId) {
                document.getElementById(modalId)?.classList.add('hidden');
            } else {
                btn.closest('.modal-backdrop')?.classList.add('hidden');
            }
        });
    });

    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    });

    // ==================== 7. SISTEM TOAST NOTIFICATION ====================
    window.showToast = (message, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast-item';
        toast.innerHTML = `
            <i class="fa-solid ${type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
            <span>${escapeHtml(message)}</span>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    // ==================== 8. UTILITIES ====================
    const formatDuration = (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    // Pemuatan Awal Data Pustaka
    await refreshLibraryData();
});
