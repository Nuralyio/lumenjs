/**
 * WebRTC peer connection manager.
 * Wraps RTCPeerConnection and wires to the LumenJS communication SDK signaling.
 */

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let _cachedIceServers: RTCIceServer[] | null = null;

async function fetchIceServersFromApi(): Promise<RTCIceServer[] | null> {
  if (_cachedIceServers) return _cachedIceServers;
  try {
    const res = await fetch('/api/ice-servers');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.iceServers?.length) {
      _cachedIceServers = data.iceServers;
      return data.iceServers;
    }
  } catch {}
  return null;
}

function getIceServers(custom?: RTCIceServer[]): RTCIceServer[] {
  return custom
    || (typeof window !== 'undefined' && (window as any).__NK_ICE_SERVERS)
    || _cachedIceServers
    || DEFAULT_ICE_SERVERS;
}

export type CallRole = 'caller' | 'callee';

export interface WebRTCCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onLocalStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onError: (error: Error) => void;
}

/** Pre-fetch ICE servers from /api/ice-servers. Call early (e.g. on page load). */
export async function preloadIceServers(): Promise<void> {
  await fetchIceServersFromApi();
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
    this._createPeerConnection(getIceServers(iceServers));
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
      // Only request video when the call type is video.
      // For audio-only calls, skip the camera entirely to avoid the permission
      // prompt and camera LED. Screen sharing can add a video track later.
      this._localStream = await navigator.mediaDevices.getUserMedia({ video, audio });
      this._callbacks.onLocalStream(this._localStream);

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

// ── Group WebRTC Manager (mesh topology) ──────────────────────────

const MAX_GROUP_PARTICIPANTS = 8;

export type RemoteStreamKind = 'camera' | 'screen';

export interface GroupWebRTCCallbacks {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (userId: string, kind: RemoteStreamKind, stream: MediaStream) => void;
  onRemoteStreamRemoved: (userId: string, kind?: RemoteStreamKind) => void;
  onConnectionStateChange: (userId: string, state: RTCPeerConnectionState) => void;
  onIceCandidate: (toUserId: string, candidate: RTCIceCandidate) => void;
  onError: (error: Error) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  screenSenders: RTCRtpSender[];
  pendingCandidates: RTCIceCandidateInit[];
}

export class GroupWebRTCManager {
  private _peers: Map<string, PeerEntry> = new Map();
  private _localStream: MediaStream | null = null;
  private _callbacks: GroupWebRTCCallbacks;
  private _iceServers: RTCIceServer[];
  private _screenStream: MediaStream | null = null;

  constructor(callbacks: GroupWebRTCCallbacks, iceServers?: RTCIceServer[]) {
    this._callbacks = callbacks;
    this._iceServers = getIceServers(iceServers);
  }

  get localStream(): MediaStream | null { return this._localStream; }
  get screenStream(): MediaStream | null { return this._screenStream; }
  get peerCount(): number { return this._peers.size; }

  getRemoteStream(userId: string): MediaStream | null {
    return this._peers.get(userId)?.cameraStream ?? null;
  }

  getRemoteScreenStream(userId: string): MediaStream | null {
    return this._peers.get(userId)?.screenStream ?? null;
  }

  getRemoteStreams(): Map<string, MediaStream> {
    const result = new Map<string, MediaStream>();
    for (const [uid, entry] of this._peers) {
      if (entry.cameraStream) result.set(uid, entry.cameraStream);
    }
    return result;
  }

  /** Acquire local media — call once before adding peers */
  async startLocalMedia(
    video: boolean = true,
    audio: boolean = true,
    deviceIds?: { audioInputId?: string | null; videoInputId?: string | null },
  ): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('Media devices unavailable — HTTPS is required for calls');
      this._callbacks.onError(err);
      throw err;
    }
    try {
      const audioConstraint: boolean | MediaTrackConstraints = audio
        ? (deviceIds?.audioInputId ? { deviceId: { exact: deviceIds.audioInputId } } : true)
        : false;
      const videoConstraint: boolean | MediaTrackConstraints = video
        ? (deviceIds?.videoInputId ? { deviceId: { exact: deviceIds.videoInputId } } : true)
        : false;
      this._localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: videoConstraint,
      });
      this._callbacks.onLocalStream(this._localStream);
      return this._localStream;
    } catch (err) {
      this._callbacks.onError(new Error(`Failed to access media: ${(err as Error).message}`));
      throw err;
    }
  }

  /** Replace the audio track on all peer connections (for switching mic mid-call) */
  async replaceAudioTrack(newTrack: MediaStreamTrack): Promise<void> {
    // Replace in local stream
    if (this._localStream) {
      const old = this._localStream.getAudioTracks()[0];
      if (old) { this._localStream.removeTrack(old); old.stop(); }
      this._localStream.addTrack(newTrack);
    }
    // Replace on all peer connections
    for (const [, entry] of this._peers) {
      const sender = entry.pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(newTrack);
    }
  }

  /** Replace the video track on all peer connections (for switching camera mid-call) */
  async replaceVideoTrack(newTrack: MediaStreamTrack): Promise<void> {
    if (this._localStream) {
      const old = this._localStream.getVideoTracks()[0];
      if (old) { this._localStream.removeTrack(old); old.stop(); }
      this._localStream.addTrack(newTrack);
    }
    for (const [, entry] of this._peers) {
      // Skip the screen-share sender(s) — we only want to swap the camera.
      const sender = entry.pc.getSenders().find(
        s => s.track?.kind === 'video' && !entry.screenSenders.includes(s),
      );
      if (sender) await sender.replaceTrack(newTrack);
    }
  }

  /** Create a peer connection for a remote user and optionally create an offer */
  async addPeer(userId: string, isCaller: boolean): Promise<string | void> {
    if (this._peers.has(userId)) return;
    if (this._peers.size >= MAX_GROUP_PARTICIPANTS - 1) {
      this._callbacks.onError(new Error(`Group call limit reached (${MAX_GROUP_PARTICIPANTS} participants)`));
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    const entry: PeerEntry = { pc, cameraStream: null, screenStream: null, screenSenders: [], pendingCandidates: [] };
    this._peers.set(userId, entry);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._callbacks.onIceCandidate(userId, event.candidate);
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      // The first MediaStream we see from this peer is their camera; any
      // subsequent stream with a different id is the screen share. Tracks
      // attached to an already-known stream don't need a new callback —
      // MediaStream auto-aggregates them.
      if (!entry.cameraStream) {
        entry.cameraStream = stream;
        this._callbacks.onRemoteStream(userId, 'camera', stream);
        return;
      }
      if (stream.id === entry.cameraStream.id) return;
      if (!entry.screenStream || entry.screenStream.id !== stream.id) {
        entry.screenStream = stream;
        this._callbacks.onRemoteStream(userId, 'screen', stream);
      }
    };

    pc.onconnectionstatechange = () => {
      this._callbacks.onConnectionStateChange(userId, pc.connectionState);
      if (pc.connectionState === 'failed') {
        this.removePeer(userId);
      }
    };

    // Add local camera/mic tracks
    if (this._localStream) {
      for (const track of this._localStream.getTracks()) {
        pc.addTrack(track, this._localStream);
      }
    }

    // Late-joiner: if we're already screen-sharing, add screen tracks too so
    // the new peer immediately receives the shared screen on the initial offer.
    if (this._screenStream) {
      for (const track of this._screenStream.getTracks()) {
        entry.screenSenders.push(pc.addTrack(track, this._screenStream));
      }
    }

    if (isCaller) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      return offer.sdp!;
    }
  }

  /** Remove and close a peer connection */
  removePeer(userId: string): void {
    const entry = this._peers.get(userId);
    if (!entry) return;
    entry.pc.close();
    if (entry.cameraStream) {
      for (const track of entry.cameraStream.getTracks()) track.stop();
    }
    if (entry.screenStream) {
      for (const track of entry.screenStream.getTracks()) track.stop();
    }
    this._peers.delete(userId);
    this._callbacks.onRemoteStreamRemoved(userId);
  }

  /** Handle an SDP offer from a remote peer and return an answer */
  async handleOffer(fromUserId: string, sdp: string): Promise<string> {
    let entry = this._peers.get(fromUserId);
    if (!entry) {
      // Auto-create peer for the offerer
      await this.addPeer(fromUserId, false);
      entry = this._peers.get(fromUserId)!;
    }
    const { pc } = entry;
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await this._flushPendingCandidates(fromUserId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer.sdp!;
  }

  /** Handle an SDP answer from a remote peer */
  async handleAnswer(fromUserId: string, sdp: string): Promise<void> {
    const entry = this._peers.get(fromUserId);
    if (!entry) return;
    await entry.pc.setRemoteDescription({ type: 'answer', sdp });
    await this._flushPendingCandidates(fromUserId);
  }

  /** Add an ICE candidate for a specific peer */
  async addIceCandidate(fromUserId: string, candidate: string, sdpMLineIndex: number | null, sdpMid: string | null): Promise<void> {
    const init: RTCIceCandidateInit = {
      candidate,
      sdpMLineIndex: sdpMLineIndex ?? undefined,
      sdpMid: sdpMid ?? undefined,
    };
    const entry = this._peers.get(fromUserId);
    if (!entry) return;
    if (!entry.pc.remoteDescription) {
      entry.pendingCandidates.push(init);
      return;
    }
    try {
      await entry.pc.addIceCandidate(init);
    } catch (err) {
      console.warn(`[GroupWebRTC] Failed to add ICE candidate for ${fromUserId}:`, err);
    }
  }

  private async _flushPendingCandidates(userId: string): Promise<void> {
    const entry = this._peers.get(userId);
    if (!entry) return;
    for (const c of entry.pendingCandidates) {
      try { await entry.pc.addIceCandidate(c); } catch {}
    }
    entry.pendingCandidates = [];
  }

  /** Toggle audio for all peers */
  setAudioEnabled(enabled: boolean): void {
    if (this._localStream) {
      for (const track of this._localStream.getAudioTracks()) track.enabled = enabled;
    }
  }

  /** Toggle video for all peers */
  setVideoEnabled(enabled: boolean): void {
    if (this._localStream) {
      for (const track of this._localStream.getVideoTracks()) track.enabled = enabled;
    }
  }

  /**
   * Start sending a camera track on a call that was negotiated without
   * video (audio-only). Adds the track to the local stream and to every
   * peer connection, then produces a renegotiation offer per peer. The
   * caller is responsible for signalling those offers and relaying the
   * answers back via `handleAnswer`. No-op if a camera track is already
   * being sent.
   */
  async enableCamera(track: MediaStreamTrack): Promise<{ offers: Array<{ userId: string; sdp: string }> }> {
    const firstPeer = this._peers.values().next().value;
    if (firstPeer) {
      const alreadySending = firstPeer.pc.getSenders().some(
        s => s.track?.kind === 'video' && !firstPeer.screenSenders.includes(s),
      );
      if (alreadySending) return { offers: [] };
    }
    if (!this._localStream) {
      this._localStream = new MediaStream();
    }
    if (!this._localStream.getTracks().includes(track)) {
      this._localStream.addTrack(track);
    }
    const offers: Array<{ userId: string; sdp: string }> = [];
    for (const [userId, entry] of this._peers) {
      entry.pc.addTrack(track, this._localStream);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      offers.push({ userId, sdp: offer.sdp! });
    }
    return { offers };
  }

  /**
   * Add a separate screen-share transceiver to every peer, alongside the
   * existing camera/mic tracks. Returns the display stream plus the list of
   * renegotiation offers the caller must signal to each peer.
   */
  async startScreenShare(): Promise<{ stream: MediaStream; offers: Array<{ userId: string; sdp: string }> }> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing unavailable — HTTPS is required');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    this._screenStream = stream;

    const offers: Array<{ userId: string; sdp: string }> = [];
    for (const [userId, entry] of this._peers) {
      for (const track of stream.getTracks()) {
        entry.screenSenders.push(entry.pc.addTrack(track, stream));
      }
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      offers.push({ userId, sdp: offer.sdp! });
    }

    return { stream, offers };
  }

  /**
   * Remove the screen tracks from every peer and renegotiate. Returns the
   * per-peer offers that must be signaled.
   */
  async stopScreenShare(): Promise<{ offers: Array<{ userId: string; sdp: string }> }> {
    if (this._screenStream) {
      for (const track of this._screenStream.getTracks()) track.stop();
      this._screenStream = null;
    }

    const offers: Array<{ userId: string; sdp: string }> = [];
    for (const [userId, entry] of this._peers) {
      if (entry.screenSenders.length === 0) continue;
      for (const sender of entry.screenSenders) {
        try { entry.pc.removeTrack(sender); } catch {}
      }
      entry.screenSenders = [];
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      offers.push({ userId, sdp: offer.sdp! });
    }

    return { offers };
  }

  /** Drop a remote peer's screen stream reference (called when a remote peer stops sharing) */
  clearRemoteScreen(userId: string): void {
    const entry = this._peers.get(userId);
    if (!entry || !entry.screenStream) return;
    entry.screenStream = null;
    this._callbacks.onRemoteStreamRemoved(userId, 'screen');
  }

  /** Clean up everything */
  destroy(): void {
    if (this._screenStream) {
      for (const track of this._screenStream.getTracks()) track.stop();
      this._screenStream = null;
    }
    const userIds = [...this._peers.keys()];
    for (const userId of userIds) {
      this.removePeer(userId);
    }
    if (this._localStream) {
      for (const track of this._localStream.getTracks()) track.stop();
      this._localStream = null;
    }
  }
}
