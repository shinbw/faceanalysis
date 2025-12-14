/* =========================================================
   - 촬영하기 누르면 3초 카운트다운 후 촬영(1장 분석)
   - 남/여 점수 구간별 고정 추천
   - 전면/후면 카메라 전환(재시작)
   - 전면(user)만 거울모드 ON
   ========================================================= */

// ====== MIN/MAX (요구사항) ======
const MIN = [19, 27, 50];
const MAX = [43, 62, 140];
const MIN_PROP = normalize(MIN);
const MAX_PROP = normalize(MAX);

// ====== 추천 매핑 ======
const PICK_MAP = {
  male: [
    { min: 70, name: "a2", src: "./assets/a2.jpg" },
    { min: 50, name: "b2", src: "./assets/b2.jpg" },
    { min: 40, name: "c2", src: "./assets/c2.jpg" },
    { min: -Infinity, name: "d2", src: "./assets/d2.jpg" },
  ],
  female: [
    { min: 70, name: "a1", src: "./assets/a1.jpg" },
    { min: 50, name: "b1", src: "./assets/b1.jpg" },
    { min: 40, name: "c1", src: "./assets/c1.jpg" },
    { min: -Infinity, name: "d1", src: "./assets/d1.jpg" },
  ],
};

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

// ====== Pose ======
let pose = null;

// ====== Camera ======
let stream = null;
let facingMode = "user"; // user(전면) / environment(후면)

// ====== State ======
let selectedGender = "male";
let analyzeInFlight = false;   // 분석 중(포즈 send 처리중)
let timerInFlight = false;     // 카운트다운 진행중
let countdownTimer = null;

let capturedCanvas = null;

// ====== Landmark index (MediaPipe Pose 33) ======
const IDX = {
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};
const MIN_VIS = 0.55;

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

  try {
    statusEl.textContent = "카메라 준비 중…";
    await initPoseIfNeeded();
    await startCamera();
    statusEl.textContent = `준비 완료! (${facingMode === "user" ? "전면" : "후면"}) 전신 맞추고 촬영하기`;
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "카메라 시작 실패: HTTPS/권한(허용)/브라우저 설정을 확인해줘(F12 콘솔도 확인).";
  }
}

function setIdleResult() {
  scoreEl.textContent = "-";
  pickImg.src = "";
  pickName.textContent = "-";
  detail.textContent = "촬영하기 버튼을 눌러 측정해줘.";
  hideCountdown();
  clearOverlay();
}

function applyMirrorMode() {
  const mirror = (facingMode === "user");
  video.classList.toggle("mirrored", mirror);
  overlay.classList.toggle("mirrored", mirror);
  countdownEl.classList.toggle("mirrored", mirror);
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

// =========================
// Switch camera (restart)
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
  } catch (e) {
    console.error(e);
    facingMode = prev;
    stopCamera();
    try { await startCamera(); } catch {}
    statusEl.textContent = "카메라 전환 실패(기기에 후면 카메라가 없을 수 있음).";
  }
}

// =========================
// 3초 후 촬영
// =========================
async function captureWithDelay(seconds) {
  if (!stream || !pose) {
    statusEl.textContent = "아직 준비 중이야. 잠깐만!";
    return;
  }
  if (analyzeInFlight || timerInFlight) return;

  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) {
    statusEl.textContent = "비디오 준비가 아직이야. 1초 뒤 다시 눌러봐.";
    return;
  }

  timerInFlight = true;
  showCountdown(seconds);
  statusEl.textContent = `촬영까지 ${seconds}초… 움직이지 말고 전신 유지!`;

  let left = seconds;

  countdownTimer = setInterval(async () => {
    left -= 1;

    if (left > 0) {
      updateCountdown(left);
      statusEl.textContent = `촬영까지 ${left}초…`;
      return;
    }

    // 0초 => 촬영 실행
    cancelCountdown();
    hideCountdown();
    statusEl.textContent = "촬영/분석 중…";
    await captureAndAnalyze();
  }, 1000);
}

function cancelCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
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

// 실제 촬영 + pose 분석 1회
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
  statusEl.textContent = `전신 맞추고 촬영하기 (${facingMode === "user" ? "전면" : "후면"})`;
  try { video.play(); } catch {}
}

