'use strict';

// ── 스토리지 ──────────────────────────────────────────
const Storage = {
  KEY: 'streamlink_streams',
  PL_KEY: 'streamlink_playlists',
  ALL_ID: '__all__',

  // ── 플레이리스트 ──
  getPlaylists() {
    try { return JSON.parse(localStorage.getItem(this.PL_KEY) || '[]'); }
    catch { return []; }
  },

  savePlaylists(pls) { localStorage.setItem(this.PL_KEY, JSON.stringify(pls)); },

  addPlaylist(name) {
    const pls = this.getPlaylists();
    const pl = { id: Date.now().toString(), name };
    pls.push(pl);
    this.savePlaylists(pls);
    return pl;
  },

  renamePlaylist(id, name) {
    const pls = this.getPlaylists().map(p => p.id === id ? { ...p, name } : p);
    this.savePlaylists(pls);
  },

  removePlaylist(id) {
    this.savePlaylists(this.getPlaylists().filter(p => p.id !== id));
    // 해당 플레이리스트 스트림 삭제
    this.save(this.getAll().filter(s => s.playlistId !== id));
  },

  // ── 스트림 ──
  getAll() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch { return []; }
  },

  getByPlaylist(playlistId) {
    const all = this.getAll();
    if (playlistId === this.ALL_ID) return all;
    return all.filter(s => s.playlistId === playlistId);
  },

  save(streams) { localStorage.setItem(this.KEY, JSON.stringify(streams)); },

  add(stream) {
    const streams = this.getAll();
    streams.push(stream);
    this.save(streams);
  },

  remove(id) { this.save(this.getAll().filter(s => s.id !== id)); },

  move(id, dir, playlistId) {
    // 현재 뷰의 순서 기준으로 이동 (전체 배열에서 상대 위치 교환)
    const all = this.getAll();
    const viewIds = this.getByPlaylist(playlistId).map(s => s.id);
    const vIdx = viewIds.indexOf(id);
    const vTarget = vIdx + dir;
    if (vTarget < 0 || vTarget >= viewIds.length) return;

    const aIdx = all.findIndex(s => s.id === viewIds[vIdx]);
    const aTarget = all.findIndex(s => s.id === viewIds[vTarget]);
    [all[aIdx], all[aTarget]] = [all[aTarget], all[aIdx]];
    this.save(all);
  }
};

// ── YouTube 유틸 ─────────────────────────────────────
const YouTube = {
  extractId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0];
      if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    } catch {}
    return null;
  },
  isYouTube(url) {
    return /youtube\.com|youtu\.be/.test(url);
  },
  async resolve(url) {
    const id = this.extractId(url);
    if (!id) throw new Error('유효하지 않은 YouTube URL입니다');
    const res = await fetch(`/api/youtube?id=${id}`, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'YouTube 오디오를 가져올 수 없습니다');
    return data.url;
  }
};


