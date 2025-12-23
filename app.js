// ====== UI ======
const screenHome = document.getElementById("screen-home");
const screenA = document.getElementById("screen-a");

const btnMale = document.getElementById("btnMale");
const btnFemale = document.getElementById("btnFemale");
const btnCapture = document.getElementById("btnCapture");
const btnSwitchCamera = document.getElementById("btnSwitchCamera");
const btnRetry = document.getElementById("btnRetry");
const btnBack = document.getElementById("btnBack");

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");

const scoreEl = document.getElementById("score");
const pickImg = document.getElementById("pickImg");
const pickName = document.getElementById("pickName");
const detail = document.getElementById("detail");

const criteriaHeader = document.getElementById("criteriaHeader");
const criteriaList = document.getElementById("criteriaList");

// ====== Pose ======
let pose = null;

// ====== Camera ======
let stream = null;
let facingMode = "user"; // user / environment

// ====== State ======
let selectedGender = "male";
let analyzeInFlight = false;
let timerInFlight = false;
let countdownTimer = null;

// captured still (for analysis overlay)
let capturedCanvas = null;

// preview loop
let previewRunning = false;
let previewBusy = false;
let previewRafId = null;

// ====== Landmark index (MediaPipe Pose 33) ======
const IDX = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,

  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_HIP: 23, RIGHT_HIP: 24,

  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
};

const MIN_VIS = 0.18;

// ====== 점수 기준(널널) ======
const FACE_GOOD = 0.12, FACE_BAD = 0.36;   // 머리 작을수록 좋음
const TORSO_GOOD = 0.18, TORSO_BAD = 0.46; // 상체 작을수록 좋음
const LEG_BAD = 0.30, LEG_GOOD = 0.78;     // 하체 길수록 좋음

const W_FACE = 0.28, W_TORSO = 0.28, W_LEG = 0.44;
const SCORE_FLOOR = 15;

// ====== 성별별 라벨/사진 ======
const GENDER_MAP = {
  male: {
    header: "남자 점수 기준",
    items: [
      { key: "top", code: "a2", label: "최상급 비율", src: "./assets/a2.jpg", bandText: "85점 이상" },
      { key: "high", code: "b2", label: "상급 비율",   src: "./assets/b2.jpg", bandText: "75~84점" },
      { key: "mid", code: "c2", label: "중급 비율",   src: "./assets/c2.jpg", bandText: "65~74점" },
      { key: "low", code: "d2", label: "하급 비율",   src: "./assets/d2.jpg", bandText: "64점 이하" },
    ],
  },
  female: {
    header: "여자 점수 기준",
    items: [
      { key: "top", code: "a1", label: "최상급 비율", src: "./assets/a1.jpg", bandText: "85점 이상" },
      { key: "high", code: "b1", label: "상급 비율",   src: "./assets/b1.jpg", bandText: "75~84점" },
      { key: "mid", code: "c1", label: "중급 비율",   src: "./assets/c1.jpg", bandText: "65~74점" },
      { key: "low", code: "d1", label: "하급 비율",   src: "./assets/d1.jpg", bandText: "64점 이하" },
    ],
  },
};

// =========================
// Events
// =========================
btnMale?.addEventListener("click", () => startFlow("male"));
btnFemale?.addEventListener("click", () => startFlow("female"));
btnCapture?.addEventListener("click", () => captureWithDelay(3));
btnSwitchCamera?.addEventListener("click", () => switchCamera());
btnRetry?.addEventListener("click", () => resetForRetry());
btnBack?.addEventListener("click", () => goHome());
window.addEventListener("resize", () => fitCanvasToVideo());

// =========================
// Screens
// =========================
function goHome() {
  stopCamera();
  screenA.classList.remove("active");
  screenHome.classList.add("active");
}
function goA() {
  screenHome.classList.remove("active");
  screenA.classList.add("active");
}

// =========================
// Start
// =========================
async function startFlow(gender) {
  selectedGender = gender;
  goA();
  setIdleResult();
  renderCriteria();

  try {
    statusEl.textContent = "카메라 준비 중…";
    await initPoseIfNeeded();
    await startCamera();
    statusEl.textContent = `준비 완료! (${facingMode === "user" ? "전면" : "후면"}) 전신 맞추고 촬영하기`;
    startPreviewLoop();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "카메라 시작 실패: HTTPS/권한(허용)/브라우저 설정 확인(F12 콘솔).";
  }
}

