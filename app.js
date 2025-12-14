/* =========================================================
   NEW SCORING RULE (요청대로)
   - 머리(얼굴) 비율 작을수록 점수 ↑
   - 상체 비율 작을수록 점수 ↑
   - 하체 비율 길수록 점수 ↑
   - 내가 정한 기준범위로 0~100점 변환

   유지 기능:
   - 촬영 버튼 누르면 3초 후 1장 캡처 분석
   - 촬영 전에도 가이드(막대/라인/스켈레톤) 많이 표시
   - 전면/후면 전환
   - 전면(user)만 거울모드
   - 추천 구간:
     남: 60↑ a2 / 40~60 b2 / 30~40 c2 / 30↓ d2
     여: 60↑ a1 / 40~60 b1 / 30~40 c1 / 30↓ d1
   ========================================================= */

// ====== 추천 매핑 ======
const PICK_MAP = {
  male: [
    { min: 60, name: "a2", src: "./assets/a2.jpg" },
    { min: 40, name: "b2", src: "./assets/b2.jpg" },
    { min: 30, name: "c2", src: "./assets/c2.jpg" },
    { min: -Infinity, name: "d2", src: "./assets/d2.jpg" },
  ],
  female: [
    { min: 60, name: "a1", src: "./assets/a1.jpg" },
    { min: 40, name: "b1", src: "./assets/b1.jpg" },
    { min: 30, name: "c1", src: "./assets/c1.jpg" },
    { min: -Infinity, name: "d1", src: "./assets/d1.jpg" },
  ],
};

// ====== UI ======
const btnMale = document.getElementById("btnMale");
const btnFemale = document.getElementById("btnFemale");
const btnCapture = document.getElementById("btnCapture");
const btnSwitchCamera = document.getElementById("btnSwitchCamera");
const btnRetry = document.getElementById("btnRetry");
const btnBack = document.getElementById("btnBack");

const screenHome = document.getElementById("screen-home");
const screenA = document.getElementById("screen-a");

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

// 캡처/분석
let analyzeInFlight = false;
let timerInFlight = false;
let countdownTimer = null;
let capturedCanvas = null;

// 실시간 프리뷰(가이드 표시)
let previewRunning = false;
let previewBusy = false;
let previewRafId = null;

// ====== Landmark index (MediaPipe Pose 33) ======
const IDX = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,

  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

// 실패 줄이기(완화)
const MIN_VIS_CORE = 0.35;
const MIN_VIS_FOOT = 0.20;

// =========================
// NEW SCORE 기준(내가 설정)
// =========================
// 비율은 face+torso+leg=1
// "좋은 쪽"의 현실적인 범위를 적당히 설정(너무 좁으면 0/100 쏠림)
// - face: 작을수록 좋음 (좋음 0.15 ~ 나쁨 0.26)
// - torso: 작을수록 좋음 (좋음 0.22 ~ 나쁨 0.36)
// - leg: 클수록 좋음 (나쁨 0.40 ~ 좋음 0.63)
const FACE_GOOD = 0.15, FACE_BAD = 0.26;     // 낮을수록 좋음
const TORSO_GOOD = 0.22, TORSO_BAD = 0.36;   // 낮을수록 좋음
const LEG_BAD = 0.40, LEG_GOOD = 0.63;       // 높을수록 좋음

// 가중치(하체 비중 좀 더 크게)
const W_FACE = 0.30;
const W_TORSO = 0.30;
const W_LEG = 0.40;

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

// =========================
// Preview loop (가이드 표시)
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
  if (previewRafId) {
    cancelAnimationFrame(previewRafId);
    previewRafId = null;
  }
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
// Pose results
// =========================
function onResults(results) {
  // 캡처 분석 결과
  if (analyzeInFlight) {
    analyzeInFlight = false;

    drawCaptured(results);

    if (!results.poseLandmarks) {
      scoreEl.textContent = "측정실패";
      statusEl.textContent = "사람 인식 실패. 전신이 나오게 다시 촬영해줘.";
      try { video.play(); } catch {}
      return;
    }

    const prop = measureProportions(
      results.poseLandmarks,
      capturedCanvas?.width || video.videoWidth,
      capturedCanvas?.height || video.videoHeight
    );

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
        : `비율(머리/상체/하체): ${prop.map(x => x.toFixed(3)).join(" / ")} · 구간: ${scoreBandText(score)} · (${selectedGender === "male" ? "남자" : "여자"})`;

    statusEl.textContent = "완료! 다시 측정하려면 ‘다시 측정’ 후 재촬영.";
    try { video.play(); } catch {}
    return;
  }

  // 프리뷰 결과(가이드)
  previewBusy = false;
  if (!results.poseLandmarks) {
    clearOverlay();
    return;
  }
  drawPreviewGuides(results.poseLandmarks);
}

