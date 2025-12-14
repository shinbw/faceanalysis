/* =========================================================
   app.js (전체 교체용)
   - 전면 카메라(셀카) 켜기
   - MediaPipe Pose로 전신 랜드마크 인식
   - 얼굴/상체/하체 비율 측정
   - MIN~MAX를 0~100점으로 선형 매핑
   - S 집합(a1~d2) 중 가장 유사한 사진 추천
   ========================================================= */

/* ====== S 집합(니가 사진 넣는 곳) ======
   src 경로는 반드시 ./assets/파일명 으로 맞춰야 함.
   name은 표시용.
   targetProp(얼굴, 상체, 하체)은 "합=1 비율" 예시값임.
   (원하면 여기 값만 바꾸면 추천 기준이 바뀜)
*/
const S = [
  { id: "a1", name: "a1", src: "./assets/a1.jpg", targetProp: [0.18, 0.28, 0.54] },
  { id: "a2", name: "a2", src: "./assets/a2.jpg", targetProp: [0.20, 0.30, 0.50] },
  { id: "b1", name: "b1", src: "./assets/b1.jpg", targetProp: [0.16, 0.27, 0.57] },
  { id: "b2", name: "b2", src: "./assets/b2.jpg", targetProp: [0.17, 0.29, 0.54] },
  { id: "c1", name: "c1", src: "./assets/c1.jpg", targetProp: [0.19, 0.26, 0.55] },
  { id: "c2", name: "c2", src: "./assets/c2.jpg", targetProp: [0.21, 0.25, 0.54] },
  { id: "d1", name: "d1", src: "./assets/d1.jpg", targetProp: [0.15, 0.31, 0.54] },
  { id: "d2", name: "d2", src: "./assets/d2.jpg", targetProp: [0.18, 0.25, 0.57] },
];

/* ====== 요구사항 MIN/MAX (얼굴:상체:하체) ====== */
const MIN = [19, 27, 50];
const MAX = [43, 62, 140];
const MIN_PROP = normalize(MIN);
const MAX_PROP = normalize(MAX);

/* ====== UI 엘리먼트 ====== */
const screenHome = document.getElementById("screen-home");
const screenA = document.getElementById("screen-a");

const btnMale = document.getElementById("btnMale");
const btnFemale = document.getElementById("btnFemale");
const btnRetry = document.getElementById("btnRetry");
const btnBack = document.getElementById("btnBack");

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");

const scoreEl = document.getElementById("score");
const pickImg = document.getElementById("pickImg");
const pickName = document.getElementById("pickName");
const detail = document.getElementById("detail");

/* ====== MediaPipe Pose ====== */
let pose = null;

/* ====== 카메라/루프 상태 ====== */
let stream = null;
let rafId = null;

/* ====== 측정 ====== */
let measuring = false;
let samples = [];
let selectedGender = "male"; // 남/여 버튼 눌렀다는 정보만 저장 (원하면 S를 성별로 나눌 수 있음)

const NEED_SAMPLES = 25;     // 평균낼 프레임 수
const MIN_VIS = 0.55;        // visibility 최소 기준

/* ====== MediaPipe Pose Landmark 인덱스(고정) ======
   MediaPipe Pose 33개 랜드마크 표준 인덱스 사용
*/
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

/* =========================
   이벤트
========================= */
btnMale?.addEventListener("click", () => startFlow("male"));
btnFemale?.addEventListener("click", () => startFlow("female"));
btnRetry?.addEventListener("click", () => restartMeasure());
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
   시작 플로우
========================= */
async function startFlow(gender) {
  selectedGender = gender;
  goA();

  try {
    statusEl.textContent = "준비 중…";
    await initPoseIfNeeded();
    await startCamera();
    restartMeasure();
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "카메라 시작 실패: 권한(허용) + HTTPS + 브라우저 설정을 확인하세요.";
  }
}

function restartMeasure() {
  samples = [];
  measuring = true;

  scoreEl.textContent = "-";
  pickImg.src = "";
  pickName.textContent = "-";
  detail.textContent = "-";

  statusEl.textContent = "측정 중… 전신이 화면에 꽉 나오게 정면으로 서주세요.";
}

/* =========================
   Pose 초기화
========================= */
async function initPoseIfNeeded() {
  if (pose) return;

  if (typeof Pose === "undefined") {
    throw new Error("MediaPipe Pose 라이브러리가 로드되지 않았습니다(HTML script 확인).");
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
   카메라 시작/정지 (getUserMedia 직접 사용)
========================= */
async function startCamera() {
  if (stream) return;

  // GitHub Pages는 HTTPS라 OK, 그래도 안전 체크
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    throw new Error("카메라는 HTTPS 또는 localhost에서만 동작합니다.");
  }

  // 권한 요청
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user", // 전면 카메라
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;

  // play()는 사용자 제스처 후엔 거의 성공
  await video.play();

  fitCanvasToVideo();

  // 프레임 루프
  const loop = async () => {
    if (!stream) return;
    try {
      await pose.send({ image: video });
    } catch (e) {
      console.error(e);
    }
    rafId = requestAnimationFrame(loop);
  };
  loop();
}

function stopCamera() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  video.srcObject = null;
}

