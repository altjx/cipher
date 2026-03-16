import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsEventType } from '../api/client';
import { getApiBaseUrl } from '../api/client';

type Callback = (data: unknown) => void;

export interface UseWebSocketReturn {
  subscribe: (eventType: WsEventType, callback: Callback) => () => void;
  connectionState: 'connecting' | 'connected' | 'disconnected';
}

export function useWebSocket(): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const listenersRef = useRef<Map<string, Set<Callback>>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const mountedRef = useRef(true);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;

    const baseUrl = await getApiBaseUrl();
    let wsUrl: string;
    if (baseUrl) {
      wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws`;
    }
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setConnectionState('connecting');

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnectionState('connected');
      backoffRef.current = 1000;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const envelope = JSON.parse(event.data as string) as { type: string; data: unknown };
        const listeners = listenersRef.current.get(envelope.type);
        if (listeners) {
          listeners.forEach((cb) => cb(envelope.data));
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnectionState('disconnected');
      wsRef.current = null;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, 30000);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const subscribe = useCallback((eventType: WsEventType, callback: Callback): (() => void) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    const set = listenersRef.current.get(eventType)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        listenersRef.current.delete(eventType);
      }
    };
  }, []);

  return { subscribe, connectionState };
}
