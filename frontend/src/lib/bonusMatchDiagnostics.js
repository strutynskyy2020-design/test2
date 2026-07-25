const STORAGE_KEY = "tm6_bonus_match_diagnostics_v87";
const MAX_EVENTS = 1200;
const MAX_PERSISTED = 420;
const WATCH_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 1000;

const nowIso = () => new Date().toISOString();
const perfNow = () => (typeof performance !== "undefined" ? Math.round(performance.now()) : null);

const safeValue = (value, depth = 0, seen = new WeakSet()) => {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (depth > 6) return "[MaxDepth]";

  if (typeof Element !== "undefined" && value instanceof Element) {
    const rect = value.getBoundingClientRect();
    return {
      tag: value.tagName,
      id: value.id || null,
      className: typeof value.className === "string" ? value.className.slice(0, 400) : null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }

  if (typeof Error !== "undefined" && value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
      cause: value.cause ? safeValue(value.cause, depth + 1, seen) : null,
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 160).map((item) => safeValue(item, depth + 1, seen));
    const output = {};
    Object.entries(value).slice(0, 220).forEach(([key, item]) => {
      try {
        output[key] = safeValue(item, depth + 1, seen);
      } catch (error) {
        output[key] = `[Unserializable: ${error?.message || "unknown"}]`;
      }
    });
    return output;
  }

  return String(value);
};

const parseColor = (color) => {
  const match = String(color || "").match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] == null ? 1 : Number(match[4]),
  };
};

const isNearlyWhite = (color) => {
  const parsed = parseColor(color);
  return Boolean(parsed && parsed.a > 0.62 && parsed.r > 236 && parsed.g > 236 && parsed.b > 236);
};

const sanitizeUrl = (rawUrl) => {
  try {
    const url = new URL(String(rawUrl || ""), typeof location !== "undefined" ? location.href : "https://local.invalid");
    const keys = [...url.searchParams.keys()];
    return `${url.origin}${url.pathname}${keys.length ? `?${keys.map((key) => `${encodeURIComponent(key)}=<redacted>`).join("&")}` : ""}`;
  } catch (_) {
    return String(rawUrl || "").slice(0, 800);
  }
};

const boardHash = (board) => (board || []).map((row) => (row || []).map((cell) => {
  if (!cell) return "_";
  if (cell.void) return "#";
  return `${cell.symbol || "-"}:${cell.special || "-"}:${cell.obstacle || "-"}:${cell.obstacle_hits || 0}:${cell.id || "-"}`;
}).join("|")).join("/");

const compactBoard = (board) => (board || []).map((row) => (row || []).map((cell) => {
  if (!cell) return null;
  return {
    id: cell.id || null,
    symbol: cell.symbol || null,
    special: cell.special || null,
    obstacle: cell.obstacle || null,
    hits: cell.obstacle_hits || 0,
    age: cell.obstacle_age || 0,
    void: Boolean(cell.void),
  };
}));

const resourceSnapshot = () => {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return [];
  return performance.getEntriesByType("resource").slice(-50).map((entry) => ({
    name: sanitizeUrl(entry.name),
    initiatorType: entry.initiatorType,
    duration: Math.round(entry.duration),
    transferSize: entry.transferSize || 0,
    encodedBodySize: entry.encodedBodySize || 0,
    decodedBodySize: entry.decodedBodySize || 0,
    startTime: Math.round(entry.startTime || 0),
  }));
};

const browserSnapshot = () => ({
  href: typeof location !== "undefined" ? sanitizeUrl(location.href) : null,
  userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  platform: typeof navigator !== "undefined" ? navigator.platform : null,
  online: typeof navigator !== "undefined" ? navigator.onLine : null,
  visibility: typeof document !== "undefined" ? document.visibilityState : null,
  serviceWorker: typeof navigator !== "undefined" ? navigator.serviceWorker?.controller?.scriptURL || null : null,
  viewport: typeof window !== "undefined" ? {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  } : null,
  fonts: typeof document !== "undefined" && document.fonts ? document.fonts.status : null,
  memory: typeof performance !== "undefined" && performance.memory ? {
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
  } : null,
});

