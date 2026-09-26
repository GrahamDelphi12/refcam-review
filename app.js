const FUNCTIONS = "https://us-central1-refcam-15b10.cloudfunctions.net";

const roomCode = document.getElementById("room-code");
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

async function ensureRoom() {
  const existing = tokenFromLocation();
  if (existing) return existing;
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
  roomCode.textContent = token;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function renderIds(room) {
  const devices = unique([...(room.deviceKeys || []), ...((room.clips || []).map((c) => c.deviceKey))]);
  const refs = unique([...(room.refereeIds || []), ...((room.clips || []).map((c) => c.refereeId))]);
  idDevice.textContent = devices.length ? devices.join("\n") : "Waiting for a scan…";
  idRef.textContent = refs.length ? refs.join("\n") : "Waiting for a scan…";
}

let clipFingerprint = "";
let selectedName = null;

function renderClips(clips) {
  const fingerprint = clips
    .map((clip) => `${clip.fileName}\0${clip.playUrl || ""}\0${clip.sizeBytes || 0}`)
    .join("|");
  if (fingerprint === clipFingerprint && clipsEl.childElementCount) return;
  clipFingerprint = fingerprint;

  clipsEl.innerHTML = "";
  if (!clips.length) {
    statusEl.textContent = "Scan the code on the recording phone to gather its IDs.";
    return;
  }
  statusEl.textContent = `${clips.length} clip${clips.length === 1 ? "" : "s"} matched to the IDs on this room.`;
  clips.forEach((clip, index) => {
    const item = document.createElement("li");
    const ref = clip.refereeId || "unregistered";
    const device = clip.deviceKey || "—";
    item.innerHTML = `<div class="name">${clip.fileName || "clip"}</div>
      <div class="meta">Referee ${ref} · Device ${device}</div>
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

async function refresh(token) {
  const response = await fetch(`${FUNCTIONS}/listClips?token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    statusEl.textContent = body.error || "The room could not be read. Functions may not be deployed yet.";
    return;
  }
  const body = await response.json();
  renderIds(body);
  renderClips(body.clips || []);
}

async function start() {
  try {
    const token = await ensureRoom();
    drawQr(token);
    statusEl.textContent = "Scan this code from Link to review site.";
    await refresh(token);
    setInterval(() => refresh(token), 4000);
  } catch (error) {
    statusEl.textContent = error.message || "The review page failed to open.";
  }
}

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