/* =========================
   결과 처리/그리기
========================= */
function onResults(results) {
  fitCanvasToVideo();

  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // 비디오 프레임 그리기
  ctx.drawImage(results.image, 0, 0, overlay.width, overlay.height);

  // 랜드마크가 없으면 안내
  if (!results.poseLandmarks) {
    statusEl.textContent = "사람을 인식하지 못함… 카메라 앞에 서주세요.";
    return;
  }

  // 스켈레톤 그리기(라이브러리 전역함수)
  if (typeof drawConnectors === "function" && typeof POSE_CONNECTIONS !== "undefined") {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { lineWidth: 3 });
  }
  if (typeof drawLandmarks === "function") {
    drawLandmarks(ctx, results.poseLandmarks, { lineWidth: 2 });
  }

  // 측정 중일 때만 수집
  if (!measuring) return;

  const prop = measureProportions(results.poseLandmarks);
  if (!prop) {
    statusEl.textContent = "전신/어깨/골반/발이 잘 보이게 다시 서주세요.";
    return;
  }

  samples.push(prop);
  statusEl.textContent = `측정 중… (${samples.length}/${NEED_SAMPLES})`;

  if (samples.length >= NEED_SAMPLES) {
    measuring = false;

    const avgProp = avgVec(samples);
    const score = scoreFromProp(avgProp);
    const pick = pickCeleb(avgProp);

    scoreEl.textContent = `${Math.round(score)}점`;
    pickImg.src = pick.src;
    pickName.textContent = pick.name;
    detail.textContent =
      `측정 비율(얼/상/하): ${avgProp.map(x => x.toFixed(3)).join(" / ")} · 유사도: ${(pick.sim * 100).toFixed(1)}%`;

    statusEl.textContent = "완료! (다시 측정 가능)";
  }
}

/* =========================
   캔버스 크기 맞추기
========================= */
function fitCanvasToVideo() {
  // 화면 표시 크기에 캔버스를 맞춤
  const w = video.clientWidth || 1280;
  const h = video.clientHeight || 720;

  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
}

/* =========================
   비율 측정
   - 얼굴: 머리끝~어깨(머리끝은 ear 기반 추정)
   - 상체: 어깨~골반
   - 하체: 골반~발끝(발목/발가락 중 더 잘 보이는 걸 사용)
========================= */
function measureProportions(lm) {
  // 비디오 실제 픽셀 크기
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;

  const le = lm[IDX.LEFT_EAR];
  const re = lm[IDX.RIGHT_EAR];
  const ls = lm[IDX.LEFT_SHOULDER];
  const rs = lm[IDX.RIGHT_SHOULDER];
  const lh = lm[IDX.LEFT_HIP];
  const rh = lm[IDX.RIGHT_HIP];

  // 발은 ankle or foot_index 중 visibility 높은 걸 선택
  const la = pickBetter(lm[IDX.LEFT_ANKLE], lm[IDX.LEFT_FOOT_INDEX]);
  const ra = pickBetter(lm[IDX.RIGHT_ANKLE], lm[IDX.RIGHT_FOOT_INDEX]);

  if (!good(le, re, ls, rs, lh, rh, la, ra)) return null;

  const earMid = mid(toPx(le, vw, vh), toPx(re, vw, vh));
  const shoulder = mid(toPx(ls, vw, vh), toPx(rs, vw, vh));
  const hip = mid(toPx(lh, vw, vh), toPx(rh, vw, vh));
  const foot = mid(toPx(la, vw, vh), toPx(ra, vw, vh));

  // 머리끝 추정: 귀중심에서 어깨 반대방향으로 조금 위로 확장
  // (정확한 '머리끝' 랜드마크가 없어서 가장 안정적인 방법 중 하나)
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
   점수 계산 (0~100)
   - MIN_PROP(0점) ~ MAX_PROP(100점)
   - 각 구간 점수 평균
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
   추천 선택
   - 코사인 유사도로 가장 가까운 targetProp 선택
========================= */
function pickCeleb(prop) {
  let best = null;
  for (const item of S) {
    const sim = cosineSim(prop, item.targetProp);
    if (!best || sim > best.sim) best = { ...item, sim };
  }
  return best;
}

/* =========================
   유틸
========================= */
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

function avgVec(arr) {
  const out = [0, 0, 0];
  for (const v of arr) {
    out[0] += v[0]; out[1] += v[1]; out[2] += v[2];
  }
  return out.map(x => x / arr.length);
}

function cosineSim(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const na = Math.hypot(a[0], a[1], a[2]);
  const nb = Math.hypot(b[0], b[1], b[2]);
  if (na * nb === 0) return 0;
  return dot / (na * nb);
}
