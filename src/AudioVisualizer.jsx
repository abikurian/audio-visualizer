import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * AudioVisualizer
 * Ultra-minimalist, cinematic circular audio spectrum.
 * Tuned for standard LED displays (Slate-950 background, icy-cyan palette, motion blur trails).
 */
export default function AudioVisualizer({ onClose }) {
  const [isEngineActive, setIsEngineActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameIdRef = useRef(null);

  // Stop media tracks, close audio context, cancel animation frames
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

  // Initialize Web Audio Engine after user gesture
  const initAudioEngine = async () => {
    try {
      setErrorMessage(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; // 128 frequency bins
      analyser.smoothingTimeConstant = 0.85; // Motion smoothing
      analyserRef.current = analyser;

      // Connect mic stream exclusively to AnalyserNode (never destination)
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      // Transition state: unmounts button overlay before canvas starts rendering
      setIsEngineActive(true);
    } catch (err) {
      console.error('Audio initialization failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access denied. Please allow microphone permissions.');
      } else {
        setErrorMessage(`Audio initialization error: ${err.message || 'Unknown error'}`);
      }
    }
  };

  const handleClose = () => {
    cleanupAudio();
    setIsEngineActive(false);
    if (onClose) {
      onClose();
    }
  };

  // Canvas render loop - active only when isEngineActive is true
  useEffect(() => {
    if (!isEngineActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Viewport resizing
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Audio sampling configuration
    const analyser = analyserRef.current;
    const bufferLength = analyser ? analyser.frequencyBinCount : 128;
    const rawData = new Uint8Array(bufferLength);

    // Sample 64 frequency bands with bilateral symmetry
    const numBars = 64;
    // Smoothed values for lerp motion smoothing
    const smoothedValues = new Float32Array(numBars);
    const lerpFactor = 0.12;

    let time = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      // 1. LED Motion Blur: Transparent Slate-950 fill creates crisp phosphor-like light trails
      ctx.fillStyle = 'rgba(2, 6, 23, 0.25)';
      ctx.fillRect(0, 0, width, height);

      time += 0.015;

      // 2. Fetch and interpolate frequency data
      if (analyser) {
        analyser.getByteFrequencyData(rawData);
      }

      for (let i = 0; i < numBars; i++) {
        // Map linearly through audible range (bins 1 to 90)
        const binIndex = Math.min(bufferLength - 1, Math.floor(1 + (i / numBars) * 85));
        const targetValue = rawData[binIndex] || 0;
        // Smooth interpolation (lerp) prevents harsh snapping
        smoothedValues[i] += (targetValue - smoothedValues[i]) * lerpFactor;
      }

      // Base radius scaled to screen dimensions
      const minDimension = Math.min(width, height);
      const baseRadius = minDimension * 0.22;
      const maxAmplitude = minDimension * 0.18;

      // 3. Ultra-minimalist Concentric Base Guides (Icy Cyan Palette)
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle inner core ring
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 4. Classic Geometric Circular Audio Spectrum (Bilateral Symmetry)
      // Left and right halves mirror each other from top (0 rad) to bottom (π rad)
      const angleStep = Math.PI / numBars;

      ctx.save();
      ctx.lineWidth = 2; // Thin, sharp, refined lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'; // Deliberate icy cyan
      ctx.shadowColor = 'rgba(56, 189, 248, 0.45)';
      ctx.shadowBlur = 6;

      const peakPoints = [];

      for (let i = 0; i < numBars; i++) {
        const normalized = smoothedValues[i] / 255;
        // Subtle ambient breathing on silence
        const ambientBreath = Math.sin(time + i * 0.1) * 1.5;
        const amplitude = Math.max(1, normalized * maxAmplitude + ambientBreath);

        // Right arc: -π/2 to +π/2
        const rightAngle = -Math.PI / 2 + i * angleStep;
        // Left arc: -π/2 to -3π/2 (mirrored)
        const leftAngle = -Math.PI / 2 - i * angleStep;

        const cosR = Math.cos(rightAngle);
        const sinR = Math.sin(rightAngle);
        const cosL = Math.cos(leftAngle);
        const sinL = Math.sin(leftAngle);

        const r1 = baseRadius;
        const r2 = baseRadius + amplitude;

        // Draw Right Spectrum Bar
        ctx.beginPath();
        ctx.moveTo(cx + cosR * r1, cy + sinR * r1);
        ctx.lineTo(cx + cosR * r2, cy + sinR * r2);
        ctx.stroke();

        // Draw Left Spectrum Bar (Symmetrical mirror)
        ctx.beginPath();
        ctx.moveTo(cx + cosL * r1, cy + sinL * r1);
        ctx.lineTo(cx + cosL * r2, cy + sinL * r2);
        ctx.stroke();

        // Collect coordinates for the outer continuous waveform boundary
        peakPoints.push({
          xR: cx + cosR * r2,
          yR: cy + sinR * r2,
          xL: cx + cosL * r2,
          yL: cy + sinL * r2,
          val: normalized,
        });
      }
      ctx.restore();

      // 5. Continuous Outer Peak Waveform Ribbon
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.4)'; // Crisp icy-white accent
      ctx.beginPath();

      // Trace right hemisphere
      for (let i = 0; i < peakPoints.length; i++) {
        const pt = peakPoints[i];
        if (i === 0) {
          ctx.moveTo(pt.xR, pt.yR);
        } else {
          ctx.lineTo(pt.xR, pt.yR);
        }
      }

      // Trace bottom closure and left hemisphere back to top
      for (let i = peakPoints.length - 1; i >= 0; i--) {
        ctx.lineTo(peakPoints[i].xL, peakPoints[i].yL);
      }

      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // 6. Precision Peak Points (Subtle glowing highlights on peak audio)
      ctx.save();
      ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
      for (let i = 0; i < peakPoints.length; i += 2) {
        const pt = peakPoints[i];
        if (pt.val > 0.35) {
          ctx.beginPath();
          ctx.arc(pt.xR, pt.yR, 1.2, 0, Math.PI * 2);
          ctx.arc(pt.xL, pt.yL, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [isEngineActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 flex items-center justify-center select-none overflow-hidden">
      {/* 1. Pre-initialization State: Clean centered button; completely unmounts once active */}
      {!isEngineActive && (
        <div className="flex flex-col items-center gap-3 z-10 px-6 text-center">
          <button
            onClick={initAudioEngine}
            className="bg-slate-900 border border-slate-700 text-slate-300 rounded-full px-6 py-2 text-xs tracking-widest uppercase hover:bg-slate-800 transition-colors shadow-xl"
          >
            Initialize Audio Engine
          </button>

          {errorMessage ? (
            <p className="text-rose-400 text-xs tracking-wide max-w-sm bg-slate-900/90 border border-rose-900/50 py-1.5 px-3 rounded-full mt-2">
              {errorMessage}
            </p>
          ) : (
            <span className="text-slate-600 text-[10px] tracking-wider uppercase font-mono">
              Web Audio API • Microphone Gesture Required
            </span>
          )}
        </div>
      )}

      {/* 2. Active State: Canvas renders only when isEngineActive is true */}
      {isEngineActive && (
        <>
          <canvas
            ref={canvasRef}
            className="w-full h-full block cursor-default"
          />

          {/* Minimalist Close [ X ] Button */}
          <button
            onClick={handleClose}
            aria-label="Close Visualizer"
            className="absolute top-6 right-6 z-50 text-slate-500 hover:text-slate-300 transition-colors text-xs font-mono tracking-widest uppercase px-3 py-1.5 rounded-full bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800/80 backdrop-blur-sm"
          >
            ✕
          </button>

          {/* Discreet status watermark */}
          <div className="absolute bottom-6 left-6 z-20 flex items-center gap-2 pointer-events-none opacity-25">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            <span className="text-[9px] font-mono tracking-widest uppercase text-slate-400">
              Spectrum Active
            </span>
          </div>
        </>
      )}
    </div>
  );
}