// ── 오디오 컨트롤러 ───────────────────────────────────
const AudioCtrl = (() => {
  // iOS: 오디오 엘리먼트를 앱 전체에서 하나만 유지해야 백그라운드 세션 유지
  const audio = new window.Audio();
  audio.preload = 'none';

  let currentId = null;
  let _onStateChange = null;
  let _onEnded = null;
  let _currentStream = null;
  let _eventsAttached = false;

  function attachEvents() {
    if (_eventsAttached) return;
    _eventsAttached = true;
    audio.addEventListener('playing', () => {
      _setPlaybackState('playing');
      _onStateChange?.('playing', currentId);
    });
    audio.addEventListener('pause', () => {
      _setPlaybackState('paused');
      _onStateChange?.('paused', currentId);
    });
    audio.addEventListener('waiting', () => _onStateChange?.('loading', currentId));
    audio.addEventListener('stalled', () => _onStateChange?.('loading', currentId));
    audio.addEventListener('error',   () => _onStateChange?.('error',   currentId));
    // 트랙 종료 시 외부 핸들러 호출 (순차재생 or 재연결)
    audio.addEventListener('ended', () => {
      _onEnded?.();
    });
  }

  function _setPlaybackState(state) {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
  }

  function setMediaSession(stream) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: stream.name, artist: 'StreamLink', album: '인터넷 라디오'
    });
    // 라이브 스트림: position 상태 설정
    try {
      navigator.mediaSession.setPositionState({ duration: Infinity, playbackRate: 1, position: 0 });
    } catch {}
    navigator.mediaSession.setActionHandler('play',  () => resume());
    navigator.mediaSession.setActionHandler('pause', () => pause());
    navigator.mediaSession.setActionHandler('stop',  () => stop());
  }

  function play(stream) {
    // src만 교체 — 엘리먼트는 재사용 (iOS 백그라운드 세션 유지)
    audio.pause();
    _currentStream = stream;
    currentId = stream.id;
    audio.src = stream.url;
    audio.load();
    attachEvents();
    setMediaSession(stream);
    _setPlaybackState('playing');
    _onStateChange?.('loading', currentId);
    audio.play().catch(err => {
      if (err.name !== 'AbortError') _onStateChange?.('error', currentId);
    });
  }

  function pause() {
    audio?.pause();
    _setPlaybackState('paused');
  }

  function resume() {
    if (!audio) return;
    audio.play().catch(() => _onStateChange?.('error', currentId));
    _setPlaybackState('playing');
  }

  function stop() {
    _currentStream = null;
    if (audio) { audio.pause(); audio.src = ''; audio.load(); }
    currentId = null;
    _setPlaybackState('none');
    _onStateChange?.('stopped', null);
  }

  function setVolume(v) { if (audio) audio.volume = v / 100; }

  function isActive() { return audio && !audio.paused; }

  // 화면 전환 후 오디오 상태 복구 (일부 브라우저가 백그라운드에서 pause 이벤트 발생)
  function handleVisibilityChange() {
    if (document.hidden) return;
    if (!_currentStream || !currentId) return;
    // 재생 중이어야 하는데 멈춰 있으면 재개
    if (audio && audio.paused && audio.src && audio.readyState >= 2) {
      audio.play().catch(() => {});
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  return {
    play, pause, resume, stop, setVolume, isActive,
    get currentId() { return currentId; },
    set onStateChange(fn) { _onStateChange = fn; },
    set onEnded(fn) { _onEnded = fn; }
  };
})();

