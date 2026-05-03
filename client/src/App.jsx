import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SERVER = 'https://private-video-call.onrender.com';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

export default function App() {
  const [roomId, setRoomId] = useState('');
  const [inputId, setInputId] = useState('');
  const [status, setStatus] = useState('idle'); // idle | waiting | connected | full
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const localStream = useRef(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const generateRoom = () => {
    const id = Math.random().toString(36).substring(2, 10).toUpperCase();
    setInputId(id);
  };

  const getMedia = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.current = stream;
    localRef.current.srcObject = stream;
    return stream;
  };

  const createPeer = (stream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (e) => {
      remoteRef.current.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', { roomId: inputId, candidate: e.candidate });
      }
    };

    return pc;
  };
  const toggleMic = () => {
  localStream.current.getAudioTracks().forEach(t => t.enabled = !t.enabled);
  setMicOn(prev => !prev);
};

const toggleCam = () => {
  localStream.current.getVideoTracks().forEach(t => t.enabled = !t.enabled);
  setCamOn(prev => !prev);
};

  const joinRoom = async () => {
    const id = inputId.trim().toUpperCase();
    if (!id) return;
    setRoomId(id);

    const socket = io(SERVER);
    socketRef.current = socket;
    await new Promise(r => setTimeout(r, 100));
    const stream = await getMedia();
    console.log('Stream tracks:', stream.getTracks());
console.log('Local video element:', localRef.current);
localRef.current.srcObject = stream;

    socket.emit('join-room', id);

    socket.on('room-full', () => setStatus('full'));

    socket.on('joined', async ({ isInitiator }) => {
      setStatus('waiting');
      if (!isInitiator) return; // wait for the other person
    });

    socket.on('user-joined', async () => {
      // We are person 1, create offer
      const pc = createPeer(stream);
      pcRef.current = pc;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { roomId: id, offer });
      setStatus('connected');
    });

    socket.on('offer', async (offer) => {
      // We are person 2, answer it
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
      try { await pcRef.current.addIceCandidate(candidate); } catch {}
    });

    socket.on('user-left', () => {
      setStatus('waiting');
      if (remoteRef.current) remoteRef.current.srcObject = null;
    });
  };

  const leaveCall = () => {
    socketRef.current?.disconnect();
    pcRef.current?.close();
    localStream.current?.getTracks().forEach(t => t.stop());
    setStatus('idle');
    setRoomId('');
  };

 return (
  <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4 p-4">
    <h1 className="text-3xl font-bold tracking-tight">🔐 Private Call</h1>

    {status === 'idle' && (
      <div className="flex flex-col gap-3 w-full max-w-sm">
        <button onClick={generateRoom}
          className="bg-indigo-600 hover:bg-indigo-500 py-2 rounded-lg font-semibold">
          Generate Room ID
        </button>
        <input value={inputId} onChange={e => setInputId(e.target.value.toUpperCase())}
          placeholder="Enter Room ID"
          className="bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-center tracking-widest text-lg" />
        <button onClick={joinRoom}
          className="bg-green-600 hover:bg-green-500 py-2 rounded-lg font-semibold">
          Join / Start Call
        </button>
      </div>
    )}

    {status === 'full' && <p className="text-red-400 text-lg">Room is full! Only 2 people allowed.</p>}
    {status === 'waiting' && <p className="text-yellow-400 animate-pulse">Waiting for the other person...</p>}

    {/* Video layout - Google Meet style */}
    <div className={`w-full max-w-6xl ${status === 'idle' || status === 'full' ? 'hidden' : ''}`}>
      {/* Remote video - large */}
      <div className="relative w-full bg-gray-800 rounded-2xl overflow-hidden mb-3"
        style={{ aspectRatio: window.innerWidth < 768 ? '9/16' : '16/9' }}>
        <video ref={remoteRef} autoPlay playsInline
          className="w-full h-full object-cover" />
        <span className="absolute top-3 left-3 text-xs bg-black/50 px-2 py-1 rounded-full">Remote</span>

        {/* Local video - small overlay */}
        <div className="absolute bottom-4 right-4 rounded-xl overflow-hidden border-2 border-white/30 shadow-lg"
          style={{
            width: window.innerWidth < 768 ? '90px' : '160px',
            aspectRatio: window.innerWidth < 768 ? '9/16' : '16/9'
          }}>
          <video ref={localRef} autoPlay muted playsInline
            className="w-full h-full object-cover" />
          <span className="absolute bottom-1 left-1 text-xs bg-black/50 px-1 rounded">You</span>
        </div>
      </div>

      {/* Controls */}
      {(status === 'waiting' || status === 'connected') && (
        <div className="flex gap-4 items-center justify-center mt-2">
          <button onClick={toggleMic}
            className={`flex flex-col items-center px-5 py-3 rounded-xl font-semibold text-sm ${micOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-500'}`}>
            <span className="text-xl">{micOn ? '🎤' : '🔇'}</span>
            <span>{micOn ? 'Mute' : 'Unmute'}</span>
          </button>

          <button onClick={leaveCall}
            className="flex flex-col items-center bg-red-600 hover:bg-red-500 px-5 py-3 rounded-xl font-semibold text-sm">
            <span className="text-xl">📵</span>
            <span>End</span>
          </button>

          <button onClick={toggleCam}
            className={`flex flex-col items-center px-5 py-3 rounded-xl font-semibold text-sm ${camOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-500'}`}>
            <span className="text-xl">{camOn ? '📷' : '🚫'}</span>
            <span>{camOn ? 'Cam Off' : 'Cam On'}</span>
          </button>
        </div>
      )}
    </div>
  </div>
);
}