/* =========================================================
   app.js (전체)
   요구사항 반영:
   1) 남자 점수 구간 -> a2/b2/c2/d2
   2) 여자 점수 구간 -> a1/b1/c1/d1
   3) 실시간 측정 X, "촬영하기" 누를 때 프레임 1장으로 측정
   4) 점수판 표시 오류 수정(엘리먼트/업데이트 로직 고정)
   ========================================================= */

/* ====== MIN/MAX (요구사항) ====== */
const MIN = [19, 27, 50];
const MAX = [43, 62, 140];
const MIN_PROP = normalize(MIN);
const MAX_PROP = normalize(MAX);

/* ====== 추천 이미지 매핑 ====== */
const PICK_MAP = {
  male: [
    { min: 70, id: "a2", name: "a2", src: "./assets/a2.jpg" },
    { min: 50, id: "b2", name: "b2", src: "./assets/b2.jpg" },
    { min: 40, id: "c2", name: "c2", src: "./assets/c2.jpg" },
    { min: -Infinity, id: "d2", name: "d2", src: "./assets/d2.jpg" },
  ],
  female: [
    { min: 70, id: "a1", name: "a1", src: "./assets/a1.jpg" },
    { min: 50, id: "b1", name: "b1", src: "./assets/b1.jpg" },
    { min: 40, id: "c1", name: "c1", src: "./assets/c1.jpg" },
    { min: -Infinity, id: "d1", name: "d1", src: "./assets/d1.jpg" },
  ],
};

/* ====== UI ====== */
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

/* ====== Pose ====== */
let pose = null;

/* ====== Camera Stream ====== */
let stream = null;

/* ====== 상태 ====== */
let selectedGender = "male";
let pendingCapture = false;       // 촬영 버튼 눌렀는지
let lastCapturedCanvas = null;    // 촬영 프레임 저장(캔버스)

/* ====== Landmark index (MediaPipe Pose 33) ====== */
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

/* =========================
   이벤트
========================= */
btnMale?.addEventListener("click", () => startFlow("male"));
btnFemale?.addEventListener("click", () => startFlow("female"));
btnCapture?.addEventListener("click", () => captureOnce());
btnRetry?.addEventListener("click", () => resetForRetry());
btnBack?.addEventListener("click", () => goHome());

window.addEventListener("resize", () => fitCanvasToVideo());

/* =========================
   화면 전환
========================= */
function goHome() {
  stopCamera();
  screenA.classList.remove("active");
  screenHome.classList.add("active");
}

function goA() {
  screenHome.classList.remove("active");
  screenA.classList.add("active");
}

/* =========================
   시작
========================= */
async function startFlow(gender) {
  selectedGender = gender;
  goA();
  setResultIdle();

  try {
    statusEl.textContent = "카메라 준비 중…";
    await initPoseIfNeeded();
    await startCamera();
    statusEl.textContent = "준비 완료! 전신 맞추고 촬영하기를 눌러줘.";
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "카메라 시작 실패: (1) HTTPS인지 (2) 권한 허용인지 (3) 콘솔 에러 확인";
  }
}

function setResultIdle() {
  // 점수판 표시 오류 방지: 여기서 확실히 세팅
  if (scoreEl) scoreEl.textContent = "-";
  if (pickImg) pickImg.src = "";
  if (pickName) pickName.textContent = "-";
  if (detail) detail.textContent = "촬영하기 버튼을 눌러 측정해줘.";
  clearOverlay();
}