function setIdleResult() {
  scoreEl.textContent = "-";
  pickImg.src = "";
  pickName.textContent = "-";
  detail.textContent = "촬영하기 버튼을 눌러 측정해줘.";

  hideCountdown();
  clearOverlay();
  capturedCanvas = null;
}

function renderCriteria() {
  const cfg = GENDER_MAP[selectedGender];
  criteriaHeader.textContent = cfg.header;
  criteriaList.innerHTML = "";
  for (const it of cfg.items) {
    const li = document.createElement("li");
    li.textContent = `${it.label}  `;
    const span = document.createElement("span");
    span.textContent = `(${it.bandText} → ${it.code})`;
    li.appendChild(span);
    criteriaList.appendChild(li);
  }
}

// =========================
// Pose init
// =========================
async function initPoseIfNeeded() {
  if (pose) return;
  if (typeof Pose === "undefined") throw new Error("pose.js 로드 실패");

  pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    selfieMode: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  pose.onResults(onResults);
}

// =========================
// Camera
// =========================
async function startCamera() {
  if (stream) return;

  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    throw new Error("카메라는 HTTPS 또는 localhost에서만 동작합니다.");
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  video.srcObject = stream;
  await video.play();

  applyMirrorMode();
  fitCanvasToVideo();
}

function stopCamera() {
  stopPreviewLoop();
  cancelCountdown();

  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  video.srcObject = null;

  analyzeInFlight = false;
  timerInFlight = false;
  capturedCanvas = null;

  hideCountdown();
  clearOverlay();
}

function applyMirrorMode() {
  const mirror = (facingMode === "user"); // 전면일 때만 거울
  video.classList.toggle("mirrored", mirror);
  overlay.classList.toggle("mirrored", mirror);
  countdownEl.classList.toggle("mirrored", mirror);
}

// =========================
// Preview loop
// =========================
function startPreviewLoop() {
  if (!pose || !stream) return;
  if (previewRunning) return;
  previewRunning = true;

  const tick = async () => {
    if (!previewRunning) return;

    if (timerInFlight || analyzeInFlight) {
      previewRafId = requestAnimationFrame(tick);
      return;
    }

    if (!previewBusy) {
      previewBusy = true;
      try {
        await pose.send({ image: video });
      } catch (e) {
        console.error(e);
        previewBusy = false;
      }
    }
    previewRafId = requestAnimationFrame(tick);
  };

  tick();
}

function stopPreviewLoop() {
  previewRunning = false;
  previewBusy = false;
  if (previewRafId) cancelAnimationFrame(previewRafId);
  previewRafId = null;
}

// =========================
// Switch camera
// =========================
async function switchCamera() {
  if (analyzeInFlight || timerInFlight) return;

  const prev = facingMode;
  facingMode = (facingMode === "user") ? "environment" : "user";

  statusEl.textContent = `전환 중… (${facingMode === "user" ? "전면" : "후면"})`;
  setIdleResult();

  try {
    stopCamera();
    await startCamera();
    statusEl.textContent = `준비 완료! (${facingMode === "user" ? "전면" : "후면"}) 전신 맞추고 촬영하기`;
    startPreviewLoop();
  } catch (e) {
    console.error(e);
    facingMode = prev;
    stopCamera();
    try { await startCamera(); startPreviewLoop(); } catch {}
    statusEl.textContent = "카메라 전환 실패(기기에 후면 카메라가 없을 수 있음).";
  }
}

// =========================
// 3초 후 촬영
// =========================
async function captureWithDelay(seconds) {
  if (!stream || !pose) return;
  if (analyzeInFlight || timerInFlight) return;

  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;

  timerInFlight = true;
  showCountdown(seconds);
  statusEl.textContent = `촬영까지 ${seconds}초…`;

  let left = seconds;
  countdownTimer = setInterval(async () => {
    left -= 1;
    if (left > 0) {
      updateCountdown(left);
      statusEl.textContent = `촬영까지 ${left}초…`;
      return;
    }
    cancelCountdown();
    hideCountdown();
    statusEl.textContent = "촬영/분석 중…";
    await captureAndAnalyze();
  }, 1000);
}

function cancelCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  timerInFlight = false;
}
function showCountdown(n) {
  countdownEl.textContent = String(n);
  countdownEl.classList.add("show");
}
function updateCountdown(n) {
  countdownEl.textContent = String(n);
}
function hideCountdown() {
  countdownEl.classList.remove("show");
}

