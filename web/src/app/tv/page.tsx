"use client";

// SOT: tv-player, pairing-screen, offline-cache, adaptive-rendering
// WHAT:  the browser kiosk client: pairs with a 4-digit code, then plays the playlist.
// WHY:   the PRD's universal client — one build for Android TV, Tizen, webOS, browser.
// HOW:   HLS via hls.js (or native where available) with a start-level capped to the
//        measured link; images pick a width variant; the last payload is cached so a
//        connectivity drop keeps the loop running.
// WHERE: renditions come from the device payload built in src/lib/content.js

import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import {
  chooseImage, chooseMp4, estimateDownlinkKbps, hasNativeHls,
  startLevelBitrateCap, supportsWebp, type ImageVariant, type Mp4Variant,
} from "@/lib/adaptive";

interface PlaylistItem {
  media_id: string;
  name: string;
  type: "image" | "video" | "html";
  url: string;
  duration: number;
  hls_url: string | null;
  poster_url: string | null;
  mp4: Mp4Variant[] | null;
  images: ImageVariant[] | null;
}

interface Payload {
  screen: { id: string; name: string; orientation: string; branch: string | null; timezone: string };
  playlist: { id: string; name: string; items: PlaylistItem[] } | null;
  ticker: { id: string; text: string; position: "top" | "bottom"; speed: number; color: string; background: string } | null;
}

type Phase = "pairing" | "playing";
type Link = "online" | "cached" | "offline";

const LS = { device: "bc_device_id", token: "bc_device_token", payload: "bc_payload" };

