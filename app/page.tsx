"use client";

import React, { useRef, useState, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MediasoupClient } from "./mediasoupClient";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface RemoteParticipant {
  id: string;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
}

/* ─── Random offsets computed once at module level (not during render) ── */
const ORB_OFFSETS = [
  Math.random() * 100,
  Math.random() * 100,
  Math.random() * 100,
];

/* ─── R3F ────────────────────────────────────────────────────────────────── */
function AmbientOrb({
  position,
  color,
  speed,
  offset,
}: {
  position: [number, number, number];
  color: string;
  speed: number;
  offset: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const t = useRef(offset);
  useFrame((_, d) => {
    t.current += d * speed;
    if (!mesh.current) return;
    mesh.current.position.y = position[1] + Math.sin(t.current) * 0.5;
    mesh.current.position.x = position[0] + Math.cos(t.current * 0.6) * 0.35;
    (mesh.current.material as THREE.MeshStandardMaterial).opacity =
      0.1 + Math.abs(Math.sin(t.current * 0.4)) * 0.08;
  });
  return (
    <mesh ref={mesh} position={position}>
      <sphereGeometry args={[2, 32, 32]} />
      <meshStandardMaterial color={color} transparent opacity={0.12} />
    </mesh>
  );
}
function R3FScene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <AmbientOrb
        position={[-3.5, 1, -3]}
        color="#6366f1"
        speed={0.35}
        offset={ORB_OFFSETS[0]}
      />
      <AmbientOrb
        position={[3.5, -1, -4]}
        color="#06b6d4"
        speed={0.28}
        offset={ORB_OFFSETS[1]}
      />
      <AmbientOrb
        position={[0.5, 2.5, -5]}
        color="#8b5cf6"
        speed={0.45}
        offset={ORB_OFFSETS[2]}
      />
    </>
  );
}

/* ─── Waveform: pure CSS keyframe animation, no Framer Motion on SVG attrs ── */
function Waveform() {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14">
      <style>{`
        @keyframes bar { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.6)} }
      `}</style>
      {[3, 7, 10, 7, 3, 8, 5, 4, 9, 4].map((h, i) => (
        <rect
          key={i}
          x={i * 2.8}
          y={(14 - h) / 2}
          width={1.8}
          height={h}
          rx={0.9}
          fill="#818cf8"
          style={{
            transformOrigin: `${i * 2.8 + 0.9}px 7px`,
            animation: `bar ${0.6 + i * 0.06}s ease-in-out infinite`,
            animationDelay: `${i * 0.05}s`,
          }}
        />
      ))}
    </svg>
  );
}

/* ─── Live pulse dot ─────────────────────────────────────────────────────── */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <motion.span
        className="absolute inline-flex h-full w-full rounded-full bg-emerald-400"
        animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
        transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
      />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}

/* ─── Tile shell ─────────────────────────────────────────────────────────── */
function TileShell({
  isLocal,
  label,
  index,
  children,
}: {
  isLocal: boolean;
  label: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88, y: -16 }}
      transition={{
        duration: 0.5,
        delay: index * 0.08,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="relative group rounded-2xl overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01))",
        border: `1px solid ${isLocal ? "rgba(99,102,241,0.35)" : "rgba(6,182,212,0.25)"}`,
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
      }}
    >
      <div
        className="absolute top-0 inset-x-0 h-px z-10"
        style={{
          background: isLocal
            ? "linear-gradient(90deg,transparent,rgba(99,102,241,0.9),transparent)"
            : "linear-gradient(90deg,transparent,rgba(6,182,212,0.7),transparent)",
        }}
      />
      {children}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none z-10" />
      <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
        <span
          className="px-2.5 py-1 rounded-lg text-xs font-medium"
          style={{
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: isLocal ? "#a5b4fc" : "#67e8f9",
            letterSpacing: "0.04em",
          }}
        >
          {isLocal ? "You" : label}
        </span>
        {isLocal && <Waveform />}
      </div>
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-10"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%,rgba(99,102,241,0.07),transparent 70%)",
        }}
      />
    </motion.div>
  );
}

/* ─── LocalVideoTile ─────────────────────────────────────────────────────────
   Receives the MediaStream as a prop and sets srcObject via useEffect.
   This avoids the timing bug where srcObject was set before the <video>
   element existed in the DOM (it was hidden behind isConnected gate).
─────────────────────────────────────────────────────────────────────────── */
function LocalVideoTile({
  stream,
  label,
  index,
}: {
  stream: MediaStream | null;
  label: string;
  index: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <TileShell isLocal={true} label={label} index={index}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full object-cover"
        style={{
          minHeight: "240px",
          maxHeight: "300px",
          background: "#0a0a12",
          display: "block",
        }}
      />
    </TileShell>
  );
}

/* ─── RemoteVideoTile ────────────────────────────────────────────────────────
   Stable MediaStream in a ref. Tracks swapped in-place via separate effects.
   srcObject is wired once on mount — never reassigned.
─────────────────────────────────────────────────────────────────────────── */
function RemoteVideoTile({
  participant,
  index,
  onVideoEl,
}: {
  participant: RemoteParticipant;
  index: number;
  onVideoEl: (id: string, el: HTMLVideoElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef(new MediaStream());

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = streamRef.current;
    el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, []);

  useEffect(() => {
    const s = streamRef.current;
    s.getVideoTracks().forEach((t) => s.removeTrack(t));
    if (participant.videoTrack) {
      s.addTrack(participant.videoTrack);
      videoRef.current?.play().catch(() => {});
    }
  }, [participant.videoTrack]);

  useEffect(() => {
    const s = streamRef.current;
    s.getAudioTracks().forEach((t) => s.removeTrack(t));
    if (participant.audioTrack) s.addTrack(participant.audioTrack);
  }, [participant.audioTrack]);

  return (
    <TileShell isLocal={false} label={participant.id} index={index}>
      <video
        ref={(el) => {
          (
            videoRef as React.MutableRefObject<HTMLVideoElement | null>
          ).current = el;
          onVideoEl(participant.id, el);
        }}
        autoPlay
        playsInline
        className="w-full object-cover"
        style={{
          minHeight: "240px",
          maxHeight: "300px",
          background: "#0a0a12",
          display: "block",
        }}
      />
    </TileShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   App
   KEY FIX: store the MediaStream in state (`localStream`).
   The video grid (including <LocalVideoTile>) only renders after
   setIsConnected(true). By the time LocalVideoTile mounts and its
   useEffect runs, `localStream` is already in state — so srcObject
   gets set correctly on the live DOM element.
═══════════════════════════════════════════════════════════════════════════ */
const App: React.FC = () => {
  const [participantId, setParticipantId] = useState<string>(
    () => `participant-${Math.random().toString(36).substr(2, 9)}`,
  );
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<
    Map<string, RemoteParticipant>
  >(new Map());
  const mediasoupClientRef = useRef<MediasoupClient | null>(null);
  // kept for compatibility with original useEffect logic
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const handleJoin = async () => {
    if (!participantId) return;
    try {
      mediasoupClientRef.current = new MediasoupClient(
        "http://54.226.35.66:3001",
        participantId,
      );

      mediasoupClientRef.current.on("participantJoined", (pid: string) => {
        console.log(`Participant ${pid} joined`);
        setRemoteParticipants((prev) => {
          const updated = new Map(prev);
          if (!updated.has(pid)) updated.set(pid, { id: pid });
          return updated;
        });
      });

      mediasoupClientRef.current.on("participantLeft", (pid: string) => {
        console.log(`Participant ${pid} left`);
        setRemoteParticipants((prev) => {
          const updated = new Map(prev);
          updated.delete(pid);
          return updated;
        });
      });

      mediasoupClientRef.current.on(
        "newProducer",
        async (data: {
          participantId: string;
          producerId: string;
          kind: string;
        }) => {
          console.log(`New producer from ${data.participantId}: ${data.kind}`);
          if (mediasoupClientRef.current) {
            const track = await mediasoupClientRef.current.consumeTrack(
              data.participantId,
              data.producerId,
            );
            if (track) {
              setRemoteParticipants((prev) => {
                const updated = new Map(prev);
                const participant = updated.get(data.participantId) || {
                  id: data.participantId,
                };
                if (data.kind === "video") participant.videoTrack = track;
                else if (data.kind === "audio") participant.audioTrack = track;
                updated.set(data.participantId, participant);
                return updated;
              });
            }
          }
        },
      );

      await mediasoupClientRef.current.connect();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // ── KEY FIX ──────────────────────────────────────────────────────────
      // Store stream in state FIRST so LocalVideoTile's useEffect can pick it
      // up after the video grid mounts (which happens after setIsConnected).
      // Previously: localVideoRef.current.srcObject = stream → ref was null
      // because the <video> element didn't exist in the DOM yet.
      setLocalStream(stream);

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if (videoTrack) await mediasoupClientRef.current.produceTrack(videoTrack);
      if (audioTrack) await mediasoupClientRef.current.produceTrack(audioTrack);

      setIsConnected(true);
    } catch (error) {
      console.error("Error joining:", error);
      alert("Failed to join. Check console for details.");
    }
  };

  const handleLeave = () => {
    if (mediasoupClientRef.current) {
      mediasoupClientRef.current.disconnect();
      mediasoupClientRef.current = null;
    }
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setIsConnected(false);
    setRemoteParticipants(new Map());
  };

  // Original useEffect kept — RemoteVideoTile also handles this independently
  useEffect(() => {
    remoteParticipants.forEach((participant, pid) => {
      const videoElement = remoteVideoRefs.current.get(pid);
      if (videoElement && (participant.videoTrack || participant.audioTrack)) {
        const stream = new MediaStream();
        if (participant.videoTrack) stream.addTrack(participant.videoTrack);
        if (participant.audioTrack) stream.addTrack(participant.audioTrack);
        videoElement.srcObject = stream;
      }
    });
  }, [remoteParticipants]);

  const participants = Array.from(remoteParticipants.values());

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{
        background: "#07070e",
        fontFamily: "'DM Sans','Helvetica Neue',sans-serif",
      }}
    >
      {/* R3F background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <Canvas camera={{ position: [0, 0, 5], fov: 55 }}>
          <Suspense fallback={null}>
            <R3FScene />
          </Suspense>
        </Canvas>
      </div>

      {/* Noise grain */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "120px 120px",
          mixBlendMode: "overlay",
        }}
      />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center justify-between px-8 pt-6 pb-4"
        >
          <div className="flex items-center gap-3">
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
              <circle
                cx="15"
                cy="15"
                r="13"
                stroke="url(#lg)"
                strokeWidth="1.4"
              />
              <circle cx="10" cy="15" r="3" fill="#6366f1" />
              <circle cx="20" cy="15" r="3" fill="#06b6d4" />
              <path
                d="M13 15 Q15 12 17 15"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="1.1"
                fill="none"
              />
              <defs>
                <linearGradient
                  id="lg"
                  x1="0"
                  y1="0"
                  x2="30"
                  y2="30"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
            </svg>
            <span
              className="text-xs font-bold tracking-[0.18em] uppercase"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              Nexus
            </span>
          </div>

          <AnimatePresence>
            {isConnected && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full"
                style={{
                  background: "rgba(16,185,129,0.08)",
                  border: "1px solid rgba(16,185,129,0.22)",
                }}
              >
                <LiveDot />
                <span className="text-xs text-emerald-400 font-medium tracking-wide">
                  Live · {remoteParticipants.size + 1} participant
                  {remoteParticipants.size !== 0 ? "s" : ""}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        <div className="flex-1 flex flex-col items-center px-6 pb-10 gap-7">
          {/* Hero */}
          <AnimatePresence>
            {!isConnected && (
              <motion.div
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{
                  duration: 0.75,
                  delay: 0.15,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="text-center mt-10 mb-2"
              >
                <h1
                  className="text-5xl font-bold leading-tight mb-3"
                  style={{
                    background:
                      "linear-gradient(135deg,#fff 25%,rgba(99,102,241,0.85) 60%,#06b6d4)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    letterSpacing: "-0.03em",
                  }}
                >
                  Clear. Present.
                  <br />
                  Connected.
                </h1>
                <p
                  className="text-sm"
                  style={{
                    color: "rgba(255,255,255,0.3)",
                    letterSpacing: "0.04em",
                  }}
                >
                  Minimal video conferencing. Maximum focus.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Controls */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.65,
              delay: 0.28,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="flex items-center gap-3"
          >
            <input
              type="text"
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              placeholder="Enter your participant ID"
              disabled={isConnected}
              className="px-4 py-2.5 rounded-xl text-sm outline-none w-64 transition-all duration-200"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)",
                color: "rgba(255,255,255,0.82)",
                caretColor: "#6366f1",
                fontFamily: "inherit",
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = "rgba(99,102,241,0.55)")
              }
              onBlur={(e) =>
                (e.target.style.borderColor = "rgba(255,255,255,0.09)")
              }
            />
            <AnimatePresence mode="wait">
              {!isConnected ? (
                <motion.button
                  key="join"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={handleJoin}
                  className="relative px-5 py-2.5 rounded-xl text-sm font-semibold overflow-hidden"
                  style={{ fontFamily: "inherit" }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background: "linear-gradient(135deg,#6366f1,#4f46e5)",
                    }}
                  />
                  <span className="relative text-white tracking-wide">
                    Join Conference
                  </span>
                </motion.button>
              ) : (
                <motion.button
                  key="leave"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={handleLeave}
                  className="relative px-5 py-2.5 rounded-xl text-sm font-semibold overflow-hidden"
                  style={{ fontFamily: "inherit" }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(135deg,rgba(239,68,68,0.85),rgba(220,38,38,0.7))",
                    }}
                  />
                  <span className="relative text-white tracking-wide">
                    Leave Conference
                  </span>
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Video grid — only rendered after isConnected */}
          <AnimatePresence>
            {isConnected && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45 }}
                className="w-full max-w-5xl"
              >
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns:
                      participants.length === 0
                        ? "minmax(0,560px)"
                        : participants.length === 1
                          ? "repeat(2,1fr)"
                          : "repeat(auto-fill,minmax(280px,1fr))",
                    justifyContent:
                      participants.length === 0 ? "center" : "start",
                  }}
                >
                  {/* LocalVideoTile receives stream as prop, sets srcObject in its own useEffect */}
                  <LocalVideoTile
                    stream={localStream}
                    label={participantId}
                    index={0}
                  />

                  <AnimatePresence>
                    {participants.map((participant, i) => (
                      <RemoteVideoTile
                        key={participant.id}
                        participant={participant}
                        index={i + 1}
                        onVideoEl={(id, el) => {
                          if (el) remoteVideoRefs.current.set(id, el);
                          else remoteVideoRefs.current.delete(id);
                        }}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="mt-4 text-xs text-center"
                  style={{
                    color: "rgba(255,255,255,0.22)",
                    letterSpacing: "0.06em",
                  }}
                >
                  Connected participants: {remoteParticipants.size + 1}{" "}
                  (including you)
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Pre-join illustration */}
          <AnimatePresence>
            {!isConnected && (
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.8, delay: 0.42 }}
                className="mt-2"
              >
                <svg width="340" height="175" viewBox="0 0 340 175" fill="none">
                  <motion.circle
                    cx="170"
                    cy="88"
                    r="18"
                    fill="rgba(99,102,241,0.13)"
                    stroke="rgba(99,102,241,0.55)"
                    strokeWidth="1.5"
                    animate={{ r: [18, 21, 18] }}
                    transition={{
                      duration: 2.6,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                  <circle cx="170" cy="88" r="7.5" fill="#6366f1" />
                  {(
                    [
                      { cx: 58, cy: 48, color: "#06b6d4", delay: 0 },
                      { cx: 282, cy: 48, color: "#8b5cf6", delay: 0.3 },
                      { cx: 58, cy: 128, color: "#8b5cf6", delay: 0.6 },
                      { cx: 282, cy: 128, color: "#06b6d4", delay: 0.9 },
                    ] as const
                  ).map((n, i) => (
                    <g key={i}>
                      <motion.line
                        x1="170"
                        y1="88"
                        x2={n.cx}
                        y2={n.cy}
                        stroke={n.color}
                        strokeWidth="1"
                        strokeDasharray="4 4"
                        animate={{ strokeOpacity: [0.18, 0.5, 0.18] }}
                        transition={{
                          duration: 2,
                          delay: n.delay,
                          repeat: Infinity,
                        }}
                      />
                      <motion.circle
                        cx={170}
                        cy={88}
                        r={2.5}
                        fill={n.color}
                        animate={{
                          cx: [170, n.cx, 170],
                          cy: [88, n.cy, 88],
                          opacity: [0, 1, 0],
                        }}
                        transition={{
                          duration: 2.4,
                          delay: n.delay,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      />
                      <motion.circle
                        cx={n.cx}
                        cy={n.cy}
                        r={11}
                        fill={`${n.color}18`}
                        stroke={n.color}
                        strokeWidth="1"
                        animate={{ r: [11, 13.5, 11] }}
                        transition={{
                          duration: 2,
                          delay: n.delay * 0.5,
                          repeat: Infinity,
                        }}
                      />
                      <circle
                        cx={n.cx}
                        cy={n.cy}
                        r="4.5"
                        fill={n.color}
                        opacity="0.85"
                      />
                    </g>
                  ))}
                  <text
                    x="170"
                    y="168"
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.18)"
                    fontSize="10.5"
                    fontFamily="DM Sans,sans-serif"
                    letterSpacing="3.5"
                  >
                    ENTER YOUR ID TO JOIN
                  </text>
                </svg>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          className="text-center pb-5"
          style={{
            color: "rgba(255,255,255,0.1)",
            fontSize: "10px",
            letterSpacing: "0.12em",
          }}
        >
          NEXUS · MEDIASOUP · N:N
        </motion.footer>
      </div>
    </div>
  );
};

export default App;