// =========================
// Pose results (after analyze)
// =========================
function onResults(results) {
  if (!analyzeInFlight) return;
  analyzeInFlight = false;

  drawCaptured(results);

  if (!results.poseLandmarks) {
    scoreEl.textContent = "측정실패";
    statusEl.textContent = "사람 인식 실패. 전신이 나오게 다시 촬영해줘.";
    try { video.play(); } catch {}
    return;
  }

  const prop = measureProportions(results.poseLandmarks);
  if (!prop) {
    scoreEl.textContent = "측정실패";
    statusEl.textContent = "측정 실패(어깨/골반/발이 잘 보여야 함). 다시 촬영해줘.";
    try { video.play(); } catch {}
    return;
  }

  const score = scoreFromProp(prop);
  const rounded = Number.isFinite(score) ? Math.round(score) : null;

  scoreEl.textContent = (rounded === null) ? "측정실패" : `${rounded}점`;

  const pick = pickByScore(score, selectedGender);
  pickImg.src = pick.src;
  pickName.textContent = pick.name;

  detail.textContent =
    (rounded === null)
      ? "점수 계산이 NaN이야. 전신/발끝이 확실히 보이게 다시 촬영해줘."
      : `비율(얼/상/하): ${prop.map(x => x.toFixed(3)).join(" / ")} · 구간: ${scoreBandText(score)} · (${selectedGender === "male" ? "남자" : "여자"}) · 카메라: ${facingMode === "user" ? "전면" : "후면"}`;

  statusEl.textContent = "완료! 다시 측정하려면 ‘다시 측정’ 후 재촬영.";
  try { video.play(); } catch {}
}

// =========================
// Measure: 얼굴/상체/하체 (합=1 비율)
// =========================
function measureProportions(lm) {
  const w = capturedCanvas?.width || video.videoWidth || 1280;
  const h = capturedCanvas?.height || video.videoHeight || 720;

  const le = lm[IDX.LEFT_EAR];
  const re = lm[IDX.RIGHT_EAR];
  const ls = lm[IDX.LEFT_SHOULDER];
  const rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP];
  const rh = lm[IDX.RIGHT_HIP];

  const la = pickBetter(lm[IDX.LEFT_ANKLE], lm[IDX.LEFT_FOOT_INDEX]);
  const ra = pickBetter(lm[IDX.RIGHT_ANKLE], lm[IDX.RIGHT_FOOT_INDEX]);

  if (!good(le, re, ls, rs, lh, rh, la, ra)) return null;

  const earMid = mid(toPx(le, w, h), toPx(re, w, h));
  const shoulder = mid(toPx(ls, w, h), toPx(rs, w, h));
  const hip = mid(toPx(lh, w, h), toPx(rh, w, h));
  const foot = mid(toPx(la, w, h), toPx(ra, w, h));

  const headTop = {
    x: earMid.x + (earMid.x - shoulder.x) * 0.25,
    y: earMid.y + (earMid.y - shoulder.y) * 0.90,
  };

  const face = dist(headTop, shoulder);
  const torso = dist(shoulder, hip);
  const leg = dist(hip, foot);
  const sum = face + torso + leg;
  if (sum <= 1e-6) return null;

  return [face / sum, torso / sum, leg / sum];
}

// =========================
// Score: MIN_PROP(0) ~ MAX_PROP(100)
// =========================
function scoreFromProp(prop) {
  const s = prop.map((p, i) => {
    const a = MIN_PROP[i], b = MAX_PROP[i];
    const t = (p - a) / (b - a);
    return clamp(t, 0, 1) * 100;
  });
  return (s[0] + s[1] + s[2]) / 3;
}

// =========================
// Pick by score + gender
// =========================
function pickByScore(score, gender) {
  const list = PICK_MAP[gender] || PICK_MAP.male;
  for (const item of list) if (score >= item.min) return item;
  return list[list.length - 1];
}

function scoreBandText(score) {
  if (score >= 70) return "70점 이상";
  if (score >= 50) return "50~70";
  if (score >= 40) return "40~50";
  return "40 이하";
}

// =========================
// Draw captured image + landmarks
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

function clearOverlay() {
  fitCanvasToVideo();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function fitCanvasToVideo() {
  const w = video.clientWidth || 1280;
  const h = video.clientHeight || 720;
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
}

// =========================
// Utils
// =========================
function normalize(v) {
  const s = v.reduce((a, b) => a + b, 0);
  return v.map(x => x / s);
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function good(...pts) {
  return pts.every(p => p && (p.visibility ?? 1) >= MIN_VIS);
}
function pickBetter(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (a.visibility ?? 0) >= (b.visibility ?? 0) ? a : b;
}
function toPx(p, w, h) {
  return { x: p.x * w, y: p.y * h };
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
