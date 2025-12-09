// Protector: Бережный шиномонтаж — Кликер
// Основная логика игры

const STORAGE_KEY = "protector_careful_tires_v1";

const FAST_CLICK_THRESHOLD_MS = 260;
const CARE_RECOVERY_PER_SECOND = 0.06;
const BASE_TIP_CHANCE = 0.02;
const BASE_CARE_PENALTY = 0.06;

// Определения улучшений
const UPGRADE_DEFS = [
  {
    id: "balancer",
    name: "Балансировка PRO",
    description: "Увеличивает доход за клик на 10% за уровень.",
    baseCost: 500,
    type: "incomeMultiplier",
    value: 0.1,
  },
  {
    id: "machine",
    name: "Премиальный станок",
    description: "Даёт фиксированный бонус к доходу за клик.",
    baseCost: 1500,
    type: "baseIncome",
    value: 15,
  },
  {
    id: "training",
    name: "Обучение персонала",
    description: "Снижает штраф за слишком быстрые клики.",
    baseCost: 1800,
    type: "careStability",
    value: 0.01,
  },
  {
    id: "loyalty",
    name: "Программа лояльности",
    description: "Повышает шанс чаевых от довольных клиентов.",
    baseCost: 2200,
    type: "tipChance",
    value: 0.01,
  },
  {
    id: "ads",
    name: "Реклама Protector",
    description: "Даёт пассивный доход каждую секунду.",
    baseCost: 3200,
    type: "autoIncome",
    value: 4,
  },
];

// Базовое состояние
const defaultState = {
  money: 0,
  totalWheels: 0,
  bestSingleClickIncome: 0,
  totalTips: 0,
  care: 1,
  lastClickTime: 0,
  upgrades: {}, // { [id]: { level: number } }
  lastSavedAt: null,
  lastTickAt: Date.now(),
  // производные значения (пересчитываются)
  baseIncomePerClick: 50,
  incomeMultiplier: 1,
  autoIncomePerSec: 0,
  tipChance: BASE_TIP_CHANCE,
  carePenalty: BASE_CARE_PENALTY,
};

let state = { ...defaultState };
let dom = {};
let timeSinceLastSave = 0;
let toastTimeoutId = null;

// === УТИЛИТЫ ===

function formatMoney(value) {
  const rounded = Math.floor(value);
  return rounded.toLocaleString("ru-RU");
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// === ХРАНИЛИЩЕ ===

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state = {
      ...defaultState,
      ...parsed,
      upgrades: parsed.upgrades || {},
    };
  } catch (e) {
    console.warn("Не удалось загрузить сохранение", e);
  }
}

function saveState() {
  try {
    const toSave = {
      money: state.money,
      totalWheels: state.totalWheels,
      bestSingleClickIncome: state.bestSingleClickIncome,
      totalTips: state.totalTips,
      care: state.care,
      lastClickTime: state.lastClickTime,
      upgrades: state.upgrades,
      lastSavedAt: Date.now(),
      lastTickAt: state.lastTickAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("Не удалось сохранить игру", e);
  }
}

// === ПРОИЗВОДНЫЕ ПАРАМЕТРЫ ===

function recalcDerived() {
  let baseIncome = 50;
  let multiplier = 1;
  let autoIncome = 0;
  let tipChance = BASE_TIP_CHANCE;
  let carePenalty = BASE_CARE_PENALTY;

  for (const def of UPGRADE_DEFS) {
    const level = (state.upgrades[def.id] && state.upgrades[def.id].level) || 0;
    if (!level) continue;

    switch (def.type) {
      case "incomeMultiplier":
        multiplier *= 1 + def.value * level;
        break;
      case "baseIncome":
        baseIncome += def.value * level;
        break;
      case "autoIncome":
        autoIncome += def.value * level;
        break;
      case "tipChance":
        tipChance += def.value * level;
        break;
      case "careStability":
        carePenalty = Math.max(0.01, carePenalty - def.value * level);
        break;
      default:
        break;
    }
  }

  state.baseIncomePerClick = baseIncome;
  state.incomeMultiplier = multiplier;
  state.autoIncomePerSec = autoIncome;
  state.tipChance = tipChance;
  state.carePenalty = carePenalty;
}

// === DOM / ИНИЦИАЛИЗАЦИЯ ===

function cacheDOM() {
  dom.moneyValue = document.getElementById("moneyValue");
  dom.wheelsValue = document.getElementById("wheelsValue");
  dom.autoIncomeValue = document.getElementById("autoIncomeValue");
  dom.clickIncomeValue = document.getElementById("clickIncomeValue");
  dom.tipChanceValue = document.getElementById("tipChanceValue");

  dom.careFill = document.getElementById("careFill");
  dom.careLabel = document.getElementById("careLabel");

  dom.wheelButton = document.getElementById("wheelButton");
  dom.floatingContainer = document.getElementById("floatingContainer");

  dom.upgradesList = document.getElementById("upgradesList");
  dom.statsContainer = document.getElementById("statsContainer");

  dom.toast = document.getElementById("toast");
  dom.navButtons = document.querySelectorAll(".nav-btn");
  dom.screens = document.querySelectorAll(".screen");
}

function bindEvents() {
  dom.wheelButton.addEventListener("click", onWheelClick);

  dom.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      switchScreen(target);
    });
  });
}

function switchScreen(target) {
  dom.screens.forEach((screen) => {
    if (screen.dataset.screen === target) {
      screen.classList.add("screen--active");
    } else {
      screen.classList.remove("screen--active");
    }
  });

  dom.navButtons.forEach((btn) => {
    if (btn.dataset.target === target) {
      btn.classList.add("nav-btn--active");
    } else {
      btn.classList.remove("nav-btn--active");
    }
  });

  if (target === "upgrades") {
    renderUpgrades();
  } else if (target === "stats") {
    renderStats();
  }
}

// === TOAST ===

function showToast(text) {
  if (!dom.toast) return;
  dom.toast.textContent = text;
  dom.toast.classList.add("toast--visible");
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    dom.toast.classList.remove("toast--visible");
  }, 3500);
}

// === FLOATING TEXT ===

