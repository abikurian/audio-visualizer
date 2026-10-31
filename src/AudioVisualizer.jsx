import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * AudioVisualizer
 * A music-reactive screensaver optimized for standard LED displays (prevents backlight bleed).
 * Built with Web Audio API and HTML5 Canvas.
 */
export default function AudioVisualizer({ onClose }) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameIdRef = useRef(null);

  const [isInitialized, setIsInitialized] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Stop all active audio streams and contexts
  const cleanupAudio = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  // Initialize Web Audio Engine via user gesture
  const initAudioEngine = async () => {
    try {
      setErrorMessage(null);

      // 1. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      streamRef.current = stream;

      // 2. Initialize AudioContext and AnalyserNode
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; // 128 frequency bins
      analyser.smoothingTimeConstant = 0.82;
      analyserRef.current = analyser;

      // 3. Connect microphone to AnalyserNode ONLY (DO NOT connect to destination to prevent feedback)
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsInitialized(true);
    } catch (err) {
      console.error('Audio initialization failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access was denied. Please allow microphone access to visualize audio.');
      } else {
        setErrorMessage(`Audio initialization error: ${err.message || 'Unknown error'}`);
      }
    }
  };

  // Close handler
  const handleClose = () => {
    cleanupAudio();
    setIsInitialized(false);
    if (onClose) {
      onClose();
    }
  };

  // Canvas visual rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI scaling & resize
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Initial fill with LED-friendly Slate-950 (#020617)
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Particle pool for radiating treble effects
    const particles = [];
    const maxParticles = 120;

    for (let p = 0; p < maxParticles; p++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        angle: Math.random() * Math.PI * 2,
        speed: 1 + Math.random() * 3,
        radius: 1 + Math.random() * 2,
        life: 0,
        maxLife: 40 + Math.random() * 60,
        hue: 180 + Math.random() * 140, // Cyan (180) to Magenta (320)
      });
    }

    let rotationAngle = 0;
    let idlePhase = 0;

    // Main animation loop
    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      // 1. LED Motion Blur: Fill canvas with semi-transparent slate-950 for trails
      ctx.fillStyle = 'rgba(2, 6, 23, 0.25)';
      ctx.fillRect(0, 0, width, height);

      // Data extraction
      let bass = 0;
      let mid = 0;
      let treble = 0;
      let dataArray = null;

      if (analyserRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount; // 128 bins
        dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Low frequency bins (Bass: bins 1 - 8)
        let bassSum = 0;
        const bassCount = 8;
        for (let i = 1; i <= bassCount; i++) {
          bassSum += dataArray[i];
        }
        bass = bassSum / (bassCount * 255);

        // Mid frequency bins (bins 9 - 36)
        let midSum = 0;
        const midCount = 28;
        for (let i = 9; i < 9 + midCount; i++) {
          midSum += dataArray[i];
        }
        mid = midSum / (midCount * 255);

        // High frequency bins (Treble: bins 37 - 110)
        let trebleSum = 0;
        const trebleCount = 74;
        for (let i = 37; i < 37 + trebleCount; i++) {
          trebleSum += dataArray[i];
        }
        treble = trebleSum / (trebleCount * 255);
      } else {
        // Idle animation breathing when waiting for mic
        idlePhase += 0.02;
        bass = (Math.sin(idlePhase) + 1) * 0.08;
        mid = (Math.cos(idlePhase * 0.7) + 1) * 0.05;
        treble = (Math.sin(idlePhase * 1.3) + 1) * 0.04;
      }

      rotationAngle += 0.005 + bass * 0.015;

      // 2. Base Dimensions
      const minDimension = Math.min(width, height);
      const baseRadius = minDimension * 0.12 + bass * (minDimension * 0.1);

      // 3. Central Ambient Glow & Deep Orb (Bass-reactive)
      const orbPulseRadius = Math.max(10, baseRadius * (0.85 + bass * 0.45));
      const coreGradient = ctx.createRadialGradient(cx, cy, orbPulseRadius * 0.1, cx, cy, orbPulseRadius * 1.6);
      
      // Vibrant Electric Cyan to Neon Magenta LED palette
      coreGradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      coreGradient.addColorStop(0.2, 'rgba(6, 245, 255, 0.85)'); // Electric cyan
      coreGradient.addColorStop(0.55, 'rgba(168, 85, 247, 0.45)'); // Vibrant violet
      coreGradient.addColorStop(0.85, 'rgba(236, 72, 153, 0.2)'); // Hot pink / magenta
      coreGradient.addColorStop(1, 'rgba(2, 6, 23, 0)');

      ctx.save();
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(cx, cy, orbPulseRadius * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 4. Central Geometric Polygonal Core (Pulsing sacred geometry)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotationAngle);

      const sides = 6;
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const polyAngle = (s / sides) * Math.PI * 2;
        const polyDist = orbPulseRadius * (0.7 + (s % 2 === 0 ? 0.2 : -0.1) * (1 + bass));
        const px = Math.cos(polyAngle) * polyDist;
        const py = Math.sin(polyAngle) * polyDist;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(6, 245, 255, ${0.4 + bass * 0.5})`;
      ctx.lineWidth = 2 + bass * 3;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 12 + bass * 20;
      ctx.stroke();

      // Second counter-rotating inner geometric triangle
      ctx.beginPath();
      for (let s = 0; s <= 3; s++) {
        const polyAngle = (s / 3) * Math.PI * 2 - rotationAngle * 2;
        const polyDist = orbPulseRadius * 0.45 * (1 + bass * 0.6);
        const px = Math.cos(polyAngle) * polyDist;
        const py = Math.sin(polyAngle) * polyDist;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(244, 63, 94, ${0.5 + mid * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ec4899';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();

      // 5. Radiating Frequency Rays & Waves (Symmetric circular waveform)
      if (dataArray) {
        const binsCount = 64; // Focus on impactful audible range
        ctx.save();
        ctx.translate(cx, cy);

        // Circular frequency spikes
        for (let i = 0; i < binsCount; i++) {
          const val = dataArray[i] / 255;
          const spikeHeight = val * (minDimension * 0.28);

          // Draw dual symmetrical arcs
          const stepAngle = (Math.PI / binsCount) * i;
          const angles = [
            rotationAngle + stepAngle,
            rotationAngle - stepAngle,
            rotationAngle + Math.PI + stepAngle,
            rotationAngle + Math.PI - stepAngle,
          ];

          const hue = 180 + (i / binsCount) * 140; // 180 (Cyan) -> 320 (Neon Pink)
          ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${0.5 + val * 0.5})`;
          ctx.lineWidth = Math.max(1.5, (minDimension / 450) * (1 + val * 0.8));
          ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
          ctx.shadowBlur = 6 + val * 12;

          angles.forEach((ang) => {
            const startX = Math.cos(ang) * orbPulseRadius;
            const startY = Math.sin(ang) * orbPulseRadius;
            const endX = Math.cos(ang) * (orbPulseRadius + spikeHeight);
            const endY = Math.sin(ang) * (orbPulseRadius + spikeHeight);

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // Tip sparkle on punchy spikes
            if (val > 0.45) {
              ctx.fillStyle = '#ffffff';
              ctx.beginPath();
              ctx.arc(endX, endY, 1.5 + val * 2, 0, Math.PI * 2);
              ctx.fill();
            }
          });
        }
        ctx.restore();
      }

      // 6. Treble Reactivity: Radiating explosive particles & fractal lines
      const trebleEnergy = treble * (1 + bass * 0.5);
      const spawnChance = 0.2 + trebleEnergy * 0.8;

      ctx.save();
      for (let p = 0; p < particles.length; p++) {
        const pt = particles[p];

        // Accelerate & expand on high treble
        const currentSpeed = pt.speed * (1 + trebleEnergy * 3.5);
        pt.x += Math.cos(pt.angle) * currentSpeed;
        pt.y += Math.sin(pt.angle) * currentSpeed;
        pt.life++;

        // Reset particle if dead or out of bounds
        const distFromCenter = Math.hypot(pt.x - cx, pt.y - cy);
        if (
          pt.life > pt.maxLife ||
          distFromCenter > minDimension * 0.85 ||
          pt.x < 0 ||
          pt.x > width ||
          pt.y < 0 ||
          pt.y > height
        ) {
          if (Math.random() < spawnChance) {
            pt.life = 0;
            pt.maxLife = 30 + Math.random() * 50;
            pt.angle = Math.random() * Math.PI * 2;
            pt.speed = 1.5 + Math.random() * 3.5 + trebleEnergy * 4;
            // Spawn just outside the pulsating orb
            const spawnRadius = orbPulseRadius * (0.95 + Math.random() * 0.2);
            pt.x = cx + Math.cos(pt.angle) * spawnRadius;
            pt.y = cy + Math.sin(pt.angle) * spawnRadius;
            pt.hue = 180 + Math.random() * 140; // Electric Cyan to Magenta
            pt.radius = 1 + Math.random() * 2 + trebleEnergy * 2;
          }
        }

        // Draw particle trail
        const alpha = Math.max(0, 1 - pt.life / pt.maxLife);
        ctx.fillStyle = `hsla(${pt.hue}, 100%, 70%, ${alpha})`;
        ctx.shadowColor = `hsl(${pt.hue}, 100%, 50%)`;
        ctx.shadowBlur = 8 + trebleEnergy * 8;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.radius * (1 + trebleEnergy * 0.5), 0, Math.PI * 2);
        ctx.fill();

        // Connect near particles with delicate neon fractal beams during high treble bursts
        if (trebleEnergy > 0.4 && p % 4 === 0) {
          const nextPt = particles[(p + 1) % particles.length];
          const distBetween = Math.hypot(pt.x - nextPt.x, pt.y - nextPt.y);
          if (distBetween < 80) {
            ctx.strokeStyle = `hsla(${pt.hue}, 100%, 75%, ${alpha * 0.35})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(nextPt.x, nextPt.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // Continue loop
      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, []);

  // Cleanup audio tracks and context when unmounting
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 flex items-center justify-center select-none overflow-hidden">
      {/* Background Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-default"
      />

      {/* Subtle Close [ X ] Button in Top-Right */}
      <button
        onClick={handleClose}
        aria-label="Close Visualizer"
        className="absolute top-6 right-6 z-50 text-slate-400 hover:text-slate-100 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/60 rounded-full w-9 h-9 flex items-center justify-center text-sm font-mono transition-all duration-200 backdrop-blur-sm shadow-lg shadow-black/40"
      >
        ✕
      </button>

      {/* Centered User Gesture Initialization Button */}
      {!isInitialized && (
        <div className="absolute z-20 flex flex-col items-center gap-3">
          <button
            onClick={initAudioEngine}
            className="bg-slate-900 border border-slate-700 text-slate-300 rounded-full px-6 py-2 text-xs tracking-widest uppercase hover:bg-slate-800 transition-colors shadow-2xl hover:border-slate-500 hover:text-slate-100"
          >
            Initialize Audio Engine
          </button>

          {errorMessage ? (
            <p className="text-rose-400 text-xs tracking-wide max-w-sm text-center px-4 bg-slate-900/90 border border-rose-900/50 py-2 rounded-lg">
              {errorMessage}
            </p>
          ) : (
            <span className="text-slate-500 text-[10px] tracking-wider uppercase">
              Microphone access required for reactive visuals
            </span>
          )}
        </div>
      )}

      {/* Live Audio Visualizer Subtle HUD Indicator */}
      {isInitialized && (
        <div className="absolute bottom-6 left-6 z-20 flex items-center gap-2 pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
          <span className="text-[10px] font-mono tracking-widest uppercase text-slate-400">
            Audio Engine Active • 256 FFT
          </span>
        </div>
      )}
    </div>
  );
}