const styleSnapshot = (element, pseudo = null) => {
  if (!element || typeof getComputedStyle === "undefined") return null;
  try {
    const style = getComputedStyle(element, pseudo);
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      id: element.id || null,
      className: typeof element.className === "string" ? element.className.slice(0, 500) : null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      zIndex: style.zIndex,
      position: style.position,
      overflow: style.overflow,
      pointerEvents: style.pointerEvents,
      transform: style.transform,
      filter: style.filter,
      backdropFilter: style.backdropFilter,
      mixBlendMode: style.mixBlendMode,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      content: pseudo ? style.content : undefined,
      color: style.color,
    };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
};

const canvasSnapshot = (canvas) => {
  const result = {
    width: canvas.width,
    height: canvas.height,
    clientWidth: canvas.clientWidth,
    clientHeight: canvas.clientHeight,
    style: styleSnapshot(canvas),
    pixelSamples: [],
  };

  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height) return result;
    const points = [
      [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
      [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
      [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
    ];
    result.pixelSamples = points.map(([px, py]) => {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(canvas.width * px)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(canvas.height * py)));
      const data = context.getImageData(x, y, 1, 1).data;
      return { x, y, rgba: [...data] };
    });
  } catch (error) {
    result.pixelReadError = error?.message || String(error);
  }
  return result;
};

const summarizeState = (state = {}) => {
  const board = state.displayBoard || state.board || [];
  return {
    gameId: state.gameId || null,
    level: state.level ?? null,
    gameStatus: state.gameStatus || null,
    movesLeft: state.movesLeft ?? null,
    score: state.score ?? null,
    visualPieceCount: state.visualPieceCount ?? null,
    moving: Boolean(state.moving),
    selected: state.selected || null,
    activeBooster: state.activeBooster || null,
    combo: state.combo ?? null,
    boardFx: state.boardFx || null,
    flash: state.flash || null,
    cascadeMotion: state.cascadeMotion || null,
    removingCount: state.removingCount ?? null,
    spawnedCount: state.spawnedCount ?? null,
    activatedCount: state.activatedCount ?? null,
    specialEffectCount: state.specialEffectCount ?? null,
    artworkReady: Boolean(state.artworkReady),
    artworkFailed: Boolean(state.artworkFailed),
    boardHash: boardHash(board),
    board: compactBoard(board),
  };
};

class BonusMatchDiagnostics {
  constructor() {
    this.version = "v87";
    this.events = [];
    this.sessionId = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.installed = false;
    this.watchTimer = null;
    this.stateProvider = null;
    this.boardProvider = null;
    this.boardObserver = null;
    this.lastWhiteSignature = null;
    this.lastHeartbeatAt = 0;
    this.lastPersistAt = 0;
    this.originalFetch = null;
    this.originalXhrOpen = null;
    this.originalXhrSend = null;
    this.originalConsoleError = null;
    this.originalConsoleWarn = null;
    this.performanceObserver = null;
    this.boundError = null;
    this.boundRejection = null;
    this.boundOnline = null;
    this.boundOffline = null;
    this.boundVisibility = null;
    this.boundSecurityPolicy = null;
    this.restore();
    this.exposeGlobalApi();
  }

