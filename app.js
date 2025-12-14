/* =========================================================
   ✅ 변경사항
   1) 촬영 전에도 실시간으로 "인식 막대" 많이 표시(점수는 계산 X)
      - 얼굴/상체/하체 바(좌측 HUD)
      - 몸 중심선(머리~어깨~골반~발)
      - 어깨/골반 가이드 라인
      - 스켈레톤+랜드마크
   2) 점수 구간 변경
      남: 60↑ a2 / 40~60 b2 / 30~40 c2 / 30↓ d2
      여: 60↑ a1 / 40~60 b1 / 30~40 c1 / 30↓ d1
   3) 촬영하기 누르면 3초 후 1장 캡처 분석
   4) 전면/후면 전환 + 전면만 거울모드
   ========================================================= */

// ====== MIN/MAX (요구사항) ======
const MIN = [19, 27, 50];
const MAX = [43, 62, 140];
const MIN_PROP = normalize(MIN);
const MAX_PROP = normalize(MAX);

// ====== 추천 매핑(수정됨) ======
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

// 캡처/분석
let analyzeInFlight = false;
let timerInFlight = false;
let countdownTimer = null;
let capturedCanvas = null;

// 실시간 “막대” 프리뷰(점수X)
let previewRunning = false;
let previewBusy = false;
let previewRafId = null;

// ====== Pose Landmark index (33) ======
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
    startPreviewLoop(); // ✅ 촬영 전에도 인식 막대 계속 표시
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
// Preview loop (점수X, 막대/스켈레톤 표시용)
// =========================
function startPreviewLoop() {
  if (!pose || !stream) return;
  if (previewRunning) return;
  previewRunning = true;

  const tick = async () => {
    if (!previewRunning) return;

    // 캡처/카운트다운/분석 중엔 프리뷰는 멈추고(화면 혼선 방지)
    if (timerInFlight || analyzeInFlight) {
      previewRafId = requestAnimationFrame(tick);
      return;
    }

    if (!previewBusy) {
      previewBusy = true;
      try {
        await pose.send({ image: video }); // 결과는 onResults로 들어옴
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

// 실제 촬영 + 분석 1회
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
    await pose.send({ image: cap }); // onResults로 처리
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
  // 1) 캡처 분석 결과 처리
  if (analyzeInFlight) {
    analyzeInFlight = false;

    // 캡처 사진 + 랜드마크 표시
    drawCaptured(results);

    if (!results.poseLandmarks) {
      scoreEl.textContent = "측정실패";
      statusEl.textContent = "사람 인식 실패. 전신이 나오게 다시 촬영해줘.";
      try { video.play(); } catch {}
      return;
    }

    const prop = measureProportions(results.poseLandmarks, capturedCanvas.width, capturedCanvas.height);
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
    return;
  }

  // 2) 실시간 프리뷰 결과(점수X, 막대 표시)
  previewBusy = false;

  if (!results.poseLandmarks) {
    // 인식 안 되면 오버레이만 깨끗하게
    clearOverlay();
    return;
  }

  drawPreviewGuides(results.poseLandmarks);
}

// =========================
// Preview drawing (막대 많이)
// =========================
function drawPreviewGuides(lm) {
  fitCanvasToVideo();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // 스켈레톤/랜드마크(기본)
  if (typeof drawConnectors === "function" && typeof POSE_CONNECTIONS !== "undefined") {
    drawConnectors(ctx, lm, POSE_CONNECTIONS, { lineWidth: 3 });
  }
  if (typeof drawLandmarks === "function") {
    drawLandmarks(ctx, lm, { lineWidth: 2 });
  }

  // 표시 좌표는 "화면 캔버스" 기준 (0~1 -> px)
  const w = overlay.width, h = overlay.height;

  const le = lm[IDX.LEFT_EAR], re = lm[IDX.RIGHT_EAR];
  const ls = lm[IDX.LEFT_SHOULDER], rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP], rh = lm[IDX.RIGHT_HIP];
  const la = pickBetter(lm[IDX.LEFT_ANKLE], lm[IDX.LEFT_FOOT_INDEX]);
  const ra = pickBetter(lm[IDX.RIGHT_ANKLE], lm[IDX.RIGHT_FOOT_INDEX]);

  if (!good(le, re, ls, rs, lh, rh, la, ra)) return;

  const earMid = mid(toPx01(le, w, h), toPx01(re, w, h));
  const shoulder = mid(toPx01(ls, w, h), toPx01(rs, w, h));
  const hip = mid(toPx01(lh, w, h), toPx01(rh, w, h));
  const foot = mid(toPx01(la, w, h), toPx01(ra, w, h));

  const headTop = {
    x: earMid.x + (earMid.x - shoulder.x) * 0.25,
    y: earMid.y + (earMid.y - shoulder.y) * 0.90,
  };

  // 1) 중심 “막대” (3구간)
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.95;

  drawSeg(ctx, headTop, shoulder, 10); // 얼굴 막대
  drawSeg(ctx, shoulder, hip, 10);     // 상체 막대
  drawSeg(ctx, hip, foot, 10);         // 하체 막대

  // 2) 어깨/골반 가이드(가로선)
  ctx.globalAlpha = 0.55;
  drawHLine(ctx, shoulder.y, 4);
  drawHLine(ctx, hip.y, 4);

  // 3) 좌측 HUD “막대” (얼굴/상체/하체 길이 비율 시각화)
  ctx.globalAlpha = 0.85;
  const faceLen = dist(headTop, shoulder);
  const torsoLen = dist(shoulder, hip);
  const legLen = dist(hip, foot);
  const sum = faceLen + torsoLen + legLen;

  const barX = 20;
  const barW = 18;
  const barTop = 20;
  const barH = Math.max(160, Math.min(overlay.height - 40, 260));
  const fH = barH * (faceLen / sum);
  const tH = barH * (torsoLen / sum);
  const lH = barH * (legLen / sum);

  // 배경 바
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, barX - 8, barTop - 8, barW + 16, barH + 16, 12, true, false);

  // 세 구간 바(색은 코드에서 지정하지만, UI 목적이라 OK)
  ctx.fillStyle = "rgba(90,209,255,0.85)"; // 얼굴
  ctx.fillRect(barX, barTop, barW, fH);
  ctx.fillStyle = "rgba(255,255,255,0.75)"; // 상체
  ctx.fillRect(barX, barTop + fH, barW, tH);
  ctx.fillStyle = "rgba(180,140,255,0.75)"; // 하체
  ctx.fillRect(barX, barTop + fH + tH, barW, lH);

  // 라벨
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 12px system-ui";
  ctx.fillText("얼굴", barX + 28, barTop + Math.min(14, fH - 2));
  ctx.fillText("상체", barX + 28, barTop + fH + Math.min(14, tH - 2));
  ctx.fillText("하체", barX + 28, barTop + fH + tH + Math.min(14, lH - 2));

  ctx.restore();
}

// 중심 세그먼트 라인(색은 구간별로 다르게)
function drawSeg(ctx, a, b, width) {
  const len = dist(a, b);
  if (len <= 1) return;

  // 구간별 색
  // 얼굴(blue), 상체(white), 하체(purple)
  // a 위치로 구분하기보다 호출 순서로 색 지정
  const key = drawSeg._k = (drawSeg._k ?? 0) + 1;
  if (key % 3 === 1) ctx.strokeStyle = "rgba(90,209,255,0.95)";
  else if (key % 3 === 2) ctx.strokeStyle = "rgba(255,255,255,0.85)";
  else ctx.strokeStyle = "rgba(180,140,255,0.85)";

  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // 끝점 강조 “막대”
  ctx.lineWidth = width + 6;
  ctx.globalAlpha *= 0.4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + 0.1, a.y + 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x + 0.1, b.y + 0.1);
  ctx.stroke();
  ctx.globalAlpha /= 0.4;
}