// =========================
// Capture (저장 없음)
// =========================
async function captureAndAnalyze() {
  analyzeInFlight = true;

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  const cap = document.createElement("canvas");
  cap.width = vw;
  cap.height = vh;
  cap.getContext("2d").drawImage(video, 0, 0, vw, vh);
  capturedCanvas = cap;

  try { video.pause(); } catch {}

  try {
    await pose.send({ image: cap });
  } catch (e) {
    console.error(e);
    analyzeInFlight = false;
    statusEl.textContent = "분석 실패. 다시 촬영해줘.";
    try { await video.play(); } catch {}
  }
}

function resetForRetry() {
  if (analyzeInFlight || timerInFlight) return;
  capturedCanvas = null;
  setIdleResult();
  statusEl.textContent = "전신 맞추고 촬영하기";
  try { video.play(); } catch {}
}

// =========================
// Pose results
// =========================
function onResults(results) {
  if (analyzeInFlight) {
    analyzeInFlight = false;

    drawCaptured(results);

    if (!results.poseLandmarks) {
      scoreEl.textContent = "측정실패";
      statusEl.textContent = "사람 인식 실패. 전신 나오게 다시!";
      try { video.play(); } catch {}
      return;
    }

    const prop = measureProportionsY(
      results.poseLandmarks,
      capturedCanvas?.width || video.videoWidth,
      capturedCanvas?.height || video.videoHeight
    );

    if (!prop) {
      scoreEl.textContent = "측정실패";
      statusEl.textContent = "측정 실패(머리/어깨/골반/발이 보여야 함).";
      try { video.play(); } catch {}
      return;
    }

    const score = scoreFromProp(prop);
    const rounded = Math.round(score);
    scoreEl.textContent = `${rounded}점`;

    const pick = pickByScore(score, selectedGender);
    pickImg.src = pick.src;
    pickName.textContent = pick.label;

    const [f,t,l] = prop;
    detail.textContent =
      `비율(머리/상체/하체): ${f.toFixed(3)} / ${t.toFixed(3)} / ${l.toFixed(3)} · 구간: ${scoreBandText(score)} · 선택: ${pick.code}`;

    statusEl.textContent = "완료!";
    try { video.play(); } catch {}
    return;
  }

  previewBusy = false;
  if (!results.poseLandmarks) { clearOverlay(); return; }
  drawPreviewGuides(results.poseLandmarks);
}

// =========================
// 측정: y 기반
// =========================
function measureProportionsY(lm, w, h) {
  const ls = lm[IDX.LEFT_SHOULDER], rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP], rh = lm[IDX.RIGHT_HIP];
  if (!ok(ls) || !ok(rs) || !ok(lh) || !ok(rh)) return null;

  const shoulderY = (ls.y + rs.y) / 2 * h;
  const hipY = (lh.y + rh.y) / 2 * h;

  const headCandidates = [
    lm[IDX.NOSE],
    lm[IDX.LEFT_EYE_INNER], lm[IDX.LEFT_EYE], lm[IDX.LEFT_EYE_OUTER],
    lm[IDX.RIGHT_EYE_INNER], lm[IDX.RIGHT_EYE], lm[IDX.RIGHT_EYE_OUTER],
    lm[IDX.LEFT_EAR], lm[IDX.RIGHT_EAR],
  ].filter(ok);
  if (headCandidates.length === 0) return null;

  let headMinY = Infinity;
  for (const p of headCandidates) headMinY = Math.min(headMinY, p.y * h);

  const headToShoulder = Math.max(5, shoulderY - headMinY);
  const headTopY = Math.max(0, headMinY - headToShoulder * 0.30);

  const leftFootMaxY = maxY(lm, [IDX.LEFT_FOOT_INDEX, IDX.LEFT_HEEL, IDX.LEFT_ANKLE], h);
  const rightFootMaxY = maxY(lm, [IDX.RIGHT_FOOT_INDEX, IDX.RIGHT_HEEL, IDX.RIGHT_ANKLE], h);
  if (!Number.isFinite(leftFootMaxY) || !Number.isFinite(rightFootMaxY)) return null;
  const footY = (leftFootMaxY + rightFootMaxY) / 2;

  const faceLen = shoulderY - headTopY;
  const torsoLen = hipY - shoulderY;
  const legLen = footY - hipY;

  if (faceLen <= 5 || torsoLen <= 5 || legLen <= 5) return null;

  const sum = faceLen + torsoLen + legLen;
  return [faceLen / sum, torsoLen / sum, legLen / sum];
}