// =========================
// Preview drawing (막대/가이드 많이)
// =========================
function drawPreviewGuides(lm) {
  fitCanvasToVideo();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // 기본 스켈레톤/랜드마크
  if (typeof drawConnectors === "function" && typeof POSE_CONNECTIONS !== "undefined") {
    drawConnectors(ctx, lm, POSE_CONNECTIONS, { lineWidth: 3 });
  }
  if (typeof drawLandmarks === "function") {
    drawLandmarks(ctx, lm, { lineWidth: 2 });
  }

  const w = overlay.width, h = overlay.height;

  const nose = lm[IDX.NOSE];
  const le = lm[IDX.LEFT_EAR], re = lm[IDX.RIGHT_EAR];
  const ls = lm[IDX.LEFT_SHOULDER], rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP], rh = lm[IDX.RIGHT_HIP];

  const lFoot = selectBest(lm, [IDX.LEFT_FOOT_INDEX, IDX.LEFT_HEEL, IDX.LEFT_ANKLE]);
  const rFoot = selectBest(lm, [IDX.RIGHT_FOOT_INDEX, IDX.RIGHT_HEEL, IDX.RIGHT_ANKLE]);

  if (!goodCore(le, re, ls, rs, lh, rh) || !goodFoot(lFoot, rFoot)) return;

  const earMid = mid(toPx01(le, w, h), toPx01(re, w, h));
  const shoulder = mid(toPx01(ls, w, h), toPx01(rs, w, h));
  const hip = mid(toPx01(lh, w, h), toPx01(rh, w, h));
  const foot = mid(toPx01(lFoot, w, h), toPx01(rFoot, w, h));

  const headBase = (nose && (nose.visibility ?? 0) >= MIN_VIS_CORE) ? toPx01(nose, w, h) : earMid;
  const headTop = {
    x: headBase.x + (headBase.x - shoulder.x) * 0.20,
    y: headBase.y + (headBase.y - shoulder.y) * 0.90,
  };

  // 중심 3구간 막대 + 어깨/골반 가이드 + 좌측 HUD 바
  ctx.save();
  ctx.lineCap = "round";

  strokeSeg(ctx, headTop, shoulder, 10, "rgba(90,209,255,0.95)");
  strokeSeg(ctx, shoulder, hip, 10, "rgba(255,255,255,0.85)");
  strokeSeg(ctx, hip, foot, 10, "rgba(180,140,255,0.85)");

  ctx.globalAlpha = 0.55;
  strokeHLine(ctx, shoulder.y, 4);
  strokeHLine(ctx, hip.y, 4);

  // 비율 HUD
  const faceLen = dist(headTop, shoulder);
  const torsoLen = dist(shoulder, hip);
  const legLen = dist(hip, foot);
  const sum = faceLen + torsoLen + legLen;

  const barX = 20, barW = 18, barTop = 20;
  const barH = Math.max(160, Math.min(overlay.height - 40, 260));
  const fH = barH * (faceLen / sum);
  const tH = barH * (torsoLen / sum);
  const lH = barH * (legLen / sum);

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, barX - 8, barTop - 8, barW + 16, barH + 16, 12, true, false);

  ctx.fillStyle = "rgba(90,209,255,0.85)";
  ctx.fillRect(barX, barTop, barW, fH);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(barX, barTop + fH, barW, tH);
  ctx.fillStyle = "rgba(180,140,255,0.75)";
  ctx.fillRect(barX, barTop + fH + tH, barW, lH);

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 12px system-ui";
  ctx.fillText("머리", barX + 28, barTop + Math.min(14, fH - 2));
  ctx.fillText("상체", barX + 28, barTop + fH + Math.min(14, tH - 2));
  ctx.fillText("하체", barX + 28, barTop + fH + tH + Math.min(14, lH - 2));

  ctx.restore();
}