// 가로 가이드 라인
function drawHLine(ctx, y, width) {
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
// Measure (캡처용)
// =========================
function measureProportions(lm, w, h) {
  const le = lm[IDX.LEFT_EAR], re = lm[IDX.RIGHT_EAR];
  const ls = lm[IDX.LEFT_SHOULDER], rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP], rh = lm[IDX.RIGHT_HIP];
  const la = pickBetter(lm[IDX.LEFT_ANKLE], lm[IDX.LEFT_FOOT_INDEX]);
  const ra = pickBetter(lm[IDX.RIGHT_ANKLE], lm[IDX.RIGHT_FOOT_INDEX]);

  if (!good(le, re, ls, rs, lh, rh, la, ra)) return null;

  const earMid = mid(toPx01(le, w, h), toPx01(re, w, h));
  const shoulder = mid(toPx01(ls, w, h), toPx01(rs, w, h));
  const hip = mid(toPx01(lh, w, h), toPx01(rh, w, h));
  const foot = mid(toPx01(la, w, h), toPx01(ra, w, h));

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
// Score + pick
// =========================
function scoreFromProp(prop) {
  const s = prop.map((p, i) => {
    const a = MIN_PROP[i], b = MAX_PROP[i];
    const t = (p - a) / (b - a);
    return clamp(t, 0, 1) * 100;
  });
  return (s[0] + s[1] + s[2]) / 3;
}

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
// Countdown + capture
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
function toPx01(p, w, h) {
  // p.x, p.y 는 0~1
  return { x: p.x * w, y: p.y * h };
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