export default function TvPlayer() {
  const [phase, setPhase] = useState<Phase>("pairing");
  const [code, setCode] = useState("----");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [index, setIndex] = useState(0);
  const [link, setLink] = useState<Link>("offline");
  const [quality, setQuality] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------- pairing ---------------- */
  const startPairing = useCallback(async () => {
    setPhase("pairing");
    const metadata = {
      resolution: `${window.screen.width}x${window.screen.height}`,
      orientation: window.screen.width >= window.screen.height ? "landscape" : "portrait",
      os_type: /Tizen/i.test(navigator.userAgent) ? "tizen"
        : /Web0S|LG/i.test(navigator.userAgent) ? "webos"
        : /Android/i.test(navigator.userAgent) ? "androidtv" : "web",
      app_version: "2.0.0",
    };
    try {
      const res = await fetch("/api/pairing/generate-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_id: deviceIdRef.current, metadata }),
      });
      const data: { code: string; expires_in_seconds: number } = await res.json();
      setCode(data.code);
      setSecondsLeft(data.expires_in_seconds);
    } catch {
      setCode("----");
      setTimeout(() => void startPairing(), 5000);
    }
  }, []);

  // device id is stable across reboots so a re-pair reuses the same identity
  useEffect(() => {
    let id = window.localStorage.getItem(LS.device);
    if (!id) {
      id = `dev_${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(LS.device, id);
    }
    deviceIdRef.current = id;
    tokenRef.current = window.localStorage.getItem(LS.token);

    const cached = window.localStorage.getItem(LS.payload);
    if (cached && tokenRef.current) {
      setPayload(JSON.parse(cached) as Payload);
      setPhase("playing");
      setLink("cached");
    }
    if (tokenRef.current) connect();
    else void startPairing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // countdown + claim polling while the code is on screen
  useEffect(() => {
    if (phase !== "playing" && secondsLeft <= 0 && code !== "----") { void startPairing(); return; }
    if (phase !== "pairing" || code === "----") return;

    const tick = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    const poll = setInterval(() => {
      void (async () => {
        const res = await fetch(
          `/api/pairing/status/${code}?device_id=${encodeURIComponent(deviceIdRef.current)}`,
        ).catch(() => null);
        if (!res || !res.ok) return;
        const data: { status: string; device_token?: string } = await res.json();
        if (data.status === "paired" && data.device_token) {
          window.localStorage.setItem(LS.token, data.device_token);
          tokenRef.current = data.device_token;
          clearInterval(poll);
          connect();
        }
      })();
    }, 2000);

    return () => { clearInterval(tick); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, code, secondsLeft]);

  /* ---------------- realtime session ---------------- */
  function connect() {
    const token = tokenRef.current;
    if (!token || wsRef.current) return;
    setPhase("playing");

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/device/session?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => setLink("online");
    ws.onmessage = (ev: MessageEvent<string>) => {
      const msg: { type: string; publish_id?: string; payload?: Payload } = JSON.parse(ev.data);
      if (msg.type === "content" && msg.payload) {
        window.localStorage.setItem(LS.payload, JSON.stringify(msg.payload));
        setPayload(msg.payload);
        setIndex(0);
        setLink("online");
        ws.send(JSON.stringify({ type: "ack", publish_id: msg.publish_id }));
      }
      if (msg.type === "unpaired") {
        window.localStorage.removeItem(LS.token);
        window.localStorage.removeItem(LS.payload);
        tokenRef.current = null;
        setPayload(null);
        ws.close();
        void startPairing();
      }
    };
    ws.onclose = () => {
      wsRef.current = null;
      if (!tokenRef.current) return;
      setLink("cached");
      setTimeout(connect, 4000);
    };
    ws.onerror = () => ws.close();

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "heartbeat",
          app_version: "2.0.0",
          resolution: `${window.screen.width}x${window.screen.height}`,
        }));
      } else clearInterval(heartbeat);
    }, 20000);
  }

  /* ---------------- playback ---------------- */
  const items = payload?.playlist?.items ?? [];
  const current = items.length ? items[index % items.length] : undefined;

  useEffect(() => {
    if (!current) return;
    if (advanceRef.current) clearTimeout(advanceRef.current);

    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && payload?.playlist) {
      ws.send(JSON.stringify({
        type: "play", media_id: current.media_id,
        playlist_id: payload.playlist.id, duration: current.duration,
      }));
    }

    const next = () => setIndex((i) => i + 1);

    if (current.type === "video") {
      const video = videoRef.current;
      if (!video) return;
      const downlink = estimateDownlinkKbps();

      hlsRef.current?.destroy();
      hlsRef.current = null;

      if (current.hls_url && hasNativeHls(video)) {
        video.src = current.hls_url;
        setQuality("HLS (native)");
      } else if (current.hls_url) {
        void (async () => {
          const { default: HlsCtor } = await import("hls.js");
          if (!HlsCtor.isSupported()) {
            const pick = chooseMp4(current.mp4 ?? [], window.screen.height, downlink);
            video.src = pick?.url ?? current.url;
            setQuality(pick ? `MP4 ${pick.height}p` : "MP4");
            return;
          }
          // Seed the estimator with the measured link so the first segment is not
          // the largest rung, and cap levels to the panel so a 720p screen never
          // fetches 1080p. startLevel -1 lets hls.js choose from the seeded estimate.
          const hls = new HlsCtor({
            abrEwmaDefaultEstimate: startLevelBitrateCap(downlink),
            abrBandWidthFactor: 0.9,
            maxBufferLength: 30,
            startLevel: -1,
            capLevelToPlayerSize: true,
          });
          hlsRef.current = hls;
          hls.attachMedia(video);
          hls.loadSource(current.hls_url!);
          hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data: { level: number }) => {
            const lvl = hls.levels[data.level];
            if (lvl) setQuality(`HLS ${lvl.height}p @ ${Math.round(lvl.bitrate / 1000)}k`);
          });
          void video.play().catch(() => undefined);
        })();
      } else {
        const pick = chooseMp4(current.mp4 ?? [], window.screen.height, downlink);
        video.src = pick?.url ?? current.url;
        setQuality(pick ? `MP4 ${pick.height}p` : "source");
      }

      video.currentTime = 0;
      void video.play().catch(() => undefined);
    } else {
      setQuality(current.images?.length ? "responsive image" : "source image");
    }

    advanceRef.current = setTimeout(next, Math.max(2, current.duration) * 1000);
    return () => { if (advanceRef.current) clearTimeout(advanceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, payload]);

  // periodic catch-up so a screen that missed a push still converges
  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        if (!tokenRef.current || link === "online") return;
        const res = await fetch("/api/device/content", {
          headers: { authorization: `Bearer ${tokenRef.current}` },
        }).catch(() => null);
        if (!res?.ok) return;
        const fresh: Payload = await res.json();
        window.localStorage.setItem(LS.payload, JSON.stringify(fresh));
        setPayload(fresh);
      })();
    }, 30000);
    return () => clearInterval(timer);
  }, [link]);

  /* ---------------- render ---------------- */
  if (phase === "pairing") {
    const mins = Math.max(0, Math.floor(secondsLeft / 60));
    const secs = Math.max(0, secondsLeft % 60);
    return (
      <main
        role="status"
        aria-live="polite"
        className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_50%_35%,#1e293b,#020617)] text-center"
      >
        <div>
          <p className="text-[2.2vw] font-bold uppercase tracking-[0.4em] text-sky-400">Brandcast TV</p>
          <p className="mx-auto mt-4 max-w-[52vw] text-[1.4vw] leading-relaxed text-slate-400">
            Enter this code in your Brandcast dashboard to pair this screen.
          </p>
          <p aria-label="Pairing code" className="my-[3vh] text-[15vw] font-extrabold leading-none tracking-[0.12em] text-white drop-shadow-[0_0_60px_rgba(56,189,248,0.55)]">
            {code}
          </p>
          <p aria-label="Time remaining" className="text-[1.8vw] tabular-nums text-amber-300">
            {mins}:{String(secs).padStart(2, "0")}
          </p>
        </div>
      </main>
    );
  }

  const tickerPos = payload?.ticker?.position === "top" ? "top-0" : "bottom-0";
  const imagePick = current?.images ? chooseImage(current.images, window.innerWidth, supportsWebp()) : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {items.length === 0 ? (
        <div className="grid h-full place-items-center text-[2vw] text-slate-500">
          No content assigned to this screen yet.
        </div>
      ) : null}

      {current?.type === "video" ? (
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          muted
          playsInline
          poster={current.poster_url ?? undefined}
          onEnded={() => setIndex((i) => i + 1)}
        />
      ) : current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imagePick?.url ?? current.url}
          alt={current.name}
          className="h-full w-full object-contain"
        />
      ) : null}

      {payload?.ticker ? (
        <div
          className={`absolute inset-x-0 ${tickerPos} flex h-[8vh] items-center overflow-hidden`}
          style={{ background: payload.ticker.background }}
        >
          <p
            className="whitespace-nowrap ps-[100vw] text-[4vh] font-semibold"
            style={{
              color: payload.ticker.color,
              animation: `bc-scroll ${Math.max(8, 6000 / (payload.ticker.speed || 60))}s linear infinite`,
            }}
          >
            {payload.ticker.text}
          </p>
        </div>
      ) : null}

      <div className="absolute end-[1.5vh] top-[1.5vh] flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/75 px-3 py-1 text-[1.4vh] text-slate-300">
        <span
          aria-hidden="true"
          className={`size-[1vh] rounded-full ${
            link === "online" ? "bg-emerald-400" : link === "cached" ? "bg-amber-400" : "bg-red-500"
          }`}
        />
        {link === "online" ? "Online" : link === "cached" ? "Offline · cached" : "Connecting"}
        {quality ? <span className="text-slate-500">· {quality}</span> : null}
      </div>

      <style>{`@keyframes bc-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }`}</style>
    </main>
  );
}
