(() => {
  // Bump this to wipe player progress for a release (no migration).
  const STORAGE_KEY = "pokedex-progress-v5";
  const STORAGE_BAK_KEY = "pokedex-progress-v5-bak";
  const DEVICE_KEY = "pokedex-device-id";
  const PROGRESS_URL = "../data/progress.json";
  const PREFS_URL = "../data/save_prefs.json";
  const PICK_EXPORT_URL = "../data/pick-export";
  const PICK_IMPORT_URL = "../data/pick-import";
  const BACKUP_URL = "../data/backup-save";
  const DATA_URL = "../data/pokemon.json?v=52";
  const LEAGUE_URL = "../data/league.json?v=2";
  const FINALE_URL = "../data/finale.json?v=7";
  const IDB_NAME = "pokedex-save-handles-v1";
  const IDB_STORE = "handles";
  /** Max balls thrown in one hunt action (manual or 一键扔球). */
  const THROW_MAX = 9999;
  const SYNC_POLL_MS = 45000;
  const MEGA_UNLOCK_COST = 10000;
  const FLOETTE_ID = 670;
  const FLOETTE_ETERNAL_ID = 10061;
  const FLORGES_ID = 671;

  /** @typedef {{ seen: boolean, caught: number, level?: number }} EntryProgress */
  /** @typedef {{ normal: Record<string, EntryProgress>, shiny: Record<string, EntryProgress> }} ProgressStore */

  const els = {
    title: document.getElementById("dex-title"),
    statsSeen: document.getElementById("stat-seen"),
    statsSeenShiny: document.getElementById("stat-seen-shiny"),
    seenTip: document.getElementById("stat-seen-tip"),
    seenShinyTip: document.getElementById("stat-seen-shiny-tip"),
    search: document.getElementById("search"),
    collect: document.getElementById("collect-filter"),
    gen: document.getElementById("gen-filter"),
    legend: document.getElementById("legend-filter"),
    sort: document.getElementById("sort-filter"),
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
    viewLeague: document.getElementById("view-league"),
    viewFinale: document.getElementById("view-finale"),
    finale: document.getElementById("finale"),
    finaleRoot: document.getElementById("finale-root"),
    shop: document.getElementById("shop"),
    shopCatalog: document.getElementById("shop-catalog"),
    btnSellAll: document.getElementById("btn-sell-all"),
    explore: document.getElementById("explore"),
    league: document.getElementById("league"),
    leagueRoot: document.getElementById("league-root"),
    leaguePicker: document.getElementById("league-picker"),
    leaguePickerList: document.getElementById("league-picker-list"),
    leaguePickerQuery: document.getElementById("league-picker-query"),
    leaguePickerClose: document.getElementById("league-picker-close"),
    leaguePickerNormal: document.getElementById("league-picker-normal"),
    leaguePickerShiny: document.getElementById("league-picker-shiny"),
    leaguePickerScroll: document.querySelector("#league-picker .league-picker-scroll"),
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
    btnUpgradeCard: document.getElementById("btn-upgrade-card"),
    megaUnlocks: document.getElementById("mega-unlocks"),
    toast: document.getElementById("toast"),
    help: document.getElementById("help"),
    helpQuery: document.getElementById("help-query"),
    helpChips: document.getElementById("help-chips"),
    helpBody: document.getElementById("help-body"),
    btnHelp: document.getElementById("btn-help"),
    detailSpawns: document.getElementById("detail-spawns"),
    detailCaught: document.getElementById("detail-caught"),
    btnExportSave: document.getElementById("btn-export-save"),
    btnImportSave: document.getElementById("btn-import-save"),
    importSaveFile: document.getElementById("import-save-file"),
    savePathLabel: document.getElementById("save-path-label"),
  };

  /** @type {any[]} */
  let pokemon = [];
  /** @type {"normal" | "shiny"} */
  let mode = "normal";
  /** @type {"dex" | "shop" | "explore" | "league"} */
  let view = "dex";
  /** @type {{ generations: any[] }} */
  let leagueData = { generations: [] };
  let finaleData = { trainers: [] };
  let leagueRegion = "";
  /** @type {"normal" | "advanced"} */
  let leagueMode = "normal";
  let leagueFight = null;
  let leagueQuery = "";
  let leagueSlot = 0;
  let leaguePickerShiny = false;

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
      desc: "24 小时内捕获率 ×5（加算）",
      price: 20000,
      kind: "buff",
    },
    {
      id: "shiny",
      name: "闪光提升",
      desc: "24 小时内闪光概率 ×8，闪光捕获率 ×2（捕获加算；出现与每日闪光乘算）",
      price: 50000,
      kind: "buff",
    },
    {
      id: "legend",
      name: "神兽提升",
      desc: "24 小时内神兽出现权重 ×20，神兽捕获率 ×3（捕获加算）",
      price: 50000,
      kind: "buff",
    },
    {
      id: "balls",
      name: "精灵球翻倍",
      desc: "24 小时内按键获得的精灵球 ×2，可与每日签到叠加",
      price: 10000,
      kind: "buff",
    },
  ];
  /** 地区图鉴（探索区域） */
  const AREAS = ["关都", "城都", "丰缘", "神奥", "合众", "卡洛斯", "阿罗拉", "伽勒尔", "洗翠", "帕底亚"];
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

  // 剑盾同代（第六世代起）捕获公式：默认高级球 ×2、当前体力为一半、无异常状态。
  // 探索一律精灵球 ×1。Boss 仍用高级球 ×2。
  function catchProbability(captureRate, catchMult, ballMult = 2) {
    const maxHP = 300;
    const curHP = 150;
    const ball = ballMult;
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
  /** updatedAt last read from progress.json. A second page must send this back
   *  so an older snapshot cannot overwrite a save the first page already wrote. */
  let diskRev = 0;
  let omitBaseOnce = false;
  /** Import replaces the whole save. Ordinary writes must not drop a win or a higher frame. */
  let replaceProgressOnce = false;
  let leagueRewrite = false;
  /** @type {ProgressStore} */
  let store = loadStore();
  let localUpdatedAt = Number(store.updatedAt) || 0;
  let syncPulling = false;

  function emptyEntry() {
    return { seen: false, caught: 0, level: 0 };
  }

  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      return "dev-unknown";
    }
  }

  function isStoreEmpty(target) {
    const n = Object.keys(target?.normal || {}).length;
    const s = Object.keys(target?.shiny || {}).length;
    const items = target?.items || {};
    const itemCount =
      (Number(items.evo) || 0) + (Number(items.upgrade) || 0) + (Number(items.legendUpgrade) || 0);
    return n === 0 && s === 0 && !(Number(target?.coins) > 0) && !(Number(target?.balls) > 0) && itemCount === 0;
  }

  function rememberLocalBackup() {
    if (isStoreEmpty(store)) return;
    try {
      localStorage.setItem(STORAGE_BAK_KEY, JSON.stringify(snapshotLocal(true)));
    } catch {
      // private mode
    }
  }

  function readLocalBackup() {
    try {
      const raw = localStorage.getItem(STORAGE_BAK_KEY) || localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !isStoreEmpty(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function restoreParsed(parsed) {
    applyProgressPayload(parsed, { takeCursor: true, baselinePresses: false });
    const rev = Number(parsed?.updatedAt) || 0;
    if (rev > 0) diskRev = rev;
    const text = JSON.stringify(snapshotLocal(true));
    try {
      localStorage.setItem(STORAGE_KEY, text);
      if (!isStoreEmpty(store)) localStorage.setItem(STORAGE_BAK_KEY, text);
    } catch {
      // ignore quota
    }
    if (pokemon.length) {
      renderGrid();
      updateStats();
    }
  }

  function snapshotLocal(includeCursor) {
    pruneStore(store);
    const body = {
      updatedAt: localUpdatedAt || Date.now(),
      deviceId: deviceId(),
      normal: store.normal,
      shiny: store.shiny,
      coins: store.coins || 0,
      balls: store.balls || 0,
      items: {
        evo: store.items?.evo || 0,
        upgrade: store.items?.upgrade || 0,
        legendUpgrade: store.items?.legendUpgrade || 0,
      },
      buffs: store.buffs || {},
      daily: store.daily || null,
      boss: store.boss || null,
      league: normalizeLeague(store.league),
    };
    if (includeCursor) body.ballCursor = store.ballCursor || 0;
    return body;
  }

  function applyProgressPayload(parsed, { baselinePresses = false, takeCursor = false, replaceLeague = false } = {}) {
    const keepCursor = Math.max(0, Math.floor(Number(store.ballCursor) || 0));
    const wasEmpty = isStoreEmpty(store);
    store.normal = parsed.normal || {};
    store.shiny = parsed.shiny || {};
    store.coins = Number(parsed.coins) || 0;
    store.balls = Number(parsed.balls) || 0;
    if (takeCursor && parsed.ballCursor != null) {
      store.ballCursor = Math.max(0, Math.floor(Number(parsed.ballCursor) || 0));
    } else {
      store.ballCursor = keepCursor;
    }
    store.items = {
      evo: Number(parsed.items?.evo) || 0,
      upgrade: Number(parsed.items?.upgrade) || 0,
      legendUpgrade: Number(parsed.items?.legendUpgrade) || 0,
    };
    store.buffs = parsed.buffs || {};
    store.daily = parsed.daily || null;
    store.boss = parsed.boss || null;
    const incomingLeague = normalizeLeague(parsed.league);
    store.league = replaceLeague ? incomingLeague : mergeLeague(store.league, incomingLeague);
    store.updatedAt = Number(parsed.updatedAt) || Date.now();
    localUpdatedAt = store.updatedAt;
    pruneStore(store);
    if (baselinePresses || wasEmpty) freshAccount = true;
  }

  /** @returns {Promise<{status: "missing" | "empty" | "full" | "error", parsed?: any}>} */
  async function readProgressFile() {
    try {
      const res = await fetch(PROGRESS_URL, { cache: "no-store" });
      if (res.status === 404) return { status: "missing" };
      if (!res.ok) return { status: "error" };
      const parsed = await res.json();
      if (!parsed || typeof parsed !== "object") return { status: "error" };
      return { status: isStoreEmpty(parsed) ? "empty" : "full", parsed };
    } catch {
      return { status: "error" };
    }
  }

  /** Authoritative save lives in launcher file (LOCALAPPDATA / Application Support), not Edge origin.
   *  A blank Edge profile (new port) must not overwrite a non-empty progress.json. */
  async function pushProgressFile() {
    try {
      if (isStoreEmpty(store)) {
        const disk = await readProgressFile();
        if (disk.status === "full" && disk.parsed) {
          restoreParsed(disk.parsed);
          return true;
        }
        if (disk.status === "error") return false;
        const bak = readLocalBackup();
        if (bak) {
          restoreParsed(bak);
        } else if (disk.status !== "missing") {
          return false;
        }
      }
      const body = snapshotLocal(true);
      body.updatedAt = Date.now();
      localUpdatedAt = body.updatedAt;
      store.updatedAt = body.updatedAt;
      if (!omitBaseOnce && diskRev > 0) body.baseUpdatedAt = diskRev;
      omitBaseOnce = false;
      if (replaceProgressOnce) {
        body.replaceProgress = true;
        replaceProgressOnce = false;
      }
      const res = await fetch(PROGRESS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (res.status === 409) {
        const disk = await readProgressFile();
        if (disk.status === "full" && disk.parsed) {
          restoreParsed(disk.parsed);
          const diskLeague = JSON.stringify(normalizeLeague(disk.parsed.league));
          const kept = JSON.stringify(normalizeLeague(store.league));
          refreshPetals();
          if (view === "finale" || view === "league") renderBattleView();
          if (kept !== diskLeague && !leagueRewrite) {
            leagueRewrite = true;
            try {
              await pushProgressFile();
            } finally {
              leagueRewrite = false;
            }
          }
        }
        return false;
      }
      if (res.ok || res.status === 204) diskRev = body.updatedAt;
      if ((res.ok || res.status === 204) && !isStoreEmpty(store)) rememberLocalBackup();
      return res.ok || res.status === 204;
    } catch {
      return false;
    }
  }

  /** Load disk save if present (same file for any localhost port). */
  async function loadProgressFromFile() {
    if (syncPulling) return false;
    syncPulling = true;
    try {
      const disk = await readProgressFile();
      if (disk.status === "error" || disk.status === "missing") {
        const bak = isStoreEmpty(store) ? readLocalBackup() : null;
        if (bak) restoreParsed(bak);
        return false;
      }
      if (disk.status === "empty" && !isStoreEmpty(store)) return false;
      if (disk.status === "empty" && isStoreEmpty(store)) {
        const bak = readLocalBackup();
        if (bak) {
          restoreParsed(bak);
          return false;
        }
      }
      if (!disk.parsed) return false;
      restoreParsed(disk.parsed);
      return !isStoreEmpty(store) || disk.status === "empty";
    } catch {
      return false;
    } finally {
      syncPulling = false;
    }
  }

  function emptyLeague() {
    return { badges: {}, frames: {}, cleared: {}, people: {}, ashDay: "" };
  }

  function normalizeLeague(raw) {
    const out = emptyLeague();
    const badges = raw?.badges && typeof raw.badges === "object" ? raw.badges : {};
    for (const [region, gyms] of Object.entries(badges)) {
      if (!gyms || typeof gyms !== "object") continue;
      const row = {};
      for (const [slug, tier] of Object.entries(gyms)) {
        if (tier === "silver" || tier === "gold") row[slug] = tier;
      }
      if (Object.keys(row).length) out.badges[region] = row;
    }
    const frames = raw?.frames && typeof raw.frames === "object" ? raw.frames : {};
    for (const [id, tier] of Object.entries(frames)) {
      if (tier === "silver" || tier === "gold" || tier === "diamond") out.frames[String(id)] = tier;
    }
    const cleared = raw?.cleared && typeof raw.cleared === "object" ? raw.cleared : {};
    for (const [region, flags] of Object.entries(cleared)) {
      if (!flags || typeof flags !== "object") continue;
      out.cleared[region] = { normal: !!flags.normal, advanced: !!flags.advanced };
    }
    const people = raw?.people && typeof raw.people === "object" ? raw.people : {};
    for (const [region, row] of Object.entries(people)) {
      if (!row || typeof row !== "object") continue;
      const kept = {};
      for (const [slug, tier] of Object.entries(row)) {
        if (tier === "silver" || tier === "gold") kept[slug] = tier;
      }
      if (Object.keys(kept).length) out.people[region] = kept;
    }
    out.ashDay = /^\d{4}-\d{2}-\d{2}$/.test(raw?.ashDay) ? raw.ashDay : "";
    return out;
  }

  function betterAshDay(a, b) {
    const ok = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const today = todayKey();
    if (a === today || b === today) return today;
    if (ok(a) && ok(b)) return a > b ? a : b;
    if (ok(a)) return a;
    if (ok(b)) return b;
    return "";
  }

  function mergeTierRow(left, right, allowDiamond) {
    const out = {};
    const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
    for (const key of keys) {
      let best = Math.max(frameRank(left?.[key]), frameRank(right?.[key]));
      if (!allowDiamond && best > 2) {
        const leftRank = frameRank(left?.[key]);
        const rightRank = frameRank(right?.[key]);
        best = Math.max(leftRank > 2 ? 0 : leftRank, rightRank > 2 ? 0 : rightRank);
      }
      const tier = best >= 3 ? "diamond" : best === 2 ? "gold" : best === 1 ? "silver" : "";
      if (tier) out[key] = tier;
    }
    return out;
  }

  function mergeRegionTiers(left, right) {
    const out = {};
    const regions = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
    for (const region of regions) {
      const row = mergeTierRow(left?.[region], right?.[region], false);
      if (Object.keys(row).length) out[region] = row;
    }
    return out;
  }

  /** Keep today's Ash win and the higher badge, person, and frame from either side. */
  function mergeLeague(a, b) {
    const left = normalizeLeague(a);
    const right = normalizeLeague(b);
    const cleared = {};
    const regions = new Set([...Object.keys(left.cleared), ...Object.keys(right.cleared)]);
    for (const region of regions) {
      const row = {
        normal: !!(left.cleared[region]?.normal || right.cleared[region]?.normal),
        advanced: !!(left.cleared[region]?.advanced || right.cleared[region]?.advanced),
      };
      if (row.normal || row.advanced) cleared[region] = row;
    }
    return normalizeLeague({
      badges: mergeRegionTiers(left.badges, right.badges),
      frames: mergeTierRow(left.frames, right.frames, true),
      cleared,
      people: mergeRegionTiers(left.people, right.people),
      ashDay: betterAshDay(left.ashDay, right.ashDay),
    });
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
          updatedAt: 0,
          items: { evo: 0, upgrade: 0, legendUpgrade: 0 },
          buffs: {},
          daily: null,
          boss: null,
          league: emptyLeague(),
        };
      }
      const parsed = JSON.parse(raw);
      const loaded = {
        normal: parsed.normal || {},
        shiny: parsed.shiny || {},
        coins: Number(parsed.coins) || 0,
        balls: Number(parsed.balls) || 0,
        ballCursor: Number(parsed.ballCursor) || 0,
        updatedAt: Number(parsed.updatedAt) || 0,
        items: {
          evo: Number(parsed.items?.evo) || 0,
          upgrade: Number(parsed.items?.upgrade) || 0,
          legendUpgrade: Number(parsed.items?.legendUpgrade) || 0,
        },
        buffs: parsed.buffs || {},
        daily: parsed.daily || null,
        boss: parsed.boss || null,
        league: normalizeLeague(parsed.league),
      };
      pruneStore(loaded);
      return loaded;
    } catch {
      return {
        normal: {},
        shiny: {},
        coins: 0,
        balls: 0,
        ballCursor: 0,
        updatedAt: 0,
        items: { evo: 0, upgrade: 0, legendUpgrade: 0 },
        buffs: {},
        daily: null,
        boss: null,
        league: emptyLeague(),
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

  const PALDEA_TAUROS_KEEP = 10250;
  const PALDEA_TAUROS_MERGE = [10251, 10252];
  const FORM_ID_MERGES = [
    { keep: 10322, merge: [10323, 10324] }, // 超级米立龙：只留上弓
    { keep: 10314, merge: [10326] }, // 超级超能妙喵：只留一只
    { keep: 10317, merge: [10318] }, // 超级玛机雅娜：只留一只
  ];

  function mergeDexEntry(dst, src) {
    if (!src) return dst;
    const out = dst || { seen: false, caught: 0, level: 0 };
    const caught = (Number(out.caught) || 0) + (Number(src.caught) || 0);
    const level = Math.max(Number(out.level) || 0, Number(src.level) || 0);
    out.caught = caught;
    out.level = level;
    out.seen = !!(out.seen || src.seen || caught > 0 || level > 0);
    return out;
  }

  /** Fold Paldean Tauros breed IDs into one entry; keep coins/balls/rest of save. */
  function migratePaldeaTauros(target) {
    if (!target) return;
    for (const bucketName of ["normal", "shiny"]) {
      const bucket = target[bucketName];
      if (!bucket) continue;
      const keepKey = String(PALDEA_TAUROS_KEEP);
      let keep = bucket[keepKey] || null;
      let moved = false;
      for (const id of PALDEA_TAUROS_MERGE) {
        const key = String(id);
        if (!bucket[key]) continue;
        keep = mergeDexEntry(keep, bucket[key]);
        delete bucket[key];
        moved = true;
      }
      if (moved && keep) bucket[keepKey] = keep;
    }
    const bossId = Number(target.boss?.id);
    if (PALDEA_TAUROS_MERGE.includes(bossId) && target.boss) {
      target.boss.id = PALDEA_TAUROS_KEEP;
    }
  }

  function migrateMergedForms(target) {
    if (!target) return;
    for (const { keep, merge } of FORM_ID_MERGES) {
      for (const bucketName of ["normal", "shiny"]) {
        const bucket = target[bucketName];
        if (!bucket) continue;
        const keepKey = String(keep);
        let keepEntry = bucket[keepKey] || null;
        let moved = false;
        for (const id of merge) {
          const key = String(id);
          if (!bucket[key]) continue;
          keepEntry = mergeDexEntry(keepEntry, bucket[key]);
          delete bucket[key];
          moved = true;
        }
        if (moved && keepEntry) bucket[keepKey] = keepEntry;
      }
      const bossId = Number(target.boss?.id);
      if (merge.includes(bossId) && target.boss) target.boss.id = keep;
    }
  }

  function pruneStore(target) {
    migratePaldeaTauros(target);
    migrateMergedForms(target);
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
    if (isStoreEmpty(store)) {
      const bak = readLocalBackup();
      if (bak) restoreParsed(bak);
    }
    if (isStoreEmpty(store)) {
      if (!syncPulling) pushProgressFile();
      return;
    }
    if (!syncPulling) {
      localUpdatedAt = Date.now();
      store.updatedAt = localUpdatedAt;
    }
    const text = JSON.stringify(snapshotLocal(true));
    try {
      localStorage.setItem(STORAGE_KEY, text);
      localStorage.setItem(STORAGE_BAK_KEY, text);
    } catch {
      // ignore quota
    }
    if (!syncPulling) pushProgressFile();
  }

  function activeDaily() {
    const d = store.daily;
    if (!d || d.day !== todayKey()) return null;
    return d;
  }

  function dailyLabel(d) {
    if (!d) return "";
    if (d.kind === "catch") return `${d.area}地区捕获率×2（加算）`;
    if (d.kind === "shiny") return `${d.area}地区闪光×3`;
    if (d.kind === "legend") return `${d.area}地区神兽权重×10、神兽捕获×1.5`;
    if (d.kind === "gold") return "卖出金币×1.5";
    if (d.kind === "shop") return "商店 75 折";
    if (d.kind === "balls") return "精灵球获取×1.5";
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

  function dexSlot(dex) {
    return dex === "shiny" ? "shiny" : "normal";
  }

  function getProgress(id, dex) {
    const bucket = store[dexSlot(dex || mode)];
    return bucket[String(id)] || emptyEntry();
  }

  function ensureProgress(id, dex) {
    const bucket = store[dexSlot(dex || mode)];
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

  function adjustCaught(id, delta, dex) {
    const slot = dexSlot(dex || mode);
    const p = byId.get(id);
    const cur = ensureProgress(id, slot);
    if (p && isUnlockForm(p)) {
      cur.caught = 0;
      return;
    }
    if (p && cannotEvolve(p)) {
      if (delta > 0) {
        cur.seen = true;
        let coins = 0;
        for (let i = 0; i < delta; i += 1) {
          if (id === FLORGES_ID && eternalUnlocked(slot)) continue;
          if ((Number(cur.level) || 0) < 100) cur.level = (Number(cur.level) || 0) + 1;
          coins += sellPrice(p, slot === "shiny");
        }
        cur.caught = 0;
        store.coins = (store.coins || 0) + Math.floor(coins * goldMult());
        if (id === FLORGES_ID) syncFlorgesFromEternal(slot);
      } else {
        cur.caught = 0;
      }
      return;
    }
    cur.caught = Math.max(0, (Number(cur.caught) || 0) + delta);
    if (cur.caught > 0) cur.seen = true;
    if (id === FLOETTE_ID && delta > 0) bumpEternalFromFloette(delta, slot);
  }

  /** 旧存档里终极形态还堆着的数量，换成等级并自动卖出 */
  function convertFinalStock() {
    let coins = 0;
    const prev = mode;
    for (const dex of ["normal", "shiny"]) {
      mode = /** @type {"normal" | "shiny"} */ (dex);
      for (const p of pokemon) {
        if (!cannotEvolve(p) || isUnlockForm(p)) continue;
        if (p.id === FLORGES_ID && eternalUnlocked(dex)) continue;
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

  function showToast(text) {
    const node = document.getElementById("toast-text");
    if (node) node.textContent = text;
    window.clearTimeout(toastTimer);
    if (!els.toast.open && typeof els.toast.showModal === "function") els.toast.showModal();
    toastTimer = window.setTimeout(() => {
      if (els.toast.open) els.toast.close();
    }, 4200);
  }

  els.toast.addEventListener("close", () => window.clearTimeout(toastTimer));
  els.toast.addEventListener("click", (ev) => {
    if (ev.target === els.toast) els.toast.close();
  });

  const HELP_SECTIONS = [
    {
      id: "intro",
      title: "简介",
      keywords: "游戏 图鉴 收集 闪光 商店 探索",
      paragraphs: [
        "这是一份可以自己点亮的宝可梦图鉴。普通和闪光各有一本，互不影响。",
        "精灵球用来探索抓捕。抓住会点亮条目；还没进化完的会记数量，最终形态会升级并自动换成金币。金币用来买增益、给最终形态升级，或解锁超级进化和特殊形态。",
      ],
    },
    {
      id: "play",
      title: "怎么玩",
      keywords: "流程 入门 开始 循环 步骤",
      paragraphs: [
        "图鉴开着的时候，键盘、鼠标按键或滚轮都算活动，鼠标移动不算。每 10 秒里只要有过活动，就获得 10 个精灵球。",
        "到探索里先选一个地区，再投入精灵球。抓住的精灵进入对应颜色的图鉴。集满 3 只同一颜色会自动进化；已经是最终形态的，每次获得升 1 级并卖掉。",
        "金币可以在商店买 24 小时增益，也可以在精灵详情里升级或解锁形态。每天第一次打开会自动签到，再送一个当天增益。探索页还有一只每天刷新的神兽 Boss。",
      ],
    },
    {
      id: "dex",
      title: "图鉴",
      keywords: "点亮 剪影 筛选 检索 地区形态 普通 闪光 槽位",
      paragraphs: [
        "普通图鉴和闪光图鉴是两本独立的收藏。抓住普通只点亮普通，抓住闪光只点亮闪光。",
        "还没获得的精灵显示剪影，名字和地区仍然看得到。点开卡片可以看到属性、进化、出现地区和当前进度。",
        "顶栏可以按名字或编号搜索，也可以按已点亮、已抓获、地区、神兽，以及编号、等级、战力排序。地区形态是单独条目，不和本体算成同一只。特殊形态不在探索里出现，要在本体详情里解锁后才会点亮。",
      ],
    },
    {
      id: "explore",
      title: "探索",
      keywords: "抓捕 地区 权重 精灵球 一键扔球 机制",
      paragraphs: [
        "先选地区图鉴：关都、城都、丰缘、神奥、合众、卡洛斯、阿罗拉、伽勒尔、洗翠、帕底亚。每颗球按该精灵在这个地区的出现权重抽取，没在该地区出现的抽不到。超级进化和特殊形态权重为 0。",
        "抽到之后再判定抓不抓得住。探索用普通精灵球，按半血、无异常的捕获公式计算。一次最多扔 9999 颗。「一键扔球」会把现有精灵球一次扔完，同样不超过这个上限。",
        "结果会分成抓住、新点亮和升级记录。战力变化按整支队伍（普通加闪光）计算。",
      ],
    },
    {
      id: "odds",
      title: "概率",
      keywords: "闪光 捕获率 神兽 暴击 加成 乘算 加算 1/1024",
      paragraphs: [
        "探索的基础闪光概率是 1/1024。商店「闪光提升」让它 ×8。当天签到若是该地区的闪光增益，再 ×3。这两项是乘在一起的，所以同时生效是 1/1024 × 8 × 3。",
        "捕获增益是加算，不是相乘。什么都没开时捕获倍率是 ×1。捕获率提升 +5，该地区签到捕获 +2，神兽提升对神兽再 +3，该地区神兽签到对神兽再 +1.5，闪光提升对闪光再 +2。例如捕获率提升和该地区捕获签到同时在，就是 ×7。",
        "神兽和幻兽的出现权重同样加算。「神兽提升」是 ×20，该地区神兽签到再 +10，两项都在就是 ×30。没有这些增益时，权重就是图鉴里的原始出现率。",
        "每日 Boss 当天是不是闪光，固定 1/8，不受探索的闪光增益影响。Boss 球按高级球计算捕获率，不吃任何捕获增益；第 10 颗必定抓住。挑战时有 1/10 概率暴击，伤害 ×2。",
      ],
    },
    {
      id: "evo",
      title: "进化与升级",
      keywords: "3只 分支 最终形态 满级 金币 花洁夫人 花叶蒂",
      paragraphs: [
        "还没到最终形态的精灵只记数量。同一颜色集满 3 只就自动进化，消耗这 3 只。有多条进化路线时，每 3 只等概率变成其中一只。普通和闪光分开进化。",
        "最终形态不堆数量。每获得 1 只升 1 级，并按售价自动换成金币，最高 100 级。满级之后再获得仍然会卖掉，但等级不再增加。",
        "已经获得的最终形态可以在详情里花金币再升 1 级：普通 3000 金币，神兽或幻兽 5000 金币，闪光 5000 金币，闪光神兽或闪光幻兽 10000 金币。还没获得时不能升级。特殊形态不能单独升级，等级跟着同色本体走。",
        "花叶蒂（永恒之花）解锁后，等级会同步给同色花洁夫人。之后继续收集花叶蒂才会让两边一起升级，花洁夫人不能直接花金币升级。",
      ],
    },
    {
      id: "power",
      title: "战力",
      keywords: "等级 成长 种族 队伍 伤害 稀有",
      paragraphs: [
        "只有最终形态，以及已解锁的超级进化和特殊形态，会计入战力。还在进化链前面的精灵不计入。",
        "种族战力按稀有度分档：普通 ×1，较少见、稀有、极稀有 ×3，神兽和幻兽 ×10。闪光的种族战力再 ×3。",
        "1 级就是种族战力。之后每升 1 级，在种族战力上再累加一档成长：普通 10%，稀有档 15%，神兽和幻兽 30%；闪光再多 5 个百分点。例如普通闪光每级成长 15%，神兽闪光每级成长 35%。战力按四舍五入取整。",
        "右上角的战力总和是普通战力加闪光战力。每日 Boss 的每次伤害就等于这个总和。",
      ],
    },
    {
      id: "league",
      title: "道馆战",
      keywords: "道馆 徽章 四天王 冠军 银色 金色 边框 克制 属性 高级 小智 落花 闪光神兽",
      paragraphs: [
        "道馆战在探索右边。先看每个地区的徽章，再选一个地区。普通对战里馆主是 50 级，四天王 60 级，冠军 70 级。普通版打赢冠军之后，才解锁高级对战：馆主 80 级，四天王 90 级，冠军 100 级。",
        "六只一对一结算。每种属性对对面的全部属性算一次：1 倍不变，2 倍 +0.2，4 倍 +0.3，1/2 −0.2，1/4 −0.3，0 倍 −0.4。加成相加后乘上这只的战力，再比六只的总和，我方更高才算赢，相同不算赢。馆主、四天王和冠军都是各自单独打。先打完这一档的全部馆主，才能挑战四天王。四天王都赢了，才能挑战冠军。",
        "点每一栏会打开选择窗口，里面只有这个地区已经点亮、并且有战力的宝可梦。还能进化的没有战力，不会出现。普通和闪光分成两个按钮，各自按战力从高到低排。同一只只能选一只，选过的会变灰并标上已选。特殊形态算本体。武道熊师的一击流和连击流算同一只。无极巨化无极汰那不能上场。超级进化和究极奈克洛兹玛全队只能上一只。",
        "打赢普通馆主得到银色徽章，打赢高级馆主得到金色徽章，已经有的不会重复发，金色也不会退回银色。普通冠军通关后，这个地区的宝可梦加上银色边框；高级冠军通关后改成金色。同一只在两个地区都有时，先打完的地区发边框，后打完的地区不再发一次。",
        "十个地区的高级冠军都打赢后，可以挑战小智。他的阵容每个自然日更换，六只都是不重复的 100 级闪光神兽。不同形态算同一只，上场的是这只神兽当前全部形态里战力最高的；战力相同就在当天随机一只。当天打赢后，回到图鉴会落下花瓣，一直持续到这天结束。",
      ],
    },
    {
      id: "shop",
      title: "商店",
      keywords: "buff 增益 捕获率提升 闪光提升 神兽提升 精灵球翻倍 24小时 75折",
      paragraphs: [
        "商店卖的都是增益，买下后立刻生效 24 小时。还没结束时再买，会从当前结束时间往后顺延 24 小时。",
        "捕获率提升 20000 金币：捕获倍率 +5。闪光提升 50000 金币：闪光出现 ×8，并且闪光的捕获倍率 +2。神兽提升 50000 金币：神兽和幻兽出现权重 ×20，它们的捕获倍率 +3。精灵球翻倍 10000 金币：按键获得的精灵球 ×2。",
        "这些增益可以和当天签到叠在一起。捕获和神兽出现按上面的加算规则；闪光出现按乘算。当天若是商店 75 折，价格先乘 0.75 再向下取整。",
      ],
    },
    {
      id: "daily",
      title: "每日签到",
      keywords: "今天 当天 签到 折扣 金币 随机",
      paragraphs: [
        "每个自然日第一次打开图鉴，会自动抽一个签到增益，持续到当天结束。六种里等概率一种：某地区捕获率 +2、某地区闪光 ×3、某地区神兽权重 +10 且神兽捕获 +1.5、卖出金币 ×1.5、商店 75 折、精灵球获取 ×1.5。",
        "带地区的三项只在抽中的那一个地区生效。卖出金币的 1.5 倍作用在自动卖出上，不作用在 Boss 栏位金币上。",
      ],
    },
    {
      id: "boss",
      title: "每日 Boss",
      keywords: "挑战 栏位 金币 神兽 必中 暴击 伤害",
      paragraphs: [
        "每天随机一只神兽或幻兽，血量无限，当天有 1/8 概率是闪光。可以挑战 5 次，每次伤害等于当前战力总和，并有 1/10 概率暴击、伤害 ×2。",
        "伤害打满一栏就得到 1 颗 Boss 球，并拿到该栏金币。第 1 栏 5 万伤害、1000 金币，之后伤害翻倍、金币每栏加 1000，一共 10 栏：5万、10万、20万、40万、80万、160万、320万、640万、1280万、2560万。一次伤害跨过好几栏时，球和金币一起结算，已经领过的栏不会再发。",
        "打出 Boss 球后会自动投掷。Boss 球不吃捕获增益，第 10 颗必定抓住。中途抓住时，还没打满的栏位金币会一次补齐，不再额外给球。抓住，或者 5 次挑战用完，今天就结束，剩余的 Boss 球也会清掉。",
      ],
    },
    {
      id: "forms",
      title: "特殊形态",
      keywords: "超级进化 解锁 金币 等级同步 无极巨化 分支",
      paragraphs: [
        "超级进化和特殊形态不会在探索里出现。打开本体详情，花金币解锁。默认 10000 金币；要先获得同色本体。普通图鉴只能解锁普通形态，闪光图鉴只能解锁闪光形态，各花一次。",
        "解锁后等级跟同色本体走，不能自己升级。本体是最终形态时跟它的等级；本体还没到最终形态时，获得本体就算 1 级。已解锁的按钮会变灰。",
        "分支进化不是解锁形态。例如熊徒弟集满 3 只后，会等概率变成武道熊师（一击流）或武道熊师（连击流），两只都会在伽勒尔出现。",
      ],
    },
    {
      id: "money",
      title: "金币与精灵球",
      keywords: "卖出 价格 按键 10秒 翻倍",
      paragraphs: [
        "精灵球来自活动结算：每 10 秒内有键盘、鼠标按键或滚轮，就记 10 个。精灵球翻倍会把这 10 个变成 20 个；当天签到是精灵球获取时，再 ×1.5 并向下取整。两项都在时，一个结算是 30 个。这套计数跟本机绑定，换电脑不会把按键次数带过去。",
        "最终形态被卖掉时按稀有度计价，进化后的售价是上一阶段的 2 倍，闪光再 ×5。基础单价：很常见 1、常见 2、较少见 4、稀有 10、极稀有 24、神兽 70、幻兽 160。当天金币签到会把这一笔再 ×1.5。Boss 栏位金币不吃这个倍率。",
      ],
    },
    {
      id: "save",
      title: "存档",
      keywords: "导出 导入 进度 换电脑 备份",
      paragraphs: [
        "进度写在本机的 PokemonPokedex/progress.json 里，和浏览器端口无关。商店里可以导出、导入。对话框会记住上次的位置当作默认，仍然可以改地方，确认之后才会写入。",
        "空存档不会覆盖一份已经有进度的存档。按键获得的精灵球各台电脑各自计算，跨电脑转移进度时用导出和导入。",
      ],
    },
  ];
  let helpTopic = "all";

  function helpText(section) {
    return [section.title, section.keywords, ...section.paragraphs].join("\n").toLowerCase();
  }

  function renderHelp() {
    if (!els.helpBody || !els.helpChips) return;
    const query = (els.helpQuery?.value || "").trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const visible = HELP_SECTIONS.filter((section) => {
      if (helpTopic !== "all" && section.id !== helpTopic) return false;
      if (!tokens.length) return true;
      const hay = helpText(section);
      return tokens.every((token) => hay.includes(token));
    });
    els.helpChips.innerHTML = [
      { id: "all", title: "全部" },
      ...HELP_SECTIONS.map((section) => ({ id: section.id, title: section.title })),
    ]
      .map(
        (chip) =>
          `<button type="button" class="help-chip${chip.id === helpTopic ? " is-active" : ""}" data-help="${chip.id}">${chip.title}</button>`
      )
      .join("");
    els.helpBody.innerHTML = visible.length
      ? visible
          .map(
            (section) =>
              `<section class="help-section"><h3>${section.title}</h3>${section.paragraphs
                .map((paragraph) => `<p>${paragraph}</p>`)
                .join("")}</section>`
          )
          .join("")
      : `<p class="help-empty">没有找到相关说明。换个词，或切回「全部」。</p>`;
  }

  function openHelp() {
    helpTopic = "all";
    if (els.helpQuery) els.helpQuery.value = "";
    renderHelp();
    if (els.help && !els.help.open && typeof els.help.showModal === "function") els.help.showModal();
    els.helpQuery?.focus();
  }

  if (els.btnHelp) els.btnHelp.addEventListener("click", openHelp);
  if (els.help) {
    document.getElementById("help-close")?.addEventListener("click", () => els.help.close());
    els.help.addEventListener("click", (ev) => {
      if (ev.target === els.help) els.help.close();
    });
    els.helpQuery?.addEventListener("input", renderHelp);
    els.helpChips?.addEventListener("click", (ev) => {
      const chip = ev.target.closest("[data-help]");
      if (!chip) return;
      helpTopic = chip.dataset.help || "all";
      renderHelp();
    });
  }

  function runAutoEvolve() {
    const events = [];
    let guard = 0;
    const shiny = mode === "shiny";
    while (guard++ < 800) {
      let did = false;
      for (const p of pokemon) {
        const targets = p.evolution?.evolves_to || [];
        if (!targets.length) continue;
        const times = Math.floor(getProgress(p.id).caught / 3);
        if (times < 1) continue;
        adjustCaught(p.id, -times * 3, mode);
        const counts = new Map();
        for (let i = 0; i < times; i += 1) {
          const pick = targets[Math.floor(Math.random() * targets.length)];
          counts.set(pick.id, (counts.get(pick.id) || 0) + 1);
        }
        for (const [toId, n] of counts) {
          adjustCaught(toId, n, mode);
          events.push({ from: p.id, to: toId, times: n, shiny });
        }
        did = true;
      }
      if (!did) break;
    }
    if (events.length) saveStore();
    return events;
  }

  /** Normal then shiny. Evolution never opens a dialog; callers render the events. */
  function evolveBothDexes() {
    const prev = mode;
    mode = "normal";
    const events = runAutoEvolve();
    mode = "shiny";
    events.push(...runAutoEvolve());
    mode = prev;
    return events;
  }

  function evoStatusText(p) {
    const color = mode === "shiny" ? "闪光" : "普通";
    if (isUnlockForm(p)) {
      const lv = effectiveLevel(p, mode);
      const power = combatPower(p, mode === "shiny", lv);
      const unlocked = !!getProgress(p.id, mode).seen;
      if (isFloetteEternal(p)) {
        if (!unlocked) return `特殊形态 · 未解锁 · 解锁后随同色花叶蒂升级，并同步给同色花洁夫人`;
        return `特殊形态 · 已解锁 · 随${color}花叶蒂升级 Lv.${lv} / 100 · 战力 ${power}（同步${color}花洁夫人；不能单独升级）`;
      }
      if (isFloetteMega(p)) {
        if (!unlocked) return `超级进化 · 未解锁 · 需先解锁同色花叶蒂（永恒之花），等级与同色永恒形态相同`;
        return `超级进化 · 已解锁 · 等级与${color}永恒形态相同 Lv.${lv} · 战力 ${power}（同步${color}花洁夫人；不可升级）`;
      }
      const base = byId.get(unlockBaseId(p));
      const body = base?.name_zh || "本体";
      const kind = isMega(p) ? "超级进化" : "特殊形态";
      if (!unlocked) {
        return `${kind} · 未解锁 · 等级同步自${color}${body}（当前 Lv.${lv}）· 不可升级`;
      }
      return `${kind} · 已解锁 · 等级同步自${color}${body} Lv.${lv} · 战力 ${power}（${powerTierLabel(p, mode === "shiny")}；不可升级）`;
    }
    const targets = p.evolution?.evolves_to || [];
    const prog = getProgress(p.id);
    if (!targets.length) {
      const lv = effectiveLevel(p, mode);
      const power = combatPower(p, mode === "shiny", lv);
      if (p.id === FLORGES_ID && eternalUnlocked(mode)) {
        return `最终形态 · 等级同步自${color}花叶蒂（永恒之花） Lv.${lv} / 100 · 战力 ${power}（${powerTierLabel(p, mode === "shiny")}）`;
      }
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

  function isMega(p) {
    return !!(p && (p.mega_form || (p.mega_of && !p.alt_form)));
  }

  function isUnlockForm(p) {
    return !!(p && (p.mega_form || p.alt_form || p.mega_of || p.alt_of));
  }

  function unlockBaseId(p) {
    return Number(p.mega_of || p.alt_of) || 0;
  }

  function unlockCostOf(p) {
    const n = Number(p.unlock_cost);
    if (Number.isFinite(n) && n > 0) return n;
    return MEGA_UNLOCK_COST;
  }

  function isSpecialForm(p) {
    return isUnlockForm(p);
  }

  function unlocksOf(baseId) {
    const nid = Number(baseId);
    return pokemon
      .filter((p) => {
        if (!isUnlockForm(p)) return false;
        const from = Array.isArray(p.unlock_from) ? p.unlock_from.map(Number) : [];
        if (from.length) return from.includes(nid);
        return unlockBaseId(p) === nid;
      })
      .sort((a, b) => unlockCostOf(a) - unlockCostOf(b) || a.id - b.id);
  }

  function reqLabel(id, dex) {
    const name = byId.get(id)?.name_zh || `#${id}`;
    return dexSlot(dex) === "shiny" ? `闪光${name}` : name;
  }

  function collectedInSlot(id, dex) {
    const slot = dexSlot(dex);
    const p = byId.get(Number(id));
    if (!p) return false;
    return isCollected(p, getProgress(id, slot));
  }

  function missingUnlockReqs(form, dex) {
    const slot = dexSlot(dex);
    const any = Array.isArray(form.unlock_requires_any) ? form.unlock_requires_any.map(Number) : [];
    if (any.length) {
      const ok = any.some((id) => collectedInSlot(id, slot));
      if (ok) return [];
      return any.map((id) => reqLabel(id, slot));
    }
    const req = Array.isArray(form.unlock_requires) ? form.unlock_requires.map(Number) : [];
    const need = req.length ? req : unlockBaseId(form) ? [unlockBaseId(form)] : [];
    return need.filter((id) => !collectedInSlot(id, slot)).map((id) => reqLabel(id, slot));
  }

  function isFloetteEternal(p) {
    return !!(p && (p.id === FLOETTE_ETERNAL_ID || p.identifier === "floette-eternal"));
  }

  function isFloetteMega(p) {
    return !!(p && (p.identifier === "floette-mega" || (isMega(p) && unlockBaseId(p) === FLOETTE_ETERNAL_ID)));
  }

  function eternalUnlocked(dex) {
    const slot = dexSlot(dex || mode);
    return !!store[slot]?.[String(FLOETTE_ETERNAL_ID)]?.seen;
  }

  function eternalStoredLevel(dex) {
    const slot = dexSlot(dex || mode);
    return Number(store[slot]?.[String(FLOETTE_ETERNAL_ID)]?.level) || 0;
  }

  function syncFlorgesFromEternal(dex) {
    const slot = dexSlot(dex || mode);
    if (!eternalUnlocked(slot)) return;
    const bucket = store[slot];
    const lv = eternalStoredLevel(slot);
    const key = String(FLORGES_ID);
    if (!bucket[key]) bucket[key] = emptyEntry();
    bucket[key].level = lv;
    bucket[key].caught = 0;
    if (lv > 0) bucket[key].seen = true;
  }

  function bumpEternalFromFloette(n, dex) {
    const slot = dexSlot(dex || mode);
    if (!(n > 0) || !eternalUnlocked(slot)) return;
    const bucket = store[slot];
    const key = String(FLOETTE_ETERNAL_ID);
    if (!bucket[key]) bucket[key] = emptyEntry();
    const entry = bucket[key];
    entry.seen = true;
    entry.caught = 0;
    entry.level = Math.min(100, (Number(entry.level) || 0) + n);
    syncFlorgesFromEternal(slot);
  }

  /** Level of mega_of / alt_of in the same color slot only (never the other color). */
  function hostProgressLevel(hostId, dex) {
    const slot = dexSlot(dex);
    const host = byId.get(Number(hostId));
    if (!host) return 0;
    if (isFloetteEternal(host) || isFloetteMega(host) || host.id === FLOETTE_ETERNAL_ID) {
      return eternalUnlocked(slot) ? eternalStoredLevel(slot) : 0;
    }
    if (isUnlockForm(host)) return effectiveLevel(host, slot);
    const entry = getProgress(host.id, slot);
    if (cannotEvolve(host)) return Number(entry.level) || 0;
    return isCollected(host, entry) ? 1 : 0;
  }

  function effectiveLevel(p, dex) {
    const slot = dexSlot(dex || mode);
    if (!p) return 0;
    if (isFloetteEternal(p) || isFloetteMega(p)) {
      return eternalUnlocked(slot) ? eternalStoredLevel(slot) : 0;
    }
    if (p.id === FLORGES_ID && eternalUnlocked(slot)) return eternalStoredLevel(slot);
    if (isUnlockForm(p)) return hostProgressLevel(unlockBaseId(p), slot);
    return Number(store[slot]?.[String(p.id)]?.level) || 0;
  }

  function isCollected(p, prog) {
    if (isUnlockForm(p)) return !!prog.seen;
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
   * 战力 = 种族战力 × (1 + (等级 - 1) × 成长率)
   * Lv1 = 种族战力；每升一级再 ×(1+成长率) 的累加档。
   */
  function combatPower(p, shiny, level) {
    const lv = Math.max(0, Number(level) || 0);
    if (lv < 1 || !p) return 0;
    const base = speciesCombatPower(p, shiny);
    if (!base) return 0;
    const rate = speciesLevelGrowth(p, shiny);
    return Math.round(base * (1 + (lv - 1) * rate));
  }

  function powerTierLabel(p, shiny) {
    const m = speciesPowerMult(p);
    const tier = m >= 10 ? "神兽×10" : m >= 3 ? "稀有×3" : "普通×1";
    const pct = Math.round(speciesLevelGrowth(p, !!shiny) * 100);
    return `${tier} · 每级+${pct}%`;
  }

  function totalCombatPower(dex) {
    const slot = dexSlot(dex);
    const bucket = store[slot] || {};
    const shiny = slot === "shiny";
    let sum = 0;
    for (const p of pokemon) {
      if (!cannotEvolve(p)) continue;
      if (isUnlockForm(p)) {
        const prog = bucket[String(p.id)];
        if (!prog?.seen) continue;
        sum += combatPower(p, shiny, effectiveLevel(p, slot));
        continue;
      }
      const prog = bucket[String(p.id)];
      if (!prog) continue;
      sum += combatPower(p, shiny, effectiveLevel(p, slot));
    }
    return sum;
  }

  /** 与顶栏「战力总和」相同：普通 + 闪光 */
  function teamCombatPower() {
    return totalCombatPower("normal") + totalCombatPower("shiny");
  }

  function huntPowerChange(before, after, coins) {
    const delta = after - before;
    const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : "+0";
    const coinText = `+${Math.max(0, Math.floor(Number(coins) || 0))}`;
    return `<div class="hunt-power-change">
      <span class="hunt-power-label">战力变化</span>
      <span class="hunt-power-side">
        <span class="hunt-power-values">${before} → ${after}<span class="hunt-power-delta">（${deltaText}）</span></span>
        <span class="hunt-coin-gain">金币 ${coinText}</span>
      </span>
    </div>`;
  }

  function imgPath(p) {
    const rel = mode === "shiny" ? p.image_shiny || p.image : p.image;
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
    const area = els.gen.value;
    const specialOnly = area === "special";
    const legend = els.legend?.value || "all";

    return pokemon.filter((p) => {
      if (specialOnly) {
        if (!isSpecialForm(p)) return false;
      } else if (area && area !== "0" && areaRate(p, area) <= 0) {
        return false;
      }
      if (legend === "legend" && !(p.is_legendary || p.is_mythical)) return false;

      const prog = getProgress(p.id);
      if (collect === "seen" && !prog.seen) return false;
      if (collect === "unseen" && prog.seen) return false;
      if (collect === "caught" && !isCollected(p, prog)) return false;
      if (collect === "uncaught" && isCollected(p, prog)) return false;

      if (!q) return true;
      if (q === "特殊形态" && isSpecialForm(p)) return true;
      const idStr = String(p.id);
      const idPad = idStr.padStart(3, "0");
      return (
        idStr.includes(q) ||
        idPad.includes(q) ||
        (p.name_zh || "").toLowerCase().includes(q) ||
        (p.name_en || "").toLowerCase().includes(q) ||
        (p.identifier || "").toLowerCase().includes(q) ||
        (p.regional_form || "").toLowerCase().includes(q)
      );
    });
  }

  /** 能继续进化的没有等级和战力。未点亮、Lv.0 也不进入等级 / 战力检索。 */
  function rankedLevel(p) {
    if (!cannotEvolve(p) && !isUnlockForm(p)) return 0;
    if (!getProgress(p.id).seen) return 0;
    return effectiveLevel(p, mode);
  }

  function rankedPower(p) {
    if (!cannotEvolve(p) && !isUnlockForm(p)) return 0;
    if (!getProgress(p.id).seen) return 0;
    return combatPower(p, mode === "shiny", effectiveLevel(p, mode));
  }

  function sortRetrieved(list) {
    const key = els.sort?.value || "id";
    if (key === "level-desc" || key === "level-asc") {
      const dir = key === "level-desc" ? -1 : 1;
      return list
        .filter((p) => rankedLevel(p) > 0)
        .sort((a, b) => (rankedLevel(a) - rankedLevel(b)) * dir || a.id - b.id);
    }
    if (key === "power-desc") {
      return list
        .filter((p) => rankedPower(p) > 0)
        .sort((a, b) => rankedPower(b) - rankedPower(a) || a.id - b.id);
    }
    return list.slice().sort((a, b) => a.id - b.id);
  }

  function countSeenSplit(dex) {
    const bucket = store[dex] || {};
    let regular = 0;
    let special = 0;
    let regularTotal = 0;
    let specialTotal = 0;
    for (const p of pokemon) {
      const form = isSpecialForm(p);
      if (form) specialTotal += 1;
      else regularTotal += 1;
      if (!bucket[String(p.id)]?.seen) continue;
      if (form) special += 1;
      else regular += 1;
    }
    return { regular, special, regularTotal, specialTotal };
  }

  function seenTipText(split) {
    return `普通图鉴 ${split.regular} / ${split.regularTotal} · 形态图鉴 ${split.special} / ${split.specialTotal}`;
  }

  function updateStats() {
    const total = pokemon.length || 1082;
    const normalSplit = countSeenSplit("normal");
    const shinySplit = countSeenSplit("shiny");
    els.statsSeen.textContent = `${normalSplit.regular + normalSplit.special} / ${total}`;
    if (els.statsSeenShiny) {
      els.statsSeenShiny.textContent = `${shinySplit.regular + shinySplit.special} / ${total}`;
    }
    if (els.seenTip) els.seenTip.textContent = seenTipText(normalSplit);
    if (els.seenShinyTip) els.seenShinyTip.textContent = seenTipText(shinySplit);
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
    const names = {
      catch: "捕获率×5",
      shiny: "闪光×8·捕获×2",
      legend: "神兽权重×20",
      balls: "精灵球×2",
    };
    const parts = Object.keys(names)
      .filter((id) => buffActive(id))
      .map((id) => `${names[id]} 剩余 ${formatRemain(buffUntil(id) - Date.now())}`);
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
    const start = Math.max(Date.now(), buffUntil(item.id));
    store.buffs[item.id] = start + DAY_MS;
    showToast(`${item.name}已生效，持续 24 小时`);
    saveStore();
    updateStats();
    if (view === "shop") renderShop();
    if (els.detail.open && activeId != null) openDetail(activeId);
  }

  function cannotEvolve(p) {
    return !(p?.evolution?.evolves_to || []).length;
  }

  function upgradeCost(p) {
    const shiny = mode === "shiny";
    const legend = isLegendMon(p);
    if (legend && shiny) return 10000;
    if (legend) return 5000;
    if (shiny) return 5000;
    return 3000;
  }

  function buyLevel(id) {
    const p = byId.get(id);
    if (!p || isUnlockForm(p) || !cannotEvolve(p)) return;
    if (id === FLORGES_ID && eternalUnlocked(mode)) {
      showToast("花洁夫人等级由永恒之花同步，请继续收集花叶蒂升级");
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
    const cost = upgradeCost(p);
    if ((store.coins || 0) < cost) {
      showToast("金币不够");
      return;
    }
    store.coins -= cost;
    prog.level = lv + 1;
    prog.seen = true;
    saveStore();
    showToast(`${mode === "shiny" ? "闪光" : ""}${p.name_zh} → Lv.${prog.level}`);
    renderGrid();
    if (els.detail.open) openDetail(id);
    updateStats();
  }

  function unlockForm(formId, dex) {
    const form = byId.get(formId);
    const slot = dexSlot(dex);
    if (!form || !isUnlockForm(form)) return;
    if (dexSlot(dex) !== dexSlot(mode)) {
      showToast(mode === "shiny" ? "闪光图鉴只能解锁闪光形态" : "普通图鉴只能解锁普通形态");
      return;
    }
    if (getProgress(formId, slot).seen) {
      showToast("已经解锁");
      return;
    }
    const missing = missingUnlockReqs(form, slot);
    if (missing.length) {
      showToast(`需要先获得：${missing.join("、")}`);
      return;
    }
    const cost = unlockCostOf(form);
    if ((store.coins || 0) < cost) {
      showToast("金币不够");
      return;
    }
    store.coins -= cost;
    const formProg = ensureProgress(formId, slot);
    formProg.seen = true;
    formProg.caught = 0;
    if (isFloetteEternal(form)) {
      const florgesLv = Number(getProgress(FLORGES_ID, slot).level) || 0;
      formProg.level = Math.max(Number(formProg.level) || 0, florgesLv, 1);
      syncFlorgesFromEternal(slot);
    }
    saveStore();
    showToast(`已解锁${slot === "shiny" ? "闪光" : ""}${form.name_zh}`);
    renderGrid();
    if (els.detail.open && activeId != null) openDetail(activeId);
    updateStats();
  }

  function unlockFormsForDetail(p) {
    const forms = unlocksOf(p.id);
    if (isUnlockForm(p) && !forms.some((f) => f.id === p.id)) return [p, ...forms];
    return forms;
  }

  function unlockButtonHtml(form, dex) {
    const slot = dexSlot(dex);
    const unlocked = !!getProgress(form.id, slot).seen;
    const cost = unlockCostOf(form);
    const prefix = slot === "shiny" ? "闪光" : "";
    const label = unlocked ? `已解锁${prefix}${form.name_zh}` : `解锁${prefix}${form.name_zh}（${cost} 金币）`;
    return `<button type="button" class="action mega-unlock${unlocked ? " is-unlocked" : ""}" data-form-id="${form.id}" data-dex="${slot}"${
      unlocked ? " disabled" : ""
    }>${label}</button>`;
  }

  function renderMegaUnlocks(p) {
    if (!els.megaUnlocks) return;
    const forms = unlockFormsForDetail(p);
    if (!forms.length) {
      els.megaUnlocks.innerHTML = "";
      els.megaUnlocks.hidden = true;
      return;
    }
    els.megaUnlocks.hidden = false;
    els.megaUnlocks.innerHTML = forms.map((m) => unlockButtonHtml(m, mode)).join("");
    els.megaUnlocks.querySelectorAll("[data-form-id]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        unlockForm(Number(btn.dataset.formId), btn.dataset.dex);
      });
    });
  }

  function renderShop() {
    els.shopCatalog.innerHTML = CATALOG.map((item) => {
      const price = shopPrice(item);
      const discounted = price < item.price;
      const extra =
        buffActive(item.id)
          ? `生效中，剩余 ${formatRemain(buffUntil(item.id) - Date.now())}`
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
    if (isUnlockForm(p)) return 0;
    let weight = areaRate(p, area);
    if (weight <= 0) return 0;
    if (p.is_legendary || p.is_mythical) {
      // 出现加算：各 buff 的「倍」直接相加。×20 + ×10 → ×30。
      let legendMult = 0;
      if (buffActive("legend")) legendMult += 20;
      const daily = activeDaily();
      if (daily?.kind === "legend" && daily.area === area) legendMult += 10;
      if (legendMult > 0) weight *= legendMult;
    }
    return weight;
  }

  /** 捕获加算：各 buff 的「倍」直接相加；全无则 ×1。例 ×5 + ×1.5 → ×6.5。 */
  function huntCatchMult(pick, shiny, area) {
    let m = 0;
    if (buffActive("catch")) m += 5;
    const daily = activeDaily();
    if (daily?.kind === "catch" && daily.area === area) m += 2;
    if (isLegendMon(pick)) {
      if (buffActive("legend")) m += 3;
      if (daily?.kind === "legend" && daily.area === area) m += 1.5;
    }
    if (shiny && buffActive("shiny")) m += 2;
    return m > 0 ? m : 1;
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
      if (!cannotEvolve(p) || isUnlockForm(p)) continue;
      const lv = Number(store[dex]?.[String(p.id)]?.level) || 0;
      map.set(p.id, lv);
    }
    return map;
  }

  function huntRank(a, b) {
    if (!!a.shiny !== !!b.shiny) return a.shiny ? -1 : 1;
    const legendA = isLegendMon(a.mon) ? 1 : 0;
    const legendB = isLegendMon(b.mon) ? 1 : 0;
    if (legendA !== legendB) return legendB - legendA;
    return a.id - b.id;
  }

  function huntLine(mon, shiny, tail) {
    const name = mon?.name_zh || (mon?.id != null ? `#${mon.id}` : "");
    const cls = [shiny ? "is-shiny" : "", mon && isLegendMon(mon) ? "is-legend" : ""]
      .filter(Boolean)
      .join(" ");
    return `<span class="${cls}">${shiny ? "闪光 " : ""}${name}${tail || ""}</span>`;
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
      showToast("没有精灵球");
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
    let shinyChance = BASE_SHINY * (buffActive("shiny") ? 8 : 1);
    if (daily?.kind === "shiny" && daily.area === huntArea) shinyChance *= 3;
    const chanceCache = new Map();
    const beforeNormal = seenIds("normal");
    const beforeShiny = seenIds("shiny");
    const beforePower = teamCombatPower();
    const coinsBefore = Number(store.coins) || 0;
    const beforeLevels = {
      normal: snapshotFinalLevels("normal"),
      shiny: snapshotFinalLevels("shiny"),
    };
    /** @type {Map<string, {id: number, shiny: boolean, caught: number}>} */
    const tally = new Map();
    for (let i = 0; i < count; i += 1) {
      const pick = pickFromPool(pool, total);
      const shiny = Math.random() < shinyChance;
      const catchMult = huntCatchMult(pick, shiny, huntArea);
      const cacheKey = `${pick.capture_rate}:${catchMult}`;
      let chance = chanceCache.get(cacheKey);
      if (chance == null) {
        chance = catchProbability(pick.capture_rate, catchMult, 1);
        chanceCache.set(cacheKey, chance);
      }
      if (Math.random() >= chance) continue;
      const bucket = shiny ? "shiny" : "normal";
      const key = `${bucket}:${pick.id}`;
      const row = tally.get(key) || { id: pick.id, shiny, caught: 0 };
      row.caught += 1;
      tally.set(key, row);
      adjustCaught(pick.id, 1, shiny ? "shiny" : "normal");
    }
    store.balls = owned - count;
    saveStore();
    evolveBothDexes();
    saveStore();

    const coinsGained = Math.max(0, (Number(store.coins) || 0) - coinsBefore);
    const caughtLines = [...tally.values()]
      .map((row) => ({ id: row.id, shiny: row.shiny, mon: byId.get(row.id), caught: row.caught }))
      .sort(huntRank)
      .map((row) => huntLine(row.mon, row.shiny, ` ×${row.caught}`));
    const lit = [];
    for (const [bucket, before] of [
      ["normal", beforeNormal],
      ["shiny", beforeShiny],
    ]) {
      const shiny = bucket === "shiny";
      for (const [id, prog] of Object.entries(store[bucket] || {})) {
        const num = Number(id);
        if (prog?.seen && !before.has(num)) lit.push({ id: num, shiny, mon: byId.get(num) });
      }
    }
    lit.sort(huntRank);
    const litLines = lit.map((row) => huntLine(row.mon, row.shiny));
    const upgrades = [];
    for (const dex of ["normal", "shiny"]) {
      const shiny = dex === "shiny";
      for (const p of pokemon) {
        if (!cannotEvolve(p) || isUnlockForm(p)) continue;
        const before = beforeLevels[dex].get(p.id) || 0;
        const after = Number(store[dex]?.[String(p.id)]?.level) || 0;
        if (after <= before) continue;
        upgrades.push({ id: p.id, shiny, mon: p, before, after });
      }
    }
    upgrades.sort(huntRank);
    const upgradeLines = upgrades.map((row) =>
      huntLine(row.mon, row.shiny, ` Lv.${row.before} → Lv.${row.after}`)
    );

    const afterPower = teamCombatPower();
    els.huntReportBody.innerHTML = [
      huntPowerChange(beforePower, afterPower, coinsGained),
      huntFold("抓住", caughtLines.length, caughtLines, true),
      huntFold("新点亮", litLines.length, litLines, litLines.length > 0),
      huntFold("升级记录", upgradeLines.length, upgradeLines, upgradeLines.length > 0),
    ].join("");
    if (typeof els.huntReport.showModal === "function") els.huntReport.showModal();
    updateStats();
    if (view === "dex") renderGrid();
  }

  function legendPool() {
    return pokemon.filter((p) => (p.is_legendary || p.is_mythical) && !isUnlockForm(p));
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

  /** 第 n 栏打满给 n×1000 金币（第 1 栏 1000，第 2 栏 2000…） */
  function bossBarCoins(fromBar, toBar) {
    let coins = 0;
    for (let i = fromBar; i <= toBar; i += 1) coins += i * 1000;
    return coins;
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
    const coins = gain > 0 ? bossBarCoins(claimed + 1, claimed + gain) : 0;
    if (gain > 0) {
      boss.balls = (Number(boss.balls) || 0) + gain;
      boss.ballsClaimed = claimed + gain;
    }
    if (coins > 0) store.coins = (store.coins || 0) + coins;
    boss.ballsClaimed = Math.min(BOSS_BALL_MAX, Number(boss.ballsClaimed) || 0);
    return { balls: gain, coins };
  }

  /** 中途抓住：还没打满的栏位金币一次给齐，不再发 Boss 球。 */
  function grantUnfinishedBossCoins(boss) {
    if (!boss?.caught) return 0;
    const claimed = Math.max(0, Math.min(BOSS_BALL_MAX, Number(boss.ballsClaimed) || 0));
    if (claimed >= BOSS_BALL_MAX) return 0;
    const coins = bossBarCoins(claimed + 1, BOSS_BALL_MAX);
    boss.ballsClaimed = BOSS_BALL_MAX;
    if (coins > 0) store.coins = (store.coins || 0) + coins;
    return coins;
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
          <span class="boss-cell-coin">+${(i + 1) * 1000}</span>
        </div>`;
      }).join("");
      els.bossProgress.setAttribute("aria-valuenow", String(pct));
      els.bossProgress.setAttribute("aria-valuetext", `${earned}/${BOSS_BALL_MAX}`);
    }
    if (els.bossProgressLabel) {
      els.bossProgressLabel.textContent =
        earned >= BOSS_BALL_MAX
          ? `今日 Boss 球已满 ${BOSS_BALL_MAX}/${BOSS_BALL_MAX}`
          : `进度 ${earned}/${BOSS_BALL_MAX} · 下一球 ${formatBossDamage(nextAt)}（还差 ${formatBossDamage(remain)}）${
              earned === BOSS_BALL_MAX - 1 ? " · 这颗必定抓住" : ""
            }`;
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
    const reward = syncBossBalls(boss);
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
      <p>获得 Boss 球 ${reward.balls} · 现有 ${boss.balls}</p>
      <p>打满栏位获得金币 ${reward.coins}</p>
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
    const thrownBefore = Math.max(0, (Number(boss.ballsClaimed) || 0) - owned);
    let caught = 0;
    let thrown = 0;
    let usedGuarantee = false;
    const coinsBefore = Number(store.coins) || 0;
    const beforeNormal = seenIds("normal");
    const beforeShiny = seenIds("shiny");
    for (let i = 0; i < count; i += 1) {
      thrown += 1;
      const ballNo = thrownBefore + i + 1;
      const sure = ballNo === BOSS_BALL_MAX;
      if (!sure && Math.random() >= chance) continue;
      if (sure) usedGuarantee = true;
      caught = 1;
      boss.caught = true;
      adjustCaught(p.id, 1, boss.shiny ? "shiny" : "normal");
      break;
    }
    boss.balls = owned - thrown;
    if (boss.caught) {
      boss.challengesLeft = 0;
      boss.balls = 0;
    }
    saveStore();
    evolveBothDexes();
    saveStore();
    const coinsGained = Math.max(0, (Number(store.coins) || 0) - coinsBefore);
    const catchCoins = boss.caught ? grantUnfinishedBossCoins(boss) : 0;
    if (catchCoins > 0) saveStore();
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
      <p>投掷 ${thrown} 颗 · 抓捕率约 ${(chance * 100).toFixed(2)}%（不受增益）${
        usedGuarantee ? " · 第10颗必定抓住" : ""
      }</p>
      <p>${
        caught > 0
          ? `抓住 ${name}${cannotEvolve(p) ? "（升级并自动卖出）" : ""} · 今日 Boss 结束，不可再抓${
              catchCoins > 0 ? ` · 未打完栏位金币 ${catchCoins}` : ""
            }`
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
    const list = sortRetrieved(filteredList());
    els.meta.textContent = `显示 ${list.length} / ${pokemon.length} 只 · ${
      mode === "shiny" ? "闪光" : "普通"
    }图鉴`;

    const frag = document.createDocumentFragment();
    list.forEach((p, i) => {
      const prog = getProgress(p.id);
      const btn = document.createElement("button");
      btn.type = "button";
      const frame = frameOf(p);
      btn.className = `card${prog.seen ? "" : " is-unseen"}${frame ? ` frame-${frame}` : ""}`;
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
            isUnlockForm(p)
              ? `<span class="pill${prog.seen ? " caught" : ""}">Lv.${effectiveLevel(
                  p,
                  mode
                )}</span><span class="pill${prog.seen ? " caught" : ""}">战力 ${
                  prog.seen ? combatPower(p, mode === "shiny", effectiveLevel(p, mode)) : 0
                }</span>`
              : cannotEvolve(p)
              ? `<span class="pill${effectiveLevel(p, mode) > 0 ? " caught" : ""}">Lv.${
                  effectiveLevel(p, mode)
                }</span><span class="pill${effectiveLevel(p, mode) > 0 ? " caught" : ""}">战力 ${combatPower(
                  p,
                  mode === "shiny",
                  effectiveLevel(p, mode)
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
    els.detailImg.classList.remove("frame-silver", "frame-gold", "frame-diamond");
    const frame = frameOf(p);
    if (frame) els.detailImg.classList.add(`frame-${frame}`);
    const formTag = p.mega_form
      ? " · 超级进化"
      : p.alt_form
        ? " · 特殊形态"
        : p.regional_form
          ? ` · ${p.regional_form}形态`
          : "";
    els.detailId.textContent = isUnlockForm(p)
      ? `#${String(p.id).padStart(3, "0")} · 特殊形态${p.mega_form ? " · 超级进化" : ""}`
      : `#${String(p.id).padStart(3, "0")} · 第${p.generation}世代${formTag}`;
    els.detailName.textContent = p.name_zh;
    els.detailEn.textContent = p.name_en;
    els.detailTypes.textContent = prog.seen ? typeLabel(p.types) : "属性未判明";
    const areas = p.spawn_areas || [];
    els.detailSpawns.innerHTML = isUnlockForm(p)
      ? `<p class="spawn-title">地区图鉴</p><p class="spawn-empty">${
          isMega(p) ? "超级进化" : "特殊形态"
        }不出现在探索中，需在本体详情花费金币解锁</p>`
      : areas.length
        ? `<p class="spawn-title">地区图鉴</p>${areas
            .map(
              (a) =>
                `<div class="spawn-row"><span>${a.area}</span><span>出现 ${appearPercent(p, a.area).toFixed(2)}%</span></div>`
            )
            .join("")}`
        : `<p class="spawn-title">地区图鉴</p><p class="spawn-empty">未知</p>`;
    els.detailCaught.textContent = isUnlockForm(p)
      ? `Lv.${effectiveLevel(p, mode)}（同步本体） · 战力 ${
          prog.seen ? combatPower(p, mode === "shiny", effectiveLevel(p, mode)) : 0
        }`
      : cannotEvolve(p)
        ? `Lv.${effectiveLevel(p, mode)} / 100 · 战力 ${combatPower(p, mode === "shiny", effectiveLevel(p, mode))}`
        : String(prog.caught);
    els.detailEvo.textContent = evoStatusText(p);
    if (els.btnSell) {
      els.btnSell.hidden = true;
      els.btnSell.disabled = true;
    }
    const showUpgrade = !isUnlockForm(p) && cannotEvolve(p);
    const lvNow = Number(prog.level) || 0;
    const synced = p.id === FLORGES_ID && eternalUnlocked(mode);
    if (els.btnUpgradeCard) {
      els.btnUpgradeCard.hidden = !showUpgrade;
      els.btnUpgradeCard.disabled = !showUpgrade || synced || lvNow < 1 || lvNow >= 100;
      els.btnUpgradeCard.textContent = !showUpgrade
        ? "升级"
        : synced
          ? "等级由永恒之花同步"
          : lvNow >= 100
            ? "已满级"
            : lvNow < 1
              ? "升级 · 先获得"
              : `升级 ${upgradeCost(p)} 金币`;
    }
    renderMegaUnlocks(p);

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
      [els.viewLeague, "league"],
      [els.viewFinale, "finale"],
    ];
    for (const [btn, name] of map) {
      if (!btn) continue;
      const on = view === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /** 攻方属性对守方属性的倍率。未列出的是 1 倍。 */
  const TYPE_HIT = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
  };

  const battlePick = { left: null, right: null };

  function artPath(p, shiny) {
    const rel = shiny ? p.image_shiny || p.image : p.image;
    return rel ? `../data/${rel}` : "";
  }

  function typeHit(attack, defend) {
    const row = TYPE_HIT[attack];
    if (!row || row[defend] == null) return 1;
    return row[defend];
  }

  /** 一种攻击属性对对面全部属性的倍率。 */
  function attackMultiplier(attack, defenders) {
    let mult = 1;
    for (const defend of defenders || []) mult *= typeHit(attack, defend);
    return mult;
  }

  /** 1 倍 0，2 倍 +2，4 倍 +3，1/2 −2，1/4 −3，0 倍 −4。单位是 0.1。 */
  function effectivenessTenths(mult) {
    if (mult === 0) return -4;
    if (mult === 0.25) return -3;
    if (mult === 0.5) return -2;
    if (mult === 2) return 2;
    if (mult >= 4) return 3;
    return 0;
  }

  function multiplierLabel(mult) {
    if (mult === 0) return "0倍";
    if (mult === 0.25) return "1/4";
    if (mult === 0.5) return "1/2";
    if (mult === 2) return "2倍";
    if (mult >= 4) return "4倍";
    return "1倍";
  }

  function tenthsLabel(tenths) {
    if (!tenths) return "不变";
    const sign = tenths > 0 ? "+" : "−";
    return `${sign}${(Math.abs(tenths) / 10).toFixed(1)}`;
  }

  function battleBase(p, shiny) {
    if (!p || (!cannotEvolve(p) && !isUnlockForm(p))) return { power: 0, level: 0, owned: false };
    const slot = shiny ? "shiny" : "normal";
    const level = effectiveLevel(p, slot);
    if (level >= 1) return { power: combatPower(p, shiny, level), level, owned: true };
    return { power: speciesCombatPower(p, shiny), level: 1, owned: false };
  }

  function settleSide(attacker, defender) {
    const lines = [];
    let tenths = 0;
    for (const attack of attacker.types || []) {
      const mult = attackMultiplier(attack, defender.types || []);
      const delta = effectivenessTenths(mult);
      tenths += delta;
      lines.push({ attack, mult, delta });
    }
    return { lines, tenths, factorTenths: 10 + tenths };
  }

  function findPokemon(id) {
    return pokemon.find((p) => p.id === id) || null;
  }

  const URSHIFU_IDS = new Set([892, 10191]);
  const ETERNAMAX_ID = 10190;
  const ULTRA_NECROZMA_ID = 10157;

  function leagueState() {
    if (!store.league || typeof store.league !== "object") store.league = emptyLeague();
    if (!store.league.badges) store.league.badges = {};
    if (!store.league.frames) store.league.frames = {};
    if (!store.league.cleared) store.league.cleared = {};
    if (!store.league.people) store.league.people = {};
    return store.league;
  }

  function leagueGenerations() {
    const byRegion = new Map((leagueData.generations || []).map((gen) => [gen.region, gen]));
    return AREAS.map((area) => byRegion.get(area)).filter(Boolean);
  }

  function leagueByRegion(region) {
    return (leagueData.generations || []).find((gen) => gen.region === region) || null;
  }

  function bodyInRegion(mon, region) {
    if (!mon) return false;
    if ((mon.spawn_areas || []).some((area) => area.area === region)) return true;
    return (mon.regions || []).includes(region);
  }

  function isEternamax(mon) {
    return !!mon && (mon.id === ETERNAMAX_ID || mon.identifier === "eternatus-eternamax");
  }

  function usesMegaSlot(mon) {
    return !!mon && (isMega(mon) || mon.id === ULTRA_NECROZMA_ID || mon.identifier === "necrozma-ultra");
  }

  function rosterKey(mon) {
    if (!mon) return "";
    if (URSHIFU_IDS.has(mon.id) || String(mon.identifier || "").startsWith("urshifu")) return "urshifu";
    if (isUnlockForm(mon)) {
      const base = unlockBaseId(mon);
      if (URSHIFU_IDS.has(base)) return "urshifu";
      return `species:${base}`;
    }
    return `species:${mon.id}`;
  }

  function canDraft(mon, region) {
    if (!mon || isEternamax(mon)) return false;
    if (leagueFight?.kind === "finale") return true;
    if (bodyInRegion(mon, region)) return true;
    if (!isUnlockForm(mon)) return false;
    const base = byId.get(unlockBaseId(mon));
    return !!(base && bodyInRegion(base, region));
  }

  function frameRank(tier) {
    if (tier === "diamond") return 3;
    if (tier === "gold") return 2;
    if (tier === "silver") return 1;
    return 0;
  }

  function frameOf(mon) {
    if (!mon) return "";
    const frames = store.league?.frames || {};
    const own = frames[String(mon.id)];
    if (frameRank(own)) return own;
    if (isUnlockForm(mon)) {
      const base = frames[String(unlockBaseId(mon))];
      if (frameRank(base)) return base;
    }
    return "";
  }

  function badgeTier(region, slug) {
    const tier = leagueState().badges[region]?.[slug];
    return tier === "gold" || tier === "silver" ? tier : "";
  }

  function badgeCounts(gen) {
    let silver = 0;
    let gold = 0;
    for (const gym of gen.gyms || []) {
      const tier = badgeTier(gen.region, gym.slug);
      if (tier === "gold") gold += 1;
      else if (tier === "silver") silver += 1;
    }
    return { silver, gold, total: (gen.gyms || []).length };
  }

  function regionCleared(region, modeName) {
    return !!leagueState().cleared[region]?.[modeName];
  }

  function allRegionsGold() {
    const gens = leagueGenerations();
    return gens.length > 0 && gens.every((gen) => regionCleared(gen.region, "advanced"));
  }

  function finaleTrainers() {
    return finaleData.trainers || [];
  }

  function ashTrainer() {
    return finaleData.ash || null;
  }

  function allHeroesBeaten() {
    const heroes = finaleTrainers();
    return heroes.length > 0 && heroes.every((hero) => personTier(hero.region, hero.slug) === "gold");
  }

  function isAshFight(fight = leagueFight) {
    return fight?.kind === "finale" && fight.trainers?.[0]?.slug === "hero-ash";
  }

  function ensurePetals() {
    let layer = document.getElementById("petals");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "petals";
      layer.className = "petals";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    if (layer.childElementCount) return;
    const colors = ["#ffd6e2", "#f7a8be", "#fff7f4", "#f28aa4", "#ffe4b8"];
    for (let i = 0; i < 56; i += 1) {
      const petal = document.createElement("span");
      petal.className = "petal";
      const size = 10 + (i % 5) * 3;
      petal.style.left = `${(i * 17) % 100}%`;
      petal.style.animationDelay = `${-((i * 0.73) % 16)}s`;
      petal.style.animationDuration = `${9 + (i % 8)}s`;
      petal.style.setProperty("--drift", `${(i % 2 === 0 ? -1 : 1) * (24 + (i % 5) * 14)}px`);
      petal.style.setProperty("--spin", `${i % 2 === 0 ? 280 : -320}deg`);
      petal.style.width = `${size}px`;
      petal.style.height = `${Math.round(size * 1.35)}px`;
      petal.style.background = colors[i % colors.length];
      petal.style.opacity = String(0.55 + (i % 4) * 0.1);
      layer.appendChild(petal);
    }
  }

  let petalDay = "";

  function ashWonToday() {
    return leagueState().ashDay === todayKey();
  }

  function refreshPetals() {
    ensurePetals();
    petalDay = todayKey();
    document.body.classList.toggle("is-petals", view === "dex" && ashWonToday());
  }

  function legendSpeciesKey(mon) {
    if (!mon) return "";
    let current = mon;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const linked = isUnlockForm(current) ? byId.get(unlockBaseId(current)) : null;
      const regional = byId.get(Number(current.base_species_id));
      const next = linked && linked.id !== current.id
        ? linked
        : regional && regional.id !== current.id
          ? regional
          : null;
      if (!next) break;
      current = next;
    }
    const root = current || mon;
    if (URSHIFU_IDS.has(root.id) || String(root.identifier || "").startsWith("urshifu")) return "urshifu";
    return String(root.id);
  }

  const ASH_ROSTER_ROLL = 3;

  function daySeed(extra) {
    const text = `${todayKey()}:${ASH_ROSTER_ROLL}:${extra}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let next = Math.imul(state ^ (state >>> 15), 1 | state);
      next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 当天的六只：不重复的闪光神兽。同一只只留 100 级闪光战力最高的形态，战力相同则当天随机一只。 */
  function dailyAshRoster() {
    const groups = new Map();
    for (const mon of pokemon) {
      if (!isLegendMon(mon) || !cannotEvolve(mon)) continue;
      const key = legendSpeciesKey(mon);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mon);
    }
    const reps = [];
    for (const [key, members] of groups) {
      let best = 0;
      for (const mon of members) best = Math.max(best, combatPower(mon, true, 100));
      if (best <= 0) continue;
      const tied = members
        .filter((mon) => combatPower(mon, true, 100) === best)
        .sort((a, b) => a.id - b.id);
      const rng = mulberry32(daySeed(`form:${key}`));
      reps.push(tied[Math.floor(rng() * tied.length)]);
    }
    reps.sort((a, b) => a.id - b.id);
    const rng = mulberry32(daySeed("roster"));
    for (let i = reps.length - 1; i > 0; i -= 1) {
      const swap = Math.floor(rng() * (i + 1));
      const held = reps[i];
      reps[i] = reps[swap];
      reps[swap] = held;
    }
    return reps.slice(0, 6);
  }

  function refreshFinaleNav() {
    if (!els.viewFinale) return;
    els.viewFinale.hidden = !allRegionsGold();
  }

  function gymBeaten(region, slug, modeName) {
    const tier = badgeTier(region, slug);
    if (modeName === "advanced") return tier === "gold";
    return tier === "silver" || tier === "gold";
  }

  function allGymsBeaten(gen, modeName) {
    return (gen.gyms || []).every((gym) => gymBeaten(gen.region, gym.slug, modeName));
  }

  function leagueLevel(modeName, role) {
    if (role === "finale") return 100;
    if (modeName === "advanced") {
      if (role === "champion") return 100;
      if (role === "elite") return 90;
      return 80;
    }
    if (role === "champion") return 70;
    if (role === "elite") return 60;
    return 50;
  }

  function setBadge(region, slug, tier) {
    const league = leagueState();
    if (!league.badges[region]) league.badges[region] = {};
    const rank = (value) => (value === "gold" ? 2 : value === "silver" ? 1 : 0);
    if (rank(tier) > rank(league.badges[region][slug])) league.badges[region][slug] = tier;
  }

  function personTier(region, slug) {
    const tier = leagueState().people[region]?.[slug];
    return tier === "gold" || tier === "silver" ? tier : "";
  }

  function setPerson(region, slug, tier) {
    const league = leagueState();
    if (!league.people[region]) league.people[region] = {};
    const rank = (value) => (value === "gold" ? 2 : value === "silver" ? 1 : 0);
    if (rank(tier) > rank(league.people[region][slug])) league.people[region][slug] = tier;
  }

  function personBeaten(region, slug, modeName) {
    const tier = personTier(region, slug);
    if (modeName === "advanced") return tier === "gold";
    return tier === "silver" || tier === "gold";
  }

  function allElitesBeaten(gen, modeName) {
    return (gen?.elite_four || []).every((person) => personBeaten(gen.region, person.slug, modeName));
  }

  function grantFrames(region, tier) {
    const frames = leagueState().frames;
    const want = frameRank(tier);
    let added = 0;
    let upgraded = 0;
    let kept = 0;
    if (!want) return { added, upgraded, kept };
    for (const mon of pokemon) {
      if (!bodyInRegion(mon, region)) continue;
      const key = String(mon.id);
      const have = frameRank(frames[key]);
      if (have >= want) {
        kept += 1;
        continue;
      }
      if (have > 0) upgraded += 1;
      else added += 1;
      frames[key] = tier;
    }
    return { added, upgraded, kept };
  }

  function frameGrantNote(frames, label) {
    const parts = [`${label}新加上 ${frames.added} 只`];
    if (frames.upgraded) parts.push(`原有边框升级 ${frames.upgraded} 只`);
    if (frames.kept) parts.push(`另外 ${frames.kept} 只本来就是${label.replace("边框", "")}，没有重复发放`);
    return `${parts.join("，")}。`;
  }

  /** 已经打赢的主角，补上钻石边框。后加的奖励不会要求再打一遍。 */
  function syncFinaleFrames() {
    for (const hero of finaleTrainers()) {
      if (personTier(hero.region, hero.slug) !== "gold") continue;
      grantFrames(hero.region, "diamond");
    }
  }

  function formLocked(mon, shiny) {
    if (!isUnlockForm(mon)) return false;
    return !getProgress(mon.id, shiny ? "shiny" : "normal").seen;
  }

  function draftBlockReason(mon, picks, ignoreIndex, shiny = mode === "shiny") {
    if (isEternamax(mon)) return "无极巨化无极汰那不能上场";
    if (formLocked(mon, shiny)) return "这个形态还没解锁";
    const key = rosterKey(mon);
    for (let i = 0; i < picks.length; i += 1) {
      if (i === ignoreIndex || !picks[i]) continue;
      const other = byId.get(picks[i].id);
      if (other && rosterKey(other) === key) return `和已选的${other.name_zh}是同一只`;
    }
    if (usesMegaSlot(mon)) {
      for (let i = 0; i < picks.length; i += 1) {
        if (i === ignoreIndex || !picks[i]) continue;
        const other = byId.get(picks[i].id);
        if (other && usesMegaSlot(other)) return "超级进化和究极奈克洛兹玛只能上场一只";
      }
    }
    return "";
  }

  /** 原作招牌怪，不是神兽。高级冠军只有这一只闪光。 */
  const CHAMPION_ACE = {
    blue: 18,
    "lance-champion": 149,
    steven: 376,
    cynthia: 445,
    iris: 612,
    diantha: 282,
    kukui: 727,
    leon: 6,
    volo: 445,
    geeta: 970,
  };

  /** 换掉战力最低的那一只。已在场上的神兽不动。 */
  const CHAMPION_LEGEND = {
    blue: 146,
    "lance-champion": 249,
    steven: 383,
    cynthia: 483,
    iris: 643,
    diantha: 717,
    kukui: 792,
    leon: 889,
    volo: 493,
    geeta: 1008,
  };

  function advancedRoster(trainer, level) {
    const mons = trainer.pokemon || [];
    const role = trainer.role || "gym";
    if (role !== "champion") {
      const ranked = mons
        .map((mon, index) => ({
          index,
          power: combatPower(byId.get(mon.id), false, level),
        }))
        .sort((a, b) => b.power - a.power || b.index - a.index);
      const shiny = new Set(ranked.slice(0, 2).map((row) => row.index));
      return mons.map((mon, index) => ({ id: mon.id, name: mon.name_zh, shiny: shiny.has(index) }));
    }
    const aceId = CHAMPION_ACE[trainer.slug];
    const legend = byId.get(CHAMPION_LEGEND[trainer.slug]);
    let low = -1;
    let lowPower = Infinity;
    mons.forEach((mon, index) => {
      if (aceId && mon.id === aceId) return;
      const power = combatPower(byId.get(mon.id), false, level);
      if (power < lowPower) {
        lowPower = power;
        low = index;
      }
    });
    return mons.map((mon, index) => {
      if (index === low && legend && legend.id !== mon.id) {
        return { id: legend.id, name: legend.name_zh, shiny: false };
      }
      return { id: mon.id, name: mon.name_zh, shiny: !!aceId && mon.id === aceId };
    });
  }

  function fightSlots(fight) {
    const slots = [];
    let index = 0;
    for (const trainer of fight.trainers || []) {
      const level = leagueLevel(leagueMode, trainer.role || "gym");
      const roster = leagueMode === "advanced" && trainer.role !== "finale"
        ? advancedRoster(trainer, level)
        : (trainer.pokemon || []).map((mon) => ({ id: mon.id, name: mon.name_zh, shiny: !!mon.shiny }));
      for (const mon of roster) {
        slots.push({
          index,
          trainer,
          foeId: mon.id,
          foeName: mon.name,
          foeShiny: !!mon.shiny,
          level,
        });
        index += 1;
      }
    }
    return slots;
  }

  function openLeagueFight(kind, trainers) {
    const fight = { kind, trainers, picks: [], resolved: false, won: false, summary: "" };
    fight.picks = fightSlots(fight).map(() => null);
    leagueFight = fight;
    leagueSlot = 0;
    leagueQuery = "";
    closeLeaguePicker();
    renderBattleView();
  }

  function clash(pick, foeId, level, foeShiny = false) {
    const player = byId.get(pick.id);
    const foe = byId.get(foeId);
    if (!player || !foe) return null;
    const mine = battleBase(player, !!pick.shiny);
    const foePower = combatPower(foe, !!foeShiny, level);
    const mineSettle = settleSide(player, foe);
    const foeSettle = settleSide(foe, player);
    const mineFinal = Math.round((mine.power * mineSettle.factorTenths) / 10);
    const foeFinal = Math.round((foePower * foeSettle.factorTenths) / 10);
    return {
      player,
      foe,
      mine,
      foePower,
      mineFinal,
      foeFinal,
      win: mineFinal > foeFinal,
      tie: mineFinal === foeFinal,
    };
  }

  function applyLeagueWin(gen, fight) {
    const person = fight.trainers[0];
    if (fight.kind === "finale" && person.slug === "hero-ash") {
      const league = leagueState();
      const before = league.ashDay === todayKey();
      league.ashDay = todayKey();
      refreshPetals();
      if (before) return `今天已经赢过${person.name_zh}。`;
      return `赢下了${person.name_zh}。回到图鉴，花瓣会落到今天结束。`;
    }
    if (fight.kind === "finale") {
      const before = personTier(gen.region, person.slug);
      setPerson(gen.region, person.slug, "gold");
      const frames = grantFrames(gen.region, "diamond");
      const note = frameGrantNote(frames, "钻石边框");
      if (before === "gold" && !frames.added && !frames.upgraded) return `已经赢过${person.name_zh}。`;
      if (before === "gold") return `已经赢过${person.name_zh}。${note}`;
      return `赢下了${person.name_zh}。${note}`;
    }
    const tier = leagueMode === "advanced" ? "gold" : "silver";
    const metal = tier === "gold" ? "金色" : "银色";
    if (fight.kind === "gym") {
      const before = badgeTier(gen.region, person.slug);
      setBadge(gen.region, person.slug, tier);
      const after = badgeTier(gen.region, person.slug);
      if (before === "gold" && tier === "silver") return "已经是金色徽章，不会退回银色。";
      if (before === after) return `这枚${metal}徽章之前就有了，不会重复发放。`;
      return `获得${metal}徽章。`;
    }
    const beforePerson = personTier(gen.region, person.slug);
    setPerson(gen.region, person.slug, tier);
    if (person.role !== "champion") {
      if (beforePerson === "gold" && tier === "silver") return "已经赢过高级，不会退回普通。";
      if (beforePerson === personTier(gen.region, person.slug)) return "这一档之前就赢过了。";
      return `赢下了${person.name_zh}。`;
    }
    const league = leagueState();
    if (!league.cleared[gen.region]) league.cleared[gen.region] = { normal: false, advanced: false };
    const already = !!league.cleared[gen.region][leagueMode];
    league.cleared[gen.region][leagueMode] = true;
    const frames = grantFrames(gen.region, tier);
    const parts = [
      already
        ? "这个地区这一档之前就通关了"
        : `${leagueMode === "advanced" ? "高级" : "普通"}版通关`,
    ];
    if (tier === "gold") {
      parts.push(`金色边框新加上 ${frames.added} 只，原有边框升级 ${frames.upgraded} 只`);
      if (frames.kept) parts.push(`另外 ${frames.kept} 只已经有金色边框，没有重复发放`);
    } else {
      parts.push(`银色边框新加上 ${frames.added} 只`);
      if (frames.kept) parts.push(`另外 ${frames.kept} 只已经有边框，没有重复发放`);
    }
    return `${parts.join("。")}。`;
  }

  function slotShown(fight, slot) {
    if (fight.results) return fight.results[slot.index] || null;
    const pick = fight.picks[slot.index];
    return pick ? clash(pick, slot.foeId, slot.level, slot.foeShiny) : null;
  }

  /** 同一位对手的六只，按一对一结算后的战力相加。 */
  function trainerScores(fight, slots) {
    const groups = [];
    for (const slot of slots) {
      const last = groups[groups.length - 1];
      if (!last || last.trainer !== slot.trainer) groups.push({ trainer: slot.trainer, slots: [slot] });
      else last.slots.push(slot);
    }
    return groups.map((group) => {
      let mine = 0;
      let foe = 0;
      let filled = 0;
      for (const slot of group.slots) {
        const row = slotShown(fight, slot);
        if (!row) continue;
        filled += 1;
        mine += row.mineFinal;
        foe += row.foeFinal;
      }
      const ready = filled === group.slots.length;
      return {
        trainer: group.trainer,
        slots: group.slots,
        mine,
        foe,
        filled,
        ready,
        win: ready && mine > foe,
      };
    });
  }

  function confirmLeagueFight() {
    const fight = leagueFight;
    if (!fight || fight.resolved) return;
    const gen = leagueByRegion(leagueRegion);
    const ash = isAshFight(fight);
    if (!gen && !ash) return;
    const slots = fightSlots(fight);
    if (slots.some((slot) => !fight.picks[slot.index])) {
      showToast("还没选满");
      return;
    }
    const results = slots.map((slot) => clash(fight.picks[slot.index], slot.foeId, slot.level, slot.foeShiny));
    fight.results = results;
    fight.resolved = true;
    const scores = trainerScores(fight, slots);
    const wonBlocks = scores.filter((score) => score.win).length;
    fight.won = wonBlocks === scores.length;
    if (fight.won) {
      fight.summary = applyLeagueWin(gen, fight);
    } else if (scores.length === 1) {
      fight.summary = `我方 ${scores[0].mine} · 对方 ${scores[0].foe}，总和没有更高。`;
    } else {
      fight.summary = `赢了 ${wonBlocks}/${scores.length} 人，要一次赢下全部。`;
    }
    if (fight.won) saveStore();
    renderBattleView();
  }

  function leagueEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function badgeImage(slug, tier, locked) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = `../data/images/badges/${slug}-${tier || "silver"}.png`;
    if (locked) img.className = "is-locked";
    return img;
  }

  function trainerArt(path) {
    return `../data/${path}?v=2`;
  }

  function renderLeagueHome(panel) {
    panel.append(leagueEl("h2", "", "道馆战"));
    panel.append(
      leagueEl(
        "p",
        "device-lead",
        "每种属性对对面结算一次：1 倍不变，2 倍 +0.2，4 倍 +0.3，1/2 −0.2，1/4 −0.3，0 倍 −0.4。六只一对一算完，比两边的总和，我方更高才算赢。馆主、四天王和冠军都是各自单独打。四天王都赢了才能打冠军。"
      )
    );
    const board = leagueEl("div", "league-regions");
    for (const gen of leagueGenerations()) {
      const counts = badgeCounts(gen);
      const btn = leagueEl("button", `league-region${gen.region === leagueRegion ? " is-on" : ""}`);
      btn.type = "button";
      btn.dataset.region = gen.region;
      btn.append(leagueEl("h3", "", gen.region));
      const cleared = regionCleared(gen.region, "advanced")
        ? "高级已通关"
        : regionCleared(gen.region, "normal")
          ? "普通已通关"
          : "还没通关";
      btn.append(
        leagueEl("p", "league-count", `银 ${counts.silver} · 金 ${counts.gold} · 共 ${counts.total} · ${cleared}`)
      );
      const row = leagueEl("div", "badge-row");
      for (const gym of gen.gyms || []) {
        const tier = badgeTier(gen.region, gym.slug);
        row.append(badgeImage(gym.slug, tier || "silver", !tier));
      }
      btn.append(row);
      board.append(btn);
    }
    panel.append(board);
    const gen = leagueByRegion(leagueRegion);
    if (!gen) return;
    panel.append(leagueEl("h2", "", gen.region));
    if (gen.note) panel.append(leagueEl("p", "league-note", gen.note));
    const modes = leagueEl("div", "league-modes");
    const normalBtn = leagueEl("button", `action${leagueMode === "normal" ? "" : " ghost"}`, "普通对战");
    normalBtn.type = "button";
    normalBtn.dataset.mode = "normal";
    const advancedBtn = leagueEl("button", `action${leagueMode === "advanced" ? "" : " ghost"}`, "高级对战");
    advancedBtn.type = "button";
    advancedBtn.dataset.mode = "advanced";
    const unlocked = regionCleared(gen.region, "normal");
    advancedBtn.disabled = !unlocked;
    modes.append(normalBtn, advancedBtn);
    panel.append(modes);
    panel.append(
      leagueEl(
        "p",
        "league-note",
        leagueMode === "advanced"
          ? "高级：馆主 80 级，四天王 90 级，冠军 100 级。馆主和四天王里，战力最高的两只是闪光。冠军的招牌怪是闪光，战力最低的一只换成神兽。"
          : unlocked
            ? "普通：馆主 50 级，四天王 60 级，冠军 70 级。高级对战已经解锁。"
            : "普通：馆主 50 级，四天王 60 级，冠军 70 级。普通版通关后解锁高级对战。"
      )
    );
    const gyms = leagueEl("div", "league-gyms");
    for (const gym of gen.gyms || []) {
      const tier = badgeTier(gen.region, gym.slug);
      const card = leagueEl("div", "league-gym");
      const person = leagueEl("div", "league-person");
      const portrait = document.createElement("img");
      portrait.alt = "";
      portrait.src = trainerArt(gym.image);
      const text = leagueEl("div");
      text.append(leagueEl("h3", "", `${gym.name_zh} · ${gym.office || "馆主"}`));
      const badgeName = tier === "gold" ? "金色徽章" : tier === "silver" ? "银色徽章" : "还没有徽章";
      text.append(leagueEl("p", "league-line", `${gym.type_zh || typeLabel([gym.type])} · ${badgeName}`));
      person.append(portrait, text, badgeImage(gym.slug, tier || "silver", !tier));
      card.append(person);
      const go = leagueEl("button", "action", gymBeaten(gen.region, gym.slug, leagueMode) ? "再次挑战" : "挑战");
      go.type = "button";
      go.dataset.gym = gym.slug;
      card.append(go);
      gyms.append(card);
    }
    panel.append(gyms);
    const ready = allGymsBeaten(gen, leagueMode);
    const elitesReady = allElitesBeaten(gen, leagueMode);
    panel.append(leagueEl("h3", "", "四天王与冠军"));
    panel.append(
      leagueEl(
        "p",
        "league-note",
        !ready
          ? "先打完这一档的全部馆主，才能挑战四天王。四天王都赢了，才能挑战冠军。"
          : elitesReady
            ? "四天王已经打完，可以挑战冠军。每场选六只，比这一场的总和。"
            : "四天王各自单独打。这一档四个人都赢了，才能挑战冠军。"
      )
    );
    const cup = leagueEl("div", "league-gyms");
    for (const person of [...(gen.elite_four || []), gen.champion].filter(Boolean)) {
      const beaten = person.role === "champion"
        ? personBeaten(gen.region, person.slug, leagueMode) || regionCleared(gen.region, leagueMode)
        : personBeaten(gen.region, person.slug, leagueMode);
      const championLocked = person.role === "champion" && !elitesReady;
      const card = leagueEl("div", "league-gym");
      const who = leagueEl("div", "league-person");
      const portrait = document.createElement("img");
      portrait.alt = "";
      portrait.src = trainerArt(person.image);
      const text = leagueEl("div");
      text.append(leagueEl("h3", "", `${person.name_zh} · ${person.office || ""}`));
      const state = !ready
        ? "馆主还没打完"
        : championLocked
          ? "四天王还没打完"
          : beaten
            ? "这一档已赢"
            : "还没打过";
      const kind = person.type_zh || (person.type ? typeLabel([person.type]) : "");
      text.append(leagueEl("p", "league-line", kind ? `${kind} · ${state}` : state));
      who.append(portrait, text);
      card.append(who);
      const go = leagueEl("button", "action", beaten ? "再次挑战" : "挑战");
      go.type = "button";
      go.dataset.person = person.slug;
      go.disabled = !ready || championLocked;
      card.append(go);
      cup.append(card);
    }
    panel.append(cup);
  }

  function renderLeagueFight(panel) {
    const fight = leagueFight;
    if (!fight) return;
    const gen = leagueByRegion(leagueRegion);
    const ash = isAshFight(fight);
    if (!gen && !ash) return;
    const back = leagueEl("button", "action ghost", "返回");
    back.type = "button";
    back.dataset.back = "1";
    panel.append(back);
    const title = ash
      ? fight.trainers[0].name_zh
      : `${gen.region} · ${fight.trainers[0].name_zh}`;
    panel.append(leagueEl("h2", "", title));
    if (ash) {
      panel.append(leagueEl("p", "league-note", "今天的六只都是不重复的闪光神兽，每只都是该神兽当前战力最高的形态。"));
    }
    if (fight.summary) panel.append(leagueEl("p", "league-summary", fight.summary));
    const slots = fightSlots(fight);
    const scores = trainerScores(fight, slots);
    for (const score of scores) {
      const head = leagueEl("div", "league-trainer");
      const top = leagueEl("div", "league-fight-head");
      const person = leagueEl("div", "league-person");
      const portrait = document.createElement("img");
      portrait.alt = "";
      portrait.src = trainerArt(score.trainer.image);
      const text = leagueEl("div");
      text.append(leagueEl("h3", "", `${score.trainer.name_zh} · ${score.trainer.office || ""}`));
      text.append(leagueEl("p", "league-line", ash ? `${score.slots[0].level} 级 · 闪光` : `${score.slots[0].level} 级`));
      person.append(portrait, text);
      const totalText = `总和 ${score.mine} : ${score.foe}`;
      const total = leagueEl(
        "p",
        `league-total${score.ready ? (score.win ? " is-win" : " is-loss") : ""}`,
        totalText
      );
      top.append(person, total);
      head.append(top);
      panel.append(head);
      for (const slot of score.slots) {
        const pick = fight.picks[slot.index];
        const shown = slotShown(fight, slot);
        const row = leagueEl("div", "league-slot");
        row.dataset.slot = String(slot.index);
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        if (slot.index === leagueSlot) row.classList.add("is-active");
        const mine = leagueEl("div", "league-mon");
        if (pick) {
          const mon = byId.get(pick.id);
          if (mon) {
            const img = document.createElement("img");
            img.alt = "";
            img.src = artPath(mon, !!pick.shiny);
            const text = leagueEl("div");
            const base = battleBase(mon, !!pick.shiny);
            text.append(leagueEl("p", "", `${mon.name_zh} · ${pick.shiny ? "闪光" : "普通"}`));
            text.append(
              leagueEl("p", "league-line", shown ? `${base.power} → ${shown.mineFinal}` : `战力 ${base.power}`)
            );
            mine.append(img);
            if (!fight.resolved) {
              const clear = leagueEl("button", "action league-clear", "拿下");
              clear.type = "button";
              clear.dataset.clear = String(slot.index);
              mine.append(clear);
            }
            mine.append(text);
          }
        } else {
          mine.append(leagueEl("p", "league-line", fight.resolved ? "这一格还空着" : "点这里选择"));
        }
        const vs = leagueEl("div", "league-vs", "对");
        const foeMon = byId.get(slot.foeId);
        const foe = leagueEl("div", "league-mon");
        if (foeMon) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = artPath(foeMon, !!slot.foeShiny);
          const text = leagueEl("div");
          const power = combatPower(foeMon, !!slot.foeShiny, slot.level);
          text.append(leagueEl("p", "", `${foeMon.name_zh}${slot.foeShiny ? " · 闪光" : ""}`));
          text.append(
            leagueEl(
              "p",
              "league-line",
              shown ? `${power} → ${shown.foeFinal}` : `${slot.level} 级 · 战力 ${power}`
            )
          );
          foe.append(img, text);
        } else {
          foe.append(leagueEl("p", "", slot.foeName || "对手"));
        }
        row.append(mine, vs, foe);
        panel.append(row);
      }
    }
    if (fight.resolved || !scores.every((score) => score.win)) return;
    const go = leagueEl("button", "action", "开始挑战");
    go.type = "button";
    go.dataset.confirm = "1";
    const actions = leagueEl("div", "league-actions");
    actions.append(go);
    panel.append(actions);
  }

  function litChoices(region, shiny) {
    const query = leagueQuery.trim();
    const q = query.toLowerCase();
    const rows = [];
    for (const mon of pokemon) {
      if (!canDraft(mon, region)) continue;
      if (!cannotEvolve(mon) && !isUnlockForm(mon)) continue;
      if (!getProgress(mon.id, shiny ? "shiny" : "normal").seen) continue;
      if (formLocked(mon, shiny)) continue;
      if (query && !(
        mon.name_zh.includes(query) ||
        (mon.name_en || "").toLowerCase().includes(q) ||
        String(mon.id) === q
      )) continue;
      rows.push({ mon, shiny });
    }
    rows.sort((a, b) => battleBase(b.mon, shiny).power - battleBase(a.mon, shiny).power || a.mon.id - b.mon.id);
    return rows;
  }

  function closeLeaguePicker() {
    if (els.leaguePicker?.open) els.leaguePicker.close();
  }

  function renderLeaguePicker() {
    const gen = leagueByRegion(leagueRegion);
    const fight = leagueFight;
    const list = els.leaguePickerList;
    if (!fight || !list) return;
    if (!gen && fight.kind !== "finale") return;
    if (els.leaguePickerNormal) {
      els.leaguePickerNormal.classList.toggle("is-on", !leaguePickerShiny);
      els.leaguePickerNormal.classList.toggle("ghost", leaguePickerShiny);
    }
    if (els.leaguePickerShiny) {
      els.leaguePickerShiny.classList.toggle("is-on", leaguePickerShiny);
      els.leaguePickerShiny.classList.toggle("ghost", !leaguePickerShiny);
    }
    list.replaceChildren();
    const choices = litChoices(gen?.region, leaguePickerShiny);
    if (!choices.length) {
      const empty = queryEmpty(leagueQuery)
        ? (fight.kind === "finale"
          ? "这个颜色还没有点亮、并且有战力的宝可梦。"
          : `这个颜色还没有点亮的${gen?.region || ""}宝可梦。`)
        : "没有对得上的名字。";
      list.append(leagueEl("p", "league-note", empty));
      return;
    }
    for (const { mon, shiny } of choices) {
      const reason = draftBlockReason(mon, fight.picks, leagueSlot, shiny);
      const taken = !!reason && reason.includes("同一只");
      const btn = leagueEl("button", `league-pick${reason ? " is-taken" : ""}`);
      btn.type = "button";
      btn.dataset.add = String(mon.id);
      btn.dataset.shiny = shiny ? "1" : "0";
      btn.disabled = !!reason;
      const img = document.createElement("img");
      img.alt = "";
      img.src = artPath(mon, shiny);
      const base = battleBase(mon, shiny);
      btn.append(img, leagueEl("strong", "", mon.name_zh));
      btn.append(leagueEl("span", "", typeLabel(mon.types)));
      btn.append(leagueEl("span", "", `战力 ${base.power}`));
      if (reason) btn.append(leagueEl("span", "league-pick-tag", taken ? "已选" : reason));
      list.append(btn);
    }
  }

  function queryEmpty(value) {
    return !String(value || "").trim();
  }

  function openLeaguePicker() {
    if (!leagueFight || leagueFight.resolved) return;
    const lead = document.getElementById("league-picker-lead");
    if (lead) {
      lead.textContent = leagueFight.kind === "finale"
        ? "所有世代已经点亮、并且有战力的宝可梦都可以选。还能进化的不会出现。普通和闪光分开选，同一只只能选一只。"
        : "只显示这个地区已经点亮、并且有战力的宝可梦。还能进化的不会出现。普通和闪光分开选，同一只只能选一只。";
    }
    leagueQuery = "";
    leaguePickerShiny = false;
    if (els.leaguePickerQuery) els.leaguePickerQuery.value = "";
    if (els.leaguePickerScroll) els.leaguePickerScroll.scrollTop = 0;
    renderLeaguePicker();
    if (els.leaguePicker && !els.leaguePicker.open && typeof els.leaguePicker.showModal === "function") {
      els.leaguePicker.showModal();
    }
  }

  function renderBattleView() {
    if (view === "finale") renderFinale();
    else renderLeague();
  }

  function renderFinaleHome(panel) {
    panel.append(leagueEl("h2", "", "最终挑战"));
    panel.append(
      leagueEl(
        "p",
        "device-lead",
        "十个地区的高级冠军都已经打完。每位主角带六只 100 级神兽，其中两只闪光，超级进化那只算在这两只里，究极奈克洛兹玛也算。可以选择所有世代已经点亮、并且有战力的宝可梦。六只一对一，总和更高才算赢。打赢哪个地区的主角，那个地区的宝可梦就换成钻石边框。"
      )
    );
    const board = leagueEl("div", "league-gyms");
    for (const hero of finaleTrainers()) {
      const beaten = personBeaten(hero.region, hero.slug, "advanced");
      const card = leagueEl("div", "league-gym");
      const who = leagueEl("div", "league-person");
      const portrait = document.createElement("img");
      portrait.alt = "";
      portrait.src = trainerArt(hero.image);
      const text = leagueEl("div");
      text.append(leagueEl("h3", "", hero.name_zh));
      text.append(leagueEl("p", "league-line", `${hero.office || hero.region} · ${beaten ? "已赢" : "还没打过"}`));
      who.append(portrait, text);
      card.append(who);
      const go = leagueEl("button", "action", beaten ? "再次挑战" : "挑战");
      go.type = "button";
      go.dataset.hero = hero.slug;
      card.append(go);
      board.append(card);
    }
    panel.append(board);
    const ash = ashTrainer();
    if (ash && allHeroesBeaten()) {
      const beaten = ashWonToday();
      const roster = dailyAshRoster();
      const card = leagueEl("div", "league-gym");
      const who = leagueEl("div", "league-person");
      const portrait = document.createElement("img");
      portrait.alt = "";
      portrait.src = trainerArt(ash.image);
      const text = leagueEl("div");
      text.append(leagueEl("h3", "", ash.name_zh));
      text.append(leagueEl("p", "league-line", `${ash.office || "隐藏挑战"} · ${beaten ? "今天已赢" : "今天还没打过"}`));
      if (roster.length) {
        text.append(leagueEl("p", "league-line", `今日阵容：${roster.map((mon) => mon.name_zh).join("、")}`));
      }
      text.append(
        leagueEl(
          "p",
          "league-note",
          beaten
            ? "图鉴上的落花会持续到今天结束。"
            : "六只不重复的 100 级闪光神兽，都是最终形态。不同形态只算一只，上场的是其中战力最高的形态；战力相同就当天随机一只。打赢后，图鉴落花持续到今天结束。"
        )
      );
      who.append(portrait, text);
      card.append(who);
      const go = leagueEl("button", "action", beaten ? "再次挑战" : "挑战");
      go.type = "button";
      go.dataset.hero = ash.slug;
      card.append(go);
      panel.append(card);
    }
  }

  function renderFinale() {
    refreshFinaleNav();
    const root = els.finaleRoot;
    if (!root) return;
    root.replaceChildren();
    const panel = leagueEl("div", "device-panel");
    if (!finaleTrainers().length) {
      panel.append(leagueEl("h2", "", "最终挑战"));
      panel.append(leagueEl("p", "league-note", "挑战资料还没载入。"));
    } else if (leagueFight?.kind === "finale") renderLeagueFight(panel);
    else renderFinaleHome(panel);
    root.append(panel);
  }

  function renderLeague() {
    refreshFinaleNav();
    const root = els.leagueRoot;
    if (!root) return;
    root.replaceChildren();
    const panel = leagueEl("div", "device-panel");
    if (!leagueGenerations().length) {
      panel.append(leagueEl("h2", "", "道馆战"));
      panel.append(leagueEl("p", "league-note", "道馆资料还没载入。"));
    } else if (leagueFight && leagueFight.kind !== "finale") renderLeagueFight(panel);
    else renderLeagueHome(panel);
    root.append(panel);
  }

  function onLeagueClick(event) {
    const target = event.target.closest(
      "[data-region], [data-mode], [data-gym], [data-person], [data-hero], [data-back], [data-slot], [data-add], [data-color], [data-clear], [data-confirm]"
    );
    const root = view === "finale" ? els.finaleRoot : els.leagueRoot;
    if (!target || !root || !root.contains(target)) return;
    if (target.dataset.hero === "hero-ash") {
      const ash = ashTrainer();
      if (!ash || !allHeroesBeaten()) return;
      const roster = dailyAshRoster();
      if (!roster.length) {
        showToast("今天的神兽阵容还没准备好");
        return;
      }
      leagueRegion = "";
      openLeagueFight("finale", [{
        ...ash,
        pokemon: roster.map((mon) => ({ id: mon.id, name_zh: mon.name_zh, shiny: true })),
      }]);
      return;
    }
    if (target.dataset.hero) {
      const hero = finaleTrainers().find((item) => item.slug === target.dataset.hero);
      if (!hero || !allRegionsGold()) return;
      leagueRegion = hero.region;
      openLeagueFight("finale", [hero]);
      return;
    }
    if (target.dataset.region) {
      leagueRegion = target.dataset.region;
      if (!regionCleared(leagueRegion, "normal")) leagueMode = "normal";
      leagueFight = null;
      closeLeaguePicker();
      renderLeague();
      return;
    }
    if (target.dataset.mode) {
      if (target.dataset.mode === "advanced" && !regionCleared(leagueRegion, "normal")) {
        showToast("普通版通关后才解锁高级对战");
        return;
      }
      leagueMode = target.dataset.mode === "advanced" ? "advanced" : "normal";
      leagueFight = null;
      closeLeaguePicker();
      renderLeague();
      return;
    }
    if (target.dataset.gym) {
      const gen = leagueByRegion(leagueRegion);
      const gym = (gen?.gyms || []).find((item) => item.slug === target.dataset.gym);
      if (gym) openLeagueFight("gym", [gym]);
      return;
    }
    if (target.dataset.person) {
      const gen = leagueByRegion(leagueRegion);
      if (!gen || !allGymsBeaten(gen, leagueMode)) {
        showToast("先打完这一档的全部馆主");
        return;
      }
      const person = [...(gen.elite_four || []), gen.champion]
        .filter(Boolean)
        .find((item) => item.slug === target.dataset.person);
      if (!person) return;
      if (person.role === "champion" && !allElitesBeaten(gen, leagueMode)) {
        showToast("先打完这一档的四天王");
        return;
      }
      if (person) openLeagueFight(person.role || "elite", [person]);
      return;
    }
    if (target.dataset.back) {
      leagueFight = null;
      closeLeaguePicker();
      renderBattleView();
      return;
    }
    if (target.dataset.confirm) {
      closeLeaguePicker();
      confirmLeagueFight();
      return;
    }
    if (target.dataset.add) {
      chooseLeaguePick(Number(target.dataset.add), target.dataset.shiny === "1");
      return;
    }
    if (target.dataset.clear != null && target.dataset.clear !== "") {
      const index = Number(target.dataset.clear);
      if (!leagueFight || leagueFight.resolved) return;
      leagueFight.picks[index] = null;
      leagueSlot = index;
      renderBattleView();
      return;
    }
    if (target.dataset.color) {
      const index = Number(target.dataset.slot);
      if (!leagueFight || leagueFight.resolved || !leagueFight.picks[index]) return;
      const shiny = target.dataset.color === "1";
      const picked = byId.get(leagueFight.picks[index].id);
      if (picked && formLocked(picked, shiny)) {
        showToast("这个颜色的形态还没解锁");
        return;
      }
      leagueFight.picks[index] = { ...leagueFight.picks[index], shiny };
      leagueSlot = index;
      renderBattleView();
      return;
    }
    if (target.dataset.slot != null && !leagueFight?.resolved) {
      leagueSlot = Number(target.dataset.slot);
      renderBattleView();
      openLeaguePicker();
    }
  }

  function chooseLeaguePick(id, shiny) {
    const gen = leagueByRegion(leagueRegion);
    const fight = leagueFight;
    const mon = byId.get(Number(id));
    if (!fight || fight.resolved || !mon) return;
    if (fight.kind !== "finale" && !gen) return;
    if (!canDraft(mon, gen?.region)) return;
    if (!cannotEvolve(mon) && !isUnlockForm(mon)) return;
    if (!getProgress(mon.id, shiny ? "shiny" : "normal").seen) return;
    const reason = draftBlockReason(mon, fight.picks, leagueSlot, shiny);
    if (reason) {
      showToast(reason.includes("同一只") ? "已选" : reason);
      return;
    }
    fight.picks[leagueSlot] = { id: mon.id, shiny };
    const next = fightSlots(fight).find((slot) => !fight.picks[slot.index]);
    leagueSlot = next ? next.index : leagueSlot;
    closeLeaguePicker();
    renderBattleView();
  }

  function showDex() {
    view = "dex";
    setViewButtons();
    els.shop.hidden = true;
    els.explore.hidden = true;
    els.league.hidden = true;
    if (els.finale) els.finale.hidden = true;
    els.grid.hidden = false;
    els.meta.hidden = false;
    els.filters.hidden = false;
    els.title.textContent = mode === "shiny" ? "闪光图鉴" : "普通图鉴";
    closeLeaguePicker();
    renderGrid();
    refreshPetals();
  }

  function showShop() {
    view = "shop";
    setViewButtons();
    els.shop.hidden = false;
    els.explore.hidden = true;
    els.league.hidden = true;
    if (els.finale) els.finale.hidden = true;
    els.grid.hidden = true;
    els.meta.hidden = true;
    els.filters.hidden = true;
    els.title.textContent = "商店";
    closeLeaguePicker();
    renderShop();
    refreshPetals();
  }

  function showExplore() {
    view = "explore";
    setViewButtons();
    els.shop.hidden = true;
    els.explore.hidden = false;
    els.league.hidden = true;
    if (els.finale) els.finale.hidden = true;
    els.grid.hidden = true;
    els.meta.hidden = true;
    els.filters.hidden = true;
    els.title.textContent = "探索";
    closeLeaguePicker();
    renderExplore();
    refreshPetals();
  }

  function showLeague() {
    view = "league";
    setViewButtons();
    els.shop.hidden = true;
    els.explore.hidden = true;
    els.league.hidden = false;
    if (els.finale) els.finale.hidden = true;
    els.grid.hidden = true;
    els.meta.hidden = true;
    els.filters.hidden = true;
    els.title.textContent = "道馆战";
    renderLeague();
    refreshPetals();
  }

  function showFinale() {
    if (!allRegionsGold()) {
      refreshFinaleNav();
      showToast("十个地区的高级冠军都打完，才会出现");
      return;
    }
    view = "finale";
    setViewButtons();
    els.shop.hidden = true;
    els.explore.hidden = true;
    els.league.hidden = true;
    if (els.finale) els.finale.hidden = false;
    els.grid.hidden = true;
    els.meta.hidden = true;
    els.filters.hidden = true;
    els.title.textContent = "最终挑战";
    closeLeaguePicker();
    renderFinale();
    refreshPetals();
  }

  els.viewShop.addEventListener("click", () => showShop());
  els.viewExplore.addEventListener("click", () => showExplore());
  els.viewLeague.addEventListener("click", () => showLeague());
  if (els.viewFinale) els.viewFinale.addEventListener("click", () => showFinale());
  els.leagueRoot.addEventListener("click", onLeagueClick);
  if (els.finaleRoot) els.finaleRoot.addEventListener("click", onLeagueClick);
  els.leaguePicker.addEventListener("click", (event) => {
    if (event.target.closest("#league-picker-close")) {
      closeLeaguePicker();
      return;
    }
    const color = event.target.closest("[data-picker-color]");
    if (color) {
      leaguePickerShiny = color.dataset.pickerColor === "1";
      if (els.leaguePickerScroll) els.leaguePickerScroll.scrollTop = 0;
      renderLeaguePicker();
      return;
    }
    const pick = event.target.closest("[data-add]");
    if (!pick || pick.disabled) return;
    chooseLeaguePick(Number(pick.dataset.add), pick.dataset.shiny === "1");
  });
  els.leaguePickerQuery.addEventListener("input", () => {
    leagueQuery = els.leaguePickerQuery.value;
    renderLeaguePicker();
  });
  if (els.btnSellAll) els.btnSellAll.hidden = true;
  if (els.btnSell) els.btnSell.hidden = true;
  if (els.btnUpgradeCard) {
    els.btnUpgradeCard.addEventListener("click", (e) => {
      e.preventDefault();
      if (activeId != null) buyLevel(activeId);
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
  els.sort.addEventListener("change", renderGrid);

  async function syncKeyBalls() {
    let changed = false;
    try {
      const res = await fetch("../data/key_presses.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const presses = Math.max(0, Math.floor(Number(data.presses) || 0));
        const cursor = Math.max(0, Math.floor(Number(store.ballCursor) || 0));
        if (freshAccount && cursor <= 0) {
          // Fresh localStorage with no cursor yet: baseline (no backlog grant).
          // Fixes Win installs where LOCALAPPDATA key_presses.json still has a huge count.
          // A restored save already has ballCursor > 0; those presses still become balls
          // after the window was closed.
          store.ballCursor = presses;
          freshAccount = false;
          changed = true;
        } else if (presses > cursor) {
          freshAccount = false;
          let gained = presses - cursor;
          if (buffActive("balls")) gained *= 2;
          if (activeDaily()?.kind === "balls") gained = Math.floor(gained * 1.5);
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

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb"));
    });
  }

  async function idbGet(key) {
    try {
      const db = await openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function idbSet(key, value) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // ignore
    }
  }

  async function idbDel(key) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // ignore
    }
  }

  async function loadSavePrefs() {
    try {
      const res = await fetch(PREFS_URL, { cache: "no-store" });
      if (!res.ok) return {};
      const j = await res.json();
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }

  async function putSavePrefs(prefs) {
    try {
      await fetch(PREFS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
    } catch {
      // ignore
    }
  }

  function shortPathLabel(path) {
    if (!path) return "";
    const s = String(path);
    if (s.length <= 64) return s;
    return `…${s.slice(-60)}`;
  }

  async function refreshSavePathLabel() {
    if (!els.savePathLabel) return;
    const handle = await idbGet("export");
    const prefs = await loadSavePrefs();
    let label = "";
    if (handle && handle.name) label = handle.name;
    else if (prefs.exportFile) label = shortPathLabel(prefs.exportFile);
    else if (prefs.exportLabel) label = prefs.exportLabel;
    els.savePathLabel.textContent = label
      ? `上次导出：${label}（下次仍可改）`
      : "上次导出：尚未选择";
  }

  async function writeViaFileHandle(handle, text) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function ensureHandlePermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") return false;
    let perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") return true;
    if (typeof handle.requestPermission === "function") {
      perm = await handle.requestPermission({ mode: "readwrite" });
    }
    return perm === "granted";
  }

  function downloadSaveFallback(text, name) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportSave() {
    const text = JSON.stringify(snapshotLocal(true), null, 2);
    const prefs = await loadSavePrefs();
    const defaultName =
      (prefs.exportFile && String(prefs.exportFile).split(/[/\\]/).pop()) ||
      prefs.exportLabel ||
      `pokedex-save-${todayKey()}.json`;

    /* Always show a picker; remembered path is only a default. User must confirm.
       The snapshot is the POST body. A current launcher writes those exact bytes
       after the dialog (and reports bytes). An older launcher only returns the
       path, so we PUT the same text and refuse a 0-byte result. */
    const saveBytes = new TextEncoder().encode(text).length;
    try {
      const res = await fetch(PICK_EXPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (res.ok) {
        const j = await res.json();
        if (j.cancelled) {
          showToast("已取消导出");
          return;
        }
        if (j.ok && j.exportFile && Number(j.bytes) === saveBytes) {
          await idbDel("export");
          showToast(`已导出到 ${shortPathLabel(j.exportFile)}`);
          await refreshSavePathLabel();
          return;
        }
        if (j.ok && j.exportFile && j.bytes == null) {
          const put = await fetch(BACKUP_URL, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: text,
          });
          let written = {};
          if (put.ok) written = await put.json().catch(() => ({}));
          if (put.ok && (written.bytes == null || Number(written.bytes) === saveBytes)) {
            await idbDel("export");
            showToast(`已导出到 ${shortPathLabel(j.exportFile)}`);
            await refreshSavePathLabel();
            return;
          }
          showToast("导出失败：没有写入存档");
          return;
        }
        if (j.exportFile || j.error === "empty") {
          showToast("导出失败：没有写入存档");
          return;
        }
      }
    } catch (err) {
      console.warn(err);
    }

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const opts = {
          suggestedName: defaultName,
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        };
        const prev = await idbGet("export");
        if (prev) opts.startIn = prev;
        const handle = await window.showSaveFilePicker(opts);
        await writeViaFileHandle(handle, text);
        await idbSet("export", handle);
        const next = await loadSavePrefs();
        next.exportLabel = handle.name;
        delete next.exportFile;
        await putSavePrefs(next);
        showToast(`已导出到 ${handle.name}`);
        await refreshSavePathLabel();
        return;
      } catch (err) {
        if (err && err.name === "AbortError") {
          showToast("已取消导出");
          return;
        }
        console.warn(err);
      }
    }

    downloadSaveFallback(text, defaultName);
    showToast("存档已下载（未能弹出确认框）");
    await refreshSavePathLabel();
  }

  async function applyImportedText(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("bad save");
    applyProgressPayload(parsed, { baselinePresses: true, replaceLeague: true });
    omitBaseOnce = true;
    replaceProgressOnce = true;
    saveStore();
    ensureBossDay();
    claimDailyIfNeeded();
    convertFinalStock();
    runAutoEvolve();
    updateStats();
    renderBuffs();
    if (view === "dex") renderGrid();
    if (view === "shop") renderShop();
    if (view === "explore") renderExplore();
    if (view === "league") renderLeague();
    if (view === "finale") renderFinale();
    refreshFinaleNav();
    await syncKeyBalls();
  }

  async function importSaveFile(file) {
    try {
      const text = await file.text();
      await applyImportedText(text);
      showToast("存档已导入");
    } catch (err) {
      console.error(err);
      showToast("导入失败：文件无效");
    }
  }

  async function importSave() {
    try {
      const res = await fetch(PICK_IMPORT_URL, { method: "POST" });
      if (res.ok) {
        const j = await res.json();
        if (j.cancelled) {
          showToast("已取消导入");
          return;
        }
        if (j.ok && typeof j.text === "string") {
          await applyImportedText(j.text);
          showToast(j.importFile ? `已从 ${shortPathLabel(j.importFile)} 导入` : "存档已导入");
          await refreshSavePathLabel();
          return;
        }
      }
    } catch (err) {
      console.warn(err);
    }

    if (typeof window.showOpenFilePicker === "function") {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
        const file = await handle.getFile();
        await idbSet("import", handle);
        await importSaveFile(file);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") {
          showToast("已取消导入");
          return;
        }
        console.warn(err);
      }
    }

    if (els.importSaveFile) els.importSaveFile.click();
  }

  async function boot() {
    try {
      // Fresh-start builds: drop older save keys; do not migrate progress.
      localStorage.removeItem("pokedex-progress-v1");
      localStorage.removeItem("pokedex-progress-v2");
      localStorage.removeItem("pokedex-progress-v3");
      localStorage.removeItem("pokedex-progress-v4");
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pokemon = await res.json();
      pokemon.sort((a, b) => a.id - b.id);
      byId = new Map(pokemon.map((p) => [p.id, p]));
      try {
        const leagueRes = await fetch(LEAGUE_URL, { cache: "no-store" });
        if (leagueRes.ok) leagueData = await leagueRes.json();
      } catch (err) {
        console.warn(err);
      }
      try {
        const finaleRes = await fetch(FINALE_URL, { cache: "no-store" });
        if (finaleRes.ok) finaleData = await finaleRes.json();
      } catch (err) {
        console.warn(err);
      }
      // Disk file is source of truth (port-independent). Else migrate localStorage → file.
      const fromFile = await loadProgressFromFile();
      if (!fromFile && !isStoreEmpty(store)) {
        // First run after upgrade: flush browser cache into progress.json.
        await pushProgressFile();
      }
      const freshDaily = claimDailyIfNeeded();
      ensureBossDay();
      const converted = convertFinalStock();
      saveStore();
      runAutoEvolve();
      syncFinaleFrames();
      refreshFinaleNav();
      renderGrid();
      refreshPetals();
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
      setInterval(() => {
        if (todayKey() === petalDay) return;
        const midAsh = leagueFight?.trainers?.[0]?.slug === "hero-ash";
        refreshPetals();
        if (view === "finale" && !midAsh) renderFinale();
      }, 1000);
      refreshSavePathLabel();
    } catch (err) {
      els.meta.textContent =
        "无法加载图鉴数据。请在项目根目录运行：python3 -m http.server 8080 后访问 /pokedex/";
      console.error(err);
    }
  }

  if (els.btnExportSave) els.btnExportSave.addEventListener("click", () => exportSave());
  if (els.btnImportSave) els.btnImportSave.addEventListener("click", () => importSave());
  if (els.importSaveFile) {
    els.importSaveFile.addEventListener("change", () => {
      const file = els.importSaveFile.files?.[0];
      els.importSaveFile.value = "";
      if (file) importSaveFile(file);
    });
  }

  boot();
})();
