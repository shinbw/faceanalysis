// ====== S 집합(니가 사진만 갈아끼우면 됨) ======
// targetProp: [얼굴, 상체, 하체] "비율(합=1)" 기준. (예시값이니 너가 원하면 바꿔도 됨)
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

// ====== 요구사항의 최소/최대 비율(주어진 숫자) ======
const MIN = [19, 27, 50];
const MAX = [43, 62, 140];

// 비율을 "합=1"로 바꿔서 비교(가장 깔끔함)
const MIN_PROP = normalize(MIN);
const MAX_PROP = normalize(MAX);

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

let pose, camera;
let measuring = false;
let samples = [];
let selectedGender = "male";

// 측정 안정화를 위해 프레임 여러개 평균
const NEED_SAMPLES = 25;

// ========== UI ==========
btnMale.addEventListener("click", () => startFlow("male"));
btnFemale.addEventListener("click", () => startFlow("female"));
btnRetry.addEventListener("click", () => restartMeasure());
btnBack.addEventListener("click", () => goHome());

function goHome(){
  stopCamera();
  screenA.classList.remove("active");
  screenHome.classList.add("active");
}

function goA(){
  screenHome.classList.remove("active");
  screenA.classList.add("active");
}

async function startFlow(gender){
  selectedGender = gender;
  goA();
  await initPoseIfNeeded();
  await startCamera();
  restartMeasure();
}

function restartMeasure(){
  samples = [];
  measuring = true;
  scoreEl.textContent = "-";
  pickImg.src = "";
  pickName.textContent = "-";
  detail.textContent = "-";
  statusEl.textContent = "측정 중… 전신이 화면에 꽉 나오게 정면으로 서주세요.";
}

// ========== MediaPipe Pose ==========
async function initPoseIfNeeded(){
  if(pose) return;

  pose = new Pose.Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    selfieMode: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  pose.onResults(onResults);
}

async function startCamera(){
  if(camera) return;

  overlay.width = video.clientWidth || 1280;
  overlay.height = video.clientHeight || 720;

  camera = new Camera.Camera(video, {
    onFrame: async () => {
      await pose.send({ image: video });
    },
    width: 1280,
    height: 720,
  });

  await camera.start();
}

function stopCamera(){
  try{
    if(camera){
      camera.stop();
      camera = null;
    }
  }catch(e){}
}

// ========== 측정 로직 ==========
function onResults(results){
  const ctx = overlay.getContext("2d");
  fitCanvasToVideo();

  ctx.save();
  ctx.clearRect(0,0,overlay.width,overlay.height);
  ctx.drawImage(results.image, 0,0,overlay.width,overlay.height);

  if(results.poseLandmarks){
    DrawingUtils.drawConnectors(ctx, results.poseLandmarks, Pose.POSE_CONNECTIONS, { lineWidth: 3 });
    DrawingUtils.drawLandmarks(ctx, results.poseLandmarks, { lineWidth: 2 });

    if(measuring){
      const prop = measureProportions(results.poseLandmarks);
      if(prop){
        samples.push(prop);
        statusEl.textContent = `측정 중… (${samples.length}/${NEED_SAMPLES})`;
      }else{
        statusEl.textContent = "전신/어깨/골반/발목이 잘 보이게 다시 서주세요.";
      }

      if(samples.length >= NEED_SAMPLES){
        measuring = false;
        const avgProp = avgVec(samples);
        const score = scoreFromProp(avgProp);
        const pick = pickCeleb(avgProp);

        scoreEl.textContent = `${Math.round(score)}점`;
        pickImg.src = pick.src;
        pickName.textContent = pick.name;
        detail.textContent =
          `측정 비율(얼/상/하): ${avgProp.map(x=>x.toFixed(3)).join(" / ")} · 유사도: ${(pick.sim*100).toFixed(1)}%`;
        statusEl.textContent = "완료! (다시 측정 가능)";
      }
    }
  }else{
    statusEl.textContent = "사람을 인식하지 못함… 카메라 앞에 서주세요.";
  }

  ctx.restore();
}

function fitCanvasToVideo(){
  // 화면 리사이즈 대응
  const w = video.clientWidth || 1280;
  const h = video.clientHeight || 720;
  if(overlay.width !== w || overlay.height !== h){
    overlay.width = w;
    overlay.height = h;
  }
}

// 얼굴: 머리끝~어깨, 상체: 어깨~골반, 하체: 골반~발끝
function measureProportions(lm){
  // landmark indices
  const L = Pose.POSE_LANDMARKS;
  const ls = lm[L.LEFT_SHOULDER], rs = lm[L.RIGHT_SHOULDER];
  const lh = lm[L.LEFT_HIP],      rh = lm[L.RIGHT_HIP];
  const la = lm[L.LEFT_ANKLE],    ra = lm[L.RIGHT_ANKLE];
  const le = lm[L.LEFT_EAR],      re = lm[L.RIGHT_EAR];

  // visibility 체크(너무 낮으면 측정 안 함)
  if(!good(ls,rs,lh,rh,la,ra,le,re)) return null;

  const shoulder = mid(ls, rs);
  const hip = mid(lh, rh);
  const ankle = mid(la, ra);
  const earMid = mid(le, re);

  // "머리 끝"은 Pose에 정확히 없어서, 귀중심에서 어깨방향 반대로 조금 올려서 추정
  const headTop = {
    x: earMid.x + (earMid.x - shoulder.x) * 0.25,
    y: earMid.y + (earMid.y - shoulder.y) * 0.85
  };

  const face = dist2(headTop, shoulder);
  const torso = dist2(shoulder, hip);
  const leg = dist2(hip, ankle);

  const sum = face + torso + leg;
  if(sum <= 1e-6) return null;

  // 합=1 비율
  return [face/sum, torso/sum, leg/sum];
}

function scoreFromProp(prop){
  // 각 구간을 MIN_PROP~MAX_PROP 사이에서 0~100으로 선형 매핑 후 평균
  const s = prop.map((p,i)=>{
    const a = MIN_PROP[i], b = MAX_PROP[i];
    const t = (p - a) / (b - a);
    return clamp(t,0,1) * 100;
  });
  return (s[0]+s[1]+s[2]) / 3;
}

function pickCeleb(prop){
  // 코사인 유사도(벡터 방향 유사)로 가장 가까운 사진 선택
  let best = null;
  for(const item of S){
    const sim = cosineSim(prop, item.targetProp);
    if(!best || sim > best.sim){
      best = { ...item, sim };
    }
  }
  return best;
}

// ====== utils ======
function normalize(v){
  const s = v.reduce((a,b)=>a+b,0);
  return v.map(x=>x/s);
}
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }

function good(...pts){
  return pts.every(p => p && (p.visibility ?? 1) > 0.55);
}
function mid(a,b){ return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 }; }
function dist2(a,b){
  const dx=a.x-b.x, dy=a.y-b.y;
  return Math.hypot(dx,dy);
}
function avgVec(arr){
  const out = [0,0,0];
  for(const v of arr){
    out[0]+=v[0]; out[1]+=v[1]; out[2]+=v[2];
  }
  return out.map(x=>x/arr.length);
}
function cosineSim(a,b){
  const dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const na = Math.hypot(a[0],a[1],a[2]);
  const nb = Math.hypot(b[0],b[1],b[2]);
  if(na*nb === 0) return 0;
  return dot/(na*nb);
}