function maxY(lm, indices, h) {
  let best = -Infinity;
  let has = false;
  for (const idx of indices) {
    const p = lm[idx];
    if (!ok(p)) continue;
    has = true;
    best = Math.max(best, p.y * h);
  }
  return has ? best : NaN;
}

function ok(p) {
  return p && (p.visibility ?? 0) >= MIN_VIS && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// =========================
// 점수
// =========================
function scoreFromProp([face, torso, leg]) {
  const faceScore = scoreLowBetter(face, FACE_GOOD, FACE_BAD);
  const torsoScore = scoreLowBetter(torso, TORSO_GOOD, TORSO_BAD);
  const legScore = scoreHighBetter(leg, LEG_BAD, LEG_GOOD);

  const total =
    faceScore * W_FACE +
    torsoScore * W_TORSO +
    legScore * W_LEG;

  const raw = total / (W_FACE + W_TORSO + W_LEG);
  const x = raw / 100;        // 0~1
  const CENTER = 0.50;
  const STEEP = 10;

  const y = 0.5 + 0.5 * Math.tanh(STEEP * (x - CENTER)); // 0~1
  const contrasted = y * 100; // 0~100
  const withFloor = SCORE_FLOOR + (100 - SCORE_FLOOR) * (contrasted / 100);
  return clamp(withFloor, SCORE_FLOOR, 100);
}

function scoreLowBetter(x, good, bad) {
  if (x <= good) return 100;
  if (x >= bad) return 0;
  const t = (x - good) / (bad - good);
  return 100 * (1 - t);
}
function scoreHighBetter(x, bad, good) {
  if (x <= bad) return 0;
  if (x >= good) return 100;
  const t = (x - bad) / (good - bad);
  return 100 * t;
}

// =========================
// Pick
// =========================
function pickByScore(score, gender) {
  const cfg = GENDER_MAP[gender] || GENDER_MAP.male;
  let key = "low";
  if (score >= 85) key = "top";
  else if (score >= 75) key = "high";
  else if (score >= 65) key = "mid";
  return cfg.items.find(x => x.key === key) || cfg.items[cfg.items.length - 1];
}
function scoreBandText(score) {
  if (score >= 85) return "85점 이상";
  if (score >= 75) return "75~84";
  if (score >= 65) return "65~74";
  return "64 이하";
}

// =========================
// Preview guides
// =========================
function drawPreviewGuides(lm) {
  fitCanvasToVideo();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (typeof drawConnectors === "function" && typeof POSE_CONNECTIONS !== "undefined") {
    drawConnectors(ctx, lm, POSE_CONNECTIONS, { lineWidth: 3 });
  }
  if (typeof drawLandmarks === "function") {
    drawLandmarks(ctx, lm, { lineWidth: 2 });
  }

  const prop = measureProportionsY(lm, overlay.width, overlay.height);
  if (!prop) return;

  const [f,t,l] = prop;
  const barX = 20, barW = 18, barTop = 20;
  const barH = Math.max(160, Math.min(overlay.height - 40, 260));
  const fH = barH * f, tH = barH * t, lH = barH * l;

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, barX - 8, barTop - 8, barW + 16, barH + 16, 12, true, false);

  ctx.fillStyle = "rgba(90,209,255,0.85)";
  ctx.fillRect(barX, barTop, barW, fH);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(barX, barTop + fH, barW, tH);
  ctx.fillStyle = "rgba(180,140,255,0.75)";
  ctx.fillRect(barX, barTop + fH + tH, barW, lH);

  ctx.restore();
}

// =========================
// Draw captured image
// =========================
function drawCaptured(results) {
  fitCanvasToVideo();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (capturedCanvas) ctx.drawImage(capturedCanvas, 0, 0, overlay.width, overlay.height);

  if (results.poseLandmarks && typeof drawConnectors === "function" && typeof POSE_CONNECTIONS !== "undefined") {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { lineWidth: 3 });
  }
  if (results.poseLandmarks && typeof drawLandmarks === "function") {
    drawLandmarks(ctx, results.poseLandmarks, { lineWidth: 2 });
  }
}

// =========================
// Layout helpers
// =========================
function fitCanvasToVideo() {
  const w = video.clientWidth || 1280;
  const h = video.clientHeight || 720;
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
}
function clearOverlay() {
  fitCanvasToVideo();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
