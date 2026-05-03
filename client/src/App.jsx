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
  <div style={{
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#fff',
    fontFamily: "'Inter', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem'
  }}>

    {/* Header */}
    <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: '50px', padding: '6px 16px', marginBottom: '1rem'
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', animation: 'pulse 2s infinite' }} />
        <span style={{ fontSize: 13, color: '#a5b4fc' }}>End-to-End Encrypted</span>
      </div>
      <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.8rem)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
        SecureCall
      </h1>
      <p style={{ color: '#64748b', marginTop: '0.5rem', fontSize: 14 }}>Private 1-on-1 video calls. No accounts. No tracking.</p>
    </div>

    {/* Idle screen */}
    {status === 'idle' && (
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20, padding: '2rem', width: '100%', maxWidth: 400,
        backdropFilter: 'blur(10px)'
      }}>
        <button onClick={generateRoom} style={{
          width: '100%', padding: '14px', borderRadius: 12, border: 'none',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
          marginBottom: '1rem', letterSpacing: '0.01em'
        }}>
          + Generate Room ID
        </button>

        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0, height: 1,
            background: 'rgba(255,255,255,0.08)', transform: 'translateY(-50%)'
          }} />
          <span style={{
            position: 'relative', background: '#0a0a0f', padding: '0 12px',
            color: '#475569', fontSize: 13, display: 'block', textAlign: 'center', width: 'fit-content', margin: '0 auto'
          }}>or join existing</span>
        </div>

        <input
          value={inputId}
          onChange={e => setInputId(e.target.value.toUpperCase())}
          placeholder="Enter Room ID"
          style={{
            width: '100%', padding: '14px', borderRadius: 12, boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff', fontSize: 16, textAlign: 'center', letterSpacing: '0.15em',
            marginBottom: '1rem', outline: 'none'
          }}
        />

        <button onClick={joinRoom} style={{
          width: '100%', padding: '14px', borderRadius: 12, border: '1px solid rgba(99,102,241,0.5)',
          background: 'transparent', color: '#a5b4fc', fontSize: 15, fontWeight: 600,
          cursor: 'pointer', letterSpacing: '0.01em'
        }}>
          Join Call →
        </button>

        {/* Features */}
        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {[['🔐', 'Encrypted'], ['👥', 'Max 2 Users'], ['⚡', 'Low Latency']].map(([icon, label]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
              <div style={{ fontSize: 11, color: '#475569' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    )}

    {status === 'full' && (
      <div style={{
        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 12, padding: '1rem 2rem', color: '#fca5a5'
      }}>
        Room is full — only 2 people allowed per call.
      </div>
    )}

    {status === 'waiting' && (
      <div style={{
        background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: 12, padding: '1rem 2rem', color: '#fcd34d', marginBottom: '1rem'
      }}>
        ⏳ Waiting for the other person to join...
      </div>
    )}

    {/* Video layout */}
    <div style={{ width: '100%', maxWidth: 1100, display: status === 'idle' || status === 'full' ? 'none' : 'block' }}>

      {/* Room ID bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, padding: '10px 16px', marginBottom: '1rem'
      }}>
        <span style={{ color: '#64748b', fontSize: 13 }}>Room</span>
        <span style={{ fontFamily: 'monospace', color: '#a5b4fc', fontWeight: 600, letterSpacing: '0.1em' }}>{roomId}</span>
        <button
          onClick={() => navigator.clipboard.writeText(roomId)}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
          Copy
        </button>
      </div>

      {/* Remote video - large */}
      <div style={{
        position: 'relative', width: '100%', borderRadius: 20, overflow: 'hidden',
        background: '#111827', marginBottom: '1rem',
        aspectRatio: window.innerWidth < 768 ? '9/16' : '16/9'
      }}>
        <video ref={remoteRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

        {status === 'waiting' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column', gap: 12
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgba(99,102,241,0.2)', border: '2px solid rgba(99,102,241,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28
            }}>👤</div>
            <p style={{ color: '#64748b', fontSize: 14 }}>Waiting for other person...</p>
          </div>
        )}

        {/* Local video overlay */}
        <div style={{
          position: 'absolute', bottom: 16, right: 16, borderRadius: 12,
          overflow: 'hidden', border: '2px solid rgba(255,255,255,0.2)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          width: window.innerWidth < 768 ? 90 : 180,
          aspectRatio: window.innerWidth < 768 ? '9/16' : '16/9'
        }}>
          <video ref={localRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute', bottom: 4, left: 6,
            fontSize: 10, color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.4)',
            padding: '2px 6px', borderRadius: 4
          }}>You</div>
        </div>

        {/* Status badge */}
        {status === 'connected' && (
          <div style={{
            position: 'absolute', top: 16, left: 16,
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(0,0,0,0.5)', borderRadius: 50, padding: '6px 12px'
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ fontSize: 12, color: '#fff' }}>Live</span>
          </div>
        )}
      </div>

      {/* Controls */}
      {(status === 'waiting' || status === 'connected') && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: '1rem'
        }}>
          <button onClick={toggleMic} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: micOn ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.2)',
            color: micOn ? '#fff' : '#fca5a5', fontSize: 12, fontWeight: 500
          }}>
            <span style={{ fontSize: 20 }}>{micOn ? '🎤' : '🔇'}</span>
            {micOn ? 'Mute' : 'Unmute'}
          </button>

          <button onClick={toggleCam} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: camOn ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.2)',
            color: camOn ? '#fff' : '#fca5a5', fontSize: 12, fontWeight: 500
          }}>
            <span style={{ fontSize: 20 }}>{camOn ? '📷' : '🚫'}</span>
            {camOn ? 'Cam Off' : 'Cam On'}
          </button>

          <button onClick={leaveCall} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '12px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'rgba(239,68,68,0.8)', color: '#fff', fontSize: 12, fontWeight: 600
          }}>
            <span style={{ fontSize: 20 }}>📵</span>
            End Call
          </button>
        </div>
      )}
    </div>

    <style>{`
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
    `}</style>
  </div>
);
}