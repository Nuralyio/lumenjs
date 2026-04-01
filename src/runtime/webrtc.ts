/**
 * WebRTC peer connection manager.
 * Wraps RTCPeerConnection and wires to the LumenJS communication SDK signaling.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type CallRole = 'caller' | 'callee';

export interface WebRTCCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onLocalStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onError: (error: Error) => void;
}

export class WebRTCManager {
  private _pc: RTCPeerConnection | null = null;
  private _localStream: MediaStream | null = null;
  private _remoteStream: MediaStream | null = null;
  private _callbacks: WebRTCCallbacks;
  private _pendingCandidates: RTCIceCandidateInit[] = [];
  private _role: CallRole = 'caller';
  private _screenStream: MediaStream | null = null;

  constructor(callbacks: WebRTCCallbacks, iceServers?: RTCIceServer[]) {
    this._callbacks = callbacks;
    this._createPeerConnection(iceServers || ICE_SERVERS);
  }

  private _createPeerConnection(iceServers: RTCIceServer[]): void {
    this._pc = new RTCPeerConnection({ iceServers });

    this._pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._callbacks.onIceCandidate(event.candidate);
      }
    };

    this._pc.ontrack = (event) => {
      if (!this._remoteStream) {
        this._remoteStream = new MediaStream();
        this._callbacks.onRemoteStream(this._remoteStream);
      }
      this._remoteStream.addTrack(event.track);
    };

    this._pc.onconnectionstatechange = () => {
      if (this._pc) {
        this._callbacks.onConnectionStateChange(this._pc.connectionState);
      }
    };
  }

  get localStream(): MediaStream | null { return this._localStream; }
  get remoteStream(): MediaStream | null { return this._remoteStream; }
  get role(): CallRole { return this._role; }
  get connectionState(): RTCPeerConnectionState | null { return this._pc?.connectionState ?? null; }

  /** Acquire local media (camera/mic) and add tracks to the peer connection */
  async startLocalMedia(video: boolean = true, audio: boolean = true): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('Media devices unavailable — HTTPS is required for calls');
      this._callbacks.onError(err);
      throw err;
    }
    try {
      // Always request video so both peers negotiate a video track in the SDP.
      // For audio-only calls the video track is immediately disabled (black frame)
      // but stays in the SDP as sendrecv, allowing replaceTrack for screen sharing.
      this._localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio });
      this._callbacks.onLocalStream(this._localStream);

      if (!video) {
        for (const vt of this._localStream.getVideoTracks()) {
          vt.enabled = false;
        }
      }

      for (const track of this._localStream.getTracks()) {
        this._pc?.addTrack(track, this._localStream);
      }

      return this._localStream;
    } catch (err) {
      this._callbacks.onError(new Error(`Failed to access media: ${(err as Error).message}`));
      throw err;
    }
  }

  /** Create an SDP offer (caller side) */
  async createOffer(): Promise<string> {
    this._role = 'caller';
    if (!this._pc) throw new Error('No peer connection');

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    return offer.sdp!;
  }

  /** Handle received SDP offer and create answer (callee side) */
  async handleOffer(sdp: string): Promise<string> {
    this._role = 'callee';
    if (!this._pc) throw new Error('No peer connection');

    await this._pc.setRemoteDescription({ type: 'offer', sdp });
    // Flush pending ICE candidates
    await this._flushPendingCandidates();

    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    return answer.sdp!;
  }

  /** Handle received SDP answer (caller side) */
  async handleAnswer(sdp: string): Promise<void> {
    if (!this._pc) throw new Error('No peer connection');
    await this._pc.setRemoteDescription({ type: 'answer', sdp });
    await this._flushPendingCandidates();
  }

  /** Add a received ICE candidate */
  async addIceCandidate(candidate: string, sdpMLineIndex: number | null, sdpMid: string | null): Promise<void> {
    const init: RTCIceCandidateInit = {
      candidate,
      sdpMLineIndex: sdpMLineIndex ?? undefined,
      sdpMid: sdpMid ?? undefined,
    };

    if (!this._pc?.remoteDescription) {
      // Queue candidates until remote description is set
      this._pendingCandidates.push(init);
      return;
    }

    try {
      await this._pc.addIceCandidate(init);
    } catch (err) {
      console.warn('[WebRTC] Failed to add ICE candidate:', err);
    }
  }

  private async _flushPendingCandidates(): Promise<void> {
    for (const c of this._pendingCandidates) {
      try {
        await this._pc?.addIceCandidate(c);
      } catch {}
    }
    this._pendingCandidates = [];
  }

  /** Toggle audio mute */
  setAudioEnabled(enabled: boolean): void {
    if (this._localStream) {
      for (const track of this._localStream.getAudioTracks()) {
        track.enabled = enabled;
      }
    }
  }

  /** Toggle video */
  setVideoEnabled(enabled: boolean): void {
    if (this._localStream) {
      for (const track of this._localStream.getVideoTracks()) {
        track.enabled = enabled;
      }
    }
  }

  /** Replace video track with screen share */
  async startScreenShare(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing unavailable — HTTPS is required');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const screenTrack = stream.getVideoTracks()[0];

    if (this._pc) {
      const sender = this._pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
      }
    }

    this._screenStream = stream;

    // When user stops sharing via browser UI
    screenTrack.onended = () => {
      this.stopScreenShare();
    };

    return stream;
  }

  /** Revert from screen share back to camera */
  async stopScreenShare(): Promise<void> {
    // Stop all screen share tracks so the OS stops the sharing indicator
    if (this._screenStream) {
      for (const track of this._screenStream.getTracks()) track.stop();
      this._screenStream = null;
    }
    if (!this._pc || !this._localStream) return;
    const cameraTrack = this._localStream.getVideoTracks()[0] || null;
    const sender = this._pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(cameraTrack);
    }
  }

  /** Clean up everything */
  destroy(): void {
    if (this._screenStream) {
      for (const track of this._screenStream.getTracks()) track.stop();
      this._screenStream = null;
    }
    if (this._localStream) {
      for (const track of this._localStream.getTracks()) {
        track.stop();
      }
      this._localStream = null;
    }
    if (this._remoteStream) {
      for (const track of this._remoteStream.getTracks()) {
        track.stop();
      }
      this._remoteStream = null;
    }
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
    this._pendingCandidates = [];
  }
}