function strokeSeg(ctx, a, b, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function strokeHLine(ctx, y, width) {
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(12, y);
  ctx.lineTo(overlay.width - 12, y);
  ctx.stroke();
}

// =========================
// Capture drawing
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
// Measure proportions (머리/상체/하체)
// =========================
function measureProportions(lm, w, h) {
  const nose = lm[IDX.NOSE];
  const le = lm[IDX.LEFT_EAR], re = lm[IDX.RIGHT_EAR];
  const ls = lm[IDX.LEFT_SHOULDER], rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP], rh = lm[IDX.RIGHT_HIP];

  const lFoot = selectBest(lm, [IDX.LEFT_FOOT_INDEX, IDX.LEFT_HEEL, IDX.LEFT_ANKLE]);
  const rFoot = selectBest(lm, [IDX.RIGHT_FOOT_INDEX, IDX.RIGHT_HEEL, IDX.RIGHT_ANKLE]);

  if (!goodCore(le, re, ls, rs, lh, rh) || !goodFoot(lFoot, rFoot)) return null;

  const earMid = mid(toPx01(le, w, h), toPx01(re, w, h));
  const shoulder = mid(toPx01(ls, w, h), toPx01(rs, w, h));
  const hip = mid(toPx01(lh, w, h), toPx01(rh, w, h));
  const foot = mid(toPx01(lFoot, w, h), toPx01(rFoot, w, h));

  const headBase = (nose && (nose.visibility ?? 0) >= MIN_VIS_CORE) ? toPx01(nose, w, h) : earMid;
  const headTop = {
    x: headBase.x + (headBase.x - shoulder.x) * 0.20,
    y: headBase.y + (headBase.y - shoulder.y) * 0.90,
  };

  const face = dist(headTop, shoulder);
  const torso = dist(shoulder, hip);
  const leg = dist(hip, foot);

  const sum = face + torso + leg;
  if (sum <= 1e-6) return null;

  return [face / sum, torso / sum, leg / sum];
}

// =========================
// NEW SCORE (요청한 규칙 그대로)
// =========================
function scoreFromProp(prop) {
  const face = prop[0];
  const torso = prop[1];
  const leg = prop[2];

  // 낮을수록 좋은 항목: good~bad 구간을 100~0으로
  const faceScore = scoreLowBetter(face, FACE_GOOD, FACE_BAD);
  const torsoScore = scoreLowBetter(torso, TORSO_GOOD, TORSO_BAD);

  // 높을수록 좋은 항목: bad~good 구간을 0~100으로
  const legScore = scoreHighBetter(leg, LEG_BAD, LEG_GOOD);

  const total =
    faceScore * W_FACE +
    torsoScore * W_TORSO +
    legScore * W_LEG;

  const score = total / (W_FACE + W_TORSO + W_LEG);
  return clamp(score, 0, 100);
}

function scoreLowBetter(x, good, bad) {
  // x <= good => 100점, x >= bad => 0점
  if (x <= good) return 100;
  if (x >= bad) return 0;
  const t = (x - good) / (bad - good); // 0~1
  return 100 * (1 - t);
}

function scoreHighBetter(x, bad, good) {
  // x <= bad => 0점, x >= good => 100점
  if (x <= bad) return 0;
  if (x >= good) return 100;
  const t = (x - bad) / (good - bad);
  return 100 * t;
}

// =========================
// Pick
// =========================
function pickByScore(score, gender) {
  const list = PICK_MAP[gender] || PICK_MAP.male;
  for (const item of list) if (score >= item.min) return item;
  return list[list.length - 1];
}

function scoreBandText(score) {
  if (score >= 60) return "60점 이상";
  if (score >= 40) return "40~60";
  if (score >= 30) return "30~40";
  return "30 이하";
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

// =========================
// Visibility helpers
// =========================
function goodCore(...pts) {
  return pts.every(p => p && (p.visibility ?? 0) >= MIN_VIS_CORE);
}
function goodFoot(lf, rf) {
  return lf && rf && (lf.visibility ?? 0) >= MIN_VIS_FOOT && (rf.visibility ?? 0) >= MIN_VIS_FOOT;
}
function selectBest(lm, indices) {
  let best = null;
  let bestV = -1;
  for (const idx of indices) {
    const p = lm[idx];
    const v = (p?.visibility ?? -1);
    if (v > bestV) { bestV = v; best = p; }
  }
  return best;
}

// =========================
// Misc drawing helper
// =========================
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

// =========================
// Math utils
// =========================
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function toPx01(p, w, h) {
  return { x: p.x * w, y: p.y * h };
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
