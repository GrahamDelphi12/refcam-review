const FUNCTIONS = "https://us-central1-refcam-15b10.cloudfunctions.net";

const statusEl = document.getElementById("status");
const clipsEl = document.getElementById("clips");
const player = document.getElementById("player");
const playerWrap = document.querySelector(".player-wrap");
const qrHost = document.getElementById("qr");
const idDevice = document.getElementById("id-device");
const idRef = document.getElementById("id-ref");

function siteBase() {
  return window.SITE_BASE || "/";
}

function tokenFromLocation() {
  const path = location.pathname.match(/\/w\/([A-Za-z0-9_-]{8,})/);
  if (path) return path[1];
  const query = new URLSearchParams(location.search).get("t");
  return query && /^[A-Za-z0-9_-]{8,}$/.test(query) ? query : null;
}

function roomUrl(token) {
  const origin = location.origin;
  const base = siteBase().replace(/\/$/, "");
  return `${origin}${base}/w/${token}`;
}

async function createRoom() {
  const response = await fetch(`${FUNCTIONS}/createRoom`, { method: "POST" });
  if (!response.ok) throw new Error("Could not open a review room.");
  const body = await response.json();
  history.replaceState({}, "", `${siteBase()}w/${body.token}`);
  return body.token;
}

function drawQr(token) {
  qrHost.innerHTML = "";
  const size = Math.min(qrHost.clientWidth || 300, 360);
  // eslint-disable-next-line no-undef
  new QRCode(qrHost, {
    text: roomUrl(token),
    width: size,
    height: size,
    colorDark: "#0f2a4a",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function shortId(value) {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function renderIds(room) {
  const devices = unique([...(room.deviceKeys || []), ...((room.clips || []).map((c) => c.deviceKey))]);
  const refs = unique([...(room.refereeIds || []), ...((room.clips || []).map((c) => c.refereeId))]);
  idDevice.textContent = devices.length ? devices.join("\n") : "Waiting for a scan…";
  if (room.scope === "referee" && refs.length) {
    idRef.textContent = `${refs.join("\n")}\n(all devices for this official)`;
  } else {
    idRef.textContent = refs.length ? refs.join("\n") : "This phone only until a live referee ID is used.";
  }
}

let clipFingerprint = "";
let selectedName = null;

function renderClips(clips) {
  const fingerprint = clips
    .map((clip) => `${clip.fileName}\0${clip.playUrl || ""}\0${clip.sizeBytes || 0}\0${clip.deviceKey || ""}`)
    .join("|");
  if (fingerprint === clipFingerprint && clipsEl.childElementCount) return;
  clipFingerprint = fingerprint;

  clipsEl.innerHTML = "";
  if (!clips.length) {
    statusEl.textContent = "Scan the code on the recording phone to gather its files.";
    return;
  }
  statusEl.textContent = `${clips.length} clip${clips.length === 1 ? "" : "s"} on this room.`;
  clips.forEach((clip, index) => {
    const item = document.createElement("li");
    const device = clip.deviceKey ? shortId(clip.deviceKey) : "—";
    const ref = clip.refereeId || "";
    item.innerHTML = `<div class="name">${clip.fileName || "clip"}</div>
      <div class="meta">Device ${device}${ref ? ` · Referee ${ref}` : ""}</div>
      <div class="path">${clip.gsUri || clip.storagePath || ""}</div>`;
    item.addEventListener("click", () => {
      selectedName = clip.fileName;
      play(clip, item);
    });
    clipsEl.appendChild(item);
    const chosen = selectedName
      ? clip.fileName === selectedName
      : index === 0 && !player.src;
    if (chosen) {
      item.classList.add("active");
      if (clip.playUrl && !player.src) play(clip, item);
    }
  });
}

function play(clip, item) {
  [...clipsEl.children].forEach((node) => node.classList.remove("active"));
  item.classList.add("active");
  if (!clip.playUrl) {
    statusEl.textContent = `${clip.fileName || "This clip"} is listed but not playable yet.`;
    return;
  }
  if (player.src !== clip.playUrl) {
    player.src = clip.playUrl;
  }
  playerWrap.classList.add("has-video");
  player.play().catch(() => {
    statusEl.textContent = "The browser could not start this clip.";
  });
}

const IDLE_MS = 5 * 60 * 1000;
let activeToken = null;
let pollTimer = null;
let idleTimer = null;
let sessionLive = false;

function claimed(room) {
  return (room.deviceKeys || []).length > 0 || (room.refereeIds || []).length > 0;
}

function clearFiles() {
  clipFingerprint = "";
  selectedName = null;
  clipsEl.innerHTML = "";
  player.pause();
  player.removeAttribute("src");
  player.load();
  playerWrap.classList.remove("has-video");
  idDevice.textContent = "Waiting for a scan…";
  idRef.textContent = "Waiting for a scan…";
}

function bumpIdle() {
  if (!sessionLive) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    lockSession().catch((error) => {
      statusEl.textContent = error.message || "The review page timed out.";
    });
  }, IDLE_MS);
}

async function lockSession() {
  sessionLive = false;
  clearTimeout(idleTimer);
  clearInterval(pollTimer);
  clearFiles();
  statusEl.textContent = "Idle for 5 minutes. Scan the new code to see the files again.";
  await openSession();
}

async function refresh(token) {
  const response = await fetch(`${FUNCTIONS}/listClips?token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    statusEl.textContent = body.error || "The room could not be read. Functions may not be deployed yet.";
    return;
  }
  const body = await response.json();
  if (!claimed(body)) {
    clearFiles();
    statusEl.textContent = "Scan this code from Link to review site. Files stay hidden until the phone links.";
    return;
  }
  renderIds(body);
  renderClips(body.clips || []);
}

async function openSession() {
  const token = await createRoom();
  activeToken = token;
  drawQr(token);
  sessionLive = true;
  bumpIdle();
  await refresh(token);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (activeToken === token) refresh(token);
  }, 4000);
}

async function start() {
  try {
    clearFiles();
    statusEl.textContent = "Opening a new room…";
    await openSession();
  } catch (error) {
    statusEl.textContent = error.message || "The review page failed to open.";
  }
}

["mousemove", "keydown", "touchstart", "pointerdown", "click"].forEach((name) => {
  window.addEventListener(name, bumpIdle, { passive: true });
});
player.addEventListener("timeupdate", bumpIdle);

window.addEventListener("resize", () => {
  const token = tokenFromLocation();
  if (token && qrHost.childElementCount) drawQr(token);
});

const apkButton = document.getElementById("apk-download");
const apkGate = document.getElementById("apk-gate");
const apkForm = document.getElementById("apk-form");
const apkPassword = document.getElementById("apk-password");
const apkError = document.getElementById("apk-error");
const apkCancel = document.getElementById("apk-cancel");

function releaseApk() {
  const link = document.createElement("a");
  link.href = `${siteBase()}downloads/refcam.apk`;
  link.download = "RefCam.apk";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

if (apkButton && apkGate && apkForm) {
  apkButton.addEventListener("click", () => {
    apkError.hidden = true;
    apkPassword.value = "";
    apkGate.showModal();
    apkPassword.focus();
  });
  apkCancel.addEventListener("click", () => apkGate.close());
  apkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (apkPassword.value !== "RefCam") {
      apkError.hidden = false;
      apkPassword.focus();
      apkPassword.select();
      return;
    }
    apkGate.close();
    releaseApk();
  });
}

start();
