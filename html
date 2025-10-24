<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Realtime Face Score (MVP)</title>
  <style>
    body { margin:0; background:#0b0b0c; color:#fff; font-family:system-ui, sans-serif; }
    .wrap { display:grid; place-items:center; min-height:100vh; gap:12px; }
    #view { position:relative; width:72vw; max-width:960px; aspect-ratio:16/9; }
    video, canvas { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:16px; }
    .hud { position:absolute; left:12px; bottom:12px; padding:8px 12px; background:rgba(0,0,0,.45); border-radius:999px; backdrop-filter: blur(6px); }
    .tag { display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; background:#1d1f22; font-size:12px; opacity:.9; }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="view">
      <video id="cam" autoplay playsinline muted></video>
      <canvas id="ov"></canvas>
      <div class="hud">
        <span>Score: <strong id="score">—</strong></span>
        <span class="tag" id="quality">quality: —</span>
      </div>
    </div>
  </div>

<script>
(async () => {
  // 1) 카메라 시작
  const video = document.getElementById('cam');
  const canvas = document.getElementById('ov');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const scoreEl = document.getElementById('score');
  const qualityEl = document.getElementById('quality');

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();

  const W = video.videoWidth, H = video.videoHeight;
  canvas.width = W; canvas.height = H;

  // 2) FaceDetector (MVP용, 일부 브라우저만)
  if (!('FaceDetector' in window)) {
    alert('이 브라우저는 FaceDetector API를 지원하지 않습니다. MediaPipe를 사용하세요.');
    return;
  }
  const fd = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });

  // EMA로 점수 출렁임 완화
  let ema = null, alpha = 0.2;

  function brightnessAndSharpness(imgData, rect) {
    const { x, y, width, height } = rect;
    const rx = Math.max(0, Math.floor(x));
    const ry = Math.max(0, Math.floor(y));
    const rw = Math.min(W - rx, Math.floor(width));
    const rh = Math.min(H - ry, Math.floor(height));
    if (rw <= 0 || rh <= 0) return { bright: 0, sharp: 0 };

    const roi = ctx.getImageData(rx, ry, rw, rh);
    const d = roi.data;

    // 그레이스케일 + 평균 밝기
    let sum = 0;
    const gray = new Uint8ClampedArray(rw * rh);
    for (let i = 0, gi = 0; i < d.length; i += 4, gi++) {
      const r = d[i], g = d[i+1], b = d[i+2];
      const L = (0.2126*r + 0.7152*g + 0.0722*b); // luminance
      gray[gi] = L; sum += L;
    }
    const bright = sum / gray.length; // 0~255

    // 샤프니스: 간단 라플라시안 에너지
    const k = [0,-1,0,-1,4,-1,0,-1,0];
    let lapVarSum = 0, cnt = 0;
    for (let y=1; y<rh-1; y++) {
      for (let x=1; x<rw-1; x++) {
        const i = y*rw + x;
        const val =
          gray[i]     * 4 +
          gray[i-1]   * -1 +
          gray[i+1]   * -1 +
          gray[i-rw]  * -1 +
          gray[i+rw]  * -1;
        lapVarSum += val*val; cnt++;
      }
    }
    const sharp = Math.sqrt(lapVarSum / Math.max(1,cnt)); // 값이 클수록 선명

    return { bright, sharp };
  }

  function qualityGate(rect) {
    // 얼굴 크기/위치로 아주 러프한 품질 게이트 (정면도/포즈는 MediaPipe로 보완 권장)
    const area = (rect.width * rect.height) / (W * H);
    const centered = Math.abs((rect.x + rect.width/2) - W/2) / (W/2);
    // 얼굴이 화면의 6% 이상, 중앙에서 너무 치우치지 않음
    return (area > 0.06) && (centered < 0.6);
  }

  async function loop() {
    ctx.drawImage(video, 0, 0, W, H);

    try {
      const faces = await fd.detect(video);
      if (faces && faces.length) {
        const f = faces[0].boundingBox;
        // 시각화
        ctx.lineWidth = 3; ctx.strokeStyle = '#00ffd0';
        ctx.strokeRect(f.x, f.y, f.width, f.height);

        const { bright, sharp } = brightnessAndSharpness(ctx.getImageData(0,0,W,H), f);

        // 스코어링 (임시 휴리스틱) — 0~100 정규화
        const brightScore = Math.max(0, Math.min(100, (bright - 60) * (100/140))); // ~60~200 범위 가정
        const sharpScore  = Math.max(0, Math.min(100, (sharp  - 4)  * 12));        // 대충 스케일링
        let raw = 0.5*brightScore + 0.5*sharpScore;

        // 품질 게이트 미통과 시 페널티
        const ok = qualityGate(f);
        if (!ok) raw *= 0.6;

        // EMA 스무딩
        ema = (ema == null) ? raw : (alpha*raw + (1-alpha)*ema);
        const finalScore = Math.round(Math.max(0, Math.min(100, ema)));

        scoreEl.textContent = finalScore;
        qualityEl.textContent = `quality: ${ok ? 'ok' : 'low'}`;
      } else {
        scoreEl.textContent = '—';
        qualityEl.textContent = 'quality: —';
      }
    } catch (e) {
      // FaceDetector가 바쁘면 다음 프레임에서 재시도
    }

    requestAnimationFrame(loop);
  }
  loop();
})();
</script>
</body>
</html>
