import createGlobe from 'cobe';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface GlobePin {
  lat: number;
  lng: number;
}

const DRAG_SENSITIVITY = 200;
const RENDER_SIZE = 600;
const DPR_CAP = 1;
// Radians per millisecond. Tuned so a 60fps frame advances by ~0.003 rad,
// matching the original feel without binding rotation to frame rate.
const ROTATION_SPEED = 0.003 / (1000 / 60);
// Momentum decay time-constant in ms — momentum drops to ~37% after this long.
const MOMENTUM_TAU = 450;
const MOMENTUM_EPSILON = ROTATION_SPEED / 4;

export function SpinningGlobe({ pins }: { pins: GlobePin[] }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<ReturnType<typeof createGlobe> | null>(null);
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    let raf = 0;
    // locationToAngles(20°N, 10°E) → central Europe, low tilt
    let phi = Math.PI - ((10 * Math.PI) / 180 - Math.PI / 2);
    const theta = (20 * Math.PI) / 180;
    let deltaPhi = 0;
    let momentum = 0;
    let lastMoveX = 0;
    let lastMoveTs = 0;
    let pointerStart: { x: number; id: number } | null = null;
    let observer: IntersectionObserver | undefined;
    let visible = true;
    let lastTs = 0;

    const render = () => {
      globeRef.current?.update({ phi: phi + deltaPhi, theta });
    };

    const animate = (ts: number) => {
      const dt = lastTs ? ts - lastTs : 0;
      lastTs = ts;
      if (!pointerStart) {
        if (!reducedMotion) phi += ROTATION_SPEED * dt;
        if (Math.abs(momentum) > MOMENTUM_EPSILON) {
          phi += momentum * dt;
          momentum *= Math.exp(-dt / MOMENTUM_TAU);
        } else {
          momentum = 0;
        }
      }
      render();
      // For reduced-motion users we only need to keep the loop alive while
      // the user is dragging or the throw is still decaying.
      if (reducedMotion && !pointerStart && momentum === 0) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(animate);
    };

    const startLoop = () => {
      if (!raf && visible) {
        lastTs = 0;
        raf = requestAnimationFrame(animate);
      }
    };
    const stopLoop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerStart = { x: e.clientX, id: e.pointerId };
      lastMoveX = e.clientX;
      lastMoveTs = e.timeStamp;
      momentum = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      startLoop();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointerStart || e.pointerId !== pointerStart.id) return;
      deltaPhi = (e.clientX - pointerStart.x) / DRAG_SENSITIVITY;
      const dt = e.timeStamp - lastMoveTs;
      if (dt > 0) {
        const sampleVelocity = (e.clientX - lastMoveX) / dt / DRAG_SENSITIVITY;
        // Low-pass so a single jittery sample doesn't dominate the throw.
        momentum = momentum * 0.3 + sampleVelocity * 0.7;
      }
      lastMoveX = e.clientX;
      lastMoveTs = e.timeStamp;
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (!pointerStart || e.pointerId !== pointerStart.id) return;
      phi += deltaPhi;
      deltaPhi = 0;
      pointerStart = null;
      canvas.style.cursor = 'grab';
    };

    try {
      globeRef.current = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio, DPR_CAP),
        width: RENDER_SIZE,
        height: RENDER_SIZE,
        phi,
        theta,
        dark: 0,
        diffuse: 1.2,
        mapSamples: 12000,
        mapBrightness: 6,
        baseColor: [0.74, 0.74, 0.72],
        markerColor: [0.73, 0.5, 0.15],
        glowColor: [0.74, 0.74, 0.72],
        markerElevation: 0,
        markers: [],
      });

      canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerEnd);
      canvas.addEventListener('pointercancel', onPointerEnd);

      observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (visible) {
            if (!reducedMotion) startLoop();
          } else {
            stopLoop();
          }
        },
        { threshold: 0 },
      );
      observer.observe(canvas);

      if (reducedMotion) render();
    } catch {
      // WebGL unavailable — canvas hidden gracefully
    }

    return () => {
      stopLoop();
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);
      globeRef.current?.destroy();
      globeRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    globeRef.current?.update({
      markers: pins.map((p) => ({
        location: [p.lat, p.lng] as [number, number],
        size: 0.04,
      })),
    });
  }, [pins]);

  return (
    <div className="flex flex-col items-center">
      {/* Wrapper mirrors cobe.vercel.app's demo: containment on the wrapper, plain canvas inside. */}
      <div
        style={{
          width: 'min(420px, 90vw)',
          aspectRatio: '1',
          contain: 'layout style',
          position: 'relative',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            touchAction: 'pan-y',
            cursor: 'grab',
          }}
        />
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-widest text-white/30">
        {t('home.globeCaption')}
      </p>
    </div>
  );
}
