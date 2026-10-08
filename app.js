/**
 * 光合作用與養分庫器官分配展示引擎 | Photosynthesis & Source-Sink Engine
 * 特色：
 * 1. 移除多餘步驟方塊，提供直觀「播放」與無縫互動
 * 2. 畫布圖示與所有文字全面放大至 18px~22px，極致清晰易讀
 * 3. 葡萄糖合成後三大去向：
 *    - 🥔 運往根部：儲存為澱粉
 *    - 🌸 運往花朵：提供開花能量與分泌花蜜
 *    - 🍎 運往果實：積累糖分並促成果實膨大
 * 4. 嚴格遵循木質部（水上行）與韌皮部（養分分流至各庫器官）專屬路徑
 * 5. 保衛細胞吸水膨脹(開啟)與失水萎縮(關閉)動態特寫
 */

(function () {
  'use strict';

  // 狀態管理
  const state = {
    fate: 'root', // 'root' | 'flower' | 'fruit'
    isPlaying: false,
    isAutoLoop: true, // 自動重複執行光合作用過程
    loopCount: 1, // 當前自動重複執行輪次
    loopNextTimerId: null, // 接續下一輪的計時器 ID
    activeTimers: [], // 活動計時器快取

    // 光照與氣孔開閉 (黑暗時氣孔自動關閉)
    isDay: true,
    stomaOpen: true,
    stomaAperture: 1.0, // 0.0 ~ 1.0 平滑插值

    // 累積生長/儲存量
    rootStarchCount: 0,
    flowerEnergyCount: 0,
    fruitSugarCount: 0,
    rootEmptyAlertPulse: 0,

    // 粒子系統
    co2Particles: [],
    h2oParticles: [],
    o2Bubbles: [],
    transports: [],
    conversions: [], // 抵達庫器官時的生化轉化浮動特效

    lastTime: performance.now(),
    chloroplastPulse: 0
  };

  // DOM 元素快取
  const canvas = document.getElementById('simCanvas');
  const ctx = canvas.getContext('2d');

  const playBtn = document.getElementById('playBtn');
  const resetBtn = document.getElementById('resetBtn');

  const loopIndicator = document.getElementById('loopIndicator');
  const loopBadgeText = document.getElementById('loopBadgeText');
  const loopStatusText = document.getElementById('loopStatusText');

  const toggleLightBtn = document.getElementById('toggleLightBtn');
  const lightIcon = document.getElementById('lightIcon');
  const lightStatusText = document.getElementById('lightStatusText');

  const fateRootBtn = document.getElementById('fateRootBtn');
  const fateFlowerBtn = document.getElementById('fateFlowerBtn');
  const fateFruitBtn = document.getElementById('fateFruitBtn');

  const rootToFlowerBtn = document.getElementById('rootToFlowerBtn');
  const rootToFruitBtn = document.getElementById('rootToFruitBtn');

  const eqCO2 = document.getElementById('eqCO2');
  const eqH2O = document.getElementById('eqH2O');
  const eqGlucose = document.getElementById('eqGlucose');
  const eqO2 = document.getElementById('eqO2');

  // =========================================================================
  // 解剖座標系統 (Precise Anatomical Layout)
  // =========================================================================
  const geo = {
    w: 1320,
    h: 740,
    soilY: 490,       // 地表土壤分界
    sunX: 1160,
    sunY: 95,

    // 莖部 (Stem)
    stemCenterX: 690,
    stemWidth: 72,
    stemTopY: 140,
    stemBottomY: 540,

    // 專屬輸導管 (Vascular Tracks)
    xylemStemX: 670,   // 木質部 (左側藍管)
    phloemStemX: 710,  // 韌皮部 (右側紫管)

    // 葉片 (Source - 光合作用源)
    leafBaseX: 650,
    leafCenterY: 300,
    leafTipX: 250,
    chloroplastX: 420,
    chloroplastY: 290,
    stomaX: 390,
    stomaY: 335,

    // 庫器官 1：花朵 (Flower - 位於右上部花枝，避開中央導管標籤)
    flowerX: 940,
    flowerY: 95,

    // 庫器官 2：果實 (Fruit - 位於中上部側枝)
    fruitBranchX: 960,
    fruitBranchY: 250,

    // 庫器官 3：根部儲藏塊 (Root Tuber - 位於地下)
    rootTuberX: 830,
    rootTuberY: 585
  };

  // =========================================================================
  // 計時器排程管理 (安全取消與重複調度)
  // =========================================================================

  function scheduleTimer(fn, delay) {
    const timerId = setTimeout(() => {
      state.activeTimers = state.activeTimers.filter(id => id !== timerId);
      fn();
    }, delay);
    state.activeTimers.push(timerId);
    return timerId;
  }

  function clearAllTimers() {
    state.activeTimers.forEach(id => clearTimeout(id));
    state.activeTimers = [];
  }

  function resetEquationHighlights() {
    eqCO2.className = 'eq-item';
    eqH2O.className = 'eq-item';
    eqGlucose.className = 'eq-item';
    eqO2.className = 'eq-item';
  }

  function updateLoopStatusUI(stepNote) {
    if (!loopIndicator || !loopBadgeText || !loopStatusText) return;

    if (!state.isDay) {
      loopIndicator.className = 'loop-badge paused';
      loopBadgeText.textContent = '夜間暫停';
      loopStatusText.innerHTML = '<span class="loop-icon">🌙</span> 夜間黑暗（氣孔閉合，光合作用暫停）';
      return;
    }

    if (state.isAutoLoop) {
      loopIndicator.className = 'loop-badge active';
      loopBadgeText.textContent = '自動重複中';
      if (stepNote) {
        loopStatusText.innerHTML = `<span class="loop-icon">🔄</span> 自動循環第 <strong>${state.loopCount}</strong> 輪：${stepNote}`;
      } else {
        loopStatusText.innerHTML = `<span class="loop-icon">🔄</span> 光合作用自動循環：第 <strong>${state.loopCount}</strong> 輪運行中`;
      }
    } else {
      loopIndicator.className = 'loop-badge paused';
      loopBadgeText.textContent = '已暫停循環';
      loopStatusText.innerHTML = `<span class="loop-icon">⏸️</span> 已暫停自動循環（目前累積 <strong>${state.loopCount}</strong> 輪，點擊恢復）`;
    }
  }

  function updatePlayBtnState() {
    if (!playBtn) return;
    if (state.isAutoLoop) {
      playBtn.className = 'primary-btn-lg playing';
      playBtn.innerHTML = '<span class="btn-icon">⏸️</span> 暫停自動重複';
    } else {
      playBtn.className = 'primary-btn-lg';
      playBtn.innerHTML = '<span class="btn-icon">▶</span> 開始自動重複';
    }
  }

  function togglePlayAutoLoop() {
    state.isAutoLoop = !state.isAutoLoop;
    updatePlayBtnState();
    updateLoopStatusUI();

    if (state.isAutoLoop) {
      if (!state.isDay) {
        setDayNightMode(true);
      }
      if (!state.isPlaying) {
        playPhotosynthesisDemo();
      }
    } else {
      // 暫停時取消預約中的下一輪排程計時器
      if (state.loopNextTimerId) {
        clearTimeout(state.loopNextTimerId);
        state.activeTimers = state.activeTimers.filter(id => id !== state.loopNextTimerId);
        state.loopNextTimerId = null;
      }
    }
  }

  // =========================================================================
  // 核心動態演示控制 (Photosynthesis Demo Sequence - 自動重複循環)
  // =========================================================================

  function playPhotosynthesisDemo() {
    if (state.isPlaying) return;
    if (!state.isDay) return; // 黑暗環境中暫緩進行光合作用

    state.isPlaying = true;
    updatePlayBtnState();
    updateLoopStatusUI('步驟 1/4：獲取 CO₂ 經氣孔擴散進入葉片');

    // 展開新一輪循環，重置上方反應式高亮
    resetEquationHighlights();

    // 1. 空氣中獲取二氧化碳進入氣孔
    scheduleTimer(() => {
      eqCO2.classList.add('active-co2');
    }, 80);

    for (let i = 0; i < 18; i++) {
      scheduleTimer(() => {
        state.co2Particles.push({
          x: 100 + Math.random() * 320,
          y: 70 + Math.random() * 150,
          targetX: geo.stomaX + (Math.random() - 0.5) * 20,
          targetY: geo.stomaY + (Math.random() - 0.5) * 10,
          progress: 0,
          speed: 0.015 + Math.random() * 0.008,
          size: 8
        });
      }, i * 70);
    }

    // 2. 水分由根部吸收沿木質部垂直上升
    scheduleTimer(() => {
      eqH2O.classList.add('active-h2o');
      updateLoopStatusUI('步驟 2/4：根部吸收 H₂O 沿木質部導管上升');

      for (let i = 0; i < 22; i++) {
        scheduleTimer(() => {
          const rootStartX = 500 + Math.random() * 160;
          const rootStartY = geo.soilY + 50 + Math.random() * 120;

          state.h2oParticles.push({
            waypoints: [
              { x: rootStartX, y: rootStartY },
              { x: geo.xylemStemX, y: geo.soilY + 20 },
              { x: geo.xylemStemX, y: geo.leafCenterY },
              { x: geo.chloroplastX, y: geo.chloroplastY }
            ],
            segment: 0,
            segProgress: 0,
            speed: 0.026 + Math.random() * 0.008,
            size: 8
          });
        }, i * 65);
      }
    }, 1600);

    // 3. 葉綠體光反應與卡爾文循環生成葡萄糖，並由氣孔釋放 O2
    scheduleTimer(() => {
      eqGlucose.classList.add('active-glucose');
      eqO2.classList.add('active-o2');
      state.chloroplastPulse = 1.0; // 太陽輻射激發葉綠體持續吸收光能
      updateLoopStatusUI('步驟 3/4：葉綠體合成葡萄糖，氣孔釋出 O₂');

      // 氧氣逸散自氣孔釋出
      for (let i = 0; i < 18; i++) {
        scheduleTimer(() => {
          state.o2Bubbles.push({
            x: geo.stomaX + (Math.random() - 0.5) * 15,
            y: geo.stomaY + (Math.random() - 0.5) * 10,
            vx: -(1.2 + Math.random() * 1.5),
            vy: -(1.6 + Math.random() * 1.8),
            alpha: 1,
            size: 9 + Math.random() * 4
          });
        }, i * 80);
      }
    }, 3500);

    // 4. 葡萄糖轉化為蔗糖，沿韌皮部運送至選擇的庫器官 (根 / 花 / 果)
    scheduleTimer(() => {
      let sinkAction = '運往根部 ➔ 到達轉化為「澱粉」儲存';
      if (state.fate === 'flower') {
        sinkAction = '運往花朵 ➔ 到達轉化為「花蜜與開花能量」';
      } else if (state.fate === 'fruit') {
        sinkAction = '運往果實 ➔ 到達轉化為「果糖」積累糖分';
      }
      updateLoopStatusUI(`步驟 4/4：葡萄糖轉為【蔗糖】輸導 ➔ ${sinkAction}`);
      dispatchNutrientToSink();
    }, 5200);

    // 單輪演示完成，準備自動接續下一輪
    scheduleTimer(() => {
      state.isPlaying = false;

      // 若啟用了自動重複執行且處於照光日間，無縫自動開展下一輪！
      if (state.isAutoLoop && state.isDay) {
        state.loopCount++;
        updateLoopStatusUI('本輪完成，即將自動接續下一輪...');
        state.loopNextTimerId = scheduleTimer(() => {
          state.loopNextTimerId = null;
          if (state.isAutoLoop && state.isDay) {
            playPhotosynthesisDemo();
          }
        }, 800);
      } else {
        updatePlayBtnState();
        updateLoopStatusUI();
      }
    }, 7200);
  }

  // 養分到達目標器官時的生化轉化特效 (抵達器官時由「蔗糖」轉化為「澱粉 / 花蜜 / 果糖」)
  function triggerOrganConversion(kind) {
    let text = '蔗糖 ➔ 澱粉 ✨';
    let x = geo.rootTuberX;
    let y = geo.rootTuberY - 20;
    let color = '#fef08a';

    if (kind === 'flower' || kind === 'root_to_flower') {
      text = '蔗糖 ➔ 花蜜 🌸';
      x = geo.flowerX;
      y = geo.flowerY - 15;
      color = '#f472b6';
    } else if (kind === 'fruit' || kind === 'root_to_fruit') {
      text = '蔗糖 ➔ 果糖 🍎';
      x = geo.fruitBranchX;
      y = geo.fruitBranchY - 15;
      color = '#f87171';
    }

    state.conversions.push({
      text,
      x: x + (Math.random() - 0.5) * 40,
      y: y + (Math.random() - 0.5) * 20,
      vy: -0.85 - Math.random() * 0.5,
      alpha: 1.0,
      color
    });
  }

  // 葡萄糖在葉肉細胞合成後轉化為蔗糖，經韌皮部運送至指定器官
  function dispatchNutrientToSink() {
    if (state.fate === 'root') {

      for (let i = 0; i < 16; i++) {
        scheduleTimer(() => {
          state.transports.push({
            kind: 'root',
            waypoints: [
              { x: geo.chloroplastX, y: geo.chloroplastY },
              { x: geo.phloemStemX, y: geo.leafCenterY },
              { x: geo.phloemStemX, y: geo.soilY + 20 },
              { x: geo.rootTuberX, y: geo.rootTuberY }
            ],
            segment: 0,
            segProgress: 0,
            speed: 0.022 + Math.random() * 0.006
          });
        }, i * 90);
      }
      scheduleTimer(() => {
        state.rootStarchCount++;
        updateRemobilizeButtonStates();
      }, 1500);

    } else if (state.fate === 'flower') {

      for (let i = 0; i < 16; i++) {
        scheduleTimer(() => {
          state.transports.push({
            kind: 'flower',
            waypoints: [
              { x: geo.chloroplastX, y: geo.chloroplastY },
              { x: geo.phloemStemX, y: geo.leafCenterY },
              { x: geo.phloemStemX, y: geo.stemTopY + 25 },
              { x: (geo.phloemStemX + geo.flowerX) / 2 + 15, y: geo.flowerY + 30 },
              { x: geo.flowerX, y: geo.flowerY }
            ],
            segment: 0,
            segProgress: 0,
            speed: 0.024 + Math.random() * 0.006
          });
        }, i * 90);
      }
      scheduleTimer(() => { state.flowerEnergyCount++; }, 1400);

    } else if (state.fate === 'fruit') {

      for (let i = 0; i < 16; i++) {
        scheduleTimer(() => {
          state.transports.push({
            kind: 'fruit',
            waypoints: [
              { x: geo.chloroplastX, y: geo.chloroplastY },
              { x: geo.phloemStemX, y: geo.leafCenterY },
              { x: geo.phloemStemX, y: geo.fruitBranchY },
              { x: geo.fruitBranchX, y: geo.fruitBranchY }
            ],
            segment: 0,
            segProgress: 0,
            speed: 0.024 + Math.random() * 0.006
          });
        }, i * 90);
      }
      scheduleTimer(() => { state.fruitSugarCount++; }, 1400);
    }
  }

  // 根部儲存養分再動員：將澱粉水解為蔗糖，沿韌皮部向上轉運至花或果
  function remobilizeRootNutrient(target) {
    // 嚴格檢驗：若根部沒有儲備養分 (rootStarchCount <= 0)，絕對不可向上運送！
    if (state.rootStarchCount <= 0) {
      state.rootEmptyAlertPulse = 1.0;
      updateRemobilizeButtonStates();
      return; // 立即中止，不產生任何運輸粒子
    }

    state.rootStarchCount--;
    updateRemobilizeButtonStates();

    // 在根部觸發澱粉水解為蔗糖的特效
    state.conversions.push({
      text: '澱粉水解 ➔ 蔗糖 ⚡',
      x: geo.rootTuberX,
      y: geo.rootTuberY - 25,
      vy: -0.8,
      alpha: 1.0,
      color: '#c084fc'
    });

    if (target === 'flower') {
      for (let i = 0; i < 16; i++) {
        scheduleTimer(() => {
          state.transports.push({
            kind: 'root_to_flower',
            waypoints: [
              { x: geo.rootTuberX, y: geo.rootTuberY },
              { x: geo.phloemStemX, y: geo.soilY + 20 },
              { x: geo.phloemStemX, y: geo.stemTopY + 25 },
              { x: (geo.phloemStemX + geo.flowerX) / 2 + 15, y: geo.flowerY + 30 },
              { x: geo.flowerX, y: geo.flowerY }
            ],
            segment: 0,
            segProgress: 0,
            speed: 0.024 + Math.random() * 0.006
          });
        }, i * 85);
      }
      scheduleTimer(() => { state.flowerEnergyCount++; }, 1400);

    } else if (target === 'fruit') {
      for (let i = 0; i < 16; i++) {
        scheduleTimer(() => {
          state.transports.push({
            kind: 'root_to_fruit',
            waypoints: [
              { x: geo.rootTuberX, y: geo.rootTuberY },
              { x: geo.phloemStemX, y: geo.soilY + 20 },
              { x: geo.phloemStemX, y: geo.fruitBranchY },
              { x: geo.fruitBranchX, y: geo.fruitBranchY }
            ],
            segment: 0,
            segProgress: 0,
            speed: 0.024 + Math.random() * 0.006
          });
        }, i * 85);
      }
      scheduleTimer(() => { state.fruitSugarCount++; }, 1400);
    }
  }

  // 光照與夜間黑暗模式切換 (黑暗時氣孔關閉)
  function setDayNightMode(isDay) {
    state.isDay = isDay;
    state.stomaOpen = isDay; // 照光氣孔開放；黑暗中氣孔自動關閉！

    if (toggleLightBtn) {
      if (isDay) {
        toggleLightBtn.className = 'light-toggle-btn day';
        lightIcon.textContent = '☀️';
        lightStatusText.textContent = '日間照光（氣孔開啟）';
        // 若啟用了自動重複執行且當前未在播放中，日間恢復時立即接續光合作用
        if (state.isAutoLoop && !state.isPlaying) {
          scheduleTimer(() => {
            playPhotosynthesisDemo();
          }, 350);
        }
      } else {
        toggleLightBtn.className = 'light-toggle-btn night';
        lightIcon.textContent = '🌙';
        lightStatusText.textContent = '夜間黑暗（氣孔關閉）';
      }
    }
    updateLoopStatusUI();
  }

  function toggleDayNight() {
    setDayNightMode(!state.isDay);
  }

  // 重置演示
  function resetDemo() {
    clearAllTimers();
    state.loopNextTimerId = null;
    state.isPlaying = false;
    state.co2Particles = [];
    state.h2oParticles = [];
    state.o2Bubbles = [];
    state.transports = [];
    state.conversions = [];
    state.chloroplastPulse = 0;
    state.rootStarchCount = 0;
    state.flowerEnergyCount = 0;
    state.fruitSugarCount = 0;
    state.rootEmptyAlertPulse = 0;
    state.loopCount = 1;

    resetEquationHighlights();

    state.isAutoLoop = true;
    updatePlayBtnState();

    setDayNightMode(true);
    updateRemobilizeButtonStates();
    updateLoopStatusUI();

    // 重置後重啟自動循環
    scheduleTimer(() => {
      playPhotosynthesisDemo();
    }, 400);
  }

  // 更新根部養分再動員按鈕的可用狀態
  function updateRemobilizeButtonStates() {
    if (!rootToFlowerBtn || !rootToFruitBtn) return;
    const hasStarch = state.rootStarchCount > 0;
    rootToFlowerBtn.classList.toggle('disabled', !hasStarch);
    rootToFruitBtn.classList.toggle('disabled', !hasStarch);

    const flowerSmall = rootToFlowerBtn.querySelector('small');
    const fruitSmall = rootToFruitBtn.querySelector('small');

    if (hasStarch) {
      if (flowerSmall) flowerSmall.textContent = `水解為蔗糖上行 (根部儲備: x${state.rootStarchCount})`;
      if (fruitSmall) fruitSmall.textContent = `水解為蔗糖上行 (根部儲備: x${state.rootStarchCount})`;
    } else {
      if (flowerSmall) flowerSmall.textContent = `⚠️ 根部無儲備澱粉 (需先經光合作用儲存)`;
      if (fruitSmall) fruitSmall.textContent = `⚠️ 根部無儲備澱粉 (需先經光合作用儲存)`;
    }
  }

  // =========================================================================
  // Canvas 渲染繪製核心
  // =========================================================================

  function render(now) {
    const dt = (now - state.lastTime) / 1000;
    state.lastTime = now;

    // 平滑插值氣孔開度
    const targetAperture = state.stomaOpen ? 1.0 : 0.0;
    state.stomaAperture += (targetAperture - state.stomaAperture) * 0.12;

    // 葉綠體受光激發脈動自然衰減
    if (state.chloroplastPulse > 0) {
      state.chloroplastPulse = Math.max(0, state.chloroplastPulse - 0.005);
    }

    // 根部無養分警示脈動衰減
    if (state.rootEmptyAlertPulse > 0) {
      state.rootEmptyAlertPulse = Math.max(0, state.rootEmptyAlertPulse - 0.015);
    }

    ctx.clearRect(0, 0, geo.w, geo.h);

    // 1. 環境背景與太陽/月色
    drawBackground();

    // 2. 持續照射的太陽輻射光能光束 (照光時持續照射，黑暗時無光)
    drawContinuousSunlight(now);

    // 3. 地下土壤與根系
    drawRootsAndTuber();

    // 4. 莖幹與雙管道 (大字體標記木質部與韌皮部)
    drawStemAndPipes();

    // 5. 庫器官：頂端花朵 (Flower)
    drawFlower(geo.flowerX, geo.flowerY);

    // 6. 庫器官：側枝果實 (Fruit)
    drawFruit(geo.fruitBranchX, geo.fruitBranchY);

    // 7. 光合作用源：葉片、葉脈、葉綠體與氣孔
    drawLeafAndStoma();

    // 8. 所有動態粒子
    drawAllParticles();

    requestAnimationFrame(render);
  }

  // 背景繪製 (隨照光/黑暗環境切換)
  function drawBackground() {
    // 天空背景
    const sky = ctx.createLinearGradient(0, 0, 0, geo.soilY);
    if (state.isDay) {
      sky.addColorStop(0, '#03100a');
      sky.addColorStop(0.7, '#071f14');
      sky.addColorStop(1, '#0c281a');
    } else {
      sky.addColorStop(0, '#020617');
      sky.addColorStop(0.7, '#061426');
      sky.addColorStop(1, '#091c1c');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, geo.w, geo.soilY);

    if (state.isDay) {
      // 照光環境：太陽與光芒
      const sunGrad = ctx.createRadialGradient(geo.sunX, geo.sunY, 20, geo.sunX, geo.sunY, 190);
      sunGrad.addColorStop(0, 'rgba(254, 240, 138, 0.95)');
      sunGrad.addColorStop(0.4, 'rgba(251, 191, 36, 0.45)');
      sunGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(geo.sunX, geo.sunY, 190, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fffbeb';
      ctx.beginPath();
      ctx.arc(geo.sunX, geo.sunY, 38, 0, Math.PI * 2);
      ctx.fill();

      drawBigLabel('☀️ 太陽輻射光能', geo.sunX - 60, geo.sunY + 62, '#fef08a', 18);
    } else {
      // 黑暗環境：夜空無光
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(geo.sunX, geo.sunY, 28, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#061426';
      ctx.beginPath();
      ctx.arc(geo.sunX + 10, geo.sunY - 5, 24, 0, Math.PI * 2);
      ctx.fill();

      drawBigLabel('🌙 黑暗環境 (無光照)', geo.sunX - 75, geo.sunY + 62, '#94a3b8', 18);
    }

    // 土壤
    const soil = ctx.createLinearGradient(0, geo.soilY, 0, geo.h);
    soil.addColorStop(0, '#26140b');
    soil.addColorStop(0.5, '#180d06');
    soil.addColorStop(1, '#0a0502');
    ctx.fillStyle = soil;
    ctx.fillRect(0, geo.soilY, geo.w, geo.h - geo.soilY);

    // 草地邊界線
    ctx.strokeStyle = state.isDay ? '#22c55e' : '#15803d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, geo.soilY);
    ctx.lineTo(geo.w, geo.soilY);
    ctx.stroke();

    drawBigLabel('🌱 地表土壤層 (根部吸收水分 H₂O)', 40, geo.soilY + 36, '#e2e8f0', 18);
    const atmoText = state.isDay ? '☁️ 大氣環境 (日間光照充足)' : '☁️ 大氣環境 (夜間黑暗環境)';
    drawBigLabel(atmoText, 320, 42, '#e2e8f0', 18);
  }

  // 持續照射的太陽光束 (黑暗中停止光照)
  function drawContinuousSunlight(now) {
    if (!state.isDay) return; // 黑暗環境中停止光束照射

    ctx.save();

    // 太陽核心大日冕脈動
    const pulse = 1.0 + Math.sin(now * 0.0018) * 0.05 + state.chloroplastPulse * 0.12;
    const coronaGrad = ctx.createRadialGradient(geo.sunX, geo.sunY, 30, geo.sunX, geo.sunY, 260 * pulse);
    coronaGrad.addColorStop(0, 'rgba(254, 240, 138, 0.42)');
    coronaGrad.addColorStop(0.35, 'rgba(251, 191, 36, 0.2)');
    coronaGrad.addColorStop(0.7, 'rgba(245, 158, 11, 0.07)');
    coronaGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = coronaGrad;
    ctx.beginPath();
    ctx.arc(geo.sunX, geo.sunY, 260 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // 寬廣覆蓋、持續籠罩葉片與全株的自然太陽光束 (Volumetric Sunlight Beams)
    const beams = [
      { angleOffset: -0.28, widthAngle: 0.10, speed: 0.0012, baseAlpha: 0.14 },
      { angleOffset: -0.15, widthAngle: 0.14, speed: 0.0018, baseAlpha: 0.20 },
      { angleOffset: -0.02, widthAngle: 0.16, speed: 0.0014, baseAlpha: 0.24 },
      { angleOffset: 0.12, widthAngle: 0.13, speed: 0.0022, baseAlpha: 0.18 },
      { angleOffset: 0.26, widthAngle: 0.10, speed: 0.0015, baseAlpha: 0.13 }
    ];

    const targetX = geo.chloroplastX + 40;
    const targetY = geo.leafCenterY;
    const mainAngle = Math.atan2(targetY - geo.sunY, targetX - geo.sunX);
    const beamLength = 1150;

    beams.forEach((b, idx) => {
      const curAngle = mainAngle + b.angleOffset + Math.sin(now * b.speed + idx) * 0.035;
      const alpha = b.baseAlpha + Math.sin(now * b.speed * 1.6 + idx * 2) * 0.04 + state.chloroplastPulse * 0.14;

      const beamGrad = ctx.createLinearGradient(
        geo.sunX, geo.sunY,
        geo.sunX + Math.cos(curAngle) * beamLength,
        geo.sunY + Math.sin(curAngle) * beamLength
      );
      beamGrad.addColorStop(0, `rgba(254, 240, 138, ${Math.min(alpha * 1.8, 0.65)})`);
      beamGrad.addColorStop(0.3, `rgba(253, 224, 71, ${Math.min(alpha * 1.2, 0.45)})`);
      beamGrad.addColorStop(0.7, `rgba(251, 191, 36, ${Math.min(alpha * 0.6, 0.2)})`);
      beamGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');

      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(geo.sunX, geo.sunY);
      const halfA = b.widthAngle / 2;
      ctx.lineTo(geo.sunX + Math.cos(curAngle - halfA) * beamLength, geo.sunY + Math.sin(curAngle - halfA) * beamLength);
      ctx.lineTo(geo.sunX + Math.cos(curAngle + halfA) * beamLength, geo.sunY + Math.sin(curAngle + halfA) * beamLength);
      ctx.closePath();
      ctx.fill();
    });

    ctx.restore();
  }

  // 繪製維管束專屬大字高對比標籤 (含指示虛線與端點，位置獨立不重疊)
  function drawVascularLabel(title, sub, badgeCenterX, badgeTopY, targetX, targetY, themeColor, subColor) {
    ctx.save();
    const w = 126;
    const h = 50;
    const bx = badgeCenterX - w / 2;
    const by = badgeTopY;

    // 半透明高對比底框
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 8);
    ctx.fill();
    ctx.stroke();

    // 指引連線與指示點至導管頂端
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(badgeCenterX, by + h);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = themeColor;
    ctx.beginPath();
    ctx.arc(targetX, targetY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 文字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = themeColor;
    ctx.font = 'bold 18px "Noto Sans TC", sans-serif';
    ctx.fillText(title, badgeCenterX, by + 17);

    ctx.fillStyle = subColor;
    ctx.font = 'bold 13px "Noto Sans TC", sans-serif';
    ctx.fillText(sub, badgeCenterX, by + 37);

    ctx.restore();
  }

  // 繪製莖幹與雙管道 (大字體標記)
  function drawStemAndPipes() {
    const stemW = geo.stemWidth;
    const topY = geo.stemTopY;
    const btmY = geo.stemBottomY;

    // 莖外表皮
    ctx.fillStyle = '#14532d';
    ctx.beginPath();
    ctx.roundRect(geo.stemCenterX - stemW / 2, topY, stemW, btmY - topY, 8);
    ctx.fill();
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // ----------------------------------------------------
    // 木質部導管 (Xylem Vessel) - 水分向上
    // ----------------------------------------------------
    const xPipeX = geo.xylemStemX;
    const pipeWidth = 18;

    ctx.fillStyle = 'rgba(2, 132, 199, 0.55)';
    ctx.beginPath();
    ctx.roundRect(xPipeX - pipeWidth / 2, topY + 8, pipeWidth, btmY - topY - 8, 6);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 向上流動箭頭
    ctx.fillStyle = '#bae6fd';
    ctx.font = 'bold 15px sans-serif';
    for (let y = topY + 50; y < btmY - 30; y += 45) {
      ctx.fillText('↑', xPipeX - 5, y);
    }

    // ----------------------------------------------------
    // 韌皮部篩管 (Phloem Sieve Tube) - 養分分流向下/向上
    // ----------------------------------------------------
    const pPipeX = geo.phloemStemX;

    ctx.fillStyle = 'rgba(147, 51, 234, 0.5)';
    ctx.beginPath();
    ctx.roundRect(pPipeX - pipeWidth / 2, topY + 8, pipeWidth, btmY - topY - 8, 6);
    ctx.fill();
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 流動箭頭
    ctx.fillStyle = '#f3e8ff';
    ctx.font = 'bold 15px sans-serif';
    for (let y = topY + 70; y < btmY - 30; y += 45) {
      ctx.fillText('↕', pPipeX - 5, y);
    }

    // ----------------------------------------------------
    // 木質部與韌皮部專屬大字高對比標籤 (完全避開花朵，獨立清晰)
    // ----------------------------------------------------
    drawVascularLabel('【木質部】', '水分上行 ↑', 590, topY - 68, xPipeX, topY + 8, '#38bdf8', '#7dd3fc');
    drawVascularLabel('【韌皮部】', '蔗糖輸導 ↕', 745, topY - 68, pPipeX, topY + 8, '#c084fc', '#e9d5ff');
  }

  // 繪製庫器官 1：花朵 (Flower - 位於右上側枝，避開木質部韌皮部標籤)
  function drawFlower(fx, fy) {
    ctx.save();

    // 綠色花梗 (從莖幹頂部優雅伸展至花朵)
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(geo.stemCenterX, geo.stemTopY + 25);
    ctx.quadraticCurveTo(geo.stemCenterX + 60, fy + 45, fx - 12, fy + 16);
    ctx.stroke();

    // 綠色花梗細輪廓
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 花柄內的韌皮部管道 (養分輸入通道)
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(geo.phloemStemX, geo.stemTopY + 25);
    ctx.quadraticCurveTo(geo.phloemStemX + 55, fy + 45, fx, fy + 10);
    ctx.stroke();

    // 綠色花萼
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.ellipse(fx, fy + 18, 15, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 5 片粉紅盛開花瓣
    const petalGlow = state.fate === 'flower' && state.flowerEnergyCount > 0;
    ctx.fillStyle = petalGlow ? '#f472b6' : '#ec4899';
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
      const px = fx + Math.cos(angle) * 20;
      const py = fy + Math.sin(angle) * 20;
      ctx.beginPath();
      ctx.arc(px, py, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#be185d';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // 金黃色花蕊中心 (雄蕊與雌蕊蜜腺)
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(fx, fy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 花朵大字標籤 (20px bold) - 清楚置於花朵上方
    drawBigLabel(`🌸 花朵 (發育與花蜜 x${state.flowerEnergyCount})`, fx - 100, fy - 36, '#f472b6', 20);

    ctx.restore();
  }

  // 繪製庫器官 2：側枝果實 (Fruit)
  function drawFruit(rx, ry) {
    ctx.save();

    // 綠色果枝
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(geo.stemCenterX + 15, ry);
    ctx.lineTo(rx - 25, ry);
    ctx.stroke();

    // 果梗 (韌皮部管道延伸至果實)
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(geo.phloemStemX, ry);
    ctx.lineTo(rx - 25, ry);
    ctx.stroke();

    // 綠色果蒂與果萼
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.ellipse(rx, ry - 22, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 碩大鮮紅果實本體 (隨積糖量動態膨大)
    const extraSize = Math.min(state.fruitSugarCount * 4, 20);
    const fruitR = 26 + extraSize;

    const fruitGrad = ctx.createRadialGradient(rx - 6, ry - 6, 4, rx, ry, fruitR);
    fruitGrad.addColorStop(0, '#fca5a5');
    fruitGrad.addColorStop(0.4, '#ef4444');
    fruitGrad.addColorStop(1, '#991b1b');
    ctx.fillStyle = fruitGrad;

    ctx.beginPath();
    ctx.arc(rx, ry, fruitR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 光澤高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.ellipse(rx - fruitR * 0.35, ry - fruitR * 0.35, fruitR * 0.25, fruitR * 0.15, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();

    // 果實大字標籤 (20px bold)
    drawBigLabel(`🍎 果實 (積糖與膨大 x${state.fruitSugarCount})`, rx - 90, ry + fruitR + 25, '#f87171', 20);

    ctx.restore();
  }

  // 繪製地下根系與庫器官 3：澱粉儲藏組織 (Root & Starch Tuber)
  function drawRootsAndTuber() {
    ctx.save();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    // 主根
    ctx.beginPath();
    ctx.moveTo(geo.stemCenterX, geo.soilY);
    ctx.bezierCurveTo(geo.stemCenterX - 10, geo.soilY + 60, geo.stemCenterX + 10, geo.soilY + 110, geo.stemCenterX, geo.h - 30);
    ctx.stroke();

    // 吸水側根 (連通木質部)
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(geo.xylemStemX, geo.soilY + 20);
    ctx.quadraticCurveTo(geo.xylemStemX - 60, geo.soilY + 60, geo.xylemStemX - 160, geo.soilY + 120);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(geo.xylemStemX - 50, geo.soilY + 50);
    ctx.quadraticCurveTo(geo.xylemStemX - 100, geo.soilY + 100, geo.xylemStemX - 110, geo.h - 40);
    ctx.stroke();

    // 吸水根大字標籤 (18px bold)
    drawBigLabel('根毛吸水區 (水分由此進入木質部)', geo.xylemStemX - 220, geo.soilY + 150, '#38bdf8', 18);

    // 韌皮部通往澱粉塊根 (連通韌皮部)
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(geo.phloemStemX, geo.soilY + 20);
    ctx.quadraticCurveTo(geo.phloemStemX + 40, geo.soilY + 45, geo.rootTuberX, geo.rootTuberY);
    ctx.stroke();

    // 澱粉塊根 (隨澱粉累積膨大)
    const tuberSize = Math.min(30 + state.rootStarchCount * 8, 66);
    const tuberGrad = ctx.createRadialGradient(geo.rootTuberX, geo.rootTuberY, 6, geo.rootTuberX, geo.rootTuberY, tuberSize);
    tuberGrad.addColorStop(0, '#fef08a');
    tuberGrad.addColorStop(0.5, '#ca8a04');
    tuberGrad.addColorStop(1, '#713f12');
    ctx.fillStyle = tuberGrad;

    ctx.beginPath();
    ctx.ellipse(geo.rootTuberX, geo.rootTuberY, tuberSize, tuberSize * 0.72, Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 根部大字標籤 (20px bold)
    drawBigLabel(`根部 (澱粉儲藏組織 x${state.rootStarchCount})`, geo.rootTuberX - 90, geo.rootTuberY + tuberSize + 25, '#ffffff', 20);

    // 若根部無養分且被觸發時，繪製警示光環與文字
    if (state.rootEmptyAlertPulse > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(239, 68, 68, ${state.rootEmptyAlertPulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(geo.rootTuberX, geo.rootTuberY, tuberSize + 14, 0, Math.PI * 2);
      ctx.stroke();
      drawBigLabel('根部無儲備澱粉！無法向上轉運', geo.rootTuberX - 120, geo.rootTuberY - tuberSize - 16, '#f87171', 18);
      ctx.restore();
    }

    ctx.restore();
  }

  // 繪製光合作用源：葉片、葉脈、葉綠體與氣孔
  function drawLeafAndStoma() {
    ctx.save();

    // 葉片輪廓
    ctx.beginPath();
    ctx.moveTo(geo.leafBaseX, geo.leafCenterY);
    ctx.bezierCurveTo(geo.leafBaseX - 60, geo.leafCenterY - 110, geo.leafTipX + 40, geo.leafCenterY - 90, geo.leafTipX, geo.leafCenterY);
    ctx.bezierCurveTo(geo.leafTipX + 40, geo.leafCenterY + 90, geo.leafBaseX - 60, geo.leafCenterY + 110, geo.leafBaseX, geo.leafCenterY);
    ctx.closePath();

    const leafGrad = ctx.createRadialGradient(geo.chloroplastX, geo.chloroplastY, 20, geo.chloroplastX, geo.chloroplastY, 220);
    leafGrad.addColorStop(0, '#22c55e');
    leafGrad.addColorStop(0.6, '#15803d');
    leafGrad.addColorStop(1, '#14532d');
    ctx.fillStyle = leafGrad;
    ctx.fill();
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 木質部葉脈 (藍色通道)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(geo.xylemStemX, geo.leafCenterY);
    ctx.lineTo(geo.leafBaseX, geo.leafCenterY - 4);
    ctx.quadraticCurveTo(geo.chloroplastX + 50, geo.chloroplastY - 6, geo.chloroplastX, geo.chloroplastY);
    ctx.stroke();

    // 韌皮部葉脈 (紫色通道)
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(geo.chloroplastX, geo.chloroplastY);
    ctx.quadraticCurveTo(geo.chloroplastX + 70, geo.chloroplastY + 14, geo.leafBaseX, geo.leafCenterY + 6);
    ctx.lineTo(geo.phloemStemX, geo.leafCenterY);
    ctx.stroke();

    // 葉綠體核心反應區
    ctx.fillStyle = state.chloroplastPulse > 0.1 ? '#10b981' : '#059669';
    ctx.beginPath();
    ctx.ellipse(geo.chloroplastX, geo.chloroplastY, 56, 36, -0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // 葉綠體大字標籤 (18px bold)
    drawBigLabel('葉綠體 (光合作用)', geo.chloroplastX - 52, geo.chloroplastY - 6, '#ffffff', 18);
    drawBigLabel('光反應 & 卡爾文循環', geo.chloroplastX - 52, geo.chloroplastY + 16, '#fef08a', 14);

    // 氣孔 (Stomata) 直接呈現開或關 (省略保衛細胞圖，黑暗時氣孔關閉)
    if (state.stomaAperture > 0.15) {
      // 氣孔開啟狀態：清晰開口孔隙
      const poreW = 16 * state.stomaAperture;
      const poreH = 26;

      ctx.fillStyle = '#052e16';
      ctx.beginPath();
      ctx.ellipse(geo.stomaX, geo.stomaY, poreW / 2, poreH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.beginPath();
      ctx.ellipse(geo.stomaX, geo.stomaY, poreW / 2 + 4, poreH / 2 + 4, 0, 0, Math.PI * 2);
      ctx.fill();

      drawBigLabel('【氣孔 開啟】(照光氣體暢通)', geo.stomaX - 90, geo.stomaY + 36, '#4ade80', 16);
    } else {
      // 氣孔關閉狀態 (黑暗環境中完全緊閉的縫隙)
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(geo.stomaX, geo.stomaY - 14);
      ctx.lineTo(geo.stomaX, geo.stomaY + 14);
      ctx.stroke();

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.stroke();

      drawBigLabel('【氣孔 關閉】(黑暗中閉合)', geo.stomaX - 90, geo.stomaY + 36, '#94a3b8', 16);
    }

    ctx.restore();
  }

  // 輔助函式：繪製具備陰影與高對比的大字體
  function drawBigLabel(text, x, y, color, size) {
    ctx.save();
    ctx.font = `bold ${size}px "Noto Sans TC", sans-serif`;
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 6;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // 繪製所有粒子 (分子徽章與文字全面大幅加大、清晰可辨)
  function drawAllParticles() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // A. CO2 分子 (大尺寸 36px 徽章，大字體 bold 15px)
    state.co2Particles.forEach(p => {
      p.progress += p.speed;
      const cx = p.x + (p.targetX - p.x) * p.progress;
      const cy = p.y + (p.targetY - p.y) * p.progress;
      const r = 18;

      ctx.fillStyle = p.blocked ? '#fca5a5' : '#f8fafc';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.blocked ? '#dc2626' : '#64748b';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillText('CO₂', cx, cy + 1);
    });
    state.co2Particles = state.co2Particles.filter(p => p.progress < 1);

    // B. 水分子 H2O (大尺寸 36px 徽章，大字體 bold 15px)
    state.h2oParticles.forEach(p => {
      p.segProgress += p.speed;
      if (p.segProgress >= 1) {
        p.segProgress = 0;
        p.segment++;
      }

      if (p.segment < p.waypoints.length - 1) {
        const p1 = p.waypoints[p.segment];
        const p2 = p.waypoints[p.segment + 1];
        const cx = p1.x + (p2.x - p1.x) * p.segProgress;
        const cy = p1.y + (p2.y - p1.y) * p.segProgress;
        const r = 18;

        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = '#032b43';
        ctx.font = 'bold 15px "JetBrains Mono", monospace';
        ctx.fillText('H₂O', cx, cy + 1);
      }
    });
    state.h2oParticles = state.h2oParticles.filter(p => p.segment < p.waypoints.length - 1);

    // D. 氧氣氣泡 O2 (大尺寸 40px 氣泡，大字體 bold 15px)
    state.o2Bubbles.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
      b.alpha -= 0.009;
      const r = 20;

      ctx.fillStyle = `rgba(103, 232, 249, ${Math.max(b.alpha, 0)})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(8, 145, 178, ${Math.max(b.alpha, 0)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = `rgba(8, 51, 68, ${Math.max(b.alpha, 0)})`;
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillText('O₂', b.x, b.y + 1);
    });
    state.o2Bubbles = state.o2Bubbles.filter(b => b.alpha > 0);

    // E. 蔗糖養分分配粒子 (所有運送中的養分一律為「蔗糖」，抵達目標器官才進行生化轉化)
    state.transports.forEach(t => {
      t.segProgress += t.speed;
      if (t.segProgress >= 1) {
        t.segProgress = 0;
        t.segment++;

        // 剛抵達最後目標器官的瞬間，觸發轉化特效
        if (t.segment >= t.waypoints.length - 1 && !t.converted) {
          t.converted = true;
          triggerOrganConversion(t.kind);
        }
      }

      if (t.segment < t.waypoints.length - 1) {
        const p1 = t.waypoints[t.segment];
        const p2 = t.waypoints[t.segment + 1];
        const cx = p1.x + (p2.x - p1.x) * t.segProgress;
        const cy = p1.y + (p2.y - p1.y) * t.segProgress;
        const r = 20;

        // 韌皮部運輸專屬紫色「蔗糖」大徽章 (40px 直徑，高對比大字 bold 14px)
        const ballColor = '#c084fc';
        const strokeColor = '#9333ea';
        const label = '蔗糖';

        ctx.fillStyle = ballColor;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px "Noto Sans TC", sans-serif';
        ctx.fillText(label, cx, cy + 1);
      }
    });
    state.transports = state.transports.filter(t => t.segment < t.waypoints.length - 1);

    // F. 器官到達生化轉化浮動標籤 (抵達目標器官時展示：蔗糖 ➔ 澱粉 / 花蜜 / 果糖)
    state.conversions.forEach(c => {
      c.y += c.vy;
      c.alpha -= 0.016;

      ctx.save();
      ctx.globalAlpha = Math.max(c.alpha, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 18px "Noto Sans TC", sans-serif';
      ctx.fillStyle = c.color;
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 8;
      ctx.fillText(c.text, c.x, c.y);
      ctx.restore();
    });
    state.conversions = state.conversions.filter(c => c.alpha > 0);

    ctx.restore();
  }

  // =========================================================================
  // 事件監聽與切換
  // =========================================================================
  function initEvents() {
    playBtn.onclick = togglePlayAutoLoop;
    resetBtn.onclick = resetDemo;

    // 光照環境切換 (照光開啟 / 黑暗閉合)
    if (toggleLightBtn) {
      toggleLightBtn.onclick = toggleDayNight;
    }

    // 葡萄糖去向切換 (根 / 花 / 果)
    fateRootBtn.onclick = () => {
      state.fate = 'root';
      updateFateButtons();
    };

    fateFlowerBtn.onclick = () => {
      state.fate = 'flower';
      updateFateButtons();
    };

    fateFruitBtn.onclick = () => {
      state.fate = 'fruit';
      updateFateButtons();
    };

    // 根部養分再動員轉運至花朵或果實
    if (rootToFlowerBtn) {
      rootToFlowerBtn.onclick = () => remobilizeRootNutrient('flower');
    }
    if (rootToFruitBtn) {
      rootToFruitBtn.onclick = () => remobilizeRootNutrient('fruit');
    }
  }

  function updateFateButtons() {
    fateRootBtn.classList.toggle('active', state.fate === 'root');
    fateFlowerBtn.classList.toggle('active', state.fate === 'flower');
    fateFruitBtn.classList.toggle('active', state.fate === 'fruit');
  }

  function init() {
    initEvents();
    setDayNightMode(true);
    updatePlayBtnState();
    updateRemobilizeButtonStates();
    updateFateButtons();
    updateLoopStatusUI();

    // 進入頁面後立即自動重複執行光合作用過程
    scheduleTimer(() => {
      playPhotosynthesisDemo();
    }, 450);

    requestAnimationFrame(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
