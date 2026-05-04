import { useRef, useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const SERVER = 'https://private-video-call.onrender.com';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

export default function App() {

  const [roomId, setRoomId] = useState('');
  const [inputId, setInputId] = useState('');
  const [status, setStatus] = useState('idle');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [unread, setUnread] = useState(0);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteCamOff, setRemoteCamOff] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [flashOn, setFlashOn] = useState(false);
  const [isSwapped, setIsSwapped] = useState(false);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localSmallRef = useRef(null);
  const remoteRef = useRef(null);
  const localStream = useRef(null);
  const messagesEndRef = useRef(null);
  const currentRoomId = useRef('');
  // FIX 1: declare chatOpenRef so socket callbacks always see latest value
  const chatOpenRef = useRef(false);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  const generateRoom = () => {
    const id = Math.random().toString(36).substring(2, 10).toUpperCase();
    setInputId(id);
  };

  const getMedia = async (facing = 'user') => {
    if (localStream.current) {
      return localStream.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: true
    });

    localStream.current = stream;

    if (localSmallRef.current) localSmallRef.current.srcObject = stream;

    return stream;
  };

  const createPeer = (stream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = (e) => {
      if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current.emit('ice-candidate', { roomId: currentRoomId.current, candidate: e.candidate });
    };
    return pc;
  };

  const joinRoom = async () => {
    const id = inputId.trim().toUpperCase();
    if (!id) return;
    setRoomId(id);
    currentRoomId.current = id;
    const socket = io(SERVER);
    socketRef.current = socket;
    await new Promise(r => setTimeout(r, 100));
    const stream = await getMedia(facingMode);

    socket.emit('join-room', id);
    socket.on('room-full', () => setStatus('full'));
    socket.on('joined', async ({ isInitiator }) => {
      setStatus('waiting');
      if (!isInitiator) return;
    });
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
    socket.on('answer', async (answer) => { await pcRef.current.setRemoteDescription(answer); });
    socket.on('ice-candidate', async (candidate) => {
      try { await pcRef.current.addIceCandidate(candidate); } catch {}
    });
    socket.on('user-left', () => {
      setStatus('waiting');
      if (remoteRef.current) remoteRef.current.srcObject = null;
    });
    // FIX 2: use chatOpenRef instead of chatOpen (stale closure fix)
    socket.on('chat-message', (msg) => {
      setMessages(prev => [...prev, { from: 'them', text: msg, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      setUnread(prev => chatOpenRef.current ? 0 : prev + 1);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    socket.on('peer-mic', ({ muted }) => setRemoteMuted(muted));
    socket.on('peer-cam', ({ off }) => setRemoteCamOff(off));
  };

  const sendMessage = () => {
    if (!msgInput.trim()) return;
    const msg = { from: 'me', text: msgInput.trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setMessages(prev => [...prev, msg]);
    socketRef.current.emit('chat-message', { roomId, message: msgInput.trim() });
    setMsgInput('');
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const toggleMic = () => {
    const newState = !micOn;
    localStream.current.getAudioTracks().forEach(t => t.enabled = newState);
    setMicOn(newState);
    socketRef.current.emit('peer-mic', { roomId, muted: !newState });
  };

  const toggleCam = async () => {
    const newState = !camOn;
    setCamOn(newState);

    if (!newState) {
      localStream.current.getVideoTracks().forEach(t => t.enabled = false);
      socketRef.current.emit('peer-cam', { roomId, off: true });
    } else {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: true
      });

      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

      if (sender) await sender.replaceTrack(newTrack);

      localStream.current.getTracks().forEach(t => t.stop());
      localStream.current = newStream;

      if (localSmallRef.current) localSmallRef.current.srcObject = newStream;

      socketRef.current.emit('peer-cam', { roomId, off: false });
    }
  };

  const switchCamera = async () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacing);

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing },
      audio: true
    });

    const newTrack = newStream.getVideoTracks()[0];
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

    if (sender) await sender.replaceTrack(newTrack);

    localStream.current.getTracks().forEach(t => t.stop());
    localStream.current = newStream;

    if (localSmallRef.current) localSmallRef.current.srcObject = newStream;
  };

  const toggleFlash = () => {
    setFlashOn(prev => {
      if (!prev) {
        setTimeout(() => setFlashOn(false), 1500);
      }
      return !prev;
    });
  };

  const leaveCall = () => {
    socketRef.current?.disconnect();
    pcRef.current?.close();
    localStream.current?.getTracks().forEach(t => t.stop());
    localStream.current = null;
    setStatus('idle');
    setRoomId('');
    setMessages([]);
    setChatOpen(false);
    setRemoteMuted(false);
    setRemoteCamOff(false);
    // FIX 3: removed setLocalExpanded(false) — that state never existed
  };

  const openChat = () => {
    setChatOpen(true);
    setUnread(0);
  };

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>

      {/* Flash overlay */}
      {flashOn && (
        <div style={{ position: 'fixed', inset: 0, background: 'white', zIndex: 9999, opacity: 0.95, pointerEvents: 'none', transition: 'opacity 0.3s' }} />
      )}

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '50px', padding: '6px 16px', marginBottom: '1rem' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 13, color: '#a5b4fc' }}>End-to-End Encrypted</span>
        </div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.8rem)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>SecureCall</h1>
        <p style={{ color: '#64748b', marginTop: '0.5rem', fontSize: 14 }}>Private 1-on-1 video calls. No accounts. No tracking.</p>
      </div>

      {/* Idle */}
      {status === 'idle' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '2rem', width: '100%', maxWidth: 400 }}>
          <button onClick={generateRoom} style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: '1rem' }}>+ Generate Room ID</button>
          <div style={{ position: 'relative', marginBottom: '1rem' }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.08)', transform: 'translateY(-50%)' }} />
            <span style={{ position: 'relative', background: '#0a0a0f', padding: '0 12px', color: '#475569', fontSize: 13, display: 'block', textAlign: 'center', width: 'fit-content', margin: '0 auto' }}>or join existing</span>
          </div>
          <input value={inputId} onChange={e => setInputId(e.target.value.toUpperCase())} placeholder="Enter Room ID"
            style={{ width: '100%', padding: '14px', borderRadius: 12, boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 16, textAlign: 'center', letterSpacing: '0.15em', marginBottom: '1rem', outline: 'none' }} />
          <button onClick={joinRoom} style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px solid rgba(99,102,241,0.5)', background: 'transparent', color: '#a5b4fc', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Join Call →</button>
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

      {status === 'full' && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '1rem 2rem', color: '#fca5a5' }}>Room is full — only 2 people allowed per call.</div>}
      {status === 'waiting' && <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, padding: '1rem 2rem', color: '#fcd34d', marginBottom: '1rem' }}>⏳ Waiting for the other person to join...</div>}

      {/* Main call layout */}
      <div style={{ width: '100%', maxWidth: 1100, display: status === 'idle' || status === 'full' ? 'none' : 'flex', gap: '1rem', alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row' }}>

        {/* Left — video */}
        <div style={{ flex: 1, width: '100%' }}>
          {/* Room ID bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 16px', marginBottom: '1rem' }}>
            <span style={{ color: '#64748b', fontSize: 13 }}>Room</span>
            <span style={{ fontFamily: 'monospace', color: '#a5b4fc', fontWeight: 600, letterSpacing: '0.1em' }}>{roomId}</span>
            <button onClick={() => navigator.clipboard.writeText(roomId)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>Copy</button>
          </div>

          {/* Remote video */}
          <div style={{ position: 'relative', width: '100%', borderRadius: 20, overflow: 'hidden', background: '#0d0d0d', marginBottom: '1rem', aspectRatio: isMobile ? '9/16' : '16/9' }}>

            {/* Remote cam off placeholder */}
            {remoteCamOff ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#111' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', border: '2px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>👤</div>
                <p style={{ color: '#64748b', fontSize: 14 }}>Camera turned off</p>
              </div>
            ) : (
              <video
                ref={isSwapped ? localSmallRef : remoteRef}
                autoPlay
                muted={isSwapped}
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}

            {/* Remote muted indicator */}
            {remoteMuted && (
              <div style={{ position: 'absolute', bottom: isMobile ? 110 : 20, left: 16, background: 'rgba(239,68,68,0.8)', borderRadius: 50, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                🔇 Muted
              </div>
            )}

            {/* Waiting placeholder */}
            {status === 'waiting' && !remoteCamOff && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', border: '2px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>👤</div>
                <p style={{ color: '#64748b', fontSize: 14 }}>Waiting for other person...</p>
              </div>
            )}

            {/* FIX 4: local video overlay — was bare parens (invalid JSX), now a proper fragment */}
            <div onClick={() => setIsSwapped(prev => !prev)} style={{ position: 'absolute', bottom: 16, right: 16, borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.2)', width: isMobile ? 90 : 180, aspectRatio: isMobile ? '9/16' : '16/9', cursor: 'pointer' }}>
              {!camOn ? (
                <div style={{ width: '100%', height: '100%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🚫</div>
              ) : (
                <video
                  ref={isSwapped ? remoteRef : localSmallRef}
                  autoPlay
                  muted={!isSwapped}
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              <div style={{ position: 'absolute', bottom: 4, left: 6, fontSize: 10, color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4 }}>You</div>
            </div>

            {/* Live badge */}
            {status === 'connected' && (
              <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.5)', borderRadius: 50, padding: '6px 12px' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ fontSize: 12 }}>Live</span>
              </div>
            )}
          </div>

          {/* Controls */}
          {(status === 'waiting' || status === 'connected') && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '1rem', flexWrap: 'wrap' }}>

              {[
                { onClick: toggleMic, active: micOn, icon: micOn ? '🎤' : '🔇', label: micOn ? 'Mute' : 'Unmute' },
                { onClick: toggleCam, active: camOn, icon: camOn ? '📷' : '🚫', label: camOn ? 'Cam Off' : 'Cam On' },
                { onClick: switchCamera, active: true, icon: '🔄', label: 'Flip' },
                { onClick: toggleFlash, active: true, icon: '💡', label: 'Flash' },
              ].map(({ onClick, active, icon, label }) => (
                <button key={label} onClick={onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', background: active ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.2)', color: active ? '#fff' : '#fca5a5', fontSize: 11, fontWeight: 500 }}>
                  <span style={{ fontSize: 18 }}>{icon}</span>
                  {label}
                </button>
              ))}

              <button onClick={chatOpen ? () => setChatOpen(false) : openChat} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', background: chatOpen ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)', color: '#a5b4fc', fontSize: 11, fontWeight: 500, position: 'relative' }}>
                <span style={{ fontSize: 18 }}>💬</span>
                Chat
                {unread > 0 && <div style={{ position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: '50%', background: '#ef4444', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{unread}</div>}
              </button>

              <button onClick={leaveCall} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.8)', color: '#fff', fontSize: 11, fontWeight: 600 }}>
                <span style={{ fontSize: 18 }}>📵</span>
                End
              </button>
            </div>
          )}
        </div>

        {/* Chat panel */}
        {chatOpen && (
          <div style={{ width: isMobile ? '100%' : 300, flexShrink: 0, background: '#111118', border: '1px solid #1e1e2e', borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: 500 }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e1e2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>💬 Chat</span>
              <button onClick={() => setChatOpen(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.length === 0 && <p style={{ color: '#475569', fontSize: 13, textAlign: 'center', marginTop: '2rem' }}>No messages yet. Say hi! 👋</p>}
              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.from === 'me' ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: msg.from === 'me' ? '12px 12px 2px 12px' : '12px 12px 12px 2px', background: msg.from === 'me' ? '#4f46e5' : '#1e1e2e', fontSize: 13, lineHeight: 1.5 }}>{msg.text}</div>
                  <span style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{msg.time}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ padding: '12px', borderTop: '1px solid #1e1e2e', display: 'flex', gap: 8 }}>
              <input value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Type a message..."
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: '#1a1a2e', border: '1px solid #2e2e4e', color: '#fff', fontSize: 13, outline: 'none' }} />
              <button onClick={sendMessage} style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: 'rgba(99,102,241,0.7)', color: '#fff', cursor: 'pointer', fontSize: 16 }}>➤</button>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
