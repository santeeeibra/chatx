/**
 * webrtc-manager.js
 * Gestiona RTCPeerConnection con STUN, logs de debug en cada paso.
 */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class WebRTCManager {
  constructor() {
    this.pc          = null;
    this.localStream = null;

    // Callbacks asignados desde afuera
    this.onRemoteStream  = null; // (MediaStream) => void
    this.onIceCandidate  = null; // (RTCIceCandidate) => void
    this.onDisconnected  = null; // () => void
  }

  // ----------------------------------------------------------------
  // STREAM LOCAL
  // ----------------------------------------------------------------

  async initLocalStream() {
    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = this.localStream;
    localVideo.muted = true;
    localVideo.play().catch(() => {});

    document.getElementById('placeholder-local')?.classList.add('hidden');
    return this.localStream;
  }

  // ----------------------------------------------------------------
  // PEER CONNECTION
  // ----------------------------------------------------------------

  createPeer() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

    this.pc.ontrack = (e) => {
      const remoteStream = e.streams[0];
      console.log('[WebRTC] Remote stream received');
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.onplaying = () => {
          document.getElementById('placeholder-remote')?.classList.add('hidden');
        };
      }
      this.onRemoteStream?.(remoteStream);
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log('[WebRTC] ICE candidate sent');
        this.onIceCandidate?.(candidate);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE state:', this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
        this.onDisconnected?.();
      }
    };

    return this.pc;
  }

  // ----------------------------------------------------------------
  // OFFER / ANSWER
  // ----------------------------------------------------------------

  async createOffer() {
    console.log('[WebRTC] Creating offer...');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log('[WebRTC] Offer sent');
    return offer;
  }

  async handleOffer(sdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    console.log('[WebRTC] Answer sent');
    return answer;
  }

  async handleAnswer(sdp) {
    console.log('[WebRTC] Answer received');
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async addIceCandidate(candidateData) {
    console.log('[WebRTC] ICE candidate received');
    if (this.pc && this.pc.remoteDescription) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidateData));
    }
  }

  // ----------------------------------------------------------------
  // ROTAR CÁMARA
  // ----------------------------------------------------------------

  async rotarCamara() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    if (videoDevices.length < 2) return;

    const currentTrack = this.localStream?.getVideoTracks()[0];
    const currentDeviceId = currentTrack?.getSettings?.()?.deviceId;
    const currentIdx = videoDevices.findIndex(d => d.deviceId === currentDeviceId);
    const nextDevice = videoDevices[(currentIdx + 1) % videoDevices.length];

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: nextDevice.deviceId } },
      audio: false,
    });

    const newVideoTrack = newStream.getVideoTracks()[0];

    // Replace track in peer connection if connected
    if (this.pc) {
      const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newVideoTrack);
    }

    // Replace track in local stream
    if (currentTrack) {
      currentTrack.stop();
      this.localStream.removeTrack(currentTrack);
    }
    this.localStream.addTrack(newVideoTrack);

    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = this.localStream;
      localVideo.play().catch(() => {});
    }
  }

  // ----------------------------------------------------------------
  // LIMPIEZA
  // ----------------------------------------------------------------

  close() {
    this.pc?.close();
    this.pc = null;
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;

    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = null;

    document.getElementById('placeholder-remote')?.classList.remove('hidden');
    document.getElementById('placeholder-local')?.classList.remove('hidden');
  }
}
