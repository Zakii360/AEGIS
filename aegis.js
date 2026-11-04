(function () {
  "use strict";

  if (window.Aegis) return;

  const VERSION = "0.4.0";
  const LOAD_KEY = "aegis.load-history.v1";
  const RELOAD_WINDOW = 60000;
  const RELOAD_LIMIT = 3;
  const DECISION_DELAY = 1550;
  const CHALLENGE_TIMEOUT = 35000;
  const COLS = 12;
  const ROWS = 6;

  const css = `
    :host { display:block; width:min(100%, 344px); color:#252525; font:14px/1.4 Arial,Helvetica,sans-serif; }
    * { box-sizing:border-box; }
    .panel { width:100%; padding:15px 16px; border:1px solid #d9d9d9; border-radius:4px; background:#fff; box-shadow:0 1px 3px #0000000d; }
    .status { display:flex; align-items:center; gap:13px; min-height:42px; }
    .indicator { position:relative; width:22px; height:22px; flex:0 0 22px; border:2px solid #e1e1e1; border-top-color:#555; border-radius:50%; animation:spin .8s linear infinite; transition:border-color 240ms ease,transform 280ms cubic-bezier(.2,.8,.2,1); }
    .indicator:after { content:""; position:absolute; left:6px; top:2px; width:6px; height:10px; border:solid #26834a; border-width:0 2px 2px 0; opacity:0; transform:translateY(-2px) rotate(45deg) scale(.35); transition:opacity 150ms ease,transform 280ms cubic-bezier(.18,.75,.25,1.25); }
    .panel.done .indicator { border-color:#26834a; animation:none; transform:scale(1.04); }
    .panel.done .indicator:after { opacity:1; transform:translateY(0) rotate(45deg) scale(1); transition-delay:90ms; }
    .panel.failed .indicator { border-color:#bb4848; animation:none; }
    .panel.failed .indicator:after { content:"×"; left:1px; top:-5px; width:auto; height:auto; border:0; color:#bb4848; font-size:22px; opacity:1; transform:none; }
    .copy { min-width:0; }
    .heading { margin:0; font-size:14px; line-height:1.35; font-weight:600; }
    .detail { margin:3px 0 0; color:#777; font-size:12px; }
    .challenge { display:none; margin-top:15px; }
    .panel.challenge-on .challenge { display:block; }
    .instruction { margin:0 0 9px; color:#555; font-size:12px; }
    .grid { position:relative; height:174px; overflow:hidden; border:1px solid #ddd; background:#fcfcfc; background-image:linear-gradient(to right,#ededed 1px,transparent 1px),linear-gradient(to bottom,#ededed 1px,transparent 1px); background-size:calc(100% / 12) calc(100% / 6); cursor:crosshair; touch-action:none; user-select:none; outline:none; }
    .grid:focus-visible { outline:2px solid #8ba99a; outline-offset:3px; }
    .grid.bad { border-color:#bd7777; }
    .trace { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
    .trace polyline { fill:none; stroke:#718d7d; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; opacity:.78; }
    .dot { position:absolute; z-index:1; display:grid; place-items:center; transform:translate(-50%,-50%); pointer-events:none; }
    .start { width:25px; height:25px; border:2px solid #444; border-radius:50%; background:#fff; color:#333; font-size:10px; font-weight:700; }
    .target { width:23px; height:23px; border:2px solid #333; border-radius:50%; background:#333; color:#fff; font-size:10px; font-weight:700; transition:background 140ms ease,border-color 140ms ease,transform 140ms ease; }
    .target.current { border-color:#47765a; background:#47765a; transform:translate(-50%,-50%) scale(1.13); }
    .target.visited { border-color:#8ba99a; background:#8ba99a; }
    .decoy { width:7px; height:7px; border-radius:50%; background:#bdbdbd; }
    .key-cursor { position:absolute; z-index:2; display:none; width:9px; height:9px; border:2px solid #fff; border-radius:50%; background:#222; box-shadow:0 0 0 1px #222; transform:translate(-50%,-50%); pointer-events:none; }
    .help { min-height:17px; margin:8px 0 0; color:#777; font-size:11px; }
    .retry { display:none; margin-top:10px; padding:7px 12px; border:1px solid #ccc; border-radius:3px; background:#fff; color:#333; font:inherit; font-size:12px; cursor:pointer; }
    .retry:hover { background:#f6f6f6; }
    .panel.failed .retry { display:inline-block; }
    .panel.done .challenge { display:none; }
    @keyframes spin { to { transform:rotate(360deg); } }
    @media(prefers-reduced-motion:reduce) { .indicator { animation-duration:2s; transition-duration:1ms; } .indicator:after,.target { transition-duration:1ms; transition-delay:0ms; } }
  `;

  const markup = `
    <main class="panel" role="status" aria-live="polite">
      <div class="status"><span class="indicator" aria-hidden="true"></span><div class="copy"><p class="heading">Checking your browser</p><p class="detail">AEGIS is checking this request.</p></div></div>
      <section class="challenge" aria-label="Additional verification">
        <p class="instruction">Move from S through dots 1, 2 and 3 in order.</p>
        <div class="grid" tabindex="0" role="application" aria-label="Verification grid. Start at S, then move through dots 1, 2 and 3 in order. Use arrow keys to move the cursor.">
          <svg class="trace" aria-hidden="true"><polyline points=""></polyline></svg>
          <span class="key-cursor" aria-hidden="true"></span>
        </div>
        <p class="help">Follow the points in order. Keep your movement inside the grid. Keyboard users can use the arrow keys.</p>
        <button class="retry" type="button">Try again</button>
      </section>
    </main>`;

  function recentLoads() {
    const now = Date.now();
    let loads = [];
    try {
      loads = JSON.parse(sessionStorage.getItem(LOAD_KEY) || "[]");
      if (!Array.isArray(loads)) loads = [];
    } catch (_) { loads = []; }

    loads = loads.filter((stamp) =>
      Number.isFinite(stamp) &&
      now - stamp >= 0 &&
      now - stamp < RELOAD_WINDOW
    );

    loads.push(now);

    try {
      sessionStorage.setItem(LOAD_KEY, JSON.stringify(loads));
    } catch (_) {
      /* storage can be blocked */
    }

    return loads.length;
  }

  const PAGE_RELOADS = recentLoads();

  function mount(host) {
    if (!host || host.dataset.aegisMounted === "true") return;

    host.dataset.aegisMounted = "true";

    const root = host.shadowRoot || host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${css}</style>${markup}`;

    const panel = root.querySelector(".panel");
    const heading = root.querySelector(".heading");
    const detail = root.querySelector(".detail");
    const challenge = root.querySelector(".challenge");
    const grid = root.querySelector(".grid");
    const trace = root.querySelector("polyline");
    const keyCursor = root.querySelector(".key-cursor");
    const help = root.querySelector(".help");
    const retry = root.querySelector(".retry");

    const reloads = PAGE_RELOADS;

    const signals = {
      pointerMoved: false,
      reloads,
      webdriver: navigator.webdriver === true
    };

    let decisionTimer = 0;
    let challengeTimer = 0;
    let active = false;
    let state = null;
    let keyPosition = null;
    let terminal = false;

    function emit(name, detailValue) {
      const event = new CustomEvent("aegis:" + name, {
        bubbles: true,
        composed: true,
        detail: detailValue
      });

      host.dispatchEvent(event);

      window.dispatchEvent(new CustomEvent("aegis:" + name, {
        detail: detailValue
      }));
    }

    function pass(risk, method) {
      if (terminal) return;

      terminal = true;
      active = false;

      clearTimeout(decisionTimer);
      clearTimeout(challengeTimer);

      panel.classList.remove("challenge-on", "failed");
      panel.classList.add("done");

      heading.textContent = "Verification complete";
      detail.textContent = "This request has been cleared.";

      host.dataset.aegisStatus = "verified";

      const result = {
        risk,
        method,
        version: VERSION,
        clientVerified: true
      };

      emit("verified", result);
    }

    function fail(message) {
      if (!active || terminal || panel.classList.contains("failed")) return;

      clearTimeout(challengeTimer);

      panel.classList.add("failed");
      grid.classList.add("bad");

      heading.textContent = "Verification failed";
      detail.textContent = message;

      help.textContent = "Try again and follow each point in order. Keep your movement inside the grid.";

      host.dataset.aegisStatus = "failed";

      emit("failed", {
        reason: message,
        version: VERSION
      });
    }

    function distance(a, b) {
      return Math.hypot(a.col - b.col, a.row - b.row);
    }

    function shuffledCells() {
      const cells = [];

      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          cells.push({ col, row });
        }
      }

      for (let i = cells.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }

      return cells;
    }

    function chooseCell(selected, minDistance) {
      const cells = shuffledCells();

      return cells.find((cell) =>
        selected.every((point) => distance(cell, point) >= minDistance)
      ) || cells.find((cell) =>
        selected.every((point) => distance(cell, point) >= 1.5)
      );
    }

    function addDot(kind, label, cell, bounds) {
      const dot = document.createElement("span");

      dot.className = "dot " + kind;
      dot.textContent = label;

      dot.style.left =
        ((cell.col + 0.5) / COLS * bounds.width) + "px";

      dot.style.top =
        ((cell.row + 0.5) / ROWS * bounds.height) + "px";

      grid.appendChild(dot);

      return dot;
    }

    function cellAt(x, y, bounds) {
      return {
        col: Math.max(
          0,
          Math.min(COLS - 1, Math.floor(x / bounds.width * COLS))
        ),
        row: Math.max(
          0,
          Math.min(ROWS - 1, Math.floor(y / bounds.height * ROWS))
        )
      };
    }

    function atTarget(point, x, y, bounds) {
      const px = (point.cell.col + 0.5) / COLS * bounds.width;
      const py = (point.cell.row + 0.5) / ROWS * bounds.height;

      return Math.hypot(x - px, y - py) <= 16;
    }

    function startLeg(x, y, time, bounds) {
      const cell = cellAt(x, y, bounds);

      state.started = true;
      state.lastX = x;
      state.lastY = y;
      state.originX = x;
      state.originY = y;
      state.lastTime = time;
      state.legStartedAt = time;
      state.samples = 0;
      state.length = 0;
      state.speeds = [];
      state.cells = new Set([cell.col + ":" + cell.row]);
      state.path = [{ x, y }];

      drawPath();

      heading.textContent = "Follow the dots";
      detail.textContent = "Keep moving through the numbered points.";
      help.textContent = "Good. Now move to dot 1.";
    }

    function drawPath() {
      trace.setAttribute(
        "points",
        state.path.map((point) => point.x + "," + point.y).join(" ")
      );
    }

    function processPosition(clientX, clientY, time) {
      if (!active || terminal || panel.classList.contains("failed")) return;

      const bounds = grid.getBoundingClientRect();

      const x = clientX - bounds.left;
      const y = clientY - bounds.top;

      const inside =
        x >= 0 &&
        y >= 0 &&
        x <= bounds.width &&
        y <= bounds.height;

      if (!inside) {
        if (state.started) {
          fail("The pointer left the grid. Try again.");
        }
        return;
      }

      if (!state.started) {
        if (atTarget({ cell: state.start }, x, y, bounds)) {
          startLeg(x, y, time, bounds);
        }
        return;
      }

      const elapsed = Math.max(1, time - state.lastTime);
      const step = Math.hypot(x - state.lastX, y - state.lastY);

      if (step < 1) return;

      const speed = step / elapsed;

      if ((step > 84 && elapsed < 180) || speed > 4.5) {
        fail("That movement jumped across the grid too quickly. Try again.");
        return;
      }

      state.samples += 1;
      state.length += step;
      state.speeds.push(speed);

      state.lastX = x;
      state.lastY = y;
      state.lastTime = time;

      const cell = cellAt(x, y, bounds);

      state.cells.add(cell.col + ":" + cell.row);
      state.path.push({ x, y });

      if (state.path.length > 220) {
        state.path.shift();
      }

      drawPath();

      const current = state.targets[state.targetIndex];

      for (
        let index = state.targetIndex + 1;
        index < state.targets.length;
        index += 1
      ) {
        if (atTarget(state.targets[index], x, y, bounds)) {
          fail("The points were not followed in order. Try again.");
          return;
        }
      }

      if (!atTarget(current, x, y, bounds)) return;

      const duration = time - state.legStartedAt;

      const meanSpeed =
        state.speeds.reduce((sum, value) => sum + value, 0) /
        Math.max(1, state.speeds.length);

      const speedVariance =
        state.speeds.reduce(
          (sum, value) => sum + Math.pow(value - meanSpeed, 2),
          0
        ) / Math.max(1, state.speeds.length);

      const speedVariation =
        meanSpeed > 0 ? Math.sqrt(speedVariance) / meanSpeed : 0;

      const targetX =
        (current.cell.col + 0.5) / COLS * bounds.width;

      const targetY =
        (current.cell.row + 0.5) / ROWS * bounds.height;

      const vectorX = targetX - state.originX;
      const vectorY = targetY - state.originY;

      const vectorLengthSquared =
        Math.max(1, vectorX * vectorX + vectorY * vectorY);

      const lineDeviation = state.path.reduce((maximum, point) => {
        const position = Math.max(
          0,
          Math.min(
            1,
            (
              (point.x - state.originX) * vectorX +
              (point.y - state.originY) * vectorY
            ) / vectorLengthSquared
          )
        );

        const projectedX = state.originX + position * vectorX;
        const projectedY = state.originY + position * vectorY;

        return Math.max(
          maximum,
          Math.hypot(point.x - projectedX, point.y - projectedY)
        );
      }, 0);

      if (
        state.samples < 8 ||
        duration < 260 ||
        state.length < 38 ||
        state.cells.size < 2
      ) {
        fail("That movement was too abrupt to verify. Try again with a continuous movement.");
        return;
      }

      if (
        state.inputMode !== "keyboard" &&
        lineDeviation < 4.5 &&
        speedVariation < 0.35
      ) {
        fail("The movement pattern was unusually straight and uniform. Try again.");
        return;
      }

      current.element.classList.remove("current");
      current.element.classList.add("visited");

      state.targetIndex += 1;

      if (state.targetIndex === state.targets.length) {
        pass("challenged", "grid-path");
        return;
      }

      const next = state.targets[state.targetIndex];

      next.element.classList.add("current");

      state.lastX = x;
      state.lastY = y;
      state.originX = x;
      state.originY = y;
      state.lastTime = time;
      state.legStartedAt = time;
      state.samples = 0;
      state.length = 0;
      state.speeds = [];
      state.cells = new Set([cell.col + ":" + cell.row]);

      help.textContent =
        "Dot " + state.targetIndex +
        " reached. Now move to dot " +
        (state.targetIndex + 1) + ".";
    }

    function handlePointerMove(event) {
      if (
        !active ||
        !event.isTrusted ||
        panel.classList.contains("failed")
      ) {
        return;
      }

      if (state) state.inputMode = "pointer";

      const events =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];

      const samples = events.length ? events : [event];

      for (const sample of samples) {
        processPosition(
          sample.clientX,
          sample.clientY,
          Number.isFinite(sample.timeStamp)
            ? sample.timeStamp
            : performance.now()
        );

        if (panel.classList.contains("failed") || terminal) {
          break;
        }
      }
    }

    function makeChallenge(reason) {
      if (terminal || active) return;

      active = true;

      clearTimeout(decisionTimer);

      panel.classList.add("challenge-on");

      heading.textContent = "One more step";
      detail.textContent = reason;

      help.textContent =
        "Start at S, then move to 1, 2 and 3 in order. Avoid sudden jumps.";

      host.dataset.aegisStatus = "challenge";

      buildChallenge();

      grid.focus({ preventScroll: true });

      challengeTimer = setTimeout(
        () => fail("The verification timed out. Try again."),
        CHALLENGE_TIMEOUT
      );

      emit("challenge", {
        risk: signals.webdriver || reloads >= RELOAD_LIMIT
          ? "high"
          : "medium",
        reloads,
        version: VERSION
      });
    }

    function buildChallenge() {
      clearTimeout(challengeTimer);

      const svg = grid.querySelector("svg");

      grid.replaceChildren(svg, keyCursor);

      const bounds = grid.getBoundingClientRect();

      svg.setAttribute(
        "viewBox",
        "0 0 " + bounds.width + " " + bounds.height
      );

      trace.setAttribute("points", "");

      keyCursor.style.display = "none";
      keyPosition = null;

      grid.classList.remove("bad");

      const selected = [];

      const start = chooseCell(selected, 3.2);
      selected.push(start);

      const targets = [];

      for (let index = 0; index < 3; index += 1) {
        const cell = chooseCell(selected, 3.2);

        selected.push(cell);

        targets.push({
          cell,
          element: null
        });
      }

      const decoys = [];

      for (let index = 0; index < 3; index += 1) {
        const cell = chooseCell(selected, 1.6);

        if (cell) {
          selected.push(cell);
          decoys.push(cell);
        }
      }

      addDot("start", "S", start, bounds);

      targets.forEach((target, index) => {
        target.element = addDot(
          "target",
          String(index + 1),
          target.cell,
          bounds
        );
      });

      decoys.forEach((cell) => {
        addDot("decoy", "", cell, bounds);
      });

      targets[0].element.classList.add("current");

      state = {
        start,
        targets,
        targetIndex: 0,
        started: false,
        lastX: 0,
        lastY: 0,
        originX: 0,
        originY: 0,
        lastTime: 0,
        legStartedAt: 0,
        samples: 0,
        length: 0,
        speeds: [],
        inputMode: "pointer",
        cells: new Set(),
        path: []
      };
    }

    function onKeyboard(event) {
      if (!event.isTrusted) return;

      const directions = {
        ArrowUp: [0, -9],
        ArrowDown: [0, 9],
        ArrowLeft: [-9, 0],
        ArrowRight: [9, 0]
      };

      const delta = directions[event.key];

      if (
        !delta ||
        !active ||
        panel.classList.contains("failed")
      ) {
        return;
      }

      event.preventDefault();

      if (state) state.inputMode = "keyboard";

      const bounds = grid.getBoundingClientRect();

      if (!keyPosition) {
        keyPosition = {
          x: (state.start.col + 0.5) / COLS * bounds.width,
          y: (state.start.row + 0.5) / ROWS * bounds.height
        };
      }

      keyPosition.x = Math.max(
        2,
        Math.min(bounds.width - 2, keyPosition.x + delta[0])
      );

      keyPosition.y = Math.max(
        2,
        Math.min(bounds.height - 2, keyPosition.y + delta[1])
      );

      keyCursor.style.display = "block";
      keyCursor.style.left = keyPosition.x + "px";
      keyCursor.style.top = keyPosition.y + "px";

      processPosition(
        bounds.left + keyPosition.x,
        bounds.top + keyPosition.y,
        performance.now()
      );
    }

    function resetChallenge() {
      if (!active || terminal) return;

      panel.classList.remove("failed");

      buildChallenge();

      grid.focus({ preventScroll: true });

      heading.textContent = "One more step";
      detail.textContent = "Follow the new set of points.";

      help.textContent =
        "Start at S, then move to 1, 2 and 3 in order.";

      challengeTimer = setTimeout(
        () => fail("The verification timed out. Try again."),
        CHALLENGE_TIMEOUT
      );
    }

    document.addEventListener("pointermove", (event) => {
      if (
        !event.isTrusted ||
        (event.pointerType !== "mouse" && event.pointerType !== "pen")
      ) {
        return;
      }

      signals.pointerMoved = true;
    }, { passive: true });

    window.addEventListener(
      "pointermove",
      handlePointerMove,
      { passive: true }
    );

    grid.addEventListener("keydown", onKeyboard);

    retry.addEventListener("click", resetChallenge);

    const elevated =
      signals.webdriver ||
      reloads >= RELOAD_LIMIT;

    if (elevated) {
      decisionTimer = setTimeout(
        () => makeChallenge("We need an additional check for this request."),
        700
      );
    } else {
      decisionTimer = setTimeout(() => {
        if (signals.pointerMoved) {
          pass("low", "browser-interaction");
        } else {
          makeChallenge(
            "No cursor movement was detected, so this request needs another check."
          );
        }
      }, DECISION_DELAY);
    }
  }

  const script = document.currentScript;

  function start() {
    let hosts = Array.from(
      document.querySelectorAll("[data-aegis]")
    );

    if (!hosts.length) {
      const host = document.createElement("div");

      host.setAttribute("data-aegis", "");

      if (
        script &&
        script.parentNode &&
        script.parentNode !== document.head
      ) {
        script.parentNode.insertBefore(host, script.nextSibling);
      } else {
        (document.body || document.documentElement).appendChild(host);
      }

      hosts = [host];
    }

    hosts.forEach(mount);
  }

  window.Aegis = Object.freeze({
    version: VERSION,

    mount: (target) => mount(
      typeof target === "string"
        ? document.querySelector(target)
        : target
    )
  });

  if (document.body) {
    start();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  }
})();