  exposeGlobalApi() {
    if (typeof window === "undefined") return;
    window.__TM6_BONUS_DIAGNOSTICS__ = {
      version: this.version,
      download: (extra) => this.download(extra),
      copy: (extra) => this.copy(extra),
      snapshot: (reason = "console_snapshot") => this.captureWatchdog(reason, true),
      clear: () => this.clear(),
      report: () => this.buildReport({ source: "console" }),
      events: () => this.events.slice(),
      summary: () => this.getSummary(),
    };
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.events)) this.events = parsed.events.slice(-MAX_PERSISTED);
    } catch (_) {
      // Diagnostics must never break the game.
    }
  }

  persist(force = false) {
    const now = Date.now();
    if (!force && now - this.lastPersistAt < 700) return;
    this.lastPersistAt = now;
    const payload = JSON.stringify({
      version: this.version,
      sessionId: this.sessionId,
      updatedAt: nowIso(),
      events: this.events.slice(-MAX_PERSISTED),
    });
    try { sessionStorage.setItem(STORAGE_KEY, payload); } catch (_) {}
    try { localStorage.setItem(STORAGE_KEY, payload); } catch (_) {}
  }

  log(type, data = {}, level = "info") {
    const event = {
      seq: this.events.length ? Number(this.events[this.events.length - 1].seq || 0) + 1 : 1,
      at: nowIso(),
      perfMs: perfNow(),
      type,
      level,
      data: safeValue(data),
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.persist(level === "error" || type.includes("white_board") || type.includes("mismatch") || type.includes("crash"));
    if (level === "error") {
      try { window.dispatchEvent(new CustomEvent("bonusmatch:diagnostic-alert", { detail: event })); } catch (_) {}
    }
    return event;
  }

  installGlobalHandlers() {
    if (this.installed || typeof window === "undefined") return () => {};
    this.installed = true;

    this.boundError = (event) => {
      const target = event.target;
      const resourceElement = target && target !== window && target instanceof Element;
      if (resourceElement) {
        this.log("resource_load_error", {
          target: styleSnapshot(target),
          src: sanitizeUrl(target.currentSrc || target.src || target.href || target.data || ""),
          outerHTML: target.outerHTML?.slice(0, 3000) || null,
          browser: browserSnapshot(),
        }, "error");
        return;
      }
      this.log("window_error", {
        message: event.message,
        filename: sanitizeUrl(event.filename),
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
        browser: browserSnapshot(),
      }, "error");
    };

    this.boundRejection = (event) => this.log("unhandled_rejection", {
      reason: event.reason,
      browser: browserSnapshot(),
    }, "error");
    this.boundOnline = () => this.log("network_online", browserSnapshot());
    this.boundOffline = () => this.log("network_offline", browserSnapshot(), "warn");
    this.boundVisibility = () => this.log("visibility_changed", browserSnapshot());
    this.boundSecurityPolicy = (event) => this.log("security_policy_violation", {
      blockedURI: sanitizeUrl(event.blockedURI),
      violatedDirective: event.violatedDirective,
      effectiveDirective: event.effectiveDirective,
      sourceFile: sanitizeUrl(event.sourceFile),
      lineNumber: event.lineNumber,
      columnNumber: event.columnNumber,
    }, "error");

    window.addEventListener("error", this.boundError, true);
    window.addEventListener("unhandledrejection", this.boundRejection);
    window.addEventListener("online", this.boundOnline);
    window.addEventListener("offline", this.boundOffline);
    document.addEventListener("visibilitychange", this.boundVisibility);
    document.addEventListener("securitypolicyviolation", this.boundSecurityPolicy);

    this.installFetchInstrumentation();
    this.installXhrInstrumentation();
    this.installConsoleInstrumentation();
    this.installPerformanceObserver();

    this.log("diagnostics_installed", browserSnapshot());
    return () => this.uninstallGlobalHandlers();
  }

  installFetchInstrumentation() {
    if (typeof window.fetch !== "function" || this.originalFetch) return;
    this.originalFetch = window.fetch;
    const diagnostics = this;
    window.fetch = async function instrumentedFetch(input, init = {}) {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const url = sanitizeUrl(typeof input === "string" ? input : input?.url);
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      diagnostics.log("fetch_started", { method, url });
      try {
        const response = await diagnostics.originalFetch.apply(this, arguments);
        diagnostics.log("fetch_finished", {
          method,
          url,
          status: response.status,
          ok: response.ok,
          type: response.type,
          redirected: response.redirected,
          contentType: response.headers?.get?.("content-type") || null,
          elapsedMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
        }, response.ok ? "info" : "warn");
        return response;
      } catch (error) {
        diagnostics.log("fetch_failed", {
          method,
          url,
          elapsedMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
          error,
        }, "error");
        throw error;
      }
    };
  }

  installXhrInstrumentation() {
    if (typeof XMLHttpRequest === "undefined" || this.originalXhrOpen) return;
    const diagnostics = this;
    this.originalXhrOpen = XMLHttpRequest.prototype.open;
    this.originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function instrumentedOpen(method, url) {
      this.__tm6BonusDiagnostic = {
        method: String(method || "GET").toUpperCase(),
        url: sanitizeUrl(url),
      };
      return diagnostics.originalXhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function instrumentedSend() {
      const meta = this.__tm6BonusDiagnostic || { method: "GET", url: "unknown" };
      meta.startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      diagnostics.log("xhr_started", meta);
      const finalize = () => {
        diagnostics.log("xhr_finished", {
          ...meta,
          status: this.status,
          statusText: this.statusText,
          responseType: this.responseType,
          contentType: this.getResponseHeader?.("content-type") || null,
          elapsedMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - meta.startedAt),
        }, this.status >= 200 && this.status < 400 ? "info" : "error");
      };
      this.addEventListener("loadend", finalize, { once: true });
      return diagnostics.originalXhrSend.apply(this, arguments);
    };
  }

  installConsoleInstrumentation() {
    if (typeof console === "undefined" || this.originalConsoleError) return;
    const diagnostics = this;
    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;
    console.error = function instrumentedConsoleError() {
      diagnostics.log("console_error", { arguments: [...arguments] }, "error");
      return diagnostics.originalConsoleError.apply(this, arguments);
    };
    console.warn = function instrumentedConsoleWarn() {
      diagnostics.log("console_warn", { arguments: [...arguments] }, "warn");
      return diagnostics.originalConsoleWarn.apply(this, arguments);
    };
  }

  installPerformanceObserver() {
    if (typeof PerformanceObserver === "undefined" || this.performanceObserver) return;
    try {
      this.performanceObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.entryType === "longtask" && entry.duration >= 80) {
            this.log("long_task", { duration: Math.round(entry.duration), startTime: Math.round(entry.startTime) }, "warn");
          }
        });
      });
      this.performanceObserver.observe({ entryTypes: ["longtask"] });
    } catch (_) {
      this.performanceObserver = null;
    }
  }

  uninstallGlobalHandlers() {
    if (!this.installed || typeof window === "undefined") return;
    window.removeEventListener("error", this.boundError, true);
    window.removeEventListener("unhandledrejection", this.boundRejection);
    window.removeEventListener("online", this.boundOnline);
    window.removeEventListener("offline", this.boundOffline);
    document.removeEventListener("visibilitychange", this.boundVisibility);
    document.removeEventListener("securitypolicyviolation", this.boundSecurityPolicy);

    if (this.originalFetch) window.fetch = this.originalFetch;
    if (this.originalXhrOpen) XMLHttpRequest.prototype.open = this.originalXhrOpen;
    if (this.originalXhrSend) XMLHttpRequest.prototype.send = this.originalXhrSend;
    if (this.originalConsoleError) console.error = this.originalConsoleError;
    if (this.originalConsoleWarn) console.warn = this.originalConsoleWarn;
    this.performanceObserver?.disconnect?.();

    this.originalFetch = null;
    this.originalXhrOpen = null;
    this.originalXhrSend = null;
    this.originalConsoleError = null;
    this.originalConsoleWarn = null;
    this.performanceObserver = null;
    this.installed = false;
  }

  startWatch({ getState, getBoard }) {
    this.stopWatch();
    this.stateProvider = getState;
    this.boardProvider = getBoard;
    this.attachBoardObserver();
    this.watchTimer = window.setInterval(() => this.captureWatchdog(), WATCH_INTERVAL_MS);
    this.captureWatchdog("watch_started", true);
  }

  attachBoardObserver() {
    this.boardObserver?.disconnect?.();
    this.boardObserver = null;
    const board = this.boardProvider?.();
    if (!board || typeof MutationObserver === "undefined") return;
    this.boardObserver = new MutationObserver((mutations) => {
      const childMutations = mutations.filter((mutation) => mutation.type === "childList");
      const attributeMutations = mutations.filter((mutation) => mutation.type === "attributes");
      const added = childMutations.flatMap((mutation) => [...mutation.addedNodes]).filter((node) => node.nodeType === 1);
      const removed = childMutations.flatMap((mutation) => [...mutation.removedNodes]).filter((node) => node.nodeType === 1);
      if (!added.length && !removed.length && !attributeMutations.length) return;
      this.log("board_dom_mutation", {
        added: added.slice(0, 20).map((node) => ({ tag: node.tagName, className: node.className, outerHTML: node.outerHTML?.slice(0, 1200) })),
        removed: removed.slice(0, 20).map((node) => ({ tag: node.tagName, className: node.className, outerHTML: node.outerHTML?.slice(0, 1200) })),
        attributes: attributeMutations.slice(0, 20).map((mutation) => ({
          attributeName: mutation.attributeName,
          target: styleSnapshot(mutation.target),
        })),
      });
    });
    this.boardObserver.observe(board, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "href", "data", "class", "hidden"],
    });
  }

  stopWatch() {
    if (this.watchTimer) window.clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.boardObserver?.disconnect?.();
    this.boardObserver = null;
    this.stateProvider = null;
    this.boardProvider = null;
  }

  inspectBoard(boardElement) {
    if (!boardElement || typeof getComputedStyle === "undefined") return { exists: false };
    const rect = boardElement.getBoundingClientRect();
    const samplePoints = [
      [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
      [0.08, 0.5], [0.5, 0.5], [0.92, 0.5],
      [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
    ];

    const pointStacks = typeof document.elementsFromPoint === "function"
      ? samplePoints.map(([px, py]) => {
        const x = rect.left + rect.width * px;
        const y = rect.top + rect.height * py;
        return {
          point: { x, y, px, py },
          elements: document.elementsFromPoint(x, y).slice(0, 14).map((element) => styleSnapshot(element)),
        };
      })
      : [];

    const descendants = [...boardElement.querySelectorAll("*")];
    const largeDescendants = descendants.map((element) => {
      const elementRect = element.getBoundingClientRect();
      if (elementRect.width < rect.width * 0.68 || elementRect.height < rect.height * 0.68) return null;
      return {
        ...styleSnapshot(element),
        before: styleSnapshot(element, "::before"),
        after: styleSnapshot(element, "::after"),
        outerHTML: element.outerHTML?.slice(0, 2500) || null,
      };
    }).filter(Boolean).slice(0, 30);

    const pieceElements = [...boardElement.querySelectorAll("[data-bonus-piece]")];
    const pieceSamples = pieceElements.slice(0, 18).map((element) => ({
      ...styleSnapshot(element),
      pieceId: element.getAttribute("data-bonus-piece"),
      symbol: element.getAttribute("data-piece-symbol"),
      parent: styleSnapshot(element.parentElement),
    }));

    const visiblePieceCount = pieceElements.filter((element) => {
      const style = getComputedStyle(element);
      const pieceRect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.03 && pieceRect.width > 1 && pieceRect.height > 1;
    }).length;

    const animations = typeof boardElement.getAnimations === "function"
      ? boardElement.getAnimations({ subtree: true }).slice(0, 80).map((animation) => {
        const target = animation.effect?.target;
        return {
          playState: animation.playState,
          currentTime: animation.currentTime,
          startTime: animation.startTime,
          playbackRate: animation.playbackRate,
          target: target ? styleSnapshot(target) : null,
        };
      })
      : [];

    const whiteCandidates = [
      styleSnapshot(boardElement),
      ...largeDescendants,
      ...pointStacks.flatMap((stack) => stack.elements),
    ].filter((item) => item && (isNearlyWhite(item.backgroundColor) || /url\(/i.test(item.backgroundImage || "") && item.tag === "IMG"));

    const canvases = [...boardElement.querySelectorAll("canvas")].map(canvasSnapshot);
    const runawayCanvases = canvases.filter((canvas) => (
      Number(canvas.width || 0) > 8192
      || Number(canvas.height || 0) > 8192
      || Number(canvas.clientWidth || 0) > Math.max(2048, rect.width * 2)
      || Number(canvas.clientHeight || 0) > Math.max(2048, rect.height * 2)
    ));

    return {
      exists: true,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      board: {
        ...styleSnapshot(boardElement),
        before: styleSnapshot(boardElement, "::before"),
        after: styleSnapshot(boardElement, "::after"),
        outerHTML: boardElement.outerHTML?.slice(0, 12000) || null,
      },
      childCount: boardElement.childElementCount,
      descendantCount: descendants.length,
      pieceNodes: pieceElements.length,
      visiblePieceCount,
      pieceSamples,
      replacedElements: [...boardElement.querySelectorAll("img,picture,object,embed,iframe,video")].slice(0, 30).map((element) => ({
        ...styleSnapshot(element),
        src: sanitizeUrl(element.currentSrc || element.src || element.data || ""),
        outerHTML: element.outerHTML?.slice(0, 2500) || null,
      })),
      canvases,
      runawayCanvases,
      pointStacks,
      largeDescendants,
      whiteCandidates: whiteCandidates.slice(0, 30),
      animations,
    };
  }

  captureWatchdog(reason = "watch_tick", forceLog = false) {
    try {
      const state = this.stateProvider?.() || {};
      const boardElement = this.boardProvider?.() || null;
      const stateSummary = summarizeState(state);
      const boardInfo = this.inspectBoard(boardElement);
      const expectedPieces = Number(stateSummary.visualPieceCount || 0);
      const actualPieces = Number(boardInfo.pieceNodes || 0);
      const visiblePieces = Number(boardInfo.visiblePieceCount || 0);
      const suspiciousWhite = boardInfo.whiteCandidates?.length > 0;
      const runawayCanvas = boardInfo.runawayCanvases?.length > 0;
      const missingPieces = expectedPieces > 0 && actualPieces === 0;
      const hiddenPieces = expectedPieces > 0 && actualPieces > 0 && visiblePieces === 0;
      const signature = suspiciousWhite
        ? JSON.stringify(boardInfo.whiteCandidates.map((item) => [item.tag, item.className, item.backgroundColor, item.backgroundImage, item.rect]))
        : null;

      if (runawayCanvas) {
        this.log("effects_canvas_size_runaway", {
          reason,
          state: stateSummary,
          boardRect: boardInfo.rect,
          canvases: boardInfo.runawayCanvases,
          browser: browserSnapshot(),
        }, "error");
      } else if (suspiciousWhite && signature !== this.lastWhiteSignature) {
        this.lastWhiteSignature = signature;
        this.log("white_board_candidate_detected", {
          reason,
          state: stateSummary,
          board: boardInfo,
          resources: resourceSnapshot(),
          browser: browserSnapshot(),
        }, "error");
      } else if (missingPieces) {
        this.log("piece_dom_missing", { reason, state: stateSummary, board: boardInfo }, "error");
      } else if (hiddenPieces) {
        this.log("piece_dom_hidden", { reason, state: stateSummary, board: boardInfo }, "error");
      }

      const now = Date.now();
      if (forceLog || reason !== "watch_tick" || now - this.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        this.lastHeartbeatAt = now;
        this.log(reason === "watch_tick" ? "watch_heartbeat" : reason, {
          state: stateSummary,
          board: boardInfo,
          resources: forceLog ? resourceSnapshot() : undefined,
          browser: forceLog ? browserSnapshot() : undefined,
        });
      }
      return { state: stateSummary, board: boardInfo };
    } catch (error) {
      this.log("watchdog_failure", { error }, "error");
      return null;
    }
  }

  snapshot(type, state = {}, includeResources = false) {
    const payload = {
      state: summarizeState(state),
      browser: browserSnapshot(),
    };
    if (includeResources) payload.resources = resourceSnapshot();
    return this.log(type, payload);
  }

  reactError(error, info) {
    this.log("react_error_boundary", {
      error,
      componentStack: info?.componentStack || null,
      browser: browserSnapshot(),
      resources: resourceSnapshot(),
    }, "error");
  }

  clear() {
    this.events = [];
    this.lastWhiteSignature = null;
    this.lastHeartbeatAt = 0;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    this.log("diagnostics_cleared");
  }

  getSummary() {
    const errors = this.events.filter((event) => event.level === "error");
    return {
      version: this.version,
      sessionId: this.sessionId,
      eventCount: this.events.length,
      errorCount: errors.length,
      lastEvent: this.events.at(-1) || null,
      lastError: errors.at(-1) || null,
    };
  }

  buildReport(extra = {}) {
    let liveCapture = null;
    try {
      liveCapture = this.captureWatchdog("report_generated", true);
    } catch (_) {}
    return {
      schema: "tm6-bonus-match-diagnostics/2",
      generatedAt: nowIso(),
      version: this.version,
      sessionId: this.sessionId,
      browser: browserSnapshot(),
      liveCapture,
      resources: resourceSnapshot(),
      extra: safeValue(extra),
      events: this.events.slice(),
    };
  }

  download(extra = {}) {
    const report = this.buildReport(extra);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bonus-match-diagnostics-v87-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.log("diagnostics_downloaded", { eventCount: report.events.length });
  }

  async copy(extra = {}) {
    const report = this.buildReport(extra);
    const text = JSON.stringify(report, null, 2);
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable");
    await navigator.clipboard.writeText(text);
    this.log("diagnostics_copied", { eventCount: report.events.length });
  }
}

export const bonusMatchDiagnostics = new BonusMatchDiagnostics();
export { compactBoard, boardHash, browserSnapshot, resourceSnapshot };
