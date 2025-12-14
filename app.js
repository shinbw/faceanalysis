/* =========================================================
   요구사항 반영:
   - 실시간 점수 X, "촬영하기" 눌렀을 때 1장 분석
   - 남자: 70↑ a2 / 50~70 b2 / 40~50 c2 / 40↓ d2
   - 여자: 70↑ a1 / 50~70 b1 / 40~50 c1 / 40↓ d1
   - 점수판(score) 반드시 표시(NaN이면 '측정실패'라도 표시)
   - 거울모드(좌우반전)는 HTML/CSS에서 영상+오버레이 같이 뒤집음
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
const btnRetry = document.getElementById("btnRetry");
const btnBack = document.getElementById("btnBack");

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");

const scoreEl = document.getElementById("score");
const pickImg = document.getElementById("pickImg");
const pickName = document.getElementById("pickName");
const detail = document.getElementById("detail");

// ====== Pose ======
let pose = null;

// ====== Camera ======
let stream = null;

// ====== State ======
let selectedGender = "male";
let captureInFlight = false;
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
btnCapture?.addEventListener("click", () => captureOnce());
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
    statusEl.textContent = "준비 완료! 전신 맞추고 ‘촬영하기’를 눌러줘.";
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "카메라 시작 실패: HTTPS/권한(허용)/브라우저 설정을 확인해줘(F12 콘솔도 확인).";
  }
}

function setIdleResult() {
  if (scoreEl) scoreEl.textContent = "-";
  if (pickImg) pickImg.src = "";
  if (pickName) pickName.textContent = "-";
  if (detail) detail.textContent = "촬영하기 버튼을 눌러 측정해줘.";
  clearOverlay();
}

// =========================
// Pose init
// =========================
async function initPoseIfNeeded() {
  if (pose) return;

  if (typeof Pose === "undefined") {
    throw new Error("pose.js 로드 실패(HTML script 태그 확인).");
  }

  pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    selfieMode: true,              // 결과를 셀피 기준으로 맞춰줌
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
      facingMode: "user", // 전면
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  video.srcObject = stream;
  await video.play();
  fitCanvasToVideo();
}

function stopCamera() {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  video.srcObject = null;
  captureInFlight = false;
  capturedCanvas = null;
  clearOverlay();
}

// =========================
// Capture (one-shot)
// =========================
async function captureOnce() {
  if (!stream || !pose) {
    statusEl.textContent = "아직 준비 중이야. 잠깐만!";
    return;
  }
  if (captureInFlight) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    statusEl.textContent = "비디오 준비가 아직이야. 1초 뒤 다시 눌러봐.";
    return;
  }

  captureInFlight = true;
  statusEl.textContent = "촬영/분석 중…";

  // 현재 프레임을 캔버스에 저장 (거울효과는 표시만, 분석은 원본 프레임)
  const cap = document.createElement("canvas");
  cap.width = vw;
  cap.height = vh;
  cap.getContext("2d").drawImage(video, 0, 0, vw, vh);
  capturedCanvas = cap;

  // (선택) 촬영 순간 화면 느낌 주고 싶으면 일시정지
  try { video.pause(); } catch {}

  try {
    await pose.send({ image: cap }); // 분석 1회
  } catch (e) {
    console.error(e);
    captureInFlight = false;
    statusEl.textContent = "분석 실패. 다시 촬영해줘.";
    try { await video.play(); } catch {}
  }
}

function resetForRetry() {
  captureInFlight = false;
  capturedCanvas = null;
  setIdleResult();
  statusEl.textContent = "전신 맞추고 ‘촬영하기’를 눌러줘.";
  try { video.play(); } catch {}
}

// =========================
// Pose results (only after capture)
// =========================
function onResults(results) {
  // captureOnce로 호출된 결과만 처리
  if (!captureInFlight) return;
  captureInFlight = false;

  // 촬영된 사진 + 랜드마크를 오버레이에 표시
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

  // ✅ 점수 무조건 표시(안 뜨는 문제 방지)
  scoreEl.textContent = (rounded === null) ? "측정실패" : `${rounded}점`;

  const pick = pickByScore(score, selectedGender);
  pickImg.src = pick.src;
  pickName.textContent = pick.name;
  detail.textContent =
    (rounded === null)
      ? "점수 계산이 NaN으로 나왔어. 전신/발끝이 확실히 보이게 다시 촬영해줘."
      : `비율(얼/상/하): ${prop.map(x => x.toFixed(3)).join(" / ")} · 구간: ${scoreBandText(score)} · (${selectedGender === "male" ? "남자" : "여자"})`;

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

  // 머리끝 추정(귀 중심에서 어깨 반대 방향으로 위로)
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
// Score: MIN_PROP(0) ~ MAX_PROP(100) 선형 매핑 평균
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
// Pick by score + gender (요구사항 그대로)
// =========================
function pickByScore(score, gender) {
  const list = PICK_MAP[gender] || PICK_MAP.male;
  for (const item of list) {
    if (score >= item.min) return item;
  }
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

  if (capturedCanvas) {
    ctx.drawImage(capturedCanvas, 0, 0, overlay.width, overlay.height);
  }

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
