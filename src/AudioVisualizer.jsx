import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * AudioVisualizer
 * High-end minimalist liquid spline audio visualizer.
 * Features:
 * - Liquid Bezier spline closed-loop waveform
 * - Reactive cinematic bloom (shadowBlur tied to bass hits)
 * - S-Log style color mapping (Amber #b45309 -> Orange #ea580c -> White #ffffff)
 * - Parallax breathing radius (2-5% dynamic scale)
 * - LED-safe dark slate (#020617) motion blur persistence
 */
export default function AudioVisualizer({ onClose }) {
  const [isEngineActive, setIsEngineActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameIdRef = useRef(null);

  // Audio cleanup utility
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

  // Web Audio API initialization on explicit user gesture
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
      analyser.smoothingTimeConstant = 0.85; // Hardware-level motion smoothing
      analyserRef.current = analyser;

      // Connect source to analyser only (no destination to prevent audio feedback)
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      // Clean unmount of gesture UI before canvas loop starts
      setIsEngineActive(true);
    } catch (err) {
      console.error('Audio initialization failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access denied. Please grant microphone permissions.');
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

  // Canvas render loop
  useEffect(() => {
    if (!isEngineActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Viewport handling
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const analyser = analyserRef.current;
    const bufferLength = analyser ? analyser.frequencyBinCount : 128;
    const rawData = new Uint8Array(bufferLength);

    // Continuous spline resolution: 64 points arranged in bilateral symmetry
    const numPoints = 64;
    const halfPoints = numPoints / 2;
    const smoothedValues = new Float32Array(numPoints);

    // Motion smoothing & breathing state
    let smoothedBass = 0;
    let smoothedVolume = 0;
    let time = 0;

    /**
     * S-Log Color Mapper
     * Maps audio intensity curve:
     * - Idle/Low (0.0 - 0.4): Deep cinematic amber (#b45309)
     * - Mid (0.4 - 0.8): Vibrant saturated orange (#ea580c)
     * - Peak (0.8 - 1.0): Pure glowing white (#ffffff)
     */
    const getSLogColor = (intensity, alpha = 1) => {
      // S-curve interpolation
      const t = Math.min(1, Math.max(0, intensity));
      const s = t * t * (3 - 2 * t);

      let r, g, b;
      if (s < 0.5) {
        // #b45309 (180, 83, 9) to #ea580c (234, 88, 12)
        const f = s * 2;
        r = Math.round(180 + (234 - 180) * f);
        g = Math.round(83 + (88 - 83) * f);
        b = Math.round(9 + (12 - 9) * f);
      } else {
        // #ea580c (234, 88, 12) to #ffffff (255, 255, 255)
        const f = (s - 0.5) * 2;
        r = Math.round(234 + (255 - 234) * f);
        g = Math.round(88 + (255 - 88) * f);
        b = Math.round(12 + (255 - 12) * f);
      }
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      // 1. LED Motion Blur: Transparent Slate-950 fill prevents backlight bleed
      ctx.fillStyle = 'rgba(2, 6, 23, 0.25)';
      ctx.fillRect(0, 0, width, height);

      time += 0.012;

      // 2. Audio extraction and smoothing
      let bassAccum = 0;
      let totalVolume = 0;

      if (analyser) {
        analyser.getByteFrequencyData(rawData);

        // Low frequency bins (Bass: bins 1 to 8)
        for (let b = 1; b <= 8; b++) {
          bassAccum += rawData[b];
        }
        const currentBass = bassAccum / (8 * 255);
        smoothedBass += (currentBass - smoothedBass) * 0.14;

        // Total room volume average
        for (let v = 0; v < bufferLength; v++) {
          totalVolume += rawData[v];
        }
        const currentVolume = totalVolume / (bufferLength * 255);
        smoothedVolume += (currentVolume - smoothedVolume) * 0.08;
      } else {
        // Ambient sine modulation when waiting for audio input
        const ambient = (Math.sin(time * 2) + 1) * 0.05;
        smoothedBass += (ambient - smoothedBass) * 0.05;
        smoothedVolume += (ambient * 0.5 - smoothedVolume) * 0.05;
      }

      // 3. Parallax Breathing: Base radius expands and contracts by 2-5%
      const minDimension = Math.min(width, height);
      const idleBreathing = Math.sin(time) * 0.015; // Subtle organic breath
      const volumeBreathing = smoothedVolume * 0.05; // 2% to 5% room volume expansion
      const breathingScale = 1 + idleBreathing + volumeBreathing;

      const baseRadius = minDimension * 0.22 * breathingScale;
      const maxDisplacement = minDimension * 0.16;

      // Bilateral frequency mapping:
      // Map audible bins (1 to 75) symmetrically around the ring
      for (let i = 0; i < halfPoints; i++) {
        const binIndex = Math.min(bufferLength - 1, Math.floor(1 + (i / halfPoints) * 72));
        const rawTarget = (rawData[binIndex] || 0) / 255;
        // Linear interpolation (lerp) for fluid spline deformation
        smoothedValues[i] += (rawTarget - smoothedValues[i]) * 0.14;
      }

      // Build closed loop points with bilateral symmetry:
      // Points flow seamlessly from top (-π/2) through right side to bottom, then mirror up the left
      const ringPoints = [];
      const angleStep = Math.PI / halfPoints;

      // Right hemisphere: Top to Bottom
      for (let i = 0; i < halfPoints; i++) {
        const angle = -Math.PI / 2 + i * angleStep;
        const disp = smoothedValues[i] * maxDisplacement;
        const r = baseRadius + disp;
        ringPoints.push({
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          intensity: smoothedValues[i],
        });
      }

      // Left hemisphere: Bottom to Top (mirrored)
      for (let i = halfPoints - 1; i >= 0; i--) {
        const angle = Math.PI / 2 + (halfPoints - i) * angleStep;
        const disp = smoothedValues[i] * maxDisplacement;
        const r = baseRadius + disp;
        ringPoints.push({
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          intensity: smoothedValues[i],
        });
      }

      // 4. Subtle Base Reference Ring (Whisper-thin guide)
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.08)';
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 5. Liquid Spline Rendering (Quadratic Bezier Curves)
      if (ringPoints.length > 2) {
        ctx.save();

        // 6. Reactive Cinematic Bloom (Glow tied directly to bass)
        // shadowBlur flares dynamically on low-frequency heavy kicks
        const bassImpact = Math.pow(smoothedBass, 1.6);
        const dynamicBlur = 6 + bassImpact * 44;
        ctx.shadowBlur = dynamicBlur;

        // Shadow color flares from rich amber to fiery orange/white
        if (bassImpact > 0.55) {
          ctx.shadowColor = `rgba(255, 255, 255, ${0.5 + bassImpact * 0.4})`;
        } else {
          ctx.shadowColor = `rgba(234, 88, 12, ${0.35 + bassImpact * 0.5})`;
        }

        // Line properties: S-Log color mapping based on combined bass & volume intensity
        const combinedIntensity = Math.min(1, smoothedBass * 1.35 + smoothedVolume * 0.8);
        ctx.lineWidth = 2;
        ctx.strokeStyle = getSLogColor(combinedIntensity, 0.95);

        // Render continuous smooth liquid ring using midpoints
        ctx.beginPath();
        const len = ringPoints.length;
        const pLast = ringPoints[len - 1];
        const pFirst = ringPoints[0];
        const startX = (pLast.x + pFirst.x) / 2;
        const startY = (pLast.y + pFirst.y) / 2;

        ctx.moveTo(startX, startY);

        for (let i = 0; i < len; i++) {
          const curr = ringPoints[i];
          const next = ringPoints[(i + 1) % len];
          const midX = (curr.x + next.x) / 2;
          const midY = (curr.y + next.y) / 2;
          // Smooth bezier curve through control points
          ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
        }

        ctx.closePath();
        ctx.stroke();

        // 7. Secondary Soft Echo Wave (Liquid Glass Depth)
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = getSLogColor(Math.max(0, combinedIntensity - 0.25), 0.2);
        ctx.beginPath();
        const innerRatio = 0.985;
        ctx.moveTo(
          cx + (startX - cx) * innerRatio,
          cy + (startY - cy) * innerRatio
        );
        for (let i = 0; i < len; i++) {
          const curr = ringPoints[i];
          const next = ringPoints[(i + 1) % len];
          const midX = (curr.x + next.x) / 2;
          const midY = (curr.y + next.y) / 2;
          ctx.quadraticCurveTo(
            cx + (curr.x - cx) * innerRatio,
            cy + (curr.y - cy) * innerRatio,
            cx + (midX - cx) * innerRatio,
            cy + (midY - cy) * innerRatio
          );
        }
        ctx.closePath();
        ctx.stroke();

        ctx.restore();
      }

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

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return (
    <div className="fixed inset-0 bg-slate-950 z-50 flex items-center justify-center select-none overflow-hidden">
      {/* 1. Initialization Overlay: Unmounts completely once audio is running */}
      {!isEngineActive && (
        <div className="flex flex-col items-center gap-3 z-10 px-6 text-center">
          <button
            onClick={initAudioEngine}
            className="bg-slate-900 border border-slate-700 text-slate-300 rounded-full px-6 py-2 text-xs tracking-widest uppercase hover:bg-slate-800 transition-colors shadow-2xl"
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

      {/* 2. Full-Screen Canvas: Renders only when audio engine is active */}
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

          {/* Subtle Studio HUD Watermark */}
          <div className="absolute bottom-6 left-6 z-20 flex items-center gap-2 pointer-events-none opacity-20">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[9px] font-mono tracking-widest uppercase text-slate-400">
              Liquid Spectrum • 256 FFT
            </span>
          </div>
        </>
      )}
    </div>
  );
}
