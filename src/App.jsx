import { useState } from 'react';
import AudioVisualizer from './AudioVisualizer';

export default function App() {
  const [isActive, setIsActive] = useState(true);

  return (
    <div className="w-screen h-screen bg-slate-950 flex items-center justify-center overflow-hidden">
      {isActive ? (
        <AudioVisualizer onClose={() => setIsActive(false)} />
      ) : (
        <div className="flex flex-col items-center gap-4 text-center z-10 p-6">
          <div className="w-12 h-12 rounded-full border border-slate-800 flex items-center justify-center text-slate-500 mb-2">
            <svg
              className="w-5 h-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <p className="text-slate-400 text-xs tracking-widest uppercase font-mono">
            Screensaver Suspended
          </p>
          <button
            onClick={() => setIsActive(true)}
            className="bg-slate-900 border border-slate-700 text-slate-300 rounded-full px-6 py-2 text-xs tracking-widest uppercase hover:bg-slate-800 transition-colors shadow-lg"
          >
            Launch Visualizer
          </button>
        </div>
      )}
    </div>
  );
}
