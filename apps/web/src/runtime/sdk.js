/*
 * Sofra frame SDK. Runs inside the sandboxed tool frame as the first script of the
 * document and defines the global `sofra` (API: docs/ARCHITECTURE.md).
 *
 * Plain browser JavaScript without dependencies. The host embeds this file as text
 * (srcdoc.ts), so it must stay self-contained and must never contain the character
 * sequences that end a script element or open an HTML comment. Tests evaluate it with
 * `new Function("window", source)` against a fake window.
 *
 * Nothing in here is a security boundary: tool code shares this realm and can undo any of
 * it. The boundary is the sandbox attribute, the CSP and the host's validation. This file
 * provides the API and makes common mistakes in generated code harmless.
 */
(function (window) {
  "use strict";

  var document = window.document;
  var host = window.parent;
  var NONCE = "__SOFRA_NONCE__";
  var MAX_KEY_LENGTH = 200;
  var MAX_VALUE_BYTES = 65536;
  var MAX_FRAME_HEIGHT = 4000;
  var MAX_QUEUE = 500;
  var MAX_ERRORS = 30;

  // The nonce lives only in this closure: remove the element that carried the source.
  try {
    var self = document.currentScript;
    if (self && self.parentNode) self.parentNode.removeChild(self);
  } catch (e) {}

  var stringify = JSON.stringify;
  var parse = JSON.parse;

  function clone(value) {
    return value === undefined ? undefined : parse(stringify(value));
  }

  function byteLength(text) {
    try {
      return new window.TextEncoder().encode(text).length;
    } catch (e) {
      return text.length * 3;
    }
  }

  // ---------------------------------------------------------------- transport

  var port = null;
  var queue = [];

  function send(message) {
    if (port) port.postMessage(message);
    else if (queue.length < MAX_QUEUE) queue.push(message);
  }

  var errorCount = 0;
  var lastError = "";

  function report(message) {
    var text = String(message).slice(0, 500);
    if (!text || text === lastError || errorCount >= MAX_ERRORS) return;
    lastError = text;
    errorCount++;
    send({ type: "sofra:error", message: text });
  }

  function guarded(fn, a) {
    try {
      fn(a);
    } catch (error) {
      report(error && error.message ? error.message : error);
      if (window.console && window.console.error) window.console.error(error);
    }
  }

  // -------------------------------------------------------------------- state

  var state = Object.create(null);
  var pending = Object.create(null); // key -> local writes the host has not answered yet
  var subscribers = [];
  var depth = 0;

  var me = { id: "", name: "", color: "" };
  var members = [];
  var theme = "light";
  try {
    if (document.documentElement.getAttribute("data-theme") === "dark") theme = "dark";
  } catch (e) {}
  var inited = false;
  var readyCallbacks = [];
  var memberCallbacks = [];
  var themeCallbacks = [];

  function notify(key) {
    if (depth > 20) {
      report("state.subscribe callbacks keep changing state; stopped to avoid a loop");
      return;
    }
    depth++;
    try {
      var list = subscribers.slice();
      for (var i = 0; i < list.length; i++) guarded(list[i], key);
    } finally {
      depth--;
    }
    scheduleMeasure();
  }

  function same(a, b) {
    if (a === undefined || b === undefined) return a === b;
    return stringify(a) === stringify(b);
  }

  function applyRemote(key, value) {
    if (same(state[key], value)) return;
    if (value === undefined) delete state[key];
    else state[key] = value;
    notify(key);
  }

  function checkKey(key, what) {
    if (typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH) return true;
    report(
      "sofra.state." +
        what +
        ": the key must be a string of 1 to " +
        MAX_KEY_LENGTH +
        " characters",
    );
    return false;
  }

  function addCallback(list, fn) {
    if (typeof fn !== "function") return function () {};
    list.push(fn);
    return function () {
      var index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    };
  }

  var api = {
    ready: function (fn) {
      if (typeof fn !== "function") return;
      if (inited) guarded(fn);
      else readyCallbacks.push(fn);
    },
    onMembers: function (fn) {
      return addCallback(memberCallbacks, fn);
    },
    onTheme: function (fn) {
      return addCallback(themeCallbacks, fn);
    },
    id: function () {
      var alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
      var bytes = null;
      try {
        bytes = window.crypto.getRandomValues(new Uint8Array(12));
      } catch (e) {}
      var out = "";
      for (var i = 0; i < 12; i++) {
        var n = bytes ? bytes[i] : Math.floor(Math.random() * 256);
        out += alphabet.charAt(n % 36);
      }
      return out;
    },
    state: {
      get: function (key) {
        return clone(state[key]);
      },
      set: function (key, value) {
        if (!checkKey(key, "set")) return;
        var json;
        try {
          json = stringify(value);
        } catch (e) {
          json = undefined;
        }
        if (typeof json !== "string") {
          report('sofra.state.set("' + key + '"): the value is not JSON');
          return;
        }
        if (byteLength(json) > MAX_VALUE_BYTES) {
          report('sofra.state.set("' + key + '"): the value is too large');
          return;
        }
        if (state[key] !== undefined && stringify(state[key]) === json) return;
        var copy = parse(json);
        state[key] = copy;
        pending[key] = (pending[key] || 0) + 1;
        send({ type: "sofra:set", key: key, value: parse(json) });
        notify(key);
      },
      delete: function (key) {
        if (!checkKey(key, "delete")) return;
        if (state[key] === undefined) return;
        delete state[key];
        pending[key] = (pending[key] || 0) + 1;
        send({ type: "sofra:delete", key: key });
        notify(key);
      },
      keys: function (prefix) {
        var out = [];
        var p = typeof prefix === "string" ? prefix : "";
        for (var key in state) if (key.indexOf(p) === 0) out.push(key);
        return out;
      },
      entries: function (prefix) {
        var keys = api.state.keys(prefix);
        var out = [];
        for (var i = 0; i < keys.length; i++) out.push([keys[i], clone(state[keys[i]])]);
        return out;
      },
      all: function () {
        var out = {};
        for (var key in state) {
          Object.defineProperty(out, key, {
            value: clone(state[key]),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return out;
      },
      subscribe: function (fn) {
        return addCallback(subscribers, fn);
      },
    },
  };

  Object.defineProperty(api, "me", {
    enumerable: true,
    get: function () {
      return clone(me);
    },
  });
  Object.defineProperty(api, "members", {
    enumerable: true,
    get: function () {
      return clone(members);
    },
  });
  Object.defineProperty(api, "theme", {
    enumerable: true,
    get: function () {
      return theme;
    },
  });

  // ------------------------------------------------------------ host messages

  function setTheme(next) {
    theme = next === "dark" ? "dark" : "light";
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  }

  function replaceState(next) {
    state = Object.create(null);
    if (next && typeof next === "object") {
      for (var key in next) {
        if (Object.prototype.hasOwnProperty.call(next, key) && next[key] !== undefined) {
          state[key] = next[key];
        }
      }
    }
  }

  function onHostMessage(event) {
    var data = event && event.data;
    if (!data || typeof data !== "object") return;
    var i;
    var list;
    switch (data.type) {
      case "sofra:init":
        if (inited) return;
        replaceState(data.state);
        if (data.me) me = data.me;
        if (data.members) members = data.members;
        setTheme(data.theme);
        inited = true;
        list = readyCallbacks;
        readyCallbacks = [];
        for (i = 0; i < list.length; i++) guarded(list[i]);
        notify(undefined);
        break;
      case "sofra:state":
        if (typeof data.key !== "string") return;
        // The host answers every local write with exactly one message carrying the value
        // it ended up with, in order. While answers to older local writes are outstanding
        // the local value is newer, so skip them; the last one always applies.
        if (pending[data.key] > 0) {
          pending[data.key]--;
          if (pending[data.key] > 0) return;
          delete pending[data.key];
        }
        applyRemote(data.key, data.value);
        break;
      case "sofra:state-all":
        replaceState(data.state);
        notify(undefined);
        break;
      case "sofra:members":
        members = data.members || [];
        list = memberCallbacks.slice();
        for (i = 0; i < list.length; i++) guarded(list[i], clone(members));
        break;
      case "sofra:theme":
        setTheme(data.theme);
        list = themeCallbacks.slice();
        for (i = 0; i < list.length; i++) guarded(list[i], theme);
        break;
      case "sofra:ping":
        send({ type: "sofra:pong" });
        break;
    }
  }

  // The host answers "sofra:ready" with a private MessagePort. Only messages from the
  // parent window are considered (sibling tool frames can post to this window too).
  window.addEventListener(
    "message",
    function (event) {
      if (event.source !== host) return;
      var data = event.data;
      if (!data || data.type !== "sofra:port" || !event.ports || !event.ports[0]) return;
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (port) return;
      port = event.ports[0];
      port.onmessage = onHostMessage;
      port.postMessage({ type: "sofra:hello", nonce: NONCE });
      var waiting = queue;
      queue = [];
      for (var i = 0; i < waiting.length; i++) port.postMessage(waiting[i]);
    },
    true,
  );

  // ------------------------------------------------------------------- errors

  window.addEventListener("error", function (event) {
    var message = (event && event.message) || "Script error";
    if (event && event.lineno) message += " (line " + event.lineno + ")";
    report(message);
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    report((reason && reason.message) || String(reason));
  });
  document.addEventListener("securitypolicyviolation", function (event) {
    var what = (event && (event.effectiveDirective || event.violatedDirective)) || "request";
    report("Blocked by the sandbox: tools cannot load outside resources (" + what + ")");
  });

  // ----------------------------------------- make forbidden things harmless

  window.alert = function () {};
  window.confirm = function () {
    return false;
  };
  window.prompt = function () {
    return null;
  };
  window.open = function () {
    return null;
  };

  document.addEventListener(
    "submit",
    function (event) {
      event.preventDefault();
    },
    true,
  );
  document.addEventListener(
    "click",
    function (event) {
      var el = event.target;
      while (el && el !== document) {
        var tag = el.tagName ? String(el.tagName).toLowerCase() : "";
        if ((tag === "a" || tag === "area") && el.hasAttribute && el.hasAttribute("href")) {
          var href = String(el.getAttribute("href")).replace(/^\s+/, "");
          if (href.charAt(0) !== "#" && !/^javascript:/i.test(href)) event.preventDefault();
          return;
        }
        el = el.parentNode;
      }
    },
    true,
  );

  // Storage and cookies throw in a sandboxed frame. Give tools that reach for them an
  // in-memory stand-in, so they keep running (nothing is persisted or shared).
  function memoryStorage() {
    var data = Object.create(null);
    return {
      getItem: function (key) {
        return key in data ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
      },
      removeItem: function (key) {
        delete data[key];
      },
      clear: function () {
        data = Object.create(null);
      },
      key: function (index) {
        return Object.keys(data)[index] || null;
      },
      get length() {
        return Object.keys(data).length;
      },
    };
  }
  function shim(target, name, make) {
    try {
      void target[name];
    } catch (e) {
      try {
        Object.defineProperty(target, name, make());
      } catch (e2) {}
    }
  }
  shim(window, "localStorage", function () {
    return { value: memoryStorage(), configurable: true };
  });
  shim(window, "sessionStorage", function () {
    return { value: memoryStorage(), configurable: true };
  });
  shim(document, "cookie", function () {
    return {
      get: function () {
        return "";
      },
      set: function () {},
      configurable: true,
    };
  });

  // Best effort only: the CSP already blocks ordinary requests; peer connections are the
  // one network API it does not cover in every browser.
  try {
    window.RTCPeerConnection = undefined;
    window.webkitRTCPeerConnection = undefined;
    window.RTCDataChannel = undefined;
  } catch (e) {}

  // ------------------------------------------------------------------- height

  var lastHeight = -1;
  var measureQueued = false;

  function measure() {
    measureQueued = false;
    var root = document.documentElement;
    if (!root || !root.getBoundingClientRect) return;
    var height = Math.ceil(root.getBoundingClientRect().height);
    if (!(height >= 0) || height === lastHeight) return;
    lastHeight = height;
    // The host never makes the frame taller than the limit; scroll inside only then.
    if (height > MAX_FRAME_HEIGHT) root.setAttribute("data-sofra-scroll", "");
    else root.removeAttribute("data-sofra-scroll");
    send({ type: "sofra:resize", height: height });
  }

  function scheduleMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(measure);
    else if (window.setTimeout) window.setTimeout(measure, 0);
    else measureQueued = false;
  }

  function watchSize() {
    if (window.ResizeObserver) {
      var observer = new window.ResizeObserver(scheduleMeasure);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    } else if (window.setInterval) {
      window.setInterval(measure, 500);
    }
    scheduleMeasure();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchSize);
  } else {
    watchSize();
  }
  window.addEventListener("load", scheduleMeasure);

  // --------------------------------------------------------------------- boot

  window.sofra = api;
  if (host && host.postMessage) host.postMessage({ type: "sofra:ready" }, "*");
})(window);
