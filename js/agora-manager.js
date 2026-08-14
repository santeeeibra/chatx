/**
 * agora-manager.js
 * Wrapper sobre el SDK de Agora para manejar:
 *   - Video/audio local
 *   - Unirse/salir de canales
 *   - Suscribirse a usuarios remotos
 *   - Toggle mute/cámara
 *
 * Agora SDK (AgoraRTC) se carga desde CDN y es global en el browser.
 */

export class AgoraManager {
  constructor(appId) {
    this.appId = appId;
    this.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

    this.localVideoTrack = null;
    this.localAudioTrack = null;
    this.remoteUsers    = {};
    this.uid            = null;

    // Callbacks externos (asignados desde app.js)
    this.onRemoteJoined  = null; // (uid) => void
    this.onRemoteLeft    = null; // (uid) => void

    this._bindEvents();
  }

  // ============================================================
  // EVENTOS DEL SDK
  // ============================================================

  _bindEvents() {
    // Alguien publica un track (video o audio)
    this.client.on('user-published', async (user, mediaType) => {
      await this.client.subscribe(user, mediaType);
      this.remoteUsers[user.uid] = user;

      if (mediaType === 'video') {
        // Esconder placeholder y reproducir video remoto
        document.getElementById('placeholder-remote')?.classList.add('hidden');
        user.videoTrack.play('video-remote');
      }

      if (mediaType === 'audio') {
        user.audioTrack.play();
      }

      this.onRemoteJoined?.(user.uid);
    });

    // El usuario remoto deja de publicar (pausa cámara)
    this.client.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'video') {
        document.getElementById('placeholder-remote')?.classList.remove('hidden');
      }
    });

    // El usuario remoto abandona el canal
    this.client.on('user-left', (user) => {
      delete this.remoteUsers[user.uid];
      document.getElementById('placeholder-remote')?.classList.remove('hidden');
      this.onRemoteLeft?.(user.uid);
    });

    // Manejo de errores de red
    this.client.on('connection-state-change', (curState, revState) => {
      console.log(`[Agora] Conexión: ${revState} → ${curState}`);
    });
  }

  // ============================================================
  // TRACKS LOCALES
  // ============================================================

  /**
   * Inicia cámara y micrófono locales y reproduce el video en #video-local.
   */
  async initLocalVideo() {
    try {
      [this.localVideoTrack, this.localAudioTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
        {},                         // audio config
        { facingMode: 'user' }      // video config → cámara frontal en mobile
      );

      const stream = new MediaStream([this.localVideoTrack.getMediaStreamTrack()]);
      console.log('[Camera] tracks:', stream.getTracks());
      console.log('[Camera] video active:', stream.getVideoTracks()[0]?.enabled === true);

      const localVideo = document.getElementById('localVideo');
      localVideo.srcObject = stream;
      localVideo.play().catch(() => {});

      document.getElementById('placeholder-local')?.classList.add('hidden');
    } catch (err) {
      console.error('[Agora] No se pudo acceder a cámara/micrófono:', err);
      const el = document.getElementById('placeholder-local');
      if (el) el.innerHTML = '<p style="color:#EF4444;font-size:.75rem;text-align:center;padding:.5rem">❌ Sin acceso a la cámara.<br>Revisá los permisos.</p>';
    }
  }

  // ============================================================
  // CANAL
  // ============================================================

  /**
   * Unirse a un canal de Agora y publicar tracks locales.
   * @param {string} channelName
   * @param {string|null} token - null para modo sin token (dev/MVP)
   * @param {number|null} uid - null = autogenerado por Agora
   * @returns {Promise<number>} uid asignado
   */
  async joinChannel(channelName, token = null, uid = null) {
    this.uid = await this.client.join(this.appId, channelName, token, uid);

    if (this.localVideoTrack && this.localAudioTrack) {
      await this.client.publish([this.localVideoTrack, this.localAudioTrack]);
    }

    console.log(`[Agora] Unido al canal "${channelName}" como UID ${this.uid}`);
    return this.uid;
  }

  /**
   * Salir del canal actual y recrear los tracks locales para la próxima sesión.
   */
  async leaveChannel() {
    // Detener y cerrar tracks
    this.localVideoTrack?.stop();
    this.localVideoTrack?.close();
    this.localAudioTrack?.stop();
    this.localAudioTrack?.close();

    this.localVideoTrack = null;
    this.localAudioTrack = null;
    this.remoteUsers = {};

    await this.client.leave();
    console.log('[Agora] Salió del canal');

    // Volver a mostrar placeholder remoto
    document.getElementById('placeholder-remote')?.classList.remove('hidden');
    document.getElementById('placeholder-local')?.classList.remove('hidden');

    // Reiniciar video local para la próxima sesión
    await this.initLocalVideo();
  }

  // ============================================================
  // CONTROLES
  // ============================================================

  /** Toggle mute del micrófono. Devuelve true si quedó muteado. */
  async toggleMute() {
    if (!this.localAudioTrack) return false;
    const muteado = !this.localAudioTrack.enabled;
    await this.localAudioTrack.setEnabled(muteado);
    return !muteado; // devuelve el NUEVO estado: true = muteado
  }

  /** Toggle cámara. Devuelve true si quedó apagada. */
  async toggleCamera() {
    if (!this.localVideoTrack) return false;
    const apagada = !this.localVideoTrack.enabled;
    await this.localVideoTrack.setEnabled(apagada);
    return !apagada;
  }
}