/* =========================
   Pose 초기화
========================= */
async function initPoseIfNeeded() {
  if (pose) return;

  if (typeof Pose === "undefined") {
    throw new Error("MediaPipe Pose 라이브러리가 로드되지 않았습니다(index.html script 확인).");
  }

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

/* =========================
   카메라
========================= */
async function startCamera() {
  if (stream) return;

  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    throw new Error("카메라는 HTTPS 또는 localhost에서만 동작합니다.");
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
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
  pendingCapture = false;
  lastCapturedCanvas = null;
  clearOverlay();
}

/* =========================
   촬영 1회 측정
========================= */
async function captureOnce() {
  if (!stream) {
    statusEl.textContent = "카메라가 아직 준비되지 않았어. 잠깐만!";
    return;
  }
  if (!pose) {
    statusEl.textContent = "Pose 모델 준비 중… 잠깐만!";
    return;
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    statusEl.textContent = "비디오 정보가 아직 없어. 1초 뒤 다시 눌러봐.";
    return;
  }

  // 현재 프레임을 캔버스에 저장(=사진 촬영)
  const cap = document.createElement("canvas");
  cap.width = vw;
  cap.height = vh;
  const cctx = cap.getContext("2d");
  cctx.drawImage(video, 0, 0, vw, vh);

  lastCapturedCanvas = cap;
  pendingCapture = true;

  // "촬영된 사진" 기반으로 Pose 1회 분석
  statusEl.textContent = "사진 분석 중…";
  try {
    await pose.send({ image: cap });
  } catch (e) {
    console.error(e);
    pendingCapture = false;
    statusEl.textContent = "분석 실패. 다시 촬영해줘.";
  }
}

/* =========================
   다시 측정(카메라는 유지)
========================= */
function resetForRetry() {
  pendingCapture = false;
  lastCapturedCanvas = null;
  setResultIdle();
  statusEl.textContent = "준비 완료! 전신 맞추고 촬영하기를 눌러줘.";
}

/* =========================
   Pose 결과
========================= */
function onResults(results) {
  // 우리는 "촬영" 눌렀을 때만 처리
  if (!pendingCapture) return;

  pendingCapture = false;

  // 화면에 촬영된 사진을 표시 + 랜드마크 오버레이
  drawCapturedWithLandmarks(results);

  if (!results.poseLandmarks) {
    statusEl.textContent = "사람 인식 실패. 전신이 나오게 다시 촬영해줘.";
    return;
  }

  const prop = measureProportions(results.poseLandmarks);
  if (!prop) {
    statusEl.textContent = "측정 실패(어깨/골반/발이 잘 보여야 함). 다시 촬영해줘.";
    return;
  }

  const score = scoreFromProp(prop);
  const pick = pickByScore(score, selectedGender);

  // 점수판 표시(오류 수정 포인트: 반드시 textContent로 업데이트)
  scoreEl.textContent = `${Math.round(score)}점`;

  pickImg.src = pick.src;
  pickName.textContent = pick.name;

  detail.textContent =
    `비율(얼/상/하): ${prop.map(x => x.toFixed(3)).join(" / ")} · 구간: ${scoreBandText(score)} · (${selectedGender === "male" ? "남자" : "여자"})`;

  statusEl.textContent = "완료! 다시 측정하려면 ‘다시 측정’ 누르고 재촬영.";
}

/* =========================
   측정: 얼굴/상체/하체 (합=1 비율)
========================= */
function measureProportions(lm) {
  const vw = lastCapturedCanvas?.width || video.videoWidth || 1280;
  const vh = lastCapturedCanvas?.height || video.videoHeight || 720;

  const le = lm[IDX.LEFT_EAR];
  const re = lm[IDX.RIGHT_EAR];
  const ls = lm[IDX.LEFT_SHOULDER];
  const rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP];
  const rh = lm[IDX.RIGHT_HIP];

  const la = pickBetter(lm[IDX.LEFT_ANKLE], lm[IDX.LEFT_FOOT_INDEX]);
  const ra = pickBetter(lm[IDX.RIGHT_ANKLE], lm[IDX.RIGHT_FOOT_INDEX]);

  if (!good(le, re, ls, rs, lh, rh, la, ra)) return null;

  const earMid = mid(toPx(le, vw, vh), toPx(re, vw, vh));
  const shoulder = mid(toPx(ls, vw, vh), toPx(rs, vw, vh));
  const hip = mid(toPx(lh, vw, vh), toPx(rh, vw, vh));
  const foot = mid(toPx(la, vw, vh), toPx(ra, vw, vh));

  // 머리끝 추정(귀 중심 -> 어깨 반대 방향으로 위쪽 확장)
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

/* =========================
   점수: MIN_PROP(0점)~MAX_PROP(100점) 선형 매핑 평균
========================= */
function scoreFromProp(prop) {
  const s = prop.map((p, i) => {
    const a = MIN_PROP[i], b = MAX_PROP[i];
    const t = (p - a) / (b - a);
    return clamp(t, 0, 1) * 100;
  });
  return (s[0] + s[1] + s[2]) / 3;
}

/* =========================
   점수 구간별 사진 선택 (요구사항 그대로)
   - 70 이상
   - 50~70
   - 40~50
   - 40 이하
========================= */
function pickByScore(score, gender) {
  const list = PICK_MAP[gender] || PICK_MAP.male;
  // list는 min 내림차순(70,50,40,-inf)
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

/* =========================
   캔버스 오버레이: 촬영 사진 + 랜드마크 그리기
========================= */
function drawCapturedWithLandmarks(results) {
  fitCanvasToVideo();
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // 촬영된 캔버스를 화면에 맞게 그리기
  if (lastCapturedCanvas) {
    ctx.drawImage(lastCapturedCanvas, 0, 0, overlay.width, overlay.height);
  }

  // 랜드마크 그리기
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

/* =========================
   캔버스 크기 맞추기
========================= */
function fitCanvasToVideo() {
  const w = video.clientWidth || 1280;
  const h = video.clientHeight || 720;
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
}

/* =========================
   utils
========================= */
function normalize(v) {
  const s = v.reduce((a, b) => a + b, 0);
  return v.map(x => x / s);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function good(...pts) {
  return pts.every(p => p && (p.visibility ?? 1) >= 0.55);
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
