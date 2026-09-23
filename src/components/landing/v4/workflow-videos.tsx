'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import './workflow-videos.css';

const SCENES = {
  conversation: {
    title: 'landingV4.motionInbox',
    detail: 'landingV4.videoConversation',
  },
  context: {
    title: 'landingV4.motionContext',
    detail: 'landingV4.motionGrounded',
  },
  permissions: {
    title: 'landingV4.motionPermissions',
    detail: 'landingV4.videoPermissions',
  },
  order: { title: 'landingV4.motionOrders', detail: 'landingV4.videoOrder' },
  results: {
    title: 'landingV4.motionResults',
    detail: 'landingV4.videoResults',
  },
} as const;

/** Text-free mascot films; labels remain live bilingual HTML. */
export function WorkflowVideo({ scene }: { scene: keyof typeof SCENES }) {
  return (
    <WorkflowVideoPlayer
      key={scene}
      scene={scene}
    />
  );
}

function WorkflowVideoPlayer({
  scene,
}: {
  scene: keyof typeof SCENES;
}) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const visible = useRef(false);
  const userPaused = useRef(false);
  const userStarted = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const content = SCENES[scene];
  const mediaPath = `/portada-b/workflow-mascot-${scene}`;

  useEffect(() => {
    const el = video.current;
    const container = root.current;
    if (!el || !container) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      if (
        !visible.current ||
        document.hidden ||
        (reduced.matches && !userStarted.current) ||
        userPaused.current
      ) {
        el.pause();
      } else if (!el.ended && el.getAttribute('src')) {
        void el.play().catch(() => {
          /* Autoplay blocked: the play control stays available. */
        });
      }
    };
    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reduced.matches) {
          setLoaded(true);
          near.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current =
          entry.isIntersecting && entry.intersectionRatio >= 0.35;
        sync();
      },
      { threshold: [0, 0.35] }
    );
    near.observe(container);
    observer.observe(container);
    el.addEventListener('canplay', sync);
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      near.disconnect();
      observer.disconnect();
      el.pause();
      el.removeEventListener('canplay', sync);
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  useEffect(() => {
    // preload="none" does not emit canplay just because React assigns src.
    // Start the first fetch explicitly when a visible clip becomes eligible.
    if (
      loaded &&
      visible.current &&
      !document.hidden &&
      !userPaused.current &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      void video.current?.play().catch(() => setPlaying(false));
    }
  }, [loaded]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (!el.paused) {
      userPaused.current = true;
      el.pause();
      return;
    }
    userPaused.current = false;
    userStarted.current = true;
    if (!loaded) {
      // Explicit playback also works with reduced motion enabled.
      el.src = `${mediaPath}.mp4`;
      setLoaded(true);
    }
    if (el.ended) el.currentTime = 0;
    void el.play().catch(() => setPlaying(false));
  };
  const label = playing
    ? 'landingV4.videoPause'
    : ended
      ? 'landingV4.motionReplay'
      : 'landingV4.videoPlay';

  return (
    <figure ref={root} className="rz-film" data-workflow-video={scene}>
      <div className="rz-film-stage">
        <video
          ref={video}
          src={loaded ? `${mediaPath}.mp4` : undefined}
          poster={`${mediaPath}.jpg`}
          muted
          playsInline
          preload="none"
          width={960}
          height={720}
          aria-label={t(content.title)}
          onPlay={() => {
            setPlaying(true);
            setEnded(false);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setEnded(true);
          }}
          onError={() => {
            setFailed(true);
            setPlaying(false);
          }}
        />
        {!failed && (
          <button
            type="button"
            onClick={toggle}
            className="rz-film-control"
            aria-label={t(label)}
            title={t(label)}
          >
            {playing ? (
              <Pause size={16} />
            ) : ended ? (
              <RotateCcw size={16} />
            ) : (
              <Play size={16} />
            )}
          </button>
        )}
      </div>
      <figcaption className="rz-film-caption">
        <span className="sr-only">{t(content.title)}. {t(content.detail)}</span>
        <span className="rz-film-note">{t('landingV4.mascotIllustration')}</span>
      </figcaption>
    </figure>
  );
}

export function ConversationDemo() {
  return <WorkflowVideo scene="conversation" />;
}
export function ContextDemo() {
  return <WorkflowVideo scene="context" />;
}
export function PermissionsDemo() {
  return <WorkflowVideo scene="permissions" />;
}
export function OrderDemo() {
  return <WorkflowVideo scene="order" />;
}
export function ResultsDemo() {
  return <WorkflowVideo scene="results" />;
}
