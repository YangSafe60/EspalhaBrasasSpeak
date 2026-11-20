import { useEffect, useRef } from "react";
import { getAccessToken, refreshAccessToken, wsProtocols, wsUrl } from "../api/client";
import { useAppStore } from "../store/appStore";
import type { WsEvent } from "../types";

export function useWebSocket(enabled: boolean) {
  const applyWsEvent = useAppStore((s) => s.applyWsEvent);
  const userId = useAppStore((s) => s.user?.id);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;

    let cancelled = false;

    const connect = () => {
      const token = getAccessToken();
      if (!token || cancelled) return;
      const ws = new WebSocket(wsUrl(), wsProtocols(token));
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        retryRef.current = 0;
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as WsEvent;
          applyWsEvent(data);
        } catch {
          /* ignore malformed */
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (cancelled) return;
        // Refused before opening: most likely an expired access token.
        if (!opened) void refreshAccessToken();
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, userId, applyWsEvent]);
}
