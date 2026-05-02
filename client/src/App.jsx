import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SERVER = 'http://localhost:5000';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
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
  <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6 p-4">
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

    {/* Always render videos so refs are always available */}
    <div className={`grid grid-cols-2 gap-4 w-full max-w-3xl ${status === 'idle' || status === 'full' ? 'hidden' : ''}`}>
      <div className="relative">
        <video ref={localRef} autoPlay muted playsInline
          className="w-full rounded-xl bg-gray-800 aspect-video object-cover border-2 border-indigo-500" />
        <span className="absolute bottom-2 left-2 text-xs bg-black/50 px-2 py-0.5 rounded">You</span>
      </div>
      <div className="relative">
        <video ref={remoteRef} autoPlay playsInline
          className="w-full rounded-xl bg-gray-800 aspect-video object-cover border-2 border-gray-600" />
        <span className="absolute bottom-2 left-2 text-xs bg-black/50 px-2 py-0.5 rounded">Remote</span>
      </div>
    </div>

    {(status === 'waiting' || status === 'connected') && (
      <button onClick={leaveCall}
        className="bg-red-600 hover:bg-red-500 px-6 py-2 rounded-lg font-semibold">
        End Call
      </button>
    )}
  </div>
);
}