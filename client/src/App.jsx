import { useRef, useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const SERVER = 'https://private-video-call.onrender.com';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

export default function App() {
  const [roomId, setRoomId] = useState('');
  const [inputId, setInputId] = useState('');
  const [status, setStatus] = useState('idle');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [isSwapped, setIsSwapped] = useState(false);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const localStream = useRef(null);
  const currentRoomId = useRef('');

  // 🎥 get media once
  const getMedia = async () => {
    if (localStream.current) return localStream.current;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localStream.current = stream;

    if (localRef.current) localRef.current.srcObject = stream;

    return stream;
  };

  // 🔗 peer
  const createPeer = (stream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (e) => {
      if (remoteRef.current) {
        remoteRef.current.srcObject = e.streams[0];
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', {
          roomId: currentRoomId.current,
          candidate: e.candidate
        });
      }
    };

    return pc;
  };

  // 🚪 join
  const joinRoom = async () => {
    const id = inputId.trim().toUpperCase();
    if (!id) return;

    setRoomId(id);
    currentRoomId.current = id;

    const socket = io(SERVER);
    socketRef.current = socket;

    const stream = await getMedia();

    socket.emit('join-room', id);

    socket.on('joined', () => setStatus('waiting'));

    socket.on('user-joined', async () => {
      const pc = createPeer(stream);
      pcRef.current = pc;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('offer', { roomId: id, offer });
      setStatus('connected');
    });

    socket.on('offer', async (offer) => {
      const pc = createPeer(stream);
      pcRef.current = pc;

      await pc.setRemoteDescription(offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('answer', { roomId: id, answer });
      setStatus('connected');
    });

    socket.on('answer', async (answer) => {
      await pcRef.current.setRemoteDescription(answer);
    });

    socket.on('ice-candidate', async (candidate) => {
      try {
        await pcRef.current.addIceCandidate(candidate);
      } catch {}
    });
  };

  // 🎤 mic
  const toggleMic = () => {
    const newState = !micOn;
    setMicOn(newState);
    localStream.current.getAudioTracks().forEach(t => t.enabled = newState);
  };

  // 📷 cam FIXED
  const toggleCam = async () => {
    const newState = !camOn;
    setCamOn(newState);

    if (!newState) {
      localStream.current.getVideoTracks().forEach(t => t.enabled = false);
    } else {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true });

      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

      if (sender) await sender.replaceTrack(newTrack);

      localStream.current.getVideoTracks().forEach(t => t.stop());

      localStream.current = newStream;

      if (localRef.current) localRef.current.srcObject = newStream;
    }
  };

  // 🔄 flip FIXED
  const switchCamera = async () => {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: true
    });

    const newTrack = newStream.getVideoTracks()[0];
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

    if (sender) await sender.replaceTrack(newTrack);

    localStream.current.getTracks().forEach(t => t.stop());
    localStream.current = newStream;

    if (localRef.current) localRef.current.srcObject = newStream;
  };

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

      {status === 'idle' && (
        <div>
          <input value={inputId} onChange={e => setInputId(e.target.value)} placeholder="Room ID" />
          <button onClick={joinRoom}>Join</button>
        </div>
      )}

      {(status === 'waiting' || status === 'connected') && (
        <div style={{ position: 'relative', width: '100%', maxWidth: 900 }}>

          {/* MAIN VIDEO */}
          <video
            ref={isSwapped ? localRef : remoteRef}
            autoPlay
            muted={isSwapped}
            playsInline
            style={{ width: '100%', height: 500, objectFit: 'cover' }}
          />

          {/* SMALL VIDEO */}
          <div
            onClick={() => setIsSwapped(prev => !prev)}
            style={{
              position: 'absolute',
              bottom: 16,
              right: 16,
              width: isMobile ? 100 : 180,
              cursor: 'pointer',
              border: '2px solid white'
            }}
          >
            <video
              ref={isSwapped ? remoteRef : localRef}
              autoPlay
              muted={!isSwapped}
              playsInline
              style={{ width: '100%' }}
            />
          </div>

          {/* Controls */}
          <div style={{ marginTop: 10 }}>
            <button onClick={toggleMic}>{micOn ? 'Mute' : 'Unmute'}</button>
            <button onClick={toggleCam}>{camOn ? 'Cam Off' : 'Cam On'}</button>
            <button onClick={switchCamera}>Flip</button>
          </div>
        </div>
      )}
    </div>
  );
}