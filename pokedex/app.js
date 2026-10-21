(() => {
  // Bump this to wipe player progress for a release (no migration).
  const STORAGE_KEY = "pokedex-progress-v4";
  const DATA_URL = "../data/pokemon.json?v=37";
  /** Max balls thrown in one hunt action (manual or 一键扔球). */
  const THROW_MAX = 9999;

  /** @typedef {{ seen: boolean, caught: number, level?: number }} EntryProgress */
  /** @typedef {{ normal: Record<string, EntryProgress>, shiny: Record<string, EntryProgress> }} ProgressStore */

  const els = {
    title: document.getElementById("dex-title"),
    statsSeen: document.getElementById("stat-seen"),
    statsSeenShiny: document.getElementById("stat-seen-shiny"),
    search: document.getElementById("search"),
    collect: document.getElementById("collect-filter"),
    gen: document.getElementById("gen-filter"),
    legend: document.getElementById("legend-filter"),
    meta: document.getElementById("result-meta"),
    grid: document.getElementById("grid"),
    tabs: document.querySelectorAll(".tab[data-mode]"),
    detail: document.getElementById("detail"),
    detailImg: document.getElementById("detail-img"),
    detailId: document.getElementById("detail-id"),
    detailName: document.getElementById("detail-name"),
    detailEn: document.getElementById("detail-en"),
    detailTypes: document.getElementById("detail-types"),
    detailEvo: document.getElementById("detail-evo"),
    viewShop: document.getElementById("view-shop"),
    viewExplore: document.getElementById("view-explore"),
    shop: document.getElementById("shop"),
    shopCatalog: document.getElementById("shop-catalog"),
    btnSellAll: document.getElementById("btn-sell-all"),
    explore: document.getElementById("explore"),
    exploreAreas: document.getElementById("explore-areas"),
    ballCount: document.getElementById("ball-count"),
    btnHunt: document.getElementById("btn-hunt"),
    btnHuntAll: document.getElementById("btn-hunt-all"),
    bossCard: document.getElementById("boss-card"),
    bossImg: document.getElementById("boss-img"),
    bossName: document.getElementById("boss-name"),
    bossMeta: document.getElementById("boss-meta"),
    bossStats: document.getElementById("boss-stats"),
    bossProgress: document.getElementById("boss-progress"),
    bossProgressLabel: document.getElementById("boss-progress-label"),
    btnBossFight: document.getElementById("btn-boss-fight"),
    huntReport: document.getElementById("hunt-report"),
    huntReportBody: document.getElementById("hunt-report-body"),
    buffBar: document.getElementById("buff-bar"),
    dailyBanner: document.getElementById("daily-banner"),
    filters: document.getElementById("filters"),
    coins: document.getElementById("stat-coins"),
    balls: document.getElementById("stat-balls"),
    powerTotal: document.getElementById("stat-power-total"),
    powerTip: document.getElementById("stat-power-tip"),
    btnSell: document.getElementById("btn-sell"),
    btnEvoCard: document.getElementById("btn-evo-card"),
    btnUpgradeCard: document.getElementById("btn-upgrade-card"),
    btnLegendUpgradeCard: document.getElementById("btn-legend-upgrade-card"),
    evoCardChoices: document.getElementById("evo-card-choices"),
    toast: document.getElementById("toast"),
    detailSpawns: document.getElementById("detail-spawns"),
    detailCaught: document.getElementById("detail-caught"),
  };

  /** @type {any[]} */
  let pokemon = [];
  /** @type {"normal" | "shiny"} */
  let mode = "normal";
  /** @type {"dex" | "shop" | "explore"} */
  let view = "dex";

  const SELL_PRICE = {
    "very-common": 1,
    common: 2,
    uncommon: 4,
    rare: 10,
    "ultra-rare": 24,
    legendary: 70,
    mythical: 160,
  };
  const CATALOG = [
    {
      id: "catch",
      name: "捕获率提升",
      desc: "24 小时内捕获率 ×5",
      price: 20000,
      kind: "buff",
    },
    {
      id: "shiny",
      name: "闪光提升",
      desc: "24 小时内闪光概率 ×8",
      price: 50000,
      kind: "buff",
    },
    {
      id: "legend",
      name: "神兽提升",
      desc: "24 小时内神兽与幻兽出现权重 ×100",
      price: 50000,
      kind: "buff",
    },
    {
      id: "balls",
      name: "精灵球翻倍",
      desc: "24 小时内按键获得的高级球 ×2，可与每日签到叠加",
      price: 10000,
      kind: "buff",
    },
    {
      id: "evo",
      name: "进化卡",
      desc: "消耗 1 张，使 1 只闪光进化。普通精灵不能用。",
      price: 10000,
      kind: "item",
    },
    {
      id: "upgrade",
      name: "升级卡",
      desc: "消耗 1 张，使 1 只闪光最终形态升 1 级（最高 100 级）。神兽 / 幻兽不能用，请用神兽升级卡。",
      price: 10000,
      kind: "item",
    },
    {
      id: "legendUpgrade",
      name: "神兽升级卡",
      desc: "消耗 1 张，使 1 只闪光神兽 / 幻兽最终形态升 1 级（最高 100 级）。普通神兽不能用。",
      price: 30000,
      kind: "item",
    },
  ];
  /** 地区图鉴（探索区域） */
  const AREAS = ["关都", "城都", "丰缘", "神奥", "合众", "卡洛斯", "阿罗拉", "伽勒尔"];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BASE_SHINY = 1 / 1024;
  const BOSS_CHALLENGES = 5;
  const BOSS_SHINY_CHANCE = 1 / 8;
  const BOSS_CRIT_CHANCE = 1 / 10;
  const BOSS_CRIT_MULT = 2;
  /** 递进阈值：5万、10万、20万…最多 10 球 */
  const BOSS_BALL_FIRST = 50000;
  const BOSS_BALL_MAX = 10;
  const BOSS_BALL_THRESHOLDS = Array.from({ length: BOSS_BALL_MAX }, (_, i) => BOSS_BALL_FIRST * 2 ** i);

  // 剑盾同代（第六世代起）捕获公式：高级球 ×2、当前体力为一半、无异常状态。
  function catchProbability(captureRate, catchMult) {
    const maxHP = 300;
    const curHP = 150;
    const ball = 2;
    const status = 1;
    const rate = Math.max(1, captureRate) * catchMult;
    let a = Math.floor(((3 * maxHP - 2 * curHP) * rate * ball) / (3 * maxHP));
    a = Math.floor(a * status);
    if (a >= 255) return 1;
    if (a <= 0) return 0;
    const b = Math.floor(65536 / Math.pow(255 / a, 3 / 16));
    return Math.pow(b / 65536, 4);
  }
  /** @type {number | null} */
  let activeId = null;
  /** @type {Map<number, any>} */
  let byId = new Map();
  let toastTimer = 0;
  /** True until first key_press sync baselines ballCursor (avoids backlog → balls). */
  let freshAccount = false;
  /** @type {ProgressStore} */
  let store = loadStore();

  function emptyEntry() {
    return { seen: false, caught: 0, level: 0 };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // New account: do not grant historical key_presses as balls on first sync.
        freshAccount = true;
        return {
          normal: {},
          shiny: {},
          coins: 0,
          balls: 0,
          ballCursor: 0,
          items: { evo: 0, upgrade: 0, legendUpgrade: 0 },
          buffs: {},
          daily: null,
          boss: null,
        };
      }
      const parsed = JSON.parse(raw);
      const store = {
        normal: parsed.normal || {},
        shiny: parsed.shiny || {},
        coins: Number(parsed.coins) || 0,
        balls: Number(parsed.balls) || 0,
        ballCursor: Number(parsed.ballCursor) || 0,
        items: {
          evo: Number(parsed.items?.evo) || 0,
          upgrade: Number(parsed.items?.upgrade) || 0,
          legendUpgrade: Number(parsed.items?.legendUpgrade) || 0,
        },
        buffs: parsed.buffs || {},
        daily: parsed.daily || null,
        boss: parsed.boss || null,
      };
      pruneStore(store);
      return store;
    } catch {
      return {
        normal: {},
        shiny: {},
        coins: 0,
        balls: 0,
        ballCursor: 0,
        items: { evo: 0, upgrade: 0, legendUpgrade: 0 },
        buffs: {},
        daily: null,
        boss: null,
      };
    }
  }

  function pruneBucket(bucket) {
    for (const [id, entry] of Object.entries(bucket || {})) {
      if (!entry || (!entry.seen && !(Number(entry.caught) > 0) && !(Number(entry.level) > 0))) {
        delete bucket[id];
      }
    }
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function msUntilEndOfDay() {
    const end = new Date();
    end.setHours(24, 0, 0, 0);
    return Math.max(0, end.getTime() - Date.now());
  }

  function pruneStore(target) {
    pruneBucket(target.normal);
    pruneBucket(target.shiny);
    const now = Date.now();
    const buffs = {};
    for (const [id, until] of Object.entries(target.buffs || {})) {
      if (Number(until) > now) buffs[id] = until;
    }
    target.buffs = buffs;
    if (target.daily && target.daily.day !== todayKey()) target.daily = null;
    if (target.daily) normalizeDailyArea(target.daily);
    if (target.boss && target.boss.day !== todayKey()) target.boss = null;
  }

  function saveStore() {
    pruneStore(store);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        normal: store.normal,
        shiny: store.shiny,
        coins: store.coins || 0,
        balls: store.balls || 0,
        ballCursor: store.ballCursor || 0,
        items: {
          evo: store.items?.evo || 0,
          upgrade: store.items?.upgrade || 0,
          legendUpgrade: store.items?.legendUpgrade || 0,
        },
        buffs: store.buffs || {},
        daily: store.daily || null,
        boss: store.boss || null,
      })
    );
  }

  function activeDaily() {
    const d = store.daily;
    if (!d || d.day !== todayKey()) return null;
    return d;
  }

  function dailyLabel(d) {
    if (!d) return "";
    if (d.kind === "catch") return `${d.area}地区捕获率×2`;
    if (d.kind === "shiny") return `${d.area}地区闪光×3`;
    if (d.kind === "legend") return `${d.area}地区神兽权重×10`;
    if (d.kind === "gold") return "卖出金币×1.5";
    if (d.kind === "shop") return "商店 75 折";
    if (d.kind === "balls") return "高级球获取×2";
    return "每日增益";
  }

  function normalizeDailyArea(daily) {
    if (!daily) return false;
    const needsArea = daily.kind === "catch" || daily.kind === "shiny" || daily.kind === "legend";
    const areaOk = !!daily.area && AREAS.includes(daily.area);
    if ((daily.area && !areaOk) || (needsArea && !areaOk)) {
      daily.area = AREAS[Math.floor(Math.random() * AREAS.length)];
      return true;
    }
    return false;
  }

  function claimDailyIfNeeded() {
    if (store.daily?.day === todayKey()) return false;
    const kinds = ["catch", "shiny", "legend", "gold", "shop", "balls"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const needsArea = kind === "catch" || kind === "shiny" || kind === "legend";
    store.daily = {
      day: todayKey(),
      kind,
      area: needsArea ? AREAS[Math.floor(Math.random() * AREAS.length)] : null,
    };
    return true;
  }

  function goldMult() {
    return activeDaily()?.kind === "gold" ? 1.5 : 1;
  }

  function shopPrice(item) {
    let price = item.price;
    if (activeDaily()?.kind === "shop") price = Math.floor(price * 0.75);
    return Math.max(1, price);
  }

  function getProgress(id) {
    const bucket = store[mode];
    return bucket[String(id)] || emptyEntry();
  }

  function ensureProgress(id) {
    const bucket = store[mode];
    const key = String(id);
    if (!bucket[key]) bucket[key] = emptyEntry();
    return bucket[key];
  }

  function setProgress(id, patch) {
    const cur = ensureProgress(id);
    Object.assign(cur, patch);
    if (cur.caught > 0) cur.seen = true;
    if (cur.caught < 0) cur.caught = 0;
    saveStore();
  }

  function adjustCaught(id, delta) {
    const p = byId.get(id);
    const cur = ensureProgress(id);
    if (p && cannotEvolve(p)) {
      if (delta > 0) {
        cur.seen = true;
        let coins = 0;
        for (let i = 0; i < delta; i += 1) {
          if ((Number(cur.level) || 0) < 100) cur.level = (Number(cur.level) || 0) + 1;
          coins += sellPrice(p, mode === "shiny");
        }
        cur.caught = 0;
        store.coins = (store.coins || 0) + Math.floor(coins * goldMult());
      } else {
        cur.caught = 0;
      }
      return;
    }
    cur.caught = Math.max(0, (Number(cur.caught) || 0) + delta);
    if (cur.caught > 0) cur.seen = true;
  }

  /** 旧存档里终极形态还堆着的数量，换成等级并自动卖出 */
  function convertFinalStock() {
    let coins = 0;
    const prev = mode;
    for (const dex of ["normal", "shiny"]) {
      mode = /** @type {"normal" | "shiny"} */ (dex);
      for (const p of pokemon) {
        if (!cannotEvolve(p)) continue;
        const entry = store[dex][String(p.id)];
        if (!entry) continue;
        entry.level = Math.min(100, Math.max(0, Number(entry.level) || 0));
        const stock = Math.max(0, Math.floor(Number(entry.caught) || 0));
        if (stock < 1) {
          entry.caught = 0;
          continue;
        }
        for (let i = 0; i < stock; i += 1) {
          if (entry.level < 100) entry.level += 1;
          coins += sellPrice(p, dex === "shiny");
          entry.seen = true;
        }
        entry.caught = 0;
      }
    }
    mode = prev;
    if (coins > 0) store.coins = (store.coins || 0) + Math.floor(coins * goldMult());
    return coins;
  }

  function nextTargets(id) {
    const p = byId.get(id);
    return p?.evolution?.evolves_to || [];
  }

  function showToast(text) {
    els.toast.hidden = false;
    els.toast.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 4200);
  }

  function formatEvents(events) {
    return events
      .map((ev) => {
        const from = byId.get(ev.from);
        const to = byId.get(ev.to);
        return `${from?.name_zh || ev.from} ×${ev.times * 3} → ${to?.name_zh || ev.to} ×${ev.times}`;
      })
      .join("，");
  }

  function runAutoEvolve(announce = true) {
    const events = [];
    let guard = 0;
    while (guard++ < 800) {
      let did = false;
      for (const p of pokemon) {
        const targets = p.evolution?.evolves_to || [];
        if (!targets.length) continue;
        const times = Math.floor(getProgress(p.id).caught / 3);
        if (times < 1) continue;
        adjustCaught(p.id, -times * 3);
        const counts = new Map();
        for (let i = 0; i < times; i += 1) {
          const pick = targets[Math.floor(Math.random() * targets.length)];
          counts.set(pick.id, (counts.get(pick.id) || 0) + 1);
        }
        for (const [toId, n] of counts) {
          adjustCaught(toId, n);
          events.push({ from: p.id, to: toId, times: n });
        }
        did = true;
      }
      if (!did) break;
    }
    if (events.length) {
      saveStore();
      if (announce) showToast(formatEvents(events));
    }
    return events;
  }

  function evoStatusText(p) {
    const targets = p.evolution?.evolves_to || [];
    const prog = getProgress(p.id);
    if (!targets.length) {
      const lv = Number(prog.level) || 0;
      const power = combatPower(p, mode === "shiny", lv);
      return `最终形态 · Lv.${lv} / 100 · 战力 ${power}（${powerTierLabel(p, mode === "shiny")}；再获得会升级并自动卖出）`;
    }
    const caught = prog.caught;
    const need = caught % 3;
    const names = targets.map((t) => byId.get(t.id)?.name_zh || `#${t.id}`).join(" / ");
    if (targets.length === 1) {
      if (caught > 0 && caught % 3 === 0) return `已集满，将进化为${names}`;
      return `再收集 ${3 - need} 只可进化为${names}（现有 ${caught}）`;
    }
    return `再收集 ${3 - need} 只后等概率进化为 ${names}（现有 ${caught}）`;
  }

  function isCollected(p, prog) {
    if (cannotEvolve(p)) return (Number(prog.level) || 0) > 0;
    return (Number(prog.caught) || 0) > 0;
  }

  /** 普通 1× / 稀有 3× / 神兽 10× */
  function speciesPowerMult(p) {
    if (p?.is_legendary || p?.is_mythical || p?.rarity === "legendary" || p?.rarity === "mythical") {
      return 10;
    }
    if (p?.rarity === "uncommon" || p?.rarity === "rare" || p?.rarity === "ultra-rare") {
      return 3;
    }
    return 1;
  }

  /** 种族值总和，个位四舍五入到十位 */
  function speciesStatBase(p) {
    if (p?.power_base != null) return Number(p.power_base) || 0;
    const st = p?.base_stats;
    if (st?.power_base != null) return Number(st.power_base) || 0;
    const total = Number(st?.total);
    if (Number.isFinite(total) && total > 0) return Math.round(total / 10) * 10;
    return 0;
  }

  /** 种族战力 = 种族值基值 × 普通1/稀有3/神兽10（闪光再×3） */
  function speciesCombatPower(p, shiny) {
    if (!p) return 0;
    const stored = Number(p.species_power);
    const base =
      Number.isFinite(stored) && stored > 0
        ? stored
        : speciesStatBase(p) * speciesPowerMult(p);
    return base * (shiny ? 3 : 1);
  }

  /** 每升一级成长率：普通 10% / 稀有 15% / 神兽 30%；闪光再 +5% */
  function speciesLevelGrowth(p, shiny) {
    const m = speciesPowerMult(p);
    let rate = m >= 10 ? 0.3 : m >= 3 ? 0.15 : 0.1;
    if (shiny) rate += 0.05;
    return rate;
  }

  /**
   * 战力 = 种族战力 × (1 + 等级 × 成长率)
   */
  function combatPower(p, shiny, level) {
    const lv = Math.max(0, Number(level) || 0);
    if (lv < 1 || !p) return 0;
    const base = speciesCombatPower(p, shiny);
    if (!base) return 0;
    const rate = speciesLevelGrowth(p, shiny);
    return Math.round(base * (1 + lv * rate));
  }

  function powerTierLabel(p, shiny) {
    const m = speciesPowerMult(p);
    const tier = m >= 10 ? "神兽×10" : m >= 3 ? "稀有×3" : "普通×1";
    const pct = Math.round(speciesLevelGrowth(p, !!shiny) * 100);
    return `${tier} · 每级+${pct}%`;
  }

  function totalCombatPower(dex) {
    const bucket = store[dex] || {};
    const shiny = dex === "shiny";
    let sum = 0;
    for (const p of pokemon) {
      if (!cannotEvolve(p)) continue;
      const prog = bucket[String(p.id)];
      if (!prog) continue;
      sum += combatPower(p, shiny, prog.level);
    }
    return sum;
  }

  /** 与顶栏「战力总和」相同：普通 + 闪光 */
  function teamCombatPower() {
    return totalCombatPower("normal") + totalCombatPower("shiny");
  }

  function huntPowerChange(before, after) {
    const delta = after - before;
    const deltaText =
      delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : "+0";
    return `<div class="hunt-power-change">
      <span class="hunt-power-label">战力变化</span>
      <span class="hunt-power-values">${before} → ${after}<span class="hunt-power-delta">（${deltaText}）</span></span>
    </div>`;
  }

  function imgPath(p) {
    const rel = mode === "shiny" ? p.image_shiny : p.image;
    return rel ? `../data/${rel}` : "";
  }

  function typeLabel(types) {
    const map = {
      normal: "一般",
      fire: "火",
      water: "水",
      electric: "电",
      grass: "草",
      ice: "冰",
      fighting: "格斗",
      poison: "毒",
      ground: "地面",
      flying: "飞行",
      psychic: "超能力",
      bug: "虫",
      rock: "岩石",
      ghost: "幽灵",
      dragon: "龙",
      dark: "恶",
      steel: "钢",
      fairy: "妖精",
    };
    return (types || []).map((t) => map[t] || t).join(" · ");
  }

  function filteredList() {
    const q = els.search.value.trim().toLowerCase();
    const collect = els.collect.value;
    const gen = Number(els.gen.value);
    const legend = els.legend?.value || "all";

    return pokemon.filter((p) => {
      if (gen && p.generation !== gen) return false;
      if (legend === "legend" && !(p.is_legendary || p.is_mythical)) return false;

      const prog = getProgress(p.id);
      if (collect === "seen" && !prog.seen) return false;
      if (collect === "unseen" && prog.seen) return false;
      if (collect === "caught" && !isCollected(p, prog)) return false;
      if (collect === "uncaught" && isCollected(p, prog)) return false;

      if (!q) return true;
      const idStr = String(p.id);
      const idPad = idStr.padStart(3, "0");
      return (
        idStr.includes(q) ||
        idPad.includes(q) ||
        (p.name_zh || "").toLowerCase().includes(q) ||
        (p.name_en || "").toLowerCase().includes(q) ||
        (p.identifier || "").toLowerCase().includes(q)
      );
    });
  }

  function countSeen(dex) {
    const bucket = store[dex] || {};
    let seen = 0;
    for (const p of pokemon) {
      if (bucket[String(p.id)]?.seen) seen += 1;
    }
    return seen;
  }

  function updateStats() {
    const total = pokemon.length || 898;
    els.statsSeen.textContent = `${countSeen("normal")} / ${total}`;
    if (els.statsSeenShiny) els.statsSeenShiny.textContent = `${countSeen("shiny")} / ${total}`;
    const powerN = totalCombatPower("normal");
    const powerS = totalCombatPower("shiny");
    if (els.powerTotal) els.powerTotal.textContent = String(powerN + powerS);
    if (els.powerTip) els.powerTip.textContent = `普通战力 ${powerN} · 闪光战力 ${powerS}`;
    if (els.coins) els.coins.textContent = String(store.coins || 0);
    if (els.balls) els.balls.textContent = String(store.balls || 0);
    renderBuffs();
  }

  function sellPrice(p, shiny, seen = new Set()) {
    let unit = SELL_PRICE[p?.rarity] || 8;
    const fromId = p?.evolution?.evolves_from;
    if (p && fromId && !seen.has(p.id)) {
      seen.add(p.id);
      const prev = byId.get(fromId);
      if (prev) unit = sellPrice(prev, false, seen) * 2;
    }
    return shiny ? unit * 5 : unit;
  }

  function buffUntil(id) {
    return Number(store.buffs?.[id]) || 0;
  }

  function buffActive(id) {
    return buffUntil(id) > Date.now();
  }

  function formatRemain(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}小时${String(m).padStart(2, "0")}分${String(s).padStart(2, "0")}秒`;
  }

  function renderDailyBanner() {
    if (!els.dailyBanner) return;
    const daily = activeDaily();
    if (!daily) {
      els.dailyBanner.hidden = true;
      els.dailyBanner.textContent = "";
      return;
    }
    els.dailyBanner.hidden = false;
    els.dailyBanner.textContent = `今日签到：${dailyLabel(daily)} · 剩余 ${formatRemain(msUntilEndOfDay())}（可与商店增益叠加）`;
  }

  function renderBuffs() {
    renderDailyBanner();
    if (!els.buffBar) return;
    const names = { catch: "捕获率×5", shiny: "闪光×8", legend: "神兽×100", balls: "高级球×2" };
    const parts = Object.keys(names)
      .filter((id) => buffActive(id))
      .map((id) => `${names[id]} 剩余 ${formatRemain(buffUntil(id) - Date.now())}`);
    const cards = store.items?.evo || 0;
    if (cards > 0) parts.push(`进化卡 ×${cards}`);
    const upgrades = store.items?.upgrade || 0;
    if (upgrades > 0) parts.push(`升级卡 ×${upgrades}`);
    const legendUpgrades = store.items?.legendUpgrade || 0;
    if (legendUpgrades > 0) parts.push(`神兽升级卡 ×${legendUpgrades}`);
    els.buffBar.textContent = parts.join(" · ");
  }

  function isLegendMon(p) {
    return !!(p?.is_legendary || p?.is_mythical || p?.rarity === "legendary" || p?.rarity === "mythical");
  }

  function buyItem(item) {
    const price = shopPrice(item);
    if ((store.coins || 0) < price) {
      showToast("金币不够");
      return;
    }
    store.coins -= price;
    if (item.kind === "buff") {
      const start = Math.max(Date.now(), buffUntil(item.id));
      store.buffs[item.id] = start + DAY_MS;
      showToast(`${item.name}已生效，持续 24 小时`);
    } else if (item.id === "upgrade") {
      store.items.upgrade = (store.items.upgrade || 0) + 1;
      showToast(`获得升级卡 ×1，现有 ${store.items.upgrade} 张`);
    } else if (item.id === "legendUpgrade") {
      store.items.legendUpgrade = (store.items.legendUpgrade || 0) + 1;
      showToast(`获得神兽升级卡 ×1，现有 ${store.items.legendUpgrade} 张`);
    } else {
      store.items.evo += 1;
      showToast(`获得进化卡 ×1，现有 ${store.items.evo} 张`);
    }
    saveStore();
    updateStats();
    if (view === "shop") renderShop();
    if (els.detail.open && activeId != null) openDetail(activeId);
  }

  function cannotEvolve(p) {
    return !(p?.evolution?.evolves_to || []).length;
  }

  function useEvoCard(fromId, toId) {
    if (mode !== "shiny") {
      showToast("进化卡只能用在闪光精灵上");
      return;
    }
    if ((store.items?.evo || 0) < 1) {
      showToast("没有进化卡");
      return;
    }
    const targets = nextTargets(fromId);
    if (!targets.length || getProgress(fromId).caught < 1) return;
    const target = toId || (targets.length === 1 ? targets[0].id : null);
    if (!target || !targets.some((t) => t.id === target)) {
      if (els.evoCardChoices) {
        els.evoCardChoices.innerHTML = targets
          .map((t) => {
            const name = byId.get(t.id)?.name_zh || `#${t.id}`;
            return `<button type="button" class="action" data-to="${t.id}">${name}</button>`;
          })
          .join("");
        els.evoCardChoices.querySelectorAll("button").forEach((btn) => {
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            useEvoCard(fromId, Number(btn.dataset.to));
          });
        });
      }
      return;
    }
    store.items.evo -= 1;
    adjustCaught(fromId, -1);
    adjustCaught(target, 1);
    saveStore();
    runAutoEvolve(false);
    const fromName = byId.get(fromId)?.name_zh || fromId;
    const toName = byId.get(target)?.name_zh || target;
    showToast(`进化卡：闪光${fromName} → 闪光${toName}`);
    renderGrid();
    if (els.detail.open) openDetail(fromId);
    updateStats();
  }

  function useUpgradeCard(id) {
    if (mode !== "shiny") {
      showToast("升级卡只能用在闪光最终形态上");
      return;
    }
    const p = byId.get(id);
    if (!p || !cannotEvolve(p)) {
      showToast("升级卡只能用在最终形态上");
      return;
    }
    if (isLegendMon(p)) {
      showToast("神兽请用神兽升级卡");
      return;
    }
    if ((store.items?.upgrade || 0) < 1) {
      showToast("没有升级卡");
      return;
    }
    const prog = ensureProgress(id);
    const lv = Number(prog.level) || 0;
    if (lv < 1) {
      showToast("还没有这只最终形态，先获得后再升级");
      return;
    }
    if (lv >= 100) {
      showToast("已经满级");
      return;
    }
    store.items.upgrade -= 1;
    prog.level = lv + 1;
    prog.seen = true;
    saveStore();
    showToast(`${mode === "shiny" ? "闪光" : ""}${p.name_zh} → Lv.${prog.level}`);
    renderGrid();
    if (els.detail.open) openDetail(id);
    updateStats();
  }

  function useLegendUpgradeCard(id) {
    if (mode !== "shiny") {
      showToast("神兽升级卡只能用在闪光神兽上");
      return;
    }
    const p = byId.get(id);
    if (!p || !cannotEvolve(p) || !isLegendMon(p)) {
      showToast("神兽升级卡只能用在闪光神兽 / 幻兽最终形态上");
      return;
    }
    if ((store.items?.legendUpgrade || 0) < 1) {
      showToast("没有神兽升级卡");
      return;
    }
    const prog = ensureProgress(id);
    const lv = Number(prog.level) || 0;
    if (lv < 1) {
      showToast("还没有这只神兽，先获得后再升级");
      return;
    }
    if (lv >= 100) {
      showToast("已经满级");
      return;
    }
    store.items.legendUpgrade -= 1;
    prog.level = lv + 1;
    prog.seen = true;
    saveStore();
    showToast(`${mode === "shiny" ? "闪光" : ""}${p.name_zh} → Lv.${prog.level}`);
    renderGrid();
    if (els.detail.open) openDetail(id);
    updateStats();
  }

  function renderShop() {
    els.shopCatalog.innerHTML = CATALOG.map((item) => {
      const price = shopPrice(item);
      const discounted = price < item.price;
      const held =
        item.id === "upgrade"
          ? store.items?.upgrade || 0
          : item.id === "legendUpgrade"
            ? store.items?.legendUpgrade || 0
            : item.id === "evo"
              ? store.items?.evo || 0
              : 0;
      const extra =
        item.kind === "buff" && buffActive(item.id)
          ? `生效中，剩余 ${formatRemain(buffUntil(item.id) - Date.now())}`
          : item.kind === "item"
            ? `持有 ${held} 张`
            : "购买后立即生效";
      return `
        <article class="shop-item">
          <strong>${item.name}</strong>
          <p>${item.desc}</p>
          <p>${extra}</p>
          <span class="shop-price">${
            discounted ? `${price} 金币（原价 ${item.price}）` : `${price} 金币`
          }</span>
          <button type="button" class="action" data-buy="${item.id}">购买</button>
        </article>
      `;
    }).join("");
    els.shopCatalog.querySelectorAll("[data-buy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = CATALOG.find((x) => x.id === btn.dataset.buy);
        if (item) buyItem(item);
      });
    });

  }

  let huntArea = "";

  function areaRate(p, area) {
    const spawn = (p.spawn_areas || []).find((a) => a.area === area);
    return spawn ? Number(spawn.rate) || 0 : 0;
  }

  function spawnWeight(p, area) {
    let weight = areaRate(p, area);
    if (weight <= 0) return 0;
    if (p.is_legendary || p.is_mythical) {
      if (buffActive("legend")) weight *= 100;
      const daily = activeDaily();
      if (daily?.kind === "legend" && daily.area === area) weight *= 10;
    }
    return weight;
  }

  function appearPercent(p, area) {
    let total = 0;
    for (const mon of pokemon) total += spawnWeight(mon, area);
    if (!total) return 0;
    return (spawnWeight(p, area) / total) * 100;
  }

  function spawnPool(area) {
    const pool = [];
    for (const p of pokemon) {
      const weight = spawnWeight(p, area);
      if (weight <= 0) continue;
      pool.push({ p, weight });
    }
    return pool;
  }

  function pickFromPool(pool, total) {
    let ticket = Math.random() * total;
    let pick = pool[pool.length - 1].p;
    for (const row of pool) {
      ticket -= row.weight;
      if (ticket <= 0) return row.p;
    }
    return pick;
  }

  function seenIds(bucket) {
    const ids = new Set();
    for (const [id, prog] of Object.entries(store[bucket] || {})) {
      if (prog && prog.seen) ids.add(Number(id));
    }
    return ids;
  }

  function snapshotFinalLevels(dex) {
    /** @type {Map<number, number>} */
    const map = new Map();
    for (const p of pokemon) {
      if (!cannotEvolve(p)) continue;
      const lv = Number(store[dex]?.[String(p.id)]?.level) || 0;
      map.set(p.id, lv);
    }
    return map;
  }

  function huntFold(title, count, lines, open = true) {
    const body =
      lines.length > 0
        ? lines.map((line) => `<p class="hunt-fold-line">${line}</p>`).join("")
        : `<p class="hunt-fold-empty">没有记录</p>`;
    return `<details class="hunt-fold"${open && lines.length ? " open" : ""}>
      <summary><span>${title}</span><span class="hunt-fold-count">${count}</span></summary>
      <div class="hunt-fold-body">${body}</div>
    </details>`;
  }

  function throwBalls(amount) {
    if (!huntArea) {
      showToast("先选一个地区图鉴");
      return;
    }
    const owned = Math.max(0, Math.floor(Number(store.balls) || 0));
    const requested = amount == null ? Math.floor(Number(els.ballCount.value) || 0) : Math.floor(amount);
    const count = Math.min(THROW_MAX, owned, requested);
    if (count < 1) {
      showToast("没有高级球");
      els.ballCount.value = "0";
      return;
    }
    els.ballCount.value = String(count);
    const pool = spawnPool(huntArea);
    if (!pool.length) {
      showToast(`${huntArea}里没有精灵`);
      return;
    }
    const total = pool.reduce((sum, row) => sum + row.weight, 0);
    const daily = activeDaily();
    let catchMult = buffActive("catch") ? 5 : 1;
    if (daily?.kind === "catch" && daily.area === huntArea) catchMult *= 2;
    let shinyChance = BASE_SHINY * (buffActive("shiny") ? 8 : 1);
    if (daily?.kind === "shiny" && daily.area === huntArea) shinyChance *= 3;
    const chanceCache = new Map();
    const beforeNormal = seenIds("normal");
    const beforeShiny = seenIds("shiny");
    const beforePower = teamCombatPower();
    const beforeLevels = {
      normal: snapshotFinalLevels("normal"),
      shiny: snapshotFinalLevels("shiny"),
    };
    /** @type {Map<string, {id: number, shiny: boolean, caught: number}>} */
    const tally = new Map();
    for (let i = 0; i < count; i += 1) {
      const pick = pickFromPool(pool, total);
      const shiny = Math.random() < shinyChance;
      let chance = chanceCache.get(pick.capture_rate);
      if (chance == null) {
        chance = catchProbability(pick.capture_rate, catchMult);
        chanceCache.set(pick.capture_rate, chance);
      }
      if (Math.random() >= chance) continue;
      const bucket = shiny ? "shiny" : "normal";
      const key = `${bucket}:${pick.id}`;
      const row = tally.get(key) || { id: pick.id, shiny, caught: 0 };
      row.caught += 1;
      tally.set(key, row);
      const prevMode = mode;
      mode = shiny ? "shiny" : "normal";
      adjustCaught(pick.id, 1);
      mode = prevMode;
    }
    store.balls = owned - count;
    saveStore();
    const prev = mode;
    mode = "normal";
    runAutoEvolve(false);
    mode = "shiny";
    runAutoEvolve(false);
    mode = prev;
    saveStore();

    const caughtLines = [...tally.values()]
      .sort((a, b) => a.id - b.id)
      .map((row) => {
        const name = byId.get(row.id)?.name_zh || `#${row.id}`;
        return `${row.shiny ? "闪光 " : ""}${name} ×${row.caught}`;
      });
    const lit = [];
    for (const [bucket, before, label] of [
      ["normal", beforeNormal, ""],
      ["shiny", beforeShiny, "闪光 "],
    ]) {
      for (const [id, prog] of Object.entries(store[bucket] || {})) {
        if (prog?.seen && !before.has(Number(id))) {
          lit.push(`${label}${byId.get(Number(id))?.name_zh || id}`);
        }
      }
    }
    const upgrades = [];
    for (const [dex, label] of [
      ["normal", ""],
      ["shiny", "闪光 "],
    ]) {
      for (const p of pokemon) {
        if (!cannotEvolve(p)) continue;
        const before = beforeLevels[dex].get(p.id) || 0;
        const after = Number(store[dex]?.[String(p.id)]?.level) || 0;
        if (after <= before) continue;
        upgrades.push(`${label}${p.name_zh} Lv.${before} → Lv.${after}`);
      }
    }

    const afterPower = teamCombatPower();
    els.huntReportBody.innerHTML = [
      huntPowerChange(beforePower, afterPower),
      huntFold("抓住", caughtLines.length, caughtLines, true),
      huntFold("新点亮", lit.length, lit, lit.length > 0),
      huntFold("升级记录", upgrades.length, upgrades, upgrades.length > 0),
    ].join("");
    if (typeof els.huntReport.showModal === "function") els.huntReport.showModal();
    updateStats();
    if (view === "dex") renderGrid();
  }

  function legendPool() {
    return pokemon.filter((p) => p.is_legendary || p.is_mythical);
  }

  function emptyBoss(day) {
    const pool = legendPool();
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    return {
      day,
      id: pick ? pick.id : 0,
      shiny: Math.random() < BOSS_SHINY_CHANCE,
      challengesLeft: BOSS_CHALLENGES,
      damage: 0,
      balls: 0,
      ballsClaimed: 0,
      caught: false,
    };
  }

  function ensureBossDay() {
    const day = todayKey();
    // 仅跨自然日才刷新 Boss / 次数 / 伤害；同日重启必须沿用存档
    if (store.boss && store.boss.day === day && Number(store.boss.id) > 0) {
      store.boss.challengesLeft = Math.max(0, Math.min(BOSS_CHALLENGES, Number(store.boss.challengesLeft) || 0));
      store.boss.damage = Math.max(0, Number(store.boss.damage) || 0);
      store.boss.balls = Math.max(0, Number(store.boss.balls) || 0);
      store.boss.ballsClaimed = Math.max(0, Math.min(BOSS_BALL_MAX, Number(store.boss.ballsClaimed) || 0));
      store.boss.shiny = !!store.boss.shiny;
      store.boss.caught = !!store.boss.caught;
      return store.boss;
    }
    store.boss = emptyBoss(day);
    saveStore();
    return store.boss;
  }

  /** 抓住，或攻击次数用完 → 今日结束 */
  function isBossDayDone(boss) {
    if (!boss) return true;
    return !!boss.caught || (Number(boss.challengesLeft) || 0) <= 0;
  }

  function formatBossDamage(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (v % 10000 === 0) return `${v / 10000}万`;
    if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return String(v);
  }

  function bossBallsEarned(damage) {
    const dmg = Math.max(0, Number(damage) || 0);
    let earned = 0;
    for (const need of BOSS_BALL_THRESHOLDS) {
      if (dmg >= need) earned += 1;
      else break;
    }
    return Math.min(BOSS_BALL_MAX, earned);
  }

  function nextBossBallThreshold(damage) {
    const dmg = Math.max(0, Number(damage) || 0);
    for (const need of BOSS_BALL_THRESHOLDS) {
      if (dmg < need) return need;
    }
    return BOSS_BALL_THRESHOLDS[BOSS_BALL_THRESHOLDS.length - 1];
  }

  function syncBossBalls(boss) {
    const earned = bossBallsEarned(boss.damage);
    let claimed = Math.max(0, Number(boss.ballsClaimed) || 0);
    // 旧公式超发时回退领取标记；已有的 Boss 球不扣，但领取上限封顶 10
    if (claimed > earned) {
      claimed = earned;
      boss.ballsClaimed = earned;
    }
    claimed = Math.min(BOSS_BALL_MAX, claimed);
    const gain = Math.max(0, Math.min(BOSS_BALL_MAX, earned) - claimed);
    if (gain > 0) {
      boss.balls = (Number(boss.balls) || 0) + gain;
      boss.ballsClaimed = claimed + gain;
    }
    boss.ballsClaimed = Math.min(BOSS_BALL_MAX, Number(boss.ballsClaimed) || 0);
    return gain;
  }

  function bossTeamPower() {
    return totalCombatPower("normal") + totalCombatPower("shiny");
  }

  function renderBoss() {
    if (!els.bossName) return;
    const boss = ensureBossDay();
    const p = byId.get(boss.id);
    if (!p) {
      els.bossName.textContent = "今日暂无 Boss";
      els.bossMeta.textContent = "图鉴数据未加载神兽";
      els.bossStats.textContent = "";
      if (els.bossImg) els.bossImg.removeAttribute("src");
      return;
    }
    const shiny = !!boss.shiny;
    const rel = shiny ? p.image_shiny : p.image;
    if (els.bossImg) {
      els.bossImg.src = rel ? `../data/${rel}` : "";
      els.bossImg.alt = `${shiny ? "闪光" : ""}${p.name_zh}`;
    }
    els.bossName.textContent = `${shiny ? "闪光 " : ""}${p.name_zh}`;
    const dmg = Number(boss.damage) || 0;
    const earned = bossBallsEarned(dmg);
    const nextAt = nextBossBallThreshold(dmg);
    const remain = earned >= BOSS_BALL_MAX ? 0 : Math.max(0, nextAt - dmg);
    const prevAt = earned <= 0 ? 0 : BOSS_BALL_THRESHOLDS[earned - 1];
    const dayDone = isBossDayDone(boss);
    els.bossMeta.textContent = boss.caught
      ? `今日已抓住 · 明日刷新`
      : dayDone
        ? `今日挑战次数已用完 · 明日刷新`
        : `HP ∞ · 捕获率 ${p.capture_rate}`;
    els.bossStats.textContent = `今日伤害 ${formatBossDamage(dmg)} · 已领球 ${earned}/${BOSS_BALL_MAX} · 手头 Boss 球 ${
      boss.balls || 0
    } · 剩余挑战 ${boss.challengesLeft || 0}/${BOSS_CHALLENGES} · 队伍战力 ${formatBossDamage(bossTeamPower())}${
      dayDone ? " · 今日已结束" : ""
    }`;
    const span = Math.max(1, nextAt - prevAt);
    const frac =
      earned >= BOSS_BALL_MAX ? 1 : Math.max(0, Math.min(1, (dmg - prevAt) / span));
    const pct = Math.round(((earned + (earned >= BOSS_BALL_MAX ? 0 : frac)) / BOSS_BALL_MAX) * 100);
    if (els.bossProgress) {
      els.bossProgress.innerHTML = BOSS_BALL_THRESHOLDS.map((need, i) => {
        let fill = 0;
        if (i < earned) fill = 100;
        else if (i === earned) fill = Math.round(frac * 100);
        const cls = i < earned ? "is-done" : i === earned ? "is-next" : "";
        return `<div class="boss-cell ${cls}">
          <div class="boss-seg"><div class="boss-seg-fill" style="width:${fill}%"></div></div>
          <b>${i + 1}</b>
          <span>${formatBossDamage(need)}</span>
        </div>`;
      }).join("");
      els.bossProgress.setAttribute("aria-valuenow", String(pct));
      els.bossProgress.setAttribute("aria-valuetext", `${earned}/${BOSS_BALL_MAX}`);
    }
    if (els.bossProgressLabel) {
      els.bossProgressLabel.textContent =
        earned >= BOSS_BALL_MAX
          ? `今日 Boss 球已满 ${BOSS_BALL_MAX}/${BOSS_BALL_MAX}`
          : `进度 ${earned}/${BOSS_BALL_MAX} · 下一球 ${formatBossDamage(nextAt)}（还差 ${formatBossDamage(remain)}）`;
    }
    if (els.btnBossFight) {
      const done = isBossDayDone(boss);
      els.btnBossFight.disabled = done;
      els.btnBossFight.textContent = done ? "已结束" : "挑战";
      els.btnBossFight.classList.toggle("is-ended", done);
    }
  }

  function challengeBoss() {
    const boss = ensureBossDay();
    const p = byId.get(boss.id);
    if (!p) {
      showToast("今日没有 Boss");
      return;
    }
    if (boss.caught) {
      showToast("今日已抓住，明天再来");
      return;
    }
    if ((Number(boss.challengesLeft) || 0) < 1) {
      showToast("今日挑战次数已用完");
      return;
    }
    const base = Math.max(1, bossTeamPower());
    const crit = Math.random() < BOSS_CRIT_CHANCE;
    const power = crit ? base * BOSS_CRIT_MULT : base;
    boss.challengesLeft = (Number(boss.challengesLeft) || 0) - 1;
    boss.damage = (Number(boss.damage) || 0) + power;
    const gained = syncBossBalls(boss);
    saveStore();

    let autoHtml = "";
    if ((Number(boss.balls) || 0) > 0 && !boss.caught) {
      // 本次攻击内允许自动扔球（含打完最后一次时 challengesLeft 已为 0）
      const result = throwBossBalls(boss.balls, { silent: true, fromChallenge: true });
      if (result) autoHtml = result.html;
    }

    // 次数用完且未抓住：今日结束，清空剩余球
    if (!boss.caught && (Number(boss.challengesLeft) || 0) <= 0) {
      boss.balls = 0;
      saveStore();
    }

    renderBoss();
    updateStats();
    const dayDone = isBossDayDone(boss);
    els.huntReportBody.innerHTML = `
      <h3>挑战 ${boss.shiny ? "闪光 " : ""}${p.name_zh}</h3>
      <p>造成伤害 ${formatBossDamage(power)}${crit ? `（暴击 ×${BOSS_CRIT_MULT}！基础 ${formatBossDamage(base)}）` : "（队伍战力）"}</p>
      <p>今日累计伤害 ${formatBossDamage(boss.damage)}</p>
      <p>获得 Boss 球 ${gained} · 现有 ${boss.balls}</p>
      <p>剩余挑战 ${boss.challengesLeft}/${BOSS_CHALLENGES}</p>
      ${autoHtml || `<p>暂无 Boss 球可自动投掷。</p>`}
      ${
        boss.caught
          ? `<p><strong>已抓住，今日 Boss 结束。</strong></p>`
          : dayDone
            ? `<p><strong>挑战次数已用完，今日 Boss 结束。</strong></p>`
            : ""
      }
    `;
    if (typeof els.huntReport.showModal === "function") els.huntReport.showModal();
  }

  /** @returns {{ html: string, caught: boolean, thrown: number } | null} */
  function throwBossBalls(amount, opts = {}) {
    const silent = !!opts.silent;
    const fromChallenge = !!opts.fromChallenge;
    const boss = ensureBossDay();
    const p = byId.get(boss.id);
    if (!p) {
      if (!silent) showToast("今日没有 Boss");
      return null;
    }
    if (boss.caught) {
      if (!silent) showToast("今日已抓住，不能重复抓");
      return null;
    }
    // 攻击次数用完后不可再手动扔球；挑战过程中的自动扔除外
    if (!fromChallenge && (Number(boss.challengesLeft) || 0) <= 0) {
      if (!silent) showToast("今日挑战已结束");
      return null;
    }
    const owned = Math.max(0, Math.floor(Number(boss.balls) || 0));
    const count = Math.min(owned, amount == null ? 1 : Math.floor(amount));
    if (count < 1) {
      if (!silent) showToast("没有 Boss 球");
      return null;
    }
    // 抓捕率不吃商店/每日捕获增益；抓到即停，今日不可再抓
    const chance = catchProbability(p.capture_rate, 1);
    let caught = 0;
    let thrown = 0;
    const coinsBefore = Number(store.coins) || 0;
    const beforeNormal = seenIds("normal");
    const beforeShiny = seenIds("shiny");
    for (let i = 0; i < count; i += 1) {
      thrown += 1;
      if (Math.random() >= chance) continue;
      caught = 1;
      boss.caught = true;
      const prevMode = mode;
      mode = boss.shiny ? "shiny" : "normal";
      adjustCaught(p.id, 1);
      mode = prevMode;
      break;
    }
    boss.balls = owned - thrown;
    if (boss.caught) {
      boss.challengesLeft = 0;
      boss.balls = 0;
    }
    saveStore();
    const prev = mode;
    mode = "normal";
    runAutoEvolve(false);
    mode = "shiny";
    runAutoEvolve(false);
    mode = prev;
    saveStore();
    const coinsGained = Math.max(0, (Number(store.coins) || 0) - coinsBefore);
    const lit = [];
    for (const [bucket, before, label] of [
      ["normal", beforeNormal, ""],
      ["shiny", beforeShiny, "闪光 "],
    ]) {
      for (const [id, prog] of Object.entries(store[bucket] || {})) {
        if (prog?.seen && !before.has(Number(id))) {
          lit.push(`${label}${byId.get(Number(id))?.name_zh || id}`);
        }
      }
    }
    const name = `${boss.shiny ? "闪光 " : ""}${p.name_zh}`;
    const html = `
      <h3>${silent ? "自动投掷 Boss 球" : "Boss 球结果"}</h3>
      <p>投掷 ${thrown} 颗 · 抓捕率约 ${(chance * 100).toFixed(2)}%（不受增益）</p>
      <p>${
        caught > 0
          ? `抓住 ${name}${cannotEvolve(p) ? "（升级并自动卖出）" : ""} · 今日 Boss 结束，不可再抓`
          : `没抓住 ${name}`
      }</p>
      <h3>新点亮</h3>
      ${lit.length ? lit.map((n) => `<p>${n}</p>`).join("") : `<p>没有新图鉴。</p>`}
      ${coinsGained > 0 ? `<h3>自动卖出</h3><p>${coinsGained} 金币</p>` : ""}
    `;
    if (!silent) {
      els.huntReportBody.innerHTML = html;
      if (typeof els.huntReport.showModal === "function") els.huntReport.showModal();
    }
    renderBoss();
    updateStats();
    if (view === "dex") renderGrid();
    return { html, caught: caught > 0, thrown };
  }

  function renderExplore() {
    renderBoss();
    if (!els.exploreAreas.childElementCount) {
      for (const area of AREAS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "action";
        btn.textContent = area;
        btn.addEventListener("click", () => {
          huntArea = area;
          for (const other of els.exploreAreas.children) other.classList.remove("is-picked");
          btn.classList.add("is-picked");
        });
        els.exploreAreas.appendChild(btn);
      }
    }
  }

  function renderGrid() {
    const list = filteredList();
    els.meta.textContent = `显示 ${list.length} / ${pokemon.length} 只 · ${
      mode === "shiny" ? "闪光" : "普通"
    }图鉴`;

    const frag = document.createDocumentFragment();
    list.forEach((p, i) => {
      const prog = getProgress(p.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `card${prog.seen ? "" : " is-unseen"}`;
      btn.style.animationDelay = `${Math.min(i, 40) * 8}ms`;
      btn.dataset.id = String(p.id);

      const name = p.name_zh;
      btn.innerHTML = `
        <img class="card-art" src="${imgPath(p)}" alt="${name}" loading="lazy" width="140" height="140" />
        <p class="card-id">#${String(p.id).padStart(3, "0")}</p>
        <p class="card-name">${name}</p>
        <div class="card-meta">
          <span class="pill${prog.seen ? " on" : ""}">${prog.seen ? "已点亮" : "未点亮"}</span>
          ${
            cannotEvolve(p)
              ? `<span class="pill${(prog.level || 0) > 0 ? " caught" : ""}">Lv.${
                  prog.level || 0
                }</span><span class="pill${(prog.level || 0) > 0 ? " caught" : ""}">战力 ${combatPower(
                  p,
                  mode === "shiny",
                  prog.level
                )}</span>`
              : `<span class="pill${prog.caught > 0 ? " caught" : ""}">×${prog.caught}</span>`
          }
        </div>
      `;
      btn.addEventListener("click", () => openDetail(p.id));
      frag.appendChild(btn);
    });

    els.grid.replaceChildren(frag);
    updateStats();
  }

  function openDetail(id) {
    const p = pokemon.find((x) => x.id === id);
    if (!p) return;
    activeId = id;
    const prog = getProgress(id);

    els.detailImg.src = imgPath(p);
    els.detailImg.alt = p.name_zh;
    els.detailImg.classList.toggle("is-silhouette", !prog.seen);
    els.detailId.textContent = `#${String(p.id).padStart(3, "0")} · 第${p.generation}世代`;
    els.detailName.textContent = p.name_zh;
    els.detailEn.textContent = p.name_en;
    els.detailTypes.textContent = prog.seen ? typeLabel(p.types) : "属性未判明";
    const areas = p.spawn_areas || [];
    els.detailSpawns.innerHTML = areas.length
      ? `<p class="spawn-title">地区图鉴</p>${areas
          .map(
            (a) =>
              `<div class="spawn-row"><span>${a.area}</span><span>出现 ${appearPercent(p, a.area).toFixed(2)}%</span></div>`
          )
          .join("")}`
      : `<p class="spawn-title">地区图鉴</p><p class="spawn-empty">未知</p>`;
    els.detailCaught.textContent = cannotEvolve(p)
      ? `Lv.${prog.level || 0} / 100 · 战力 ${combatPower(p, mode === "shiny", prog.level)}`
      : String(prog.caught);
    els.detailEvo.textContent = evoStatusText(p);
    if (els.btnSell) {
      els.btnSell.hidden = true;
      els.btnSell.disabled = true;
    }
    const canCard =
      mode === "shiny" &&
      (store.items?.evo || 0) > 0 &&
      prog.caught > 0 &&
      (p.evolution?.evolves_to || []).length > 0;
    els.btnEvoCard.hidden = mode !== "shiny";
    els.btnEvoCard.disabled = !canCard;
    els.btnEvoCard.textContent =
      mode !== "shiny" ? "进化卡仅闪光" : `进化卡（${store.items?.evo || 0}）`;
    const upgrades = store.items?.upgrade || 0;
    const canUpgrade =
      mode === "shiny" &&
      cannotEvolve(p) &&
      !isLegendMon(p) &&
      upgrades > 0 &&
      (Number(prog.level) || 0) > 0 &&
      (Number(prog.level) || 0) < 100;
    if (els.btnUpgradeCard) {
      els.btnUpgradeCard.hidden = mode !== "shiny" || !cannotEvolve(p) || isLegendMon(p);
      els.btnUpgradeCard.disabled = !canUpgrade;
      els.btnUpgradeCard.textContent =
        mode !== "shiny"
          ? "升级卡仅闪光"
          : (Number(prog.level) || 0) >= 100
            ? "已满级"
            : (Number(prog.level) || 0) < 1
              ? "升级卡需先获得"
              : `升级卡（${upgrades}）`;
    }
    const legendUpgrades = store.items?.legendUpgrade || 0;
    const canLegendUpgrade =
      mode === "shiny" &&
      cannotEvolve(p) &&
      isLegendMon(p) &&
      legendUpgrades > 0 &&
      (Number(prog.level) || 0) > 0 &&
      (Number(prog.level) || 0) < 100;
    if (els.btnLegendUpgradeCard) {
      els.btnLegendUpgradeCard.hidden = mode !== "shiny" || !cannotEvolve(p) || !isLegendMon(p);
      els.btnLegendUpgradeCard.disabled = !canLegendUpgrade;
      els.btnLegendUpgradeCard.textContent =
        mode !== "shiny"
          ? "神兽升级卡仅闪光"
          : (Number(prog.level) || 0) >= 100
            ? "已满级"
            : (Number(prog.level) || 0) < 1
              ? "神兽升级卡需先获得"
              : `神兽升级卡（${legendUpgrades}）`;
    }
    els.evoCardChoices.innerHTML = "";

    if (typeof els.detail.showModal === "function") {
      els.detail.showModal();
    }
  }

  function refreshDetailIfOpen() {
    if (activeId != null && els.detail.open) openDetail(activeId);
    renderGrid();
  }

  function setViewButtons() {
    const dexOn = view === "dex";
    els.tabs.forEach((tab) => {
      const on = dexOn && ((tab.dataset.mode === "shiny") === (mode === "shiny"));
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    const map = [
      [els.viewShop, "shop"],
      [els.viewExplore, "explore"],
    ];
    for (const [btn, name] of map) {
      const on = view === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function showDex() {
    view = "dex";
    setViewButtons();
    els.shop.hidden = true;
    els.explore.hidden = true;
    els.grid.hidden = false;
    els.meta.hidden = false;
    els.filters.hidden = false;
    els.title.textContent = mode === "shiny" ? "闪光图鉴" : "普通图鉴";
    renderGrid();
  }

  function showShop() {
    view = "shop";
    setViewButtons();
    els.shop.hidden = false;
    els.explore.hidden = true;
    els.grid.hidden = true;
    els.meta.hidden = true;
    els.filters.hidden = true;
    els.title.textContent = mode === "shiny" ? "闪光商店" : "商店";
    renderShop();
  }

  function showExplore() {
    view = "explore";
    setViewButtons();
    els.shop.hidden = true;
    els.explore.hidden = false;
    els.grid.hidden = true;
    els.meta.hidden = true;
    els.filters.hidden = true;
    els.title.textContent = "探索";
    renderExplore();
  }

  els.viewShop.addEventListener("click", () => showShop());
  els.viewExplore.addEventListener("click", () => showExplore());
  if (els.btnSellAll) els.btnSellAll.hidden = true;
  if (els.btnSell) els.btnSell.hidden = true;
  els.btnEvoCard.addEventListener("click", (e) => {
    e.preventDefault();
    if (activeId != null) useEvoCard(activeId);
  });
  if (els.btnUpgradeCard) {
    els.btnUpgradeCard.addEventListener("click", (e) => {
      e.preventDefault();
      if (activeId != null) useUpgradeCard(activeId);
    });
  }
  if (els.btnLegendUpgradeCard) {
    els.btnLegendUpgradeCard.addEventListener("click", (e) => {
      e.preventDefault();
      if (activeId != null) useLegendUpgradeCard(activeId);
    });
  }
  els.btnHunt.addEventListener("click", () => throwBalls());
  els.btnHuntAll.addEventListener("click", () => {
    throwBalls(Math.min(THROW_MAX, Math.floor(Number(store.balls) || 0)));
  });
  if (els.btnBossFight) els.btnBossFight.addEventListener("click", () => challengeBoss());
  els.ballCount.addEventListener("input", () => {
    const maxThrow = Math.min(THROW_MAX, Math.max(0, Math.floor(Number(store.balls) || 0)));
    const raw = Math.floor(Number(els.ballCount.value));
    if (!Number.isFinite(raw)) return;
    if (raw > maxThrow) els.ballCount.value = String(maxThrow);
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      mode = tab.dataset.mode === "shiny" ? "shiny" : "normal";
      els.tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.body.classList.toggle("is-shiny", mode === "shiny");
      activeId = null;
      if (els.detail.open) els.detail.close();
      runAutoEvolve();
      showDex();
    });
  });

  let searchTimer = 0;
  els.search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderGrid, 120);
  });
  els.collect.addEventListener("change", renderGrid);
  els.gen.addEventListener("change", renderGrid);
  els.legend.addEventListener("change", renderGrid);

  async function syncKeyBalls() {
    let changed = false;
    try {
      const res = await fetch("../data/key_presses.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const presses = Math.max(0, Math.floor(Number(data.presses) || 0));
        const cursor = Math.max(0, Math.floor(Number(store.ballCursor) || 0));
        if (freshAccount) {
          // Fresh localStorage: baseline cursor to current presses (no backlog grant).
          // Fixes Win installs where LOCALAPPDATA key_presses.json still has a huge count.
          store.ballCursor = presses;
          freshAccount = false;
          changed = true;
        } else if (presses > cursor) {
          let gained = presses - cursor;
          if (buffActive("balls")) gained *= 2;
          if (activeDaily()?.kind === "balls") gained *= 2;
          store.balls = (Number(store.balls) || 0) + gained;
          store.ballCursor = presses;
          changed = true;
        }
      }
    } catch {
      // 后台计数还没启动时保持当前球数
    }
    if (changed) {
      saveStore();
      updateStats();
    }
  }

  async function boot() {
    try {
      // Fresh-start builds: drop older save keys; do not migrate progress.
      localStorage.removeItem("pokedex-progress-v1");
      localStorage.removeItem("pokedex-progress-v2");
      localStorage.removeItem("pokedex-progress-v3");
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pokemon = await res.json();
      pokemon.sort((a, b) => a.id - b.id);
      byId = new Map(pokemon.map((p) => [p.id, p]));
      const freshDaily = claimDailyIfNeeded();
      ensureBossDay();
      const converted = convertFinalStock();
      saveStore();
      runAutoEvolve();
      renderGrid();
      updateStats();
      renderBuffs();
      const notes = [];
      if (converted > 0) notes.push(`终极形态改为等级制，结算 ${converted} 金币`);
      if (activeDaily()) {
        notes.push(
          freshDaily
            ? `今日签到：${dailyLabel(store.daily)}，持续到今天结束`
            : `今日增益：${dailyLabel(store.daily)}，剩余 ${formatRemain(msUntilEndOfDay())}`
        );
      }
      const boss = store.boss;
      if (boss?.id) {
        const bp = byId.get(boss.id);
        if (bp) notes.push(`今日 Boss：${boss.shiny ? "闪光" : ""}${bp.name_zh}`);
      }
      if (notes.length) showToast(notes.join("；"));
      syncKeyBalls();
      setInterval(syncKeyBalls, 1000);
      setInterval(renderBuffs, 1000);
    } catch (err) {
      els.meta.textContent =
        "无法加载图鉴数据。请在项目根目录运行：python3 -m http.server 8080 后访问 /pokedex/";
      console.error(err);
    }
  }

  boot();
})();