// ── UI ────────────────────────────────────────────────
const UI = {
  streamList:   document.getElementById('streamList'),
  emptyState:   document.getElementById('emptyState'),
  miniPlayer:   document.getElementById('miniPlayer'),
  miniTitle:    document.getElementById('miniTitle'),
  miniStatus:   document.getElementById('miniStatus'),
  miniQueue:    document.getElementById('miniQueue'),
  miniWaveform: document.getElementById('miniWaveform'),
  btnPlayMini:  document.getElementById('btnPlayMini'),
  btnPrev:      document.getElementById('btnPrev'),
  btnNext:      document.getElementById('btnNext'),
  volumeSlider: document.getElementById('volumeSlider'),
  modalOverlay:   document.getElementById('modalOverlay'),
  modalForm:      document.getElementById('modalForm'),
  inputName:      document.getElementById('inputName'),
  inputUrl:       document.getElementById('inputUrl'),
  urlError:       document.getElementById('urlError'),
  selectPlaylist: document.getElementById('selectPlaylist'),
  toast:          document.getElementById('toast'),
  main:           document.getElementById('main'),
  pwaBanner:      document.getElementById('pwaBanner'),
  btnInstall:     document.getElementById('btnInstall'),
  playlistTabs:    document.getElementById('playlistTabs'),
  plHeader:        document.getElementById('plHeader'),
  plHeaderTitle:   document.getElementById('plHeaderTitle'),
  plHeaderCount:   document.getElementById('plHeaderCount'),
  plModalOverlay:  document.getElementById('plModalOverlay'),
  plModalForm:    document.getElementById('plModalForm'),
  plModalTitle:   document.getElementById('plModalTitle'),
  plInput:        document.getElementById('plInput'),
  plError:        document.getElementById('plError'),
  btnDeletePl:    document.getElementById('btnDeletePl'),

  // XSS 방지: 브라우저 DOM이 인코딩 처리
  _esc(str) {
    const el = document.createElement('span');
    el.textContent = String(str);
    return el.innerHTML;
  },

  _stateLabel(state) {
    return { playing: '재생 중', loading: '연결 중...', paused: '일시정지', error: '재생 오류' }[state] || '';
  },

  renderList(streams, currentId, state) {
    this.emptyState.style.display = streams.length === 0 ? 'flex' : 'none';
    this.streamList.innerHTML = '';

    streams.forEach((stream, idx) => {
      const isActive = stream.id === currentId;
      const isError = isActive && state === 'error';
      const item = document.createElement('div');
      item.className = 'stream-item' + (isActive ? ' playing' : '') + (isError ? ' error' : '');
      item.dataset.id = stream.id;

      const stateLabel = isActive ? this._stateLabel(state) : '';
      const stateClass = isActive && state === 'error' ? 'error' : isActive && state === 'loading' ? 'loading' : '';

      item.innerHTML = `
        <div class="stream-icon">
          <div class="waveform${isError ? ' paused' : ''}" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <svg class="play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        </div>
        <div class="stream-meta">
          <div class="stream-name">${this._esc(stream.name)}</div>
          <div class="stream-url">${this._esc(stream.url)}</div>
          ${stateLabel ? `<div class="stream-state ${stateClass}">${this._esc(stateLabel)}${isError ? ' — <span class="retry-hint">탭하여 재시도</span>' : ''}</div>` : ''}
        </div>
        <div class="item-actions">
          <button class="btn-move" data-id="${this._esc(stream.id)}" data-dir="-1" aria-label="위로" ${idx === 0 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="18,15 12,9 6,15"/></svg>
          </button>
          <button class="btn-move" data-id="${this._esc(stream.id)}" data-dir="1" aria-label="아래로" ${idx === streams.length - 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6,9 12,15 18,9"/></svg>
          </button>
          <button class="btn-delete" data-id="${this._esc(stream.id)}" aria-label="${this._esc(stream.name)} 삭제">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/>
            </svg>
          </button>
        </div>
      `;
      this.streamList.appendChild(item);
    });
  },

  updateMiniPlayer(stream, state, queueIdx, queueLen) {
    if (!stream) {
      this.miniPlayer.hidden = true;
      this.main.classList.remove('has-player');
      return;
    }
    this.miniPlayer.hidden = false;
    this.main.classList.add('has-player');
    this.miniTitle.textContent = stream.name;

    const active = state === 'playing' || state === 'loading';
    const isError = state === 'error';

    this.miniStatus.textContent = this._stateLabel(state);
    this.miniStatus.className = 'mini-status' + (active ? '' : ' paused') + (isError ? ' error-text' : '');
    this.miniWaveform.className = 'mini-waveform' + (active ? '' : ' paused');

    // 큐 위치 표시
    if (queueLen > 1) {
      this.miniQueue.textContent = (queueIdx + 1) + ' / ' + queueLen;
    } else {
      this.miniQueue.textContent = '';
    }

    // 이전/다음 버튼 활성화
    this.btnPrev.disabled = queueIdx <= 0;
    this.btnNext.disabled = queueIdx >= queueLen - 1;

    const iconPause = this.btnPlayMini.querySelector('.icon-pause');
    const iconPlay  = this.btnPlayMini.querySelector('.icon-play');
    if (active) {
      iconPause.style.display = ''; iconPlay.style.display = 'none';
    } else {
      iconPause.style.display = 'none'; iconPlay.style.display = '';
    }
  },

  renderPlaylistTabs(playlists, activeId) {
    this.playlistTabs.innerHTML = '';

    // 전체 탭
    const allTab = document.createElement('button');
    allTab.className = 'pl-tab' + (activeId === Storage.ALL_ID ? ' active' : '');
    allTab.dataset.id = Storage.ALL_ID;
    allTab.textContent = '전체';
    this.playlistTabs.appendChild(allTab);

    playlists.forEach(pl => {
      const tab = document.createElement('button');
      tab.className = 'pl-tab' + (activeId === pl.id ? ' active' : '');
      tab.dataset.id = pl.id;

      const label = document.createElement('span');
      label.textContent = pl.name;

      const editBtn = document.createElement('button');
      editBtn.className = 'pl-tab-edit';
      editBtn.dataset.plId = pl.id;
      editBtn.dataset.plName = pl.name;
      editBtn.setAttribute('aria-label', pl.name + ' 편집');
      editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

      tab.appendChild(label);
      tab.appendChild(editBtn);
      this.playlistTabs.appendChild(tab);
    });
  },

  updatePlaylistSelect(playlists, activeId) {
    this.selectPlaylist.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = Storage.ALL_ID;
    allOpt.textContent = '전체 (분류 없음)';
    this.selectPlaylist.appendChild(allOpt);

    playlists.forEach(pl => {
      const opt = document.createElement('option');
      opt.value = pl.id;
      opt.textContent = pl.name;
      this.selectPlaylist.appendChild(opt);
    });

    // 현재 탭이 전체가 아니면 해당 플레이리스트 선택
    if (activeId !== Storage.ALL_ID) this.selectPlaylist.value = activeId;
  },

  showModal(playlists, activePlaylistId) {
    this.modalOverlay.hidden = false;
    this.inputName.value = '';
    this.inputUrl.value = '';
    this.urlError.textContent = '';
    this.updatePlaylistSelect(playlists, activePlaylistId);
    setTimeout(() => this.inputName.focus(), 50);
  },

  hideModal() { this.modalOverlay.hidden = true; },

  showPlModal(mode, pl) {
    // mode: 'create' | 'edit'
    this.plModalOverlay.hidden = false;
    this.plInput.value = mode === 'edit' ? pl.name : '';
    this.plError.textContent = '';
    this.plModalTitle.textContent = mode === 'edit' ? '플레이리스트 편집' : '플레이리스트 만들기';
    this.btnDeletePl.hidden = mode !== 'edit';
    this.plModalOverlay.dataset.mode = mode;
    this.plModalOverlay.dataset.plId = pl?.id || '';
    setTimeout(() => this.plInput.focus(), 50);
  },

  hidePlModal() { this.plModalOverlay.hidden = true; },

  updatePlHeader(playlist, streamCount) {
    if (!playlist) {
      this.plHeader.hidden = true;
      return;
    }
    this.plHeader.hidden = false;
    this.plHeaderTitle.textContent = playlist.name;
    this.plHeaderCount.textContent = streamCount + '개의 스트림';
  },

  showToast(msg, duration = 2200) {
    const hasPlayer = !this.miniPlayer.hidden;
    this.toast.textContent = msg;
    this.toast.className = 'toast visible' + (hasPlayer ? '' : ' no-player');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.className = 'toast' + (hasPlayer ? '' : ' no-player');
    }, duration);
  },

  showPwaBanner() {
    if (this.pwaBanner) this.pwaBanner.hidden = false;
  },

  hidePwaBanner() {
    if (this.pwaBanner) this.pwaBanner.hidden = true;
  }
};

