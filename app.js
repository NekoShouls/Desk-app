/* Grok Bot desk app — Plan B, polls public JSON. Fixtures are local only. */
(() => {
  const TZ = "Europe/Paris";
  const POLL_MS = 15000;
  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture"); // populated | empty
  const forceError = params.get("error") === "1";
  const forceLoading = params.get("loading") === "1";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const els = {
    error: document.getElementById("error-banner"),
    home: document.getElementById("screen-home"),
    agents: document.getElementById("screen-agents"),
    activity: document.getElementById("screen-activity"),
    account: document.getElementById("screen-account"),
    coin: document.getElementById("screen-coin"),
    auditor: document.getElementById("screen-auditor"),
    tabbar: document.getElementById("tabbar"),
    avatar: document.getElementById("btn-avatar"),
    brand: document.getElementById("btn-brand"),
    search: document.getElementById("btn-search"),
    bell: document.getElementById("btn-bell"),
    bellDot: document.getElementById("bell-dot"),
    sheet: document.getElementById("search-sheet"),
    searchInput: document.getElementById("search-input"),
    searchClose: document.getElementById("search-close"),
    searchResults: document.getElementById("search-results"),
  };

  let state = null;
  let activity = [];
  let account = null;
  let agentsExtra = {};
  let lastGood = null;
  let lastUpdate = null;
  let retryIn = 15;
  let pollTimer = null;
  let retryTimer = null;
  let route = parseRoute();
  let chartRange = "LIVE";
  let lastBalanceText = "";

  function dataPath() {
    const hash = location.hash || "";
    const m = hash.match(/[#&]d=([A-Za-z0-9_-]+)/);
    if (m) {
      try { localStorage.setItem("deskDataPath", m[1]); } catch {}
      return m[1];
    }
    try { return localStorage.getItem("deskDataPath") || ""; } catch { return ""; }
  }

  function baseUrl() {
    if (fixture === "empty") return new URL("./fixtures-empty/", location.href).href;
    if (fixture) return new URL("./fixtures/", location.href).href;
    const d = dataPath();
    if (!d) return null;
    return `https://izztuwmkyxeytgelakhe.supabase.co/storage/v1/object/public/desk/d/${d}/`;
  }

  function parseRoute() {
    const raw = (location.hash || "").replace(/^#/, "");
    const clean = raw.replace(/^[?&]?d=[^&]+&?/, "").replace(/^\/?/, "");
    const parts = clean.split("/").filter(Boolean);
    // allow #/coin/x or coin/x, ignore d=
    const filtered = parts.filter((p) => !p.startsWith("d="));
    const screen = filtered[0] || "home";
    const id = filtered[1] || "";
    return { screen, id };
  }

  function go(hash) {
    const d = dataPath();
    const path = hash.startsWith("#") ? hash : `#/${hash.replace(/^\//, "")}`;
    // keep d= if present in live mode
    if (d && !fixture && !path.includes("d=")) {
      location.hash = path + (path.includes("?") ? "&" : "") ; // keep path; d is in localStorage
    }
    if (location.hash === path || location.hash === path + "/") {
      route = parseRoute();
      render();
      return;
    }
    location.hash = path;
  }

  window.addEventListener("hashchange", () => {
    route = parseRoute();
    render();
  });

  function money(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n < 0 ? "-" : "";
    return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
  function fmtPrice(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const a = Math.abs(n);
    let body;
    if (a >= 1) body = a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    else if (a >= 0.01) body = a.toFixed(4);
    else {
      body = a.toFixed(8).replace(/0+$/, "");
      if (body.endsWith(".")) body += "0";
    }
    return (n < 0 ? "-" : "") + "$" + body;
  }
  function fmtTime(ts) {
    if (!ts) return "";
    try {
      return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(ts));
    } catch { return ts; }
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function fetchJson(rel) {
    const base = baseUrl();
    if (!base) throw new Error("no-path");
    const url = new URL(rel, base).href;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  async function refresh() {
    if (forceLoading && !state) {
      render();
      return;
    }
    try {
      const [st, act, acc] = await Promise.all([
        fetchJson("state.json"),
        fetchJson("activity.json").catch(() => []),
        fetchJson("account.json").catch(() => null),
      ]);
      state = st;
      activity = Array.isArray(act) ? act : [];
      account = acc;
      lastGood = { state, activity, account };
      lastUpdate = new Date();
      if (forceError) throw new Error("forced");
      hideError();
      render();
    } catch (err) {
      if (lastGood) {
        state = lastGood.state;
        activity = lastGood.activity;
        account = lastGood.account;
      }
      showError();
      render();
    }
  }

  function showError() {
    const n = retryIn;
    const t = lastUpdate ? fmtTime(lastUpdate.toISOString()) : "—";
    els.error.hidden = false;
    els.error.textContent = `Desk offline · retrying in ${n}s · last update ${t}`;
    if (retryTimer) clearInterval(retryTimer);
    let left = n;
    retryTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) { clearInterval(retryTimer); retryTimer = null; refresh(); left = n; return; }
      const tt = lastUpdate ? fmtTime(lastUpdate.toISOString()) : "—";
      els.error.textContent = `Desk offline · retrying in ${left}s · last update ${tt}`;
    }, 1000);
  }
  function hideError() {
    els.error.hidden = true;
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  }

  function setTab(name) {
    for (const b of els.tabbar.querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.tab === name);
    }
  }
  function showScreen(name) {
    for (const s of document.querySelectorAll(".screen")) {
      s.hidden = s.dataset.screen !== name;
    }
    const tab = ["home", "agents", "activity", "account"].includes(name) ? name : "home";
    setTab(tab);
  }

  function skel(h, extra = "") {
    return `<div class="skel" style="height:${h}px;margin:12px 16px;${extra}"></div>`;
  }

  /* ---------------- odometer ---------------- */
  function renderOdometer(el, value) {
    const text = money(value);
    if (reduced) {
      el.textContent = text;
      lastBalanceText = text;
      return;
    }
    const prev = lastBalanceText || text;
    lastBalanceText = text;
    const len = Math.max(prev.length, text.length);
    const a = prev.padStart(len, " ");
    const b = text.padStart(len, " ");
    el.innerHTML = "";
    const digits = [];
    for (let i = 0; i < len; i++) {
      const col = document.createElement("span");
      col.className = "col";
      if (!/\d/.test(b[i])) {
        col.textContent = b[i] === " " ? "" : b[i];
        el.appendChild(col);
        continue;
      }
      const strip = document.createElement("span");
      strip.className = "strip";
      for (let d = 0; d <= 9; d++) {
        const ch = document.createElement("span");
        ch.className = "ch";
        ch.textContent = String(d);
        strip.appendChild(ch);
      }
      const from = /\d/.test(a[i]) ? Number(a[i]) : 0;
      const to = Number(b[i]);
      strip.style.transform = `translateY(${-from * 0.95}em)`;
      col.appendChild(strip);
      el.appendChild(col);
      digits.push({ strip, to, changed: from !== to });
    }
    const changed = digits.filter((d) => d.changed);
    requestAnimationFrame(() => {
      changed.forEach((d, idx) => {
        const delay = (changed.length - 1 - idx) * 30;
        d.strip.classList.add("roll");
        d.strip.style.transitionDelay = `${delay}ms`;
        d.strip.style.transform = `translateY(${-d.to * 0.95}em)`;
      });
      digits.filter((d) => !d.changed).forEach((d) => {
        d.strip.style.transform = `translateY(${-d.to * 0.95}em)`;
      });
    });
  }

  /* ---------------- home chart ---------------- */
  function filterPoints(points, range) {
    if (!points || !points.length) return [];
    const now = Date.parse((points[points.length - 1].ts) || Date.now());
    const span = { LIVE: Infinity, "1H": 3600e3, "4H": 4 * 3600e3, "1D": 86400e3, "1W": 7 * 86400e3, ALL: Infinity }[range] || 3600e3;
    if (range === "LIVE" || range === "ALL") return points;
    return points.filter((p) => now - Date.parse(p.ts) <= span);
  }
  function drawLineChart(canvas, points, marks, startValue) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 390;
    const h = canvas.clientHeight || 210;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 16, padR = 16, padT = 36, padB = 16;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    if (!points.length) {
      // dashed start line mid
      const y = padT + innerH * 0.55;
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(235,235,245,0.3)";
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.setLineDash([]);
      return { empty: true };
    }
    const vals = points.map((p) => Number(p.value));
    const t0 = Date.parse(points[0].ts), t1 = Date.parse(points[points.length - 1].ts) || t0 + 1;
    const ymin0 = Math.min(...vals, startValue ?? vals[0]);
    const ymax0 = Math.max(...vals, startValue ?? vals[0]);
    const pad = (ymax0 - ymin0) * 0.18 || Math.abs(ymax0) * 0.04 || 1;
    const ymin = ymin0 - pad, ymax = ymax0 + pad;
    const xOf = (ts) => padL + ((Date.parse(ts) - t0) / Math.max(1, t1 - t0)) * innerW;
    const yOf = (v) => padT + (1 - (v - ymin) / (ymax - ymin)) * innerH;
    const startY = yOf(startValue ?? vals[0]);
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(235,235,245,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, startY); ctx.lineTo(w - padR, startY); ctx.stroke();
    ctx.setLineDash([]);
    // gradient fill
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xOf(p.ts), y = yOf(Number(p.value));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    const lastX = xOf(points[points.length - 1].ts);
    const firstX = xOf(points[0].ts);
    ctx.lineTo(lastX, padT + innerH);
    ctx.lineTo(firstX, padT + innerH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + innerH);
    grad.addColorStop(0, "rgba(0,211,90,0.35)");
    grad.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = grad;
    ctx.fill();
    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xOf(p.ts), y = yOf(Number(p.value));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#00d35a";
    ctx.lineWidth = 2;
    ctx.stroke();
    // marks, later mark moves up a row if overlapping
    const placed = [];
    const rowH = 16;
    const used = (marks || []).filter((m) => {
      const t = Date.parse(m.ts);
      return t >= t0 && t <= t1 + 60e3;
    });
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "bottom";
    used.forEach((m) => {
      // interpolate y at ts
      let yv = vals[0];
      for (let i = 1; i < points.length; i++) {
        if (Date.parse(points[i].ts) >= Date.parse(m.ts)) { yv = Number(points[i - 1].value); break; }
        yv = Number(points[i].value);
      }
      const x = Math.min(w - padR - 4, Math.max(padL + 4, xOf(m.ts)));
      let y = yOf(yv) - 8;
      const tw = ctx.measureText(m.label).width;
      let shifted = 0;
      const overlaps = () => placed.some((p) => Math.abs(p.x - x) < (tw + p.w) / 2 + 8 && Math.abs(p.y - y) < rowH);
      while (overlaps() && shifted < 8) { y -= rowH; shifted++; }
      placed.push({ x, y, w: tw });
      const color = m.color === "red" ? "#ff453a" : m.color === "blue" ? "#0a84ff" : "#00d35a";
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.globalAlpha = 1;
      ctx.fillText(m.label, x, y);
    });
    return { empty: false };
  }

  function agentCardHtml(a, key) {
    const color = a.color || "#fff";
    let body = "";
    if (key === "auditor") {
      const layers = a.layers || [];
      const strips = Array.from({ length: 8 }, (_, i) => {
        const L = layers.find((x) => x.n === i + 1);
        const cls = L && L.pass === true ? "on" : L && L.pass === false ? "off" : "";
        return `<i class="${cls}"></i>`;
      }).join("");
      body = `<div class="metric">${a.taken || 0} taken apart</div>
        <div class="layers-mini">${strips}</div>
        <div class="status">${escapeHtml(a.status || "taking apart...")}</div>
        <div class="feed">${a.rejected || 0} rejected</div>`;
    } else if (key === "scanner") {
      const feed = (a.feed || []).slice(0, 5).map((f) => {
        if (f.verdict === "kill" || f.verdict === "killed") {
          return `<div class="kill">${escapeHtml(f.name || f.mint)}<span class="why">${escapeHtml(f.reason || "")}</span></div>`;
        }
        return `<div class="pass">${escapeHtml(f.name || f.mint)} → auditor</div>`;
      }).join("") || `<div>${escapeHtml(a.empty || "Listening for graduations")}</div>`;
      body = `<div class="metric" style="color:${color}">${a.pools || 0} pools</div>
        <div class="feed">${feed}</div>`;
    } else if (key === "analyst") {
      const score = a.lastScore;
      const thresh = a.threshold || 70;
      const ang = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
      const stroke = score != null && score >= thresh ? "#00d35a" : color;
      body = `<div class="metric" style="color:${color}">Scoring</div>
        <svg class="score-ring" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r="34" fill="none" stroke="#2c2c2e" stroke-width="8"/>
          <circle cx="44" cy="44" r="34" fill="none" stroke="${stroke}" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${(2*Math.PI*34).toFixed(2)}"
            stroke-dashoffset="${((1-ang)*2*Math.PI*34).toFixed(2)}" transform="rotate(-90 44 44)"/>
          <text x="44" y="49" text-anchor="middle" fill="#fff" font-size="20" font-variant="tabular-nums">${score == null ? "—" : score}</text>
        </svg>
        <div class="status">${escapeHtml(a.status || "Scoring")}</div>`;
    } else if (key === "executor") {
      const size = a.lastSize != null ? money(a.lastSize) : "—";
      const pct = a.lastPct != null ? `${Number(a.lastPct)}% of stack` : "";
      body = `<div class="metric" style="color:${color}">${a.trades || 0} trades</div>
        <div class="status">${size}${pct ? " · " + escapeHtml(pct) : ""}</div>
        <div class="exec-bar"><span></span></div>
        <div class="feed">${escapeHtml(a.status || "✓ Filled")}</div>`;
    } else {
      body = `<div class="metric" style="color:${color}">${escapeHtml(a.status || "Guarding")}</div>
        <div>
          <span class="pill red">stop -${a.stopPct}%</span>
          <span class="pill green">trail ${a.trailPct}%</span>
        </div>`;
    }
    return `<article class="agent-card" data-agent="${key}">
      <h3>${escapeHtml(a.label || key)}</h3>
      ${body}
    </article>`;
  }

  function activityRow(a) {
    const kind = a.kind || "";
    const cls = kind === "sold" ? "up" : (kind === "stopped" || kind === "rejected") ? (kind === "stopped" ? "down" : "skip") : "";
    const mint = a.mint || "";
    const target = kind === "rejected" ? `audit/${mint}` : `coin/${mint}`;
    return `<button class="activity-row" data-go="${target}">
      <div class="activity-title">${escapeHtml(a.title || "")}</div>
      <div class="activity-sub">${escapeHtml(a.subtitle || "")}</div>
      <div class="activity-value ${cls}">${escapeHtml(a.value || "")}</div>
    </button>`;
  }

  function renderHome() {
    const root = els.home;
    if (forceLoading && !state) {
      root.innerHTML = skel(72) + skel(210) + skel(44) + skel(280, "border-radius:42px") + skel(180);
      return;
    }
    if (!state) {
      root.innerHTML = `<div class="empty-note">Waiting for the first trade</div>`;
      return;
    }
    const running = state.agentsRunning ?? Object.values(state.agents || {}).filter((a) => a.running).length;
    const preview = (state.activityPreview && state.activityPreview.length ? state.activityPreview : activity.slice(0, 5));
    const today = Number(state.todayPct || 0);
    const todayCls = today < 0 ? "down" : "up";
    const todaySign = today > 0 ? "+" : today < 0 ? "" : "+";
    const paper = state.mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : "";
    root.innerHTML = `
      <div class="balance-block">
        <div class="balance-row">
          <div class="odometer" id="odometer"></div>
          ${paper}
        </div>
        <div class="balance-meta">
          <span class="today ${todayCls}">${todaySign}${today.toFixed(2)}%</span>
          <span class="pill green">${Number(state.multiplier || 1).toFixed(2)}×</span>
        </div>
      </div>
      <div class="chart-wrap">
        <canvas id="home-chart"></canvas>
        <div class="chart-empty" id="chart-empty" hidden>Waiting for the first trade</div>
      </div>
      <div class="range" id="range-switch">
        ${["LIVE","1H","4H","1D","1W","ALL"].map((r) => `<button data-range="${r}" class="${r===chartRange?"active":""}">${r}</button>`).join("")}
      </div>
      <div class="section-head"><h2>Agents · ${running} running</h2></div>
      <div class="carousel" id="agent-carousel"></div>
      <div class="section-head"><h2>Activity</h2><button class="link" data-go="activity">See all</button></div>
      <div id="home-activity">${preview.length ? preview.map(activityRow).join("") : `<div class="empty-note">Nothing yet tonight</div>`}</div>
    `;
    renderOdometer(root.querySelector("#odometer"), Number(state.stack || 0));
    const carousel = root.querySelector("#agent-carousel");
    const order = ["scanner", "auditor", "analyst", "executor", "risk"];
    carousel.innerHTML = order.map((k) => agentCardHtml(state.agents[k] || { label: k }, k)).join("");
    sizeCarousel(carousel);
    const canvas = root.querySelector("#home-chart");
    const pts = filterPoints(state.balance || [], chartRange);
    const marks = state.marks || [];
    const nightStart = Number(state.nightStart || 0);
    const noTrade = !(marks && marks.length) && (pts.length <= 1 || pts.every((p) => Number(p.value) === nightStart));
    const drawn = drawLineChart(canvas, noTrade ? [] : pts, marks, nightStart);
    const empty = root.querySelector("#chart-empty");
    if (empty) empty.hidden = !drawn.empty;
    root.querySelector("#range-switch").onclick = (e) => {
      const b = e.target.closest("button[data-range]");
      if (!b) return;
      chartRange = b.dataset.range;
      renderHome();
    };
    carousel.querySelectorAll(".agent-card").forEach((c) => {
      c.addEventListener("click", () => go("agents"));
    });
  }

  function sizeCarousel(carousel) {
    const w = Math.max(200, (carousel.parentElement?.clientWidth || document.documentElement.clientWidth) - 32);
    const r = 42 * w / 504;
    carousel.querySelectorAll(".agent-card").forEach((c) => {
      c.style.width = w + "px";
      c.style.aspectRatio = "504 / 470";
      c.style.borderRadius = r + "px";
    });
  }

  function renderAgents() {
    const root = els.agents;
    if (forceLoading && !state) { root.innerHTML = skel(160)+skel(160)+skel(160); return; }
    if (!state) { root.innerHTML = `<div class="empty-note">Listening for graduations</div>`; return; }
    const order = ["scanner", "auditor", "analyst", "executor", "risk"];
    root.innerHTML = order.map((k) => {
      const a = state.agents[k] || {};
      const dec = (agentsExtra[k] && agentsExtra[k].decisions) || a.decisions || [];
      const locked = k === "risk" && a.locked;
      const on = a.running !== false;
      const rows = dec.slice(0, 20).map((d) => `
        <button class="decision" data-go="coin/${encodeURIComponent(d.mint || "")}">
          <time>${escapeHtml(fmtTime(d.ts))}</time>
          <div><strong>${escapeHtml(d.coin || d.mint || "")}</strong> · ${escapeHtml(d.verdict || "")}</div>
          <div>${escapeHtml(d.reason || "")}</div>
        </button>`).join("") || `<div class="empty-note">${k==="scanner"?"Listening for graduations":"Nothing yet tonight"}</div>`;
      return `<section class="agent-full">
        <div class="agent-full-head">
          <span class="dot-run ${on?"":"off"}"></span>
          <h3>${escapeHtml(a.label || k)}</h3>
          <span class="num" style="color:var(--secondary)">${a.taken ?? a.trades ?? a.pools ?? a.count ?? a.open ?? 0}</span>
          <button class="switch ${on?"on":""} ${locked?"locked":""}" data-agent="${k}" aria-label="Pause ${a.label || k}"><i></i></button>
        </div>
        ${rows}
        <button class="settings-link" data-go="account">Settings</button>
      </section>`;
    }).join("");
    root.querySelectorAll(".switch").forEach((sw) => {
      sw.addEventListener("click", () => {
        if (sw.classList.contains("locked")) return;
        // plan B: read-only pause; hint
        toast("Pause an agent with python -m desk.cli pause " + sw.dataset.agent);
      });
    });
  }

  function renderActivity() {
    const root = els.activity;
    if (forceLoading && !state) { root.innerHTML = skel(400); return; }
    const rows = activity.length ? activity : (state && state.activityPreview) || [];
    root.innerHTML = rows.length ? rows.map(activityRow).join("") : `<div class="empty-note">Nothing yet tonight</div>`;
  }

  function renderAccount() {
    const root = els.account;
    if (forceLoading && !account && !state) { root.innerHTML = skel(400); return; }
    const acc = account || {};
    const st = state || {};
    const mode = acc.mode || st.mode || "PAPER";
    const stack = acc.stack ?? st.stack ?? 0;
    const profile = acc.profileUrl || st.profileUrl || "#";
    const signup = acc.signupUrl || st.signupUrl || "#";
    const handle = acc.fomoHandle || st.fomoHandle || "";
    const groups = acc.groups || [];
    const groupsHtml = groups.map((g) => `
      <div class="group" id="settings-${g.name.toLowerCase()}">
        <h3>${escapeHtml(g.name)}</h3>
        ${g.keys.map((k) => `<div class="row"><div class="left">${escapeHtml(k.label)}</div><div class="right num">${escapeHtml(fmtSetting(k.value))}</div></div>`).join("")}
      </div>`).join("");
    root.innerHTML = `
      <div class="group">
        <h3>Account</h3>
        <div class="row"><div class="left">Mode</div><div class="right">${escapeHtml(mode)}</div></div>
        <div class="row"><div class="left">Stack</div><div class="right num">${money(stack)}</div></div>
        ${venue() === "axiom"
          ? `<a class="row" href="${escapeHtml(profile)}" id="venue-profile">
          <div class="left">Ton portfolio Axiom</div><div class="right">Ouvrir</div>
        </a>`
          : `<a class="row" href="${escapeHtml(profile)}" id="fomo-profile">
          <div class="left">Your FOMO profile</div><div class="right">@${escapeHtml(handle)}</div>
        </a>
        <button class="row" id="invite-row"><div class="left">Invite a friend</div><div class="right">Share</div></button>`}
        <div class="row"><div class="left">Notifier</div><div class="right">${escapeHtml(acc.notifierStatus || acc.notifier || "—")}</div></div>
      </div>
      ${groupsHtml}
      <div class="empty-note">${escapeHtml(acc.commandsHint || "Settings change via Grok Bot chat commands (python -m desk.cli).")}</div>
    `;
    const invite = root.querySelector("#invite-row");
    if (invite) invite.addEventListener("click", () => inviteFriend(signup));
  }
  function fmtSetting(v) {
    if (v == null) return "—";
    if (typeof v === "boolean") return v ? "On" : "Off";
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.join(", ") || "—";
    return String(v);
  }
  async function inviteFriend(url) {
    try {
      if (navigator.share) {
        await navigator.share({ title: "FOMO", url });
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Link copied");
    }
  }
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  /* ---------------- coin ---------------- */
  function bucketCandles(prices) {
    const map = new Map();
    for (const p of prices || []) {
      const t = Date.parse(p.ts || p.time);
      if (!t || p.price_usd == null && p.priceUsd == null) continue;
      const minute = Math.floor(t / 60000) * 60000;
      const px = Number(p.price_usd ?? p.priceUsd);
      const vol = Number(p.volume_m5 ?? p.volumeM5 ?? 0);
      let c = map.get(minute);
      if (!c) c = { t: minute, o: px, h: px, l: px, c: px, vol, prevVol: vol };
      else { c.h = Math.max(c.h, px); c.l = Math.min(c.l, px); c.c = px; c.vol = vol; }
      map.set(minute, c);
    }
    const arr = [...map.values()].sort((a, b) => a.t - b.t);
    for (let i = 0; i < arr.length; i++) {
      const prev = i ? arr[i - 1].volAbs ?? arr[i - 1].vol : arr[i].vol;
      arr[i].volAbs = arr[i].vol;
      arr[i].v = Math.max(0, arr[i].vol - (i ? arr[i - 1].volAbs : arr[i].vol));
    }
    return arr;
  }
  function drawCandles(canvas, candlesIn, exitLine) {
    let candles = candlesIn;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 358, h = canvas.clientHeight || 240;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!candles.length) return;
    if (candles.length > 72) candles = candles.slice(-72);
    const volH = 52, padT = 8, padB = 4, padL = 0, padR = 0;
    const ch = h - volH - padT - padB;
    const highs = candles.map((c) => c.h), lows = candles.map((c) => c.l);
    let ymin = Math.min(...lows), ymax = Math.max(...highs);
    if (exitLine != null) { ymin = Math.min(ymin, exitLine); ymax = Math.max(ymax, exitLine); }
    const pad = (ymax - ymin) * 0.1 || ymax * 0.05 || 1e-12;
    ymin -= pad; ymax += pad;
    const yOf = (v) => padT + (1 - (v - ymin) / (ymax - ymin)) * ch;
    const slot = (w - padL - padR) / candles.length;
    const cw = Math.max(3, slot * 0.7);
    candles.forEach((c, i) => {
      const x = padL + (i + 0.5) * slot;
      const up = c.c >= c.o;
      ctx.strokeStyle = ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yOf(c.h)); ctx.lineTo(x, yOf(c.l)); ctx.stroke();
      const y1 = yOf(Math.max(c.o, c.c)), y2 = yOf(Math.min(c.o, c.c));
      ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
    });
    if (exitLine != null) {
      const y = yOf(exitLine);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#ff9f0a";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff9f0a";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.fillText("Risk trailing stop", 8, Math.max(12, y - 4));
    }
    const vmax = Math.max(...candles.map((c) => c.v || 0), 1);
    candles.forEach((c, i) => {
      const x = padL + (i + 0.5) * slot;
      const bh = ((c.v || 0) / vmax) * (volH - 8);
      ctx.fillStyle = c.c >= c.o ? "rgba(0,211,90,0.55)" : "rgba(255,69,58,0.55)";
      ctx.fillRect(x - cw / 2, h - padB - bh, cw, bh);
    });
  }
  function fmtHolders(n) { return n == null ? "n/a" : Number(n).toLocaleString("en-US"); }
  function fmtUsdShort(n) {
    if (n == null) return "n/a";
    const a = Math.abs(n);
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
    return money(n);
  }
  function countdown(s) {
    if (s == null) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return `${h}h ${String(m).padStart(2,"0")}m left`;
    return `${m}m ${String(sec).padStart(2,"0")}s left`;
  }

  async function renderCoin(mint) {
    const root = els.coin;
    if (forceLoading) { root.innerHTML = skel(440); return; }
    let coin = null;
    try { coin = await fetchJson(`coin/${mint}.json`); }
    catch { coin = (state && (state.positions || []).find((p) => p.mint === mint)) || null; }
    if (!coin) { root.innerHTML = `<div class="empty-note">No coin taken apart yet</div>`; return; }
    const pos = coin.position;
    const px = (coin.prices && coin.prices.length) ? Number(coin.prices[coin.prices.length-1].price_usd ?? coin.prices[coin.prices.length-1].priceUsd) : null;
    const entry = pos ? Number(pos.entry_price ?? pos.entryPrice) : null;
    const chg = (px != null && entry) ? ((px - entry) / entry) * 100 : null;
    const age = coin.ageLabel || (coin.ageMin != null ? `${coin.ageMin}m old` : "");
    const sym = coin.symbol || coin.name || "X";
    const layersOk = coin.audit && coin.audit.passed;
    const shield = coin.audit ? `<span class="shield ${layersOk?"":"bad"}">${layersOk ? "8/8" : (coin.audit.layersChecked || 0)+"/8"}</span>` : "";
    const paper = (state && state.mode === "PAPER") ? `<span class="pill paper">PAPER</span>` : "";
    const exitLine = coin.exitLine ?? coin.trailLine ?? coin.stopLine ?? (pos && (pos.exitLine || pos.trailLine || pos.stopLine));
    const since = chg == null ? "" : `<div class="since ${chg>=0?"up":"down"}">${chg>=0?"▲":"▼"} ${Math.abs(chg).toFixed(2)}% since entry</div>`;
    const posCard = pos ? `<div class="pos-card"><h3>Your position · ${money(pos.size_usd ?? pos.sizeUsd)} in · Executor</h3></div>
      <div class="exit-card">
        <h3>Exit</h3>
        <div class="value-row"><span>Stop line</span><span class="v num">${fmtPrice(pos.stopLine ?? pos.stop_line)}</span></div>
        <div class="value-row"><span>Trail line</span><span class="v num">${pos.trailLine != null ? fmtPrice(pos.trailLine) : "Not on"}</span></div>
        <div class="value-row"><span>Timeout</span><span class="v num">${countdown(pos.timeoutLeftS)}</span></div>
      </div>` : "";
    const btn = pos
      ? `<a class="fomo-btn" href="${escapeHtml(coin.link || pos.link)}">${venueLabel("sell")}</a>`
      : `<a class="fomo-btn" href="${escapeHtml(coin.link || "#")}">${venueLabel("buy")}</a>`;
    root.innerHTML = `
      <div class="screen-pad">
        <div class="eyebrow">${escapeHtml(coin.name || "")} · Solana · ${escapeHtml(age)} ${shield} ${paper}</div>
        <div class="price-big num">${fmtPrice(px)}</div>
        ${since}
      </div>
      <div class="chart-wrap" style="height:260px"><canvas id="coin-chart"></canvas></div>
      <div class="screen-pad">
        <div class="stats">
          <div><div class="stat-label">Market cap</div><div class="stat-value">${fmtUsdShort(coin.marketCapUsd)}</div></div>
          <div><div class="stat-label">Liquidity</div><div class="stat-value">${fmtUsdShort(coin.liquidityUsd)}</div></div>
          <div><div class="stat-label">24h volume</div><div class="stat-value">${fmtUsdShort(coin.volume24hUsd)}</div></div>
          <div><div class="stat-label">Holders</div><div class="stat-value">${fmtHolders(coin.holders)}</div></div>
        </div>
        ${posCard}
        ${btn}
        ${coin.audit ? `<button class="settings-link" data-go="audit/${encodeURIComponent(mint)}">Auditor</button>` : ""}
      </div>`;
    const canvas = root.querySelector("#coin-chart");
    drawCandles(canvas, bucketCandles(coin.prices || []), exitLine != null ? Number(exitLine) : null);
  }

  async function renderAuditor(mint) {
    const root = els.auditor;
    if (forceLoading) { root.innerHTML = skel(400); return; }
    if (!mint && state && !state.latestAudit) {
      root.innerHTML = `<div class="empty-note">No coin taken apart yet</div>`;
      return;
    }
    let audit = null;
    const id = mint || (state && state.latestAudit && state.latestAudit.mint);
    if (id) {
      try { audit = await fetchJson(`audit/${id}.json`); }
      catch { audit = state && state.latestAudit; }
    }
    if (!audit) { root.innerHTML = `<div class="empty-note">No coin taken apart yet</div>`; return; }
    const layers = audit.layers || [];
    const name = audit.name || (state && state.latestAudit && state.latestAudit.name) || id;
    const passed = !!audit.passed;
    const size = audit.sizeUsd;
    const enabled = audit.auditorEnabled !== false;
    const discs = Array.from({ length: 8 }, (_, i) => {
      const top = 8 + i * 22;
      const L = layers.find((x) => x.n === i + 1) || {};
      return `<div class="disc" data-n="${i+1}" style="top:${top}px;z-index:${8-i}">${i+1}</div>`;
    }).join("");
    const rows = layers.map((L) => `
      <div class="value-row ${L.pass===true?"ok":L.pass===false?"no":""}" data-n="${L.n}">
        <span class="n">${L.n}. ${escapeHtml(L.name || "")}</span>
        <span class="v">${escapeHtml(L.value || "")}</span>
      </div>`).join("");
    const verdict = passed
      ? `<div class="verdict-card" id="verdict" hidden><h3>Cleared · 8/8 parts</h3><p>Sent to Executor · ${size != null ? money(size) : "—"}</p></div>`
      : `<div class="verdict-card" id="verdict" hidden><h3>Rejected · ${escapeHtml(audit.reason || "")}</h3><p>Grok Bot won't buy ${escapeHtml(name)}</p></div>`;
    root.innerHTML = `
      <div class="screen-pad">
        <div class="eyebrow">${escapeHtml(name)}</div>
        <div class="disc-stack">${discs}<div class="beam" id="beam"></div></div>
        <div class="value-rows">${rows}</div>
        ${verdict}
        <div class="toggle-row">
          <span>Take apart before buying</span>
          <div class="switch ${enabled?"on":""} locked" aria-disabled="true"><i></i></div>
        </div>
        <a class="fomo-btn" href="${escapeHtml(audit.link || "#")}">${venueLabel("open")}</a>
      </div>`;
    runBeam(root, layers, reduced);
  }

  function runBeam(root, layers, instant) {
    const beam = root.querySelector("#beam");
    const discs = [...root.querySelectorAll(".disc")];
    const verdict = root.querySelector("#verdict");
    const apply = (i) => {
      const L = layers.find((x) => x.n === i + 1);
      const d = discs[i];
      if (!d) return;
      if (L && L.pass === true) d.classList.add("ok");
      else if (L && L.pass === false) d.classList.add("no");
    };
    if (instant) {
      discs.forEach((_, i) => apply(i));
      if (verdict) verdict.hidden = false;
      return;
    }
    let i = 0;
    const step = () => {
      if (i >= 8) {
        if (beam) beam.classList.remove("on");
        setTimeout(() => { if (verdict) verdict.hidden = false; }, 150);
        return;
      }
      const d = discs[i];
      if (beam && d) {
        beam.classList.add("on");
        beam.style.top = (8 + i * 22 + 8) + "px";
      }
      const L = layers.find((x) => x.n === i + 1);
      // wait 350ms; if no result yet, stay (we only have complete payloads)
      setTimeout(() => {
        apply(i);
        i += 1;
        step();
      }, 350);
    };
    step();
  }

  function collectSearchables() {
    const out = [];
    const seen = new Set();
    const add = (c) => {
      if (!c || !c.mint || seen.has(c.mint)) return;
      seen.add(c.mint);
      out.push(c);
    };
    (state && state.waitingRoom || []).forEach(add);
    (state && state.positions || []).forEach(add);
    (state && state.recentKills || []).forEach(add);
    if (state && state.latestAudit) add(state.latestAudit);
    activity.forEach((a) => add({ mint: a.mint, name: a.title }));
    return out;
  }

  function renderSearch(q) {
    const query = (q || "").trim().toLowerCase();
    const items = collectSearchables().filter((c) => {
      if (!query) return true;
      return [c.name, c.symbol, c.mint].some((x) => String(x || "").toLowerCase().includes(query));
    });
    els.searchResults.innerHTML = items.map((c) => `
      <button class="activity-row" data-go="coin/${encodeURIComponent(c.mint)}">
        <div class="activity-title">${escapeHtml(c.name || c.mint)}</div>
        <div class="activity-sub">${escapeHtml(c.mint)}</div>
      </button>`).join("") || `<div class="empty-note">No matches</div>`;
  }

  // Which desk this data path belongs to: "axiom" (desk-axiom) or "fomo" (default, older state files).
  function venue() {
    const v = (state && state.venue) || (account && account.venue) || "fomo";
    return String(v).toLowerCase() === "axiom" ? "axiom" : "fomo";
  }
  function venueLabel(kind) {
    if (venue() === "axiom") {
      return { buy: "Acheter sur Axiom", sell: "Vendre sur Axiom", open: "Ouvrir sur Axiom" }[kind];
    }
    return { buy: "Buy on FOMO", sell: "Sell on FOMO", open: "Open on FOMO" }[kind];
  }
  function applyDeskBadge() {
    const name = venue() === "axiom" ? "Axiom" : "FOMO";
    const text = `Grok Bot · ${name} ›`;
    if (els.brand && els.brand.textContent !== text) els.brand.textContent = text;
    const title = `Grok Bot · ${name}`;
    if (document.title !== title) document.title = title;
  }

  function render() {
    applyDeskBadge();
    if (els.bellDot) els.bellDot.hidden = !(state && state.unreadPushes);
    const { screen, id } = route;
    if (screen === "agents") { showScreen("agents"); renderAgents(); }
    else if (screen === "activity") { showScreen("activity"); renderActivity(); }
    else if (screen === "account") { showScreen("account"); renderAccount(); }
    else if (screen === "coin") { showScreen("coin"); renderCoin(id); }
    else if (screen === "audit" || screen === "auditor") { showScreen("auditor"); renderAuditor(id); }
    else { showScreen("home"); renderHome(); }
  }

  document.addEventListener("click", (e) => {
    const goBtn = e.target.closest("[data-go]");
    if (goBtn) {
      e.preventDefault();
      go(goBtn.getAttribute("data-go"));
    }
  });
  els.tabbar.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) go(b.dataset.tab);
  });
  els.avatar.addEventListener("click", () => go("account"));
  els.brand.addEventListener("click", () => go("account"));
  els.search.addEventListener("click", () => {
    els.sheet.hidden = false;
    els.searchInput.value = "";
    renderSearch("");
    els.searchInput.focus();
  });
  els.searchClose.addEventListener("click", () => { els.sheet.hidden = true; });
  els.searchInput.addEventListener("input", () => renderSearch(els.searchInput.value));

  window.addEventListener("resize", () => {
    if (route.screen === "home" || !route.screen) renderHome();
  });

  // load agent decisions lazily for the Agents tab
  async function loadDecisions() {
    if (!state) return;
    for (const name of ["scanner","auditor","analyst","executor","risk"]) {
      try { agentsExtra[name] = await fetchJson(`agents/${name}.json`); }
      catch {
        if (state.agents && state.agents[name] && state.agents[name].decisions) {
          agentsExtra[name] = { name, decisions: state.agents[name].decisions };
        }
      }
    }
    if (route.screen === "agents") renderAgents();
  }

  refresh().then(loadDecisions);
  if (!forceError && !forceLoading) {
    pollTimer = setInterval(() => { refresh().then(loadDecisions); }, POLL_MS);
  }
})();
