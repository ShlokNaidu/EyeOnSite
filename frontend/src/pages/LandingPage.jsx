import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TOTAL_FRAMES = 42;

const FEATURES = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: 'PPE Detection',
    desc: 'Automatically verify if personnel are wearing hard hats, safety vests, and proper equipment using AI-powered computer vision.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
    title: 'Instant Alerts',
    desc: 'Receive real-time notifications via WebSockets the moment a security or safety anomaly occurs on any camera feed.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: 'Restricted Zones',
    desc: 'Draw polygon zones directly on camera feeds to monitor and restrict access to dangerous areas in real-time.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: 'Live Camera Feeds',
    desc: 'Stream multiple webcam, RTSP, and video feeds simultaneously with AI-powered monitoring on every frame.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: 'Smart Analytics',
    desc: 'Track safety scores, violation trends, and generate actionable reports with interactive charts and graphs.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
      </svg>
    ),
    title: 'Predictive AI',
    desc: 'Predict machinery collisions and unauthorized zone entries before they happen using trajectory analysis.',
  },
];

export default function LandingPage() {
  const canvasRef = useRef(null);
  const [images] = useState(() => []);
  const [loadedFrames, setLoadedFrames] = useState(0);
  const [showContent, setShowContent] = useState(false);
  const animRef = useRef(null);
  const navigate = useNavigate();

  // Preload images
  useEffect(() => {
    let loaded = 0;
    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = `/frames/frame_${i}.png`;
      img.onload = () => {
        loaded++;
        setLoadedFrames(loaded);
        if (loaded === TOTAL_FRAMES) {
          requestAnimationFrame(() => updateCanvas(0));
        }
      };
      images.push(img);
    }
  }, []);

  const updateCanvas = (index) => {
    if (!canvasRef.current || index >= images.length) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = images[index];

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (img && img.complete && img.naturalHeight !== 0) {
      const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
      const x = (canvas.width / 2) - (img.width / 2) * scale;
      const y = (canvas.height / 2) - (img.height / 2) * scale;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      const animSection = animRef.current;
      if (!animSection) return;

      const rect = animSection.getBoundingClientRect();
      const sectionHeight = animSection.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      const progress = Math.max(0, Math.min(1, scrolled / sectionHeight));

      const totalSteps = TOTAL_FRAMES;
      const frameIndex = Math.min(totalSteps - 1, Math.floor(progress * totalSteps));

      if (progress < 0.05) {
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      } else {
        updateCanvas(frameIndex);
      }

      setShowContent(progress >= 0.95);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    const resizeCanvas = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
        handleScroll();
      }
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [images]);

  return (
    <div className="w-full bg-white">

      {/* ====== Fixed Navbar ====== */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-700 ${showContent ? 'bg-white/90 backdrop-blur-md shadow-sm' : 'bg-transparent'}`}>
        <div className="w-full px-8 md:px-16 h-20 flex items-center justify-between">
          <img src="/logo_1.png" alt="EyeOnSite" className={`h-14 object-contain transition-opacity duration-500 ${showContent ? 'opacity-100' : 'opacity-0'}`} />
          <div className={`flex items-center gap-3 transition-all duration-500 ${showContent ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
            <button
              onClick={() => navigate('/login')}
              className="px-6 py-2.5 text-base font-semibold text-sky-600 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors"
            >
              Login
            </button>

          </div>
        </div>
      </nav>

      {/* ====== SECTION 1: Scroll Animation ====== */}
      <div ref={animRef} className="relative w-full" style={{ height: '250vh' }}>
        <div className="sticky top-0 w-full h-screen overflow-hidden">
          <canvas ref={canvasRef} className="w-full h-full object-cover" />

          {/* Loading */}
          {loadedFrames < TOTAL_FRAMES && (
            <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
              <div className="text-gray-500 font-medium">
                Loading Animation... {Math.round((loadedFrames / TOTAL_FRAMES) * 100)}%
              </div>
            </div>
          )}



          {/* Scroll indicator */}
          <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center transition-opacity duration-500 ${showContent ? 'opacity-0' : 'opacity-100'}`}>
            <div className="text-sky-500 font-semibold mb-2 animate-pulse font-mono tracking-widest text-sm">SCROLL</div>
            <div className="w-6 h-10 border-2 border-sky-500 rounded-full flex justify-center p-1">
              <div className="w-1.5 h-3 bg-sky-500 rounded-full animate-bounce" />
            </div>
          </div>
        </div>
      </div>

      {/* ====== SECTION 2: Catchy Intro ====== */}
      <section className="relative py-24 px-6 bg-gradient-to-b from-slate-50 to-white overflow-hidden">
        {/* Subtle background shapes */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-sky-200/30 rounded-full blur-3xl -translate-y-1/2" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-blue-200/20 rounded-full blur-3xl translate-y-1/2" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <p className="text-sky-500 font-semibold tracking-widest uppercase text-sm mb-4">AI-Powered Construction Safety</p>
          <h2 className="text-4xl md:text-6xl font-black text-slate-800 leading-tight mb-6">
            See Every Hazard.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-blue-600">Before It Becomes an Incident.</span>
          </h2>
          <p className="text-lg md:text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed">
            EyeOnSite uses real-time computer vision to monitor construction workers, detect PPE violations,
            track restricted zone breaches, and predict collisions — keeping your team safe around the clock.
          </p>
        </div>
      </section>

      {/* ====== SECTION 3: Industrial Grade Features ====== */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-slate-800 mb-4">Industrial Grade Features</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">Everything you need to keep construction sites safe, compliant, and incident-free.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="group relative rounded-2xl border border-sky-100 bg-white/60 backdrop-blur-md p-6 shadow-sm hover:shadow-xl hover:border-sky-300 hover:-translate-y-1 transition-all duration-300"
              >
                {/* Glass shimmer on hover */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-sky-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-500 mb-4 group-hover:bg-sky-500 group-hover:text-white transition-colors duration-300">
                    {f.icon}
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">{f.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>



      {/* ====== SECTION 5: CTA Footer ====== */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Ready to make your site safer?</h2>
          <p className="text-slate-500 text-lg mb-8">Start monitoring in minutes. No hardware changes needed — just add your cameras and go.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate('/login')}
              className="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-full transition-all hover:scale-105 shadow-lg"
            >
              Get Started — It's Free
            </button>

          </div>
          <p className="text-xs text-slate-400 mt-6">© 2026 EyeOnSite — AI-Powered Construction Safety</p>
        </div>
      </section>
    </div>
  );
}

