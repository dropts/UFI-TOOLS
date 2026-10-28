/*
 * WebSocket 推送通道
 * 页面只保留一条 /api/ws 连接，按 topic 订阅，服务端主动下发；
 * 连接不可用时由各业务模块回落到原有 HTTP 轮询（available() / isConnected()）。
 */
(() => {
    const RETRY_MIN = 1000;
    const RETRY_MAX = 8000;

    const state = {
        ws: null,
        connected: false,
        connecting: false,
        retry: 0,
        retryTimer: null,
        pingTimer: null,
        cookie: '',
        slot: 0,
        subs: new Map(),      // topic -> Set<fn>
        latest: new Map(),    // topic -> 最后一次数据
        listeners: new Set(), // (connected:boolean) => void
        paused: false,
    };

    const supported = typeof window.WebSocket === 'function';

    const wsUrl = () => {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const q = [];
        if (state.cookie) q.push('cookie=' + encodeURIComponent(state.cookie));
        q.push('slot=' + (state.slot || 0));
        return `${proto}//${location.host}/api/ws?${q.join('&')}`;
    };

    const activeTopics = () => {
        const out = [];
        state.subs.forEach((set, topic) => { if (set.size > 0) out.push(topic); });
        return out;
    };

    const send = (obj) => {
        if (!state.connected || !state.ws || state.ws.readyState !== 1) return false;
        try { state.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
    };

    const syncSubs = () => {
        const topics = activeTopics();
        if (!state.connected) return;
        if (!topics.length) return;
        send({ op: 'sub', topics, cookie: state.cookie, slot: state.slot });
    };

    const emitState = () => {
        state.listeners.forEach((fn) => {
            try { fn(state.connected); } catch (e) { console.error('ws state cb error', e); }
        });
    };

    const dispatch = (topic, data) => {
        state.latest.set(topic, data);
        const set = state.subs.get(topic);
        if (!set) return;
        set.forEach((fn) => {
            try { fn(data); } catch (e) { console.error('ws handler error [' + topic + ']', e); }
        });
    };

    const onMessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg || !msg.type) return;
        if (msg.type === 'hello' || msg.type === 'subscribed' || msg.type === 'pong') return;
        dispatch(msg.type, msg.data);
    };

    const startPing = () => {
        stopPing();
        state.pingTimer = setInterval(() => send({ op: 'ping' }), 20000);
    };
    const stopPing = () => {
        state.pingTimer && clearInterval(state.pingTimer);
        state.pingTimer = null;
    };

    const scheduleRetry = () => {
        if (state.retryTimer || state.paused || !supported) return;
        const delay = Math.min(RETRY_MIN * Math.pow(1.6, state.retry), RETRY_MAX);
        state.retry += 1;
        state.retryTimer = setTimeout(() => {
            state.retryTimer = null;
            connect();
        }, delay);
    };

    function connect() {
        if (!supported || state.connecting || state.connected) return;
        if (state.paused) return;
        state.connecting = true;
        let ws;
        try {
            ws = new WebSocket(wsUrl());
        } catch (e) {
            state.connecting = false;
            scheduleRetry();
            return;
        }
        state.ws = ws;

        ws.onopen = () => {
            state.connecting = false;
            state.connected = true;
            state.retry = 0;
            syncSubs();
            startPing();
            emitState();
        };
        ws.onmessage = onMessage;
        ws.onerror = () => { /* 交给 onclose 统一处理 */ };
        ws.onclose = () => {
            const wasConnected = state.connected;
            state.connected = false;
            state.connecting = false;
            stopPing();
            if (wasConnected) emitState();
            scheduleRetry();
        };
    }

    const close = () => {
        state.retryTimer && clearTimeout(state.retryTimer);
        state.retryTimer = null;
        stopPing();
        if (state.ws) {
            try { state.ws.close(); } catch { /* ignore */ }
        }
        state.ws = null;
        state.connected = false;
        state.connecting = false;
    };

    const KanoWS = {
        available: () => supported,
        isConnected: () => state.connected,
        latest: (topic) => state.latest.get(topic),

        setCookie(cookie) {
            const next = cookie || '';
            if (next === state.cookie) return;
            state.cookie = next;
            // 服务端会在收到任意帧时更新 cookie，这里只需同步一次订阅即可，不必重连
            syncSubs();
        },

        setSlot(slot) {
            const next = Number(slot) || 0;
            if (next === state.slot) return;
            state.slot = next;
            if (state.connected) syncSubs();
        },

        /** 订阅 topic，返回取消订阅函数 */
        subscribe(topic, fn) {
            if (!state.subs.has(topic)) state.subs.set(topic, new Set());
            state.subs.get(topic).add(fn);
            if (state.paused) {
                // 页面在后台，恢复可见时统一订阅
            } else if (state.connected) {
                send({ op: 'sub', topics: [topic], cookie: state.cookie, slot: state.slot });
            } else {
                connect();
            }
            return () => KanoWS.unsubscribe(topic, fn);
        },

        unsubscribe(topic, fn) {
            const set = state.subs.get(topic);
            if (!set) return;
            if (fn) set.delete(fn); else set.clear();
            if (set.size === 0) {
                send({ op: 'unsub', topics: [topic] });
            }
        },

        /** 连接状态变化回调，返回取消函数 */
        onState(fn) {
            state.listeners.add(fn);
            return () => state.listeners.delete(fn);
        },
    };

    // 页面切到后台就退订，避免白白消耗设备算力；回到前台自动恢复
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            state.paused = true;
            close();
            emitState();
        } else {
            state.paused = false;
            state.retry = 0;
            connect();
        }
    });

    window.addEventListener('online', () => { state.paused = false; state.retry = 0; connect(); });
    window.addEventListener('offline', () => close());

    window.KanoWS = KanoWS;
})();