function spawnFloatingText(text, variant = "money") {
  if (!dom.floatingContainer) return;

  const el = document.createElement("div");
  el.className = "floating-text";

  if (variant === "money") {
    el.classList.add("floating-text--money");
  } else if (variant === "tip") {
    el.classList.add("floating-text--tip");
  } else if (variant === "warning") {
    el.classList.add("floating-text--warning");
  }

  el.textContent = text;

  const offsetX = (Math.random() - 0.5) * 40;
  const offsetY = (Math.random() - 0.5) * 16;
  el.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-40% + ${offsetY}px))`;

  dom.floatingContainer.appendChild(el);

  setTimeout(() => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }, 800);
}

// === UI ОБНОВЛЕНИЕ ===

function updateStatsUI() {
  if (dom.moneyValue) {
    dom.moneyValue.textContent = formatMoney(state.money);
  }
  if (dom.wheelsValue) {
    dom.wheelsValue.textContent = state.totalWheels.toString();
  }
  if (dom.autoIncomeValue) {
    dom.autoIncomeValue.textContent = formatMoney(state.autoIncomePerSec) + " ₽";
  }
  if (dom.clickIncomeValue) {
    const idealIncome =
      state.baseIncomePerClick * state.incomeMultiplier;
    dom.clickIncomeValue.textContent = formatMoney(idealIncome) + " ₽";
  }
  if (dom.tipChanceValue) {
    dom.tipChanceValue.textContent = Math.round(state.tipChance * 100) + "%";
  }

  const care = clamp01(state.care);
  if (dom.careFill) {
    dom.careFill.style.transform = `scaleX(${care})`;
  }
  if (dom.careLabel) {
    dom.careLabel.textContent = Math.round(care * 100) + "%";
    if (care < 0.35) {
      dom.careLabel.style.color = "#ff5464";
    } else if (care < 0.7) {
      dom.careLabel.style.color = "#ffb84a";
    } else {
      dom.careLabel.style.color = "#00ff9a";
    }
  }
}

// === УЛУЧШЕНИЯ ===

function getUpgradeLevel(id) {
  return (state.upgrades[id] && state.upgrades[id].level) || 0;
}

function getUpgradeCost(def, levelOverride) {
  const level = levelOverride != null ? levelOverride : getUpgradeLevel(def.id);
  return Math.floor(def.baseCost * Math.pow(1.35, level));
}

function canBuyUpgrade(def) {
  const level = getUpgradeLevel(def.id);
  const cost = getUpgradeCost(def, level);
  return state.money >= cost;
}

function buyUpgrade(id) {
  const def = UPGRADE_DEFS.find((u) => u.id === id);
  if (!def) return;

  const level = getUpgradeLevel(id);
  const cost = getUpgradeCost(def, level);

  if (state.money < cost) return;

  state.money -= cost;
  state.upgrades[id] = { level: level + 1 };

  recalcDerived();
  renderUpgrades();
  updateStatsUI();
  saveState();
}

function renderUpgrades() {
  if (!dom.upgradesList) return;
  dom.upgradesList.innerHTML = "";

  UPGRADE_DEFS.forEach((def) => {
    const level = getUpgradeLevel(def.id);
    const cost = getUpgradeCost(def, level);
    const affordable = state.money >= cost;

    const card = document.createElement("div");
    card.className = "upgrade-card";

    const main = document.createElement("div");
    main.className = "upgrade-main";

    const title = document.createElement("div");
    title.className = "upgrade-title";
    title.textContent = def.name;

    const desc = document.createElement("div");
    desc.className = "upgrade-desc";
    desc.textContent = def.description;

    const meta = document.createElement("div");
    meta.className = "upgrade-meta";
    meta.innerHTML = `<span>Уровень: ${level}</span><span>Цена: ${formatMoney(
      cost
    )} ₽</span>`;

    main.appendChild(title);
    main.appendChild(desc);
    main.appendChild(meta);

    const action = document.createElement("div");
    action.className = "upgrade-action";

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = affordable ? "Купить" : "Недостаточно средств";
    btn.disabled = !affordable;

    btn.addEventListener("click", () => buyUpgrade(def.id));

    action.appendChild(btn);

    card.appendChild(main);
    card.appendChild(action);

    dom.upgradesList.appendChild(card);
  });
}

// === СТАТИСТИКА ===

function renderStats() {
  if (!dom.statsContainer) return;
  dom.statsContainer.innerHTML = "";

  const card1 = document.createElement("div");
  card1.className = "stats-card";
  card1.innerHTML = `
    <div class="stats-row">
      <span class="stats-row-label">Общий заработок</span>
      <span>${formatMoney(state.money)} ₽</span>
    </div>
    <div class="stats-row">
      <span class="stats-row-label">Обслужено колёс</span>
      <span>${state.totalWheels}</span>
    </div>
    <div class="stats-row">
      <span class="stats-row-label">Лучший доход за один клик</span>
      <span>${formatMoney(state.bestSingleClickIncome)} ₽</span>
    </div>
    <div class="stats-row">
      <span class="stats-row-label">Всего чаевых</span>
      <span>${formatMoney(state.totalTips)} ₽</span>
    </div>
  `;

  const card2 = document.createElement("div");
  card2.className = "stats-card";
  card2.innerHTML = `
    <div class="stats-row">
      <span class="stats-row-label">Пассивный доход / сек</span>
      <span>${formatMoney(state.autoIncomePerSec)} ₽</span>
    </div>
    <div class="stats-row">
      <span class="stats-row-label">Базовый доход за клик</span>
      <span>${formatMoney(state.baseIncomePerClick)} ₽</span>
    </div>
    <div class="stats-row">
      <span class="stats-row-label">Множитель дохода</span>
      <span>${state.incomeMultiplier.toFixed(2)}×</span>
    </div>
    <div class="stats-row">
      <span class="stats-row-label">Шанс чаевых</span>
      <span>${Math.round(state.tipChance * 100)}%</span>
    </div>
  `;

  dom.statsContainer.appendChild(card1);
  dom.statsContainer.appendChild(card2);
}

// === КЛИК ПО КОЛЕСУ ===

function onWheelClick() {
  const now = performance.now();
  const last = state.lastClickTime || 0;
  const delta = now - last;

  // Бережность и спам-клик
  if (last && delta < FAST_CLICK_THRESHOLD_MS) {
    state.care = clamp01(state.care - state.carePenalty);
    if (state.care < 0.4) {
      spawnFloatingText("Слишком резко! Бережнее!", "warning");
    }
  } else {
    state.care = clamp01(state.care + 0.02);
  }

  state.lastClickTime = now;

  const careFactor = 0.5 + 0.5 * clamp01(state.care); // 0.5–1.0
  let income =
    state.baseIncomePerClick * state.incomeMultiplier * careFactor;

  // Чаевые
  if (Math.random() < state.tipChance) {
    const tip = income * 0.4;
    income += tip;
    state.totalTips += tip;
    spawnFloatingText("Чаевые +" + formatMoney(tip) + " ₽", "tip");
  }

  state.money += income;
  state.totalWheels += 1;

  if (income > state.bestSingleClickIncome) {
    state.bestSingleClickIncome = income;
  }

  spawnFloatingText("+" + formatMoney(income) + " ₽", "money");

  // визуал на колесе
  dom.wheelButton.classList.add("wheel--hit");
  setTimeout(() => dom.wheelButton.classList.remove("wheel--hit"), 100);

  updateStatsUI();
}

// === ТИК-ЛУП (пассивный доход, восстановление бережности) ===

function startTickLoop() {
  state.lastTickAt = Date.now();

  setInterval(() => {
    const now = Date.now();
    let dt = (now - state.lastTickAt) / 1000;
    if (dt <= 0) dt = 0;
    if (dt > 60) dt = 60; // защита от сна вкладки

    state.lastTickAt = now;

    // Пассивный доход
    if (state.autoIncomePerSec > 0 && dt > 0) {
      const passive = state.autoIncomePerSec * dt;
      state.money += passive;
    }

    // Плавное восстановление бережности
    if (state.care < 1) {
      state.care = clamp01(
        state.care + CARE_RECOVERY_PER_SECOND * dt
      );
    }

    timeSinceLastSave += dt;
    if (timeSinceLastSave >= 5) {
      saveState();
      timeSinceLastSave = 0;
    }

    updateStatsUI();
  }, 400);
}

// === ОФФЛАЙН-ДОХОД ===

function applyOfflineIncome() {
  if (!state.lastSavedAt) {
    state.lastSavedAt = Date.now();
    state.lastTickAt = Date.now();
    return;
  }

  const now = Date.now();
  const diffSec = (now - state.lastSavedAt) / 1000;
  if (diffSec <= 0) return;

  // Используем текущий autoIncomePerSec
  const income = Math.floor(state.autoIncomePerSec * diffSec);
  if (income > 0) {
    state.money += income;
    showToast(
      `Пока тебя не было, сервис Protector аккуратно работал и заработал ${formatMoney(
        income
      )} ₽.`
    );
  }

  state.lastTickAt = now;
}

// === ИНИЦИАЛИЗАЦИЯ ===

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  recalcDerived();
  cacheDOM();
  bindEvents();
  applyOfflineIncome();
  updateStatsUI();
  renderUpgrades();
  startTickLoop();
});