// ── 앱 코어 ──────────────────────────────────────────
const App = {
  streams: [],
  playlists: [],
  activePlaylist: Storage.ALL_ID,
  currentId: null,
  state: 'stopped',
  _queue: [],       // 현재 재생 중인 플레이리스트의 순서
  _queueIdx: -1,    // 큐에서 현재 위치
  _deferredInstall: null,

  init() {
    this.playlists = Storage.getPlaylists();
    this.streams = Storage.getAll();
    this._render();
    this._bindEvents();
    this._registerSW();
    this._setupPWA();
    this._unlockAudioIOS();
  },

  // iOS Safari: 첫 번째 사용자 터치로 오디오 세션 사전 활성화
  _unlockAudioIOS() {
    const unlock = () => {
      const a = new window.Audio();
      a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      a.volume = 0;
      a.play().then(() => { a.pause(); }).catch(() => {});
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('click', unlock, { once: true });
  },

  _render() {
    const visible = Storage.getByPlaylist(this.activePlaylist);
    UI.renderPlaylistTabs(this.playlists, this.activePlaylist);
    UI.renderList(visible, this.currentId, this.state);
    // 플레이리스트 헤더 (전체 탭은 숨김)
    const activePl = this.playlists.find(p => p.id === this.activePlaylist) || null;
    UI.updatePlHeader(activePl, visible.length);
    const current = this.streams.find(s => s.id === this.currentId) || null;
    const queueIdx = this._queue.findIndex(s => s.id === this.currentId);
    UI.updateMiniPlayer(current, this.state, queueIdx, this._queue.length);
  },

  _bindEvents() {
    AudioCtrl.onStateChange = (state, id) => {
      this.state = state;
      if (id !== null) this.currentId = id;
      if (state === 'stopped') this.currentId = null;
      this._render();
    };

    AudioCtrl.onEnded = () => {
      const idx = this._queue.findIndex(s => s.id === this.currentId);
      if (idx >= 0 && idx < this._queue.length - 1) {
        this._playFromQueue(idx + 1);
      } else {
        AudioCtrl.stop();
      }
    };

    document.getElementById('btnAdd').addEventListener('click', () =>
      UI.showModal(this.playlists, this.activePlaylist)
    );
    document.getElementById('btnCloseModal').addEventListener('click', () => UI.hideModal());
    document.getElementById('btnCancel').addEventListener('click', () => UI.hideModal());
    document.getElementById('modalOverlay').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideModal();
    });
    UI.modalForm.addEventListener('submit', e => { e.preventDefault(); this._handleAddStream(); });

    // 플레이리스트 탭 클릭
    UI.playlistTabs.addEventListener('click', e => {
      const editBtn = e.target.closest('.pl-tab-edit');
      if (editBtn) {
        e.stopPropagation();
        UI.showPlModal('edit', { id: editBtn.dataset.plId, name: editBtn.dataset.plName });
        return;
      }
      const tab = e.target.closest('.pl-tab');
      if (tab) {
        this.activePlaylist = tab.dataset.id;
        this._render();
      }
    });

    // 플레이리스트 추가 버튼
    document.getElementById('btnAddPlaylist').addEventListener('click', () =>
      UI.showPlModal('create', null)
    );

    // 플레이리스트 모달
    document.getElementById('btnClosePlModal').addEventListener('click', () => UI.hidePlModal());
    document.getElementById('btnCancelPl').addEventListener('click', () => UI.hidePlModal());
    document.getElementById('plModalOverlay').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hidePlModal();
    });
    UI.plModalForm.addEventListener('submit', e => { e.preventDefault(); this._handleSavePlaylist(); });
    document.getElementById('btnDeletePl').addEventListener('click', () => this._handleDeletePlaylist());

    // 헤더 편집 버튼
    document.getElementById('plHeaderEdit').addEventListener('click', () => {
      const pl = this.playlists.find(p => p.id === this.activePlaylist);
      if (pl) UI.showPlModal('edit', pl);
    });

    // 목록 이벤트 위임 (재생, 삭제, 순서 변경)
    UI.streamList.addEventListener('click', e => {
      const moveBtn = e.target.closest('.btn-move');
      if (moveBtn) {
        e.stopPropagation();
        this._handleMove(moveBtn.dataset.id, Number(moveBtn.dataset.dir));
        return;
      }
      const delBtn = e.target.closest('.btn-delete');
      if (delBtn) {
        e.stopPropagation();
        this._handleDelete(delBtn.dataset.id);
        return;
      }
      const item = e.target.closest('.stream-item');
      if (item) this._handlePlay(item.dataset.id);
    });

    // 이전/다음 버튼
    document.getElementById('btnPrev').addEventListener('click', () => {
      const idx = this._queue.findIndex(s => s.id === this.currentId);
      if (idx > 0) this._playFromQueue(idx - 1);
    });
    document.getElementById('btnNext').addEventListener('click', () => {
      const idx = this._queue.findIndex(s => s.id === this.currentId);
      if (idx >= 0 && idx < this._queue.length - 1) this._playFromQueue(idx + 1);
    });

    // 미니 플레이어 버튼
    UI.btnPlayMini.addEventListener('click', () => {
      if (this.state === 'playing' || this.state === 'loading') {
        AudioCtrl.pause();
      } else if (this.state === 'error' && this.currentId) {
        this._retryPlay(this.currentId);
      } else if (this.currentId) {
        AudioCtrl.resume();
      }
    });

    UI.volumeSlider.addEventListener('input', e => AudioCtrl.setVolume(Number(e.target.value)));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { UI.hideModal(); UI.hidePlModal(); }
    });

    // PWA 설치 버튼
    document.getElementById('btnInstall')?.addEventListener('click', () => this._handleInstall());
    document.getElementById('btnPwaBannerClose')?.addEventListener('click', () => UI.hidePwaBanner());
  },

  _handleAddStream() {
    const name = UI.inputName.value.trim();
    const url  = UI.inputUrl.value.trim();

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      UI.urlError.textContent = 'http:// 또는 https:// 로 시작하는 URL을 입력하세요.';
      UI.inputUrl.focus();
      return;
    }
    if (url.startsWith('http://')) {
      UI.urlError.textContent = 'HTTPS URL을 권장합니다. HTTP는 일부 브라우저에서 차단될 수 있습니다.';
    } else if (YouTube.isYouTube(url) && !YouTube.extractId(url)) {
      UI.urlError.textContent = '유효하지 않은 YouTube URL입니다.';
      UI.inputUrl.focus();
      return;
    } else {
      UI.urlError.textContent = '';
    }

    let displayName = name;
    if (!displayName) {
      if (YouTube.isYouTube(url)) {
        displayName = 'YouTube — ' + (YouTube.extractId(url) || url);
      } else {
        try { displayName = new URL(url).hostname; } catch { displayName = url; }
      }
    }

    const playlistId = UI.selectPlaylist.value || Storage.ALL_ID;
    const stream = { id: Date.now().toString(), name: displayName, url, playlistId };
    Storage.add(stream);
    this.streams = Storage.getAll();
    UI.hideModal();
    this._render();
    UI.showToast('"' + displayName + '" 추가됨');
  },

  _handleDelete(id) {
    if (id === this.currentId) {
      AudioCtrl.stop();
      this.currentId = null;
      this.state = 'stopped';
    }
    const stream = this.streams.find(s => s.id === id);
    Storage.remove(id);
    this.streams = Storage.getAll();
    this._render();
    if (stream) UI.showToast('"' + stream.name + '" 삭제됨');
  },

  _handleMove(id, dir) {
    Storage.move(id, dir, this.activePlaylist);
    this.streams = Storage.getAll();
    this._render();
  },

  _handleSavePlaylist() {
    const name = UI.plInput.value.trim();
    if (!name) { UI.plError.textContent = '이름을 입력하세요.'; return; }

    const mode = UI.plModalOverlay.dataset.mode;
    if (mode === 'edit') {
      const id = UI.plModalOverlay.dataset.plId;
      Storage.renamePlaylist(id, name);
      this.playlists = Storage.getPlaylists();
    } else {
      const pl = Storage.addPlaylist(name);
      this.playlists = Storage.getPlaylists();
      this.activePlaylist = pl.id; // 새 플레이리스트로 이동
    }
    UI.hidePlModal();
    this._render();
    UI.showToast('"' + name + '" ' + (mode === 'edit' ? '변경됨' : '생성됨'));
  },

  _handleDeletePlaylist() {
    const id = UI.plModalOverlay.dataset.plId;
    const pl = this.playlists.find(p => p.id === id);
    Storage.removePlaylist(id);
    this.playlists = Storage.getPlaylists();
    this.streams = Storage.getAll();
    if (this.activePlaylist === id) this.activePlaylist = Storage.ALL_ID;
    if (this.currentId && !this.streams.find(s => s.id === this.currentId)) {
      AudioCtrl.stop();
      this.currentId = null;
      this.state = 'stopped';
    }
    UI.hidePlModal();
    this._render();
    if (pl) UI.showToast('"' + pl.name + '" 삭제됨');
  },

  _handlePlay(id) {
    const stream = this.streams.find(s => s.id === id);
    if (!stream) return;

    if (this.currentId === id) {
      if (this.state === 'playing' || this.state === 'loading') {
        AudioCtrl.pause();
      } else if (this.state === 'error') {
        this._retryPlay(id);
      } else {
        AudioCtrl.resume();
      }
      return;
    }

    // 현재 보이는 목록을 큐로 설정
    this._queue = Storage.getByPlaylist(this.activePlaylist);
    this._playFromQueue(this._queue.findIndex(s => s.id === id));
  },

  async _playFromQueue(idx) {
    const stream = this._queue[idx];
    if (!stream) return;
    this._queueIdx = idx;
    this.currentId = stream.id;
    this.state = 'loading';
    this._render();

    let playUrl = stream.url;
    if (YouTube.isYouTube(stream.url)) {
      try {
        playUrl = await YouTube.resolve(stream.url);
      } catch (err) {
        this.state = 'error';
        this._render();
        UI.showToast(err.message, 4000);
        return;
      }
    }

    AudioCtrl.play({ ...stream, url: playUrl });

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('previoustrack',
        idx > 0 ? () => this._playFromQueue(idx - 1) : null
      );
      navigator.mediaSession.setActionHandler('nexttrack',
        idx < this._queue.length - 1 ? () => this._playFromQueue(idx + 1) : null
      );
    }
  },

  _retryPlay(id) {
    const idx = this._queue.findIndex(s => s.id === id);
    if (idx >= 0) this._playFromQueue(idx);
  },

  _setupPWA() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this._deferredInstall = e;
      UI.showPwaBanner();
    });
    window.addEventListener('appinstalled', () => {
      UI.hidePwaBanner();
      this._deferredInstall = null;
    });
  },

  async _handleInstall() {
    if (!this._deferredInstall) return;
    this._deferredInstall.prompt();
    const { outcome } = await this._deferredInstall.userChoice;
    if (outcome === 'accepted') {
      this._deferredInstall = null;
      UI.hidePwaBanner();
    }
  },

  _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 등록 실패:', err));
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
