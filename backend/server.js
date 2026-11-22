
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// CORS
// =====================================

app.use((req, res, next) => {
  const allowedOrigins = [
    "https://onlybosstips.onrender.com"
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "1mb" }));

// =====================================
// SUPABASE CONFIGURATION
// =====================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

let supabase = null;

if (supabaseUrl && supabaseSecretKey) {
  supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

// =====================================
// SPORTAPI CONFIGURATION
// =====================================

const sportApiKey = process.env.SPORTAPI_KEY;
const sportApiUrl = "https://sportapi.ai/api";

async function sportApiRequest(endpoint) {
  if (!sportApiKey) {
    throw new Error("SPORTAPI_KEY is missing in Render.");
  }

  const response = await fetch(`${sportApiUrl}${endpoint}`, {
    method: "GET",
    headers: {
      "X-Api-Key": sportApiKey
    },
    signal: AbortSignal.timeout(20000)
  });

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `SportAPI returned invalid JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      `SportAPI HTTP ${response.status}: ${
        data.message || JSON.stringify(data.error || "Request failed")
      }`
    );
  }

  return data;
}

// =====================================
// GENERAL HELPERS
// =====================================

function normalizeTeam(name) {
  const value = String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

  const aliases = {
    // Manchester United
    manutd: "manchesterunited",
    manutdfootball: "manchesterunited",
    manunited: "manchesterunited",
    manchesterutd: "manchesterunited",
    manchesterunitedfc: "manchesterunited",

    // Manchester City
    mancity: "manchestercity",
    manchestercityfc: "manchestercity",

    // Liverpool
    liverpoolfc: "liverpool",
    lfc: "liverpool",

    // Arsenal
    arsenalfc: "arsenal",

    // Chelsea
    chelseafc: "chelsea",

    // Tottenham
    spurs: "tottenhamhotspur",
    tottenhamhotspurfc: "tottenhamhotspur",

    // Newcastle
    newcastleunitedfc: "newcastleunited",
    nufc: "newcastleunited",

    // Paris Saint-Germain
    psg: "parissaintgermain",
    parissaintgermainfc: "parissaintgermain",

    // Atletico Madrid
    atleticomadrid: "atleticodemadrid",
    atleticodemadridfc: "atleticodemadrid",

    // Inter Milan
    inter: "internazionale",
    intermilan: "internazionale",
    fcinternazionale: "internazionale",

    // AC Milan
    acmilan: "milan",

    // Juventus
    juventusfc: "juventus",

    // Bayern Munich
    bayernmunich: "bayernmunchen",
    fcbayernmunchen: "bayernmunchen",

    // Barcelona
    fcbarcelona: "barcelona",

    // Real Madrid
    realmadridcf: "realmadrid",

    // Borussia Dortmund
    dortmund: "borussiadortmund",
    bvb: "borussiadortmund"
  };

  if (aliases[value]) {
    return aliases[value];
  }

  return value.replace(
    /(footballclub|soccerclub|club|women|ladies|fc|cf|afc|sc)$/g,
    ""
  );
}

function teamMatches(first, second) {
  const a = normalizeTeam(first);
  const b = normalizeTeam(second);

  if (!a || !b) return false;

  // Exact canonical matching is safer than substring matching.
  // It helps prevent one team being mistaken for another.
  return a === b;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_–—]/g, " ")
    .replace(/[^a-z0-9.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finalStatus(status) {
  return ["FT", "AET", "PENS"].includes(
    String(status || "").trim().toUpperCase()
  );
}

function voidStatus(status) {
  return [
    "POSTPONED",
    "CANCELLED",
    "CANCELED"
  ].includes(String(status || "").trim().toUpperCase());
}

function kickoffDate(value) {
  const time = new Date(value);

  if (!Number.isFinite(time.getTime())) {
    return null;
  }

  return time.toISOString().slice(0, 10);
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00.000Z`);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// =====================================
// 1UP / 2UP MARKET HELPERS
// =====================================

// These markets require the match goal timeline.
// Final score alone cannot prove whether a team
// led by one or two goals at any point.

function isOneUpTwoUpMarket(prediction) {
  const market = normalizedText(
    `${prediction.market_type || ""} ${prediction.market_category || ""}`
  );

  return /\b(1up|2up)\b/.test(market);
}

function getOneUpTwoUpDetails(prediction) {
  const marketType = normalizedText(prediction.market_type);
  const selection = normalizedText(prediction.market_selection);
  const predictionText = normalizedText(prediction.prediction);

  const combined = `${marketType} ${selection} ${predictionText}`;

  const requiredLead = /\b2up\b/.test(combined) ? 2 :
    /\b1up\b/.test(combined) ? 1 : null;

  if (!requiredLead) return null;

  let side = null;

  if (/\b(home|home team)\b/.test(marketType)) {
    side = "home";
  } else if (/\b(away|away team)\b/.test(marketType)) {
    side = "away";
  } else if (/\b(home|home team)\b/.test(selection)) {
    side = "home";
  } else if (/\b(away|away team)\b/.test(selection)) {
    side = "away";
  } else if (
    prediction.home_team &&
    selection &&
    teamMatches(selection, prediction.home_team)
  ) {
    side = "home";
  } else if (
    prediction.away_team &&
    selection &&
    teamMatches(selection, prediction.away_team)
  ) {
    side = "away";
  }

  if (!side) return null;

  return {
    requiredLead,
    side
  };
}

// Converts SportAPI goal events into a verified result.
// Returns "won", "lost", or null if the event timeline
// cannot be safely verified against the final score.

function settleOneUpTwoUpMarket(prediction, fixture, eventsResponse) {
  const market = getOneUpTwoUpDetails(prediction);

  if (!market) return null;

  const finalHome = safeNumber(fixture.home_score);
  const finalAway = safeNumber(fixture.away_score);

  if (finalHome === null || finalAway === null) {
    return null;
  }

  let events = [];

  if (Array.isArray(eventsResponse)) {
    events = eventsResponse;
  } else if (eventsResponse && Array.isArray(eventsResponse.data)) {
    events = eventsResponse.data;
  } else if (
    eventsResponse &&
    eventsResponse.data &&
    Array.isArray(eventsResponse.data.data)
  ) {
    events = eventsResponse.data.data;
  } else {
    return null;
  }

  const goals = [];

  for (let index = 0; index < events.length; index++) {
    const event = events[index];

    if (!event) continue;

    const eventType = normalizedText(event.event_type || event.type);

    if (eventType !== "goal") continue;

    const side = String(event.team_side || "")
      .trim()
      .toLowerCase();

    if (side !== "home" && side !== "away") {
      return null;
    }

    const minuteText = String(event.minute || "").trim();
    const minuteMatch = minuteText.match(/^(\d+)(?:\s*\+\s*(\d+))?/);

    if (!minuteMatch) {
      return null;
    }

    const minute = Number(minuteMatch[1]);
    const added = Number(minuteMatch[2] || 0);

    if (!Number.isFinite(minute) || !Number.isFinite(added)) {
      return null;
    }

    goals.push({
      side,
      order: minute * 1000 + added,
      originalIndex: index
    });
  }

  goals.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.originalIndex - b.originalIndex;
  });

  let homeGoals = 0;
  let awayGoals = 0;
  let achievedLead = false;

  for (const goal of goals) {
    if (goal.side === "home") {
      homeGoals++;
    } else {
      awayGoals++;
    }

    const selectedTeamLead = market.side === "home"
      ? homeGoals - awayGoals
      : awayGoals - homeGoals;

    if (selectedTeamLead >= market.requiredLead) {
      achievedLead = true;
    }
  }

  // Do not settle if the events do not reconcile with
  // the final match score. This protects against missing
  // events and incomplete SportAPI event data.

  if (
    homeGoals !== finalHome ||
    awayGoals !== finalAway
  ) {
    return null;
  }

  return achievedLead ? "won" : "lost";
}

// =====================================
// AUTOMATIC MARKET SETTLEMENT
// =====================================

// Returns:
// "won", "lost", "void", or null.
//
// Null means the market is not supported by
// the available verified match data.
// It must remain pending.

function settleScoreMarket(prediction, fixture) {
  const home = safeNumber(fixture.home_score);
  const away = safeNumber(fixture.away_score);

  if (home === null || away === null) {
    return null;
  }

  const htHome = safeNumber(fixture.ht_home);
  const htAway = safeNumber(fixture.ht_away);

  const selection = normalizedText(prediction.market_selection);
  const marketType = normalizedText(
    prediction.market_type || prediction.market_category
  );
  const category = normalizedText(prediction.market_category);
  const predictionText = normalizedText(prediction.prediction);
  const combined = `${marketType} ${selection} ${predictionText}`;

  const line =
    safeNumber(prediction.market_line) ??
    (() => {
      const match = combined.match(/\b(over|under)\s*(\d+(?:\.\d+)?)/);
      return match ? Number(match[2]) : null;
    })();

  const homeWin = home > away;
  const awayWin = away > home;
  const draw = home === away;
  const totalGoals = home + away;

  function overUnder(value) {
    if (line === null) return null;

    if (/\bover\b/.test(selection) || /\bover\b/.test(marketType)) {
      if (value === line) return "void";
      return value > line ? "won" : "lost";
    }

    if (/\bunder\b/.test(selection) || /\bunder\b/.test(marketType)) {
      if (value === line) return "void";
      return value < line ? "won" : "lost";
    }

    return null;
  }

  function selectedSide(homeResult, drawResult, awayResult) {
    const sideText = `${marketType} ${selection} ${predictionText}`;

    if (/\b(home|home team)\b/.test(sideText) || /\b1\b/.test(selection)) {
      return homeResult;
    }

    if (/\b(draw|tie)\b/.test(sideText) || /\bx\b/.test(selection)) {
      return drawResult;
    }

    if (/\b(away|away team)\b/.test(sideText) || /\b2\b/.test(selection)) {
      return awayResult;
    }

    return null;
  }

  // -------------------------------------
  // FULL-TIME MATCH RESULT
  // -------------------------------------

  if (
    /full time result|match result|1x2/.test(marketType) ||
    category === "match result"
  ) {
    if (/draw no bet/.test(marketType)) {
      if (draw) return "void";

      return selectedSide(
        homeWin ? "won" : "lost",
        null,
        awayWin ? "won" : "lost"
      );
    }

    if (/winning margin/.test(marketType)) {
      if (/home/.test(selection)) return homeWin ? "won" : "lost";
      if (/away/.test(selection)) return awayWin ? "won" : "lost";
    }

    if (/home win to nil/.test(combined)) {
      return homeWin && away === 0 ? "won" : "lost";
    }

    if (/away win to nil/.test(combined)) {
      return awayWin && home === 0 ? "won" : "lost";
    }

    return selectedSide(
      homeWin ? "won" : "lost",
      draw ? "won" : "lost",
      awayWin ? "won" : "lost"
    );
  }

  // -------------------------------------
  // DOUBLE CHANCE
  // -------------------------------------

  if (
    category === "double chance" ||
    /double chance/.test(marketType)
  ) {
    if (/home or draw|1x/.test(selection)) {
      return homeWin || draw ? "won" : "lost";
    }

    if (/draw or away|x2/.test(selection)) {
      return draw || awayWin ? "won" : "lost";
    }

    if (/home or away|12/.test(selection)) {
      return homeWin || awayWin ? "won" : "lost";
    }
  }

  // -------------------------------------
  // BOTH TEAMS TO SCORE
  // -------------------------------------

  if (
    category === "both teams to score" ||
    /both teams to score|btts/.test(marketType)
  ) {
    const bothScored = home > 0 && away > 0;

    // Check all relevant prediction fields because
    // the selection may be stored as GG or NG in
    // market_selection, prediction, market_type,
    // or market_category.

    const bttsText = normalizedText(
      `${prediction.market_selection || ""} ${
        prediction.prediction || ""
      } ${prediction.market_type || ""} ${
        prediction.market_category || ""
      }`
    );

    // GG = Both Teams to Score YES.
    // NG = Both Teams to Score NO.

    const isYes = /\b(yes|gg)\b/.test(bttsText);
    const isNo = /\b(no|ng)\b/.test(bttsText);

    if (
      /btts and over 2 5|both teams to score and over 2 5/.test(combined)
    ) {
      return bothScored && totalGoals > 2.5
        ? "won"
        : "lost";
    }

    if (
      /btts and under 2 5|both teams to score and under 2 5/.test(combined)
    ) {
      return bothScored && totalGoals < 2.5
        ? "won"
        : "lost";
    }

    if (isYes && !isNo) {
      return bothScored ? "won" : "lost";
    }

    if (isNo && !isYes) {
      return !bothScored ? "won" : "lost";
    }

    // Unknown or conflicting selections remain pending.
    return null;
  }

  // -------------------------------------
  // TOTAL GOALS
  // -------------------------------------

  if (/total goals over under/.test(marketType)) {
    return overUnder(totalGoals);
  }

  if (/home team goals over under/.test(marketType)) {
    return overUnder(home);
  }

  if (/away team goals over under/.test(marketType)) {
    return overUnder(away);
  }

  if (/exact total goals/.test(marketType)) {
    const exact = safeNumber(
      prediction.market_line ?? prediction.market_selection
    );

    if (exact === null) return null;

    return totalGoals === exact ? "won" : "lost";
  }

  // -------------------------------------
  // TEAM TO SCORE / CLEAN SHEET
  // -------------------------------------

  if (/home team to score/.test(combined)) {
    return home > 0 ? "won" : "lost";
  }

  if (/away team to score/.test(combined)) {
    return away > 0 ? "won" : "lost";
  }

  if (/home clean sheet/.test(combined)) {
    return away === 0 ? "won" : "lost";
  }

  if (/away clean sheet/.test(combined)) {
    return home === 0 ? "won" : "lost";
  }

  if (/home win by 2 or more/.test(combined)) {
    return home - away >= 2 ? "won" : "lost";
  }

  if (/away win by 2 or more/.test(combined)) {
    return away - home >= 2 ? "won" : "lost";
  }

  if (/home win by 1 goal/.test(combined)) {
    return home - away === 1 ? "won" : "lost";
  }

  if (/away win by 1 goal/.test(combined)) {
    return away - home === 1 ? "won" : "lost";
  }

  if (/match to have no goals/.test(combined)) {
    return totalGoals === 0 ? "won" : "lost";
  }

  // -------------------------------------
  // CORRECT SCORE - FULL TIME
  // -------------------------------------

  if (/correct score.*(full time|home win|draw|away win)/.test(marketType)) {
    const scoreText = selection || predictionText;
    const scoreMatch = scoreText.match(/\b(\d+)\s*[-:]\s*(\d+)\b/);

    if (scoreMatch) {
      return (
        home === Number(scoreMatch[1]) &&
        away === Number(scoreMatch[2])
      ) ? "won" : "lost";
    }
  }

  // -------------------------------------
  // HALF-TIME MARKETS
  // -------------------------------------

  if (
    /half time result|half time goals|half time correct score|correct score half time|correct score first half|home half time goals|away half time goals/.test(marketType)
  ) {
    if (htHome === null || htAway === null) {
      return null;
    }

    if (/half time result/.test(marketType)) {
      return selectedSide(
        htHome > htAway ? "won" : "lost",
        htHome === htAway ? "won" : "lost",
        htAway > htHome ? "won" : "lost"
      );
    }

    if (/half time goals over under/.test(marketType)) {
      return overUnder(htHome + htAway);
    }

    if (/home half time goals/.test(marketType)) {
      return overUnder(htHome);
    }

    if (/away half time goals/.test(marketType)) {
      return overUnder(htAway);
    }

    if (/correct score/.test(marketType)) {
      const scoreText = selection || predictionText;
      const scoreMatch = scoreText.match(/\b(\d+)\s*[-:]\s*(\d+)\b/);

      if (scoreMatch) {
        return (
          htHome === Number(scoreMatch[1]) &&
          htAway === Number(scoreMatch[2])
        ) ? "won" : "lost";
      }
    }
  }

  // -------------------------------------
  // SECOND-HALF MARKETS
  // -------------------------------------

  if (/second half result|second half goals over under/.test(marketType)) {
    if (htHome === null || htAway === null) {
      return null;
    }

    const secondHome = home - htHome;
    const secondAway = away - htAway;

    if (secondHome < 0 || secondAway < 0) {
      return null;
    }

    if (/second half result/.test(marketType)) {
      return selectedSide(
        secondHome > secondAway ? "won" : "lost",
        secondHome === secondAway ? "won" : "lost",
        secondAway > secondHome ? "won" : "lost"
      );
    }

    if (/second half goals over under/.test(marketType)) {
      return overUnder(secondHome + secondAway);
    }
  }

  // -------------------------------------
  // GOALS IN A HALF
  // -------------------------------------

  if (/goal in first half|goal before half time/.test(combined)) {
    if (htHome === null || htAway === null) return null;

    return htHome + htAway > 0 ? "won" : "lost";
  }

  if (/no goal in first half/.test(combined)) {
    if (htHome === null || htAway === null) return null;

    return htHome + htAway === 0 ? "won" : "lost";
  }

  if (/goal in second half/.test(combined)) {
    if (htHome === null || htAway === null) return null;

    return (home - htHome) + (away - htAway) > 0
      ? "won"
      : "lost";
  }

  if (/goal in both halves/.test(combined)) {
    if (htHome === null || htAway === null) return null;

    const firstHalfGoals = htHome + htAway;
    const secondHalfGoals = (home - htHome) + (away - htAway);

    return firstHalfGoals > 0 && secondHalfGoals > 0
      ? "won"
      : "lost";
  }

  // -------------------------------------
  // HOME / AWAY TO WIN EITHER HALF
  // -------------------------------------

  if (/home team to win either half/.test(combined)) {
    if (htHome === null || htAway === null) return null;

    const secondHome = home - htHome;
    const secondAway = away - htAway;

    return (
      htHome > htAway ||
      secondHome > secondAway
    ) ? "won" : "lost";
  }

  if (/away team to win either half/.test(combined)) {
    if (htHome === null || htAway === null) return null;

    const secondHome = home - htHome;
    const secondAway = away - htAway;

    return (
      htAway > htHome ||
      secondAway > secondHome
    ) ? "won" : "lost";
  }

  return null;
}

// =====================================
// ADMIN AUTHENTICATION
// =====================================

async function requireAdmin(req, res, next) {
  try {
    if (!supabase) {
      console.error("ADMIN AUTH: Supabase is not configured.");

      return res.status(500).json({
        success: false,
        message: "Database connection is not configured."
      });
    }

    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required."
      });
    }

    const token = authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required."
      });
    }

    const {
      data: userData,
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !userData || !userData.user) {
      console.error("ADMIN TOKEN VERIFICATION FAILED:", {
        message: userError?.message || "No user returned",
        code: userError?.code || null
      });

      return res.status(401).json({
        success: false,
        message: "Invalid or expired login session."
      });
    }

    const {
      data: admin,
      error: adminError
    } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError) {
      console.error("ADMIN TABLE LOOKUP FAILED:", {
        message: adminError.message,
        code: adminError.code,
        details: adminError.details,
        hint: adminError.hint
      });

      return res.status(500).json({
        success: false,
        message: "Unable to check administrator record."
      });
    }

    if (!admin) {
      return res.status(403).json({
        success: false,
        message: "Administrator access denied."
      });
    }

    console.log("ADMIN AUTHENTICATION SUCCESSFUL.");

    req.adminUser = userData.user;

    return next();

  } catch (error) {
    console.error("Admin authentication error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify administrator."
    });
  }
}

// =====================================
// HEALTH CHECKS
// =====================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ONLYBOSSTIPS API is running.",
    provider: "SportAPI"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "ONLYBOSSTIPS backend is online."
  });
});

app.get("/health/database", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        message: "Supabase environment variables are missing."
      });
    }

    const { error } = await supabase
      .from("predictions")
      .select("id")
      .limit(1);

    if (error) throw error;

    return res.json({
      success: true,
      message: "ONLYBOSSTIPS database connection is working."
    });

  } catch (error) {
    console.error("Database health error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Database connection failed."
    });
  }
});

app.get("/health/football", async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const data = await sportApiRequest(`/fixtures/date/${date}`);

    return res.json({
      success: true,
      message: "ONLYBOSSTIPS is connected to SportAPI.",
      provider: "SportAPI",
      fixtures_returned: Array.isArray(data.data)
        ? data.data.length
        : 0
    });

  } catch (error) {
    console.error("SportAPI health check failed:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to verify SportAPI connection.",
      diagnostic: error.message
    });
  }
});

// =====================================
// FIXTURE SEARCH
// =====================================

app.get("/fixtures/search", async (req, res) => {
  try {
    const home = String(req.query.home || "").trim();
    const away = String(req.query.away || "").trim();
    const date = String(req.query.date || "").trim();

    if (!home || !away || !date) {
      return res.status(400).json({
        success: false,
        message: "Please provide home, away and date."
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Date must use YYYY-MM-DD format."
      });
    }

    const data = await sportApiRequest(
      `/fixtures/date/${encodeURIComponent(date)}`
    );

    const fixtures = Array.isArray(data.data) ? data.data : [];

    const matches = fixtures.filter(item =>
      teamMatches(item.home_team, home) &&
      teamMatches(item.away_team, away)
    );

    const results = matches.map(item => ({
      fixture_id: item.id,
      date: item.date,
      kickoff_utc: item.kickoff_utc,
      status: item.status,
      minute: item.minute,
      league: item.league_name,
      home_team: item.home_team,
      away_team: item.away_team,
      home_team_id: item.home_id,
      away_team_id: item.away_id,
      home_logo: item.home_logo || null,
      away_logo: item.away_logo || null,
      home_score: item.home_score,
      away_score: item.away_score
    }));

    return res.json({
      success: true,
      diagnostic: true,
      requested: { home, away, date },
      sportapi_response_keys: Object.keys(data),
      total_fixtures_returned: fixtures.length,
      matching_fixtures: results.length,
      sample_fixtures: fixtures.slice(0, 5).map(item => ({
        id: item.id,
        home_team: item.home_team,
        away_team: item.away_team,
        date: item.date
      })),
      fixtures: results
    });

  } catch (error) {
    console.error("Fixture search error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to search fixtures.",
      diagnostic: error.message
    });
  }
});

// =====================================
// SECURE ADMIN FIXTURE LINKING
// =====================================

app.post(
  "/predictions/link-fixture",
  requireAdmin,
  async (req, res) => {
    try {
      const predictionId = req.body.prediction_id;
      const fixtureId = req.body.fixture_id;

      if (!predictionId || !fixtureId) {
        return res.status(400).json({
          success: false,
          message: "prediction_id and fixture_id are required."
        });
      }

      const {
        data: prediction,
        error: predictionError
      } = await supabase
        .from("predictions")
        .select("*")
        .eq("id", predictionId)
        .maybeSingle();

      if (predictionError) {
        console.error("PREDICTION LOOKUP ERROR:", predictionError.message);

        return res.status(500).json({
          success: false,
          message: "Unable to retrieve prediction."
        });
      }

      if (!prediction) {
        return res.status(404).json({
          success: false,
          message: "Prediction not found."
        });
      }

      if (prediction.status !== "pending") {
        return res.status(409).json({
          success: false,
          message: "Only pending predictions can be linked."
        });
      }

      if (prediction.api_fixture_id) {
        return res.status(409).json({
          success: false,
          message: "This prediction already has a linked fixture."
        });
      }

      const fixtureData = await sportApiRequest(
        `/fixtures/${encodeURIComponent(fixtureId)}`
      );

      const fixture = fixtureData.fixture;

      if (!fixture) {
        return res.status(404).json({
          success: false,
          message: "Fixture not found on SportAPI."
        });
      }

      if (
        !teamMatches(prediction.home_team, fixture.home_team) ||
        !teamMatches(prediction.away_team, fixture.away_team)
      ) {
        return res.status(400).json({
          success: false,
          message: "The selected fixture does not match this prediction.",
          prediction: {
            home: prediction.home_team,
            away: prediction.away_team
          },
          fixture: {
            home: fixture.home_team,
            away: fixture.away_team
          }
        });
      }

      const predictionTime = new Date(prediction.kickoff).getTime();
      const fixtureTime = new Date(
        fixture.kickoff_utc || fixture.datetime
      ).getTime();

      if (
        !Number.isFinite(predictionTime) ||
        !Number.isFinite(fixtureTime)
      ) {
        return res.status(400).json({
          success: false,
          message: "Unable to verify the kickoff time."
        });
      }

      const timeDifference = Math.abs(
        predictionTime - fixtureTime
      );

      const eighteenHours = 18 * 60 * 60 * 1000;

      if (timeDifference > eighteenHours) {
        return res.status(400).json({
          success: false,
          message: "The fixture kickoff time differs by more than 18 hours."
        });
      }

      const {
        data: updatedPrediction,
        error: updateError
      } = await supabase
        .from("predictions")
        .update({
          api_fixture_id: fixture.id,
          fixture_status: fixture.status,
          tracking_updated_at: new Date().toISOString()
        })
        .eq("id", predictionId)
        .eq("status", "pending")
        .is("api_fixture_id", null)
        .select()
        .single();

      if (updateError) throw updateError;

      console.log(
        `Fixture ${fixture.id} linked to prediction ${predictionId}.`
      );

      return res.json({
        success: true,
        message: "Fixture successfully linked to prediction.",
        prediction: updatedPrediction,
        fixture: {
          fixture_id: fixture.id,
          home_team: fixture.home_team,
          away_team: fixture.away_team,
          home_team_id: fixture.home_id,
          away_team_id: fixture.away_id,
          home_logo: fixture.home_logo || null,
          away_logo: fixture.away_logo || null,
          kickoff: fixture.kickoff_utc || fixture.datetime,
          status: fixture.status
        }
      });

    } catch (error) {
      console.error("Fixture linking error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to link fixture.",
        diagnostic: error.message
      });
    }
  }
);

// =====================================
// AUTOMATIC MATCH TRACKING & SETTLEMENT
// =====================================

let trackingBusy = false;

const missingFixtureChecks = new Map();
const MISSING_FIXTURE_RECHECK_MS = 15 * 60 * 1000;

// Automatically search for unlinked pending predictions
// every 15 minutes. Normal linked-fixture tracking still
// runs every 3 minutes.

let lastAutoLinkScanAt = 0;
const AUTO_LINK_INTERVAL_MS = 15 * 60 * 1000;
const AUTO_LINK_MAX_PREDICTIONS = 100;
const AUTO_LINK_MAX_DATE_GROUPS = 12;

async function autoLinkUnlinkedPredictions() {
  if (!supabase || !sportApiKey) return;

  const now = Date.now();

  if (now - lastAutoLinkScanAt < AUTO_LINK_INTERVAL_MS) {
    return;
  }

  try {
    const {
      data: unlinked,
      error
    } = await supabase
      .from("predictions")
      .select("*")
      .eq("status", "pending")
      .is("api_fixture_id", null)
      .limit(AUTO_LINK_MAX_PREDICTIONS);

    if (error) throw error;

    // Only start the 15-minute waiting period after
    // the database query succeeds.
    lastAutoLinkScanAt = Date.now();

    if (!unlinked || unlinked.length === 0) {
      console.log("Automatic fixture matching: no unlinked pending predictions.");
      return;
    }

    const nowTime = Date.now();
    const earliestAllowed = nowTime - (36 * 60 * 60 * 1000);
    const latestAllowed = nowTime + (7 * 24 * 60 * 60 * 1000);

    const eligible = unlinked.filter(prediction => {
      const kickoff = new Date(prediction.kickoff).getTime();

      return (
        Number.isFinite(kickoff) &&
        kickoff >= earliestAllowed &&
        kickoff <= latestAllowed &&
        prediction.home_team &&
        prediction.away_team
      );
    });

    if (eligible.length === 0) {
      console.log("Automatic fixture matching: no predictions within the search window.");
      return;
    }

    const dateGroups = new Map();

    for (const prediction of eligible) {
      const date = kickoffDate(prediction.kickoff);

      if (!date) continue;

      if (!dateGroups.has(date)) {
        dateGroups.set(date, []);
      }

      dateGroups.get(date).push(prediction);
    }

    const dateCache = new Map();

    async function getFixturesForDate(date) {
      if (!dateCache.has(date)) {
        dateCache.set(
          date,
          sportApiRequest(
            `/fixtures/date/${encodeURIComponent(date)}`
          ).then(data => Array.isArray(data.data) ? data.data : [])
        );
      }

      return dateCache.get(date);
    }

    let scannedGroups = 0;
    let linkedCount = 0;

    for (const [date, predictionsForDate] of dateGroups) {
      scannedGroups++;

      if (scannedGroups > AUTO_LINK_MAX_DATE_GROUPS) {
        console.log(
          "Automatic fixture matching: date scan limit reached. Remaining predictions will be checked during the next scan."
        );
        break;
      }

      const adjacentDates = [
        shiftDate(date, -1),
        date,
        shiftDate(date, 1)
      ].filter(Boolean);

      let dateFixtures = [];

      for (const searchDate of adjacentDates) {
        try {
          const fixtures = await getFixturesForDate(searchDate);
          dateFixtures.push(...fixtures);
        } catch (dateError) {
          console.error(
            `Automatic fixture search failed for ${searchDate}:`,
            dateError.message
          );
        }
      }

      // Remove duplicate fixtures returned by overlapping date searches.
      const uniqueFixtures = new Map();

      for (const fixture of dateFixtures) {
        if (fixture && fixture.id !== undefined && fixture.id !== null) {
          uniqueFixtures.set(String(fixture.id), fixture);
        }
      }

      const fixtures = Array.from(uniqueFixtures.values());

      for (const prediction of predictionsForDate) {
        const predictionTime = new Date(prediction.kickoff).getTime();

        const candidates = fixtures.filter(fixture => {
          if (
            !teamMatches(prediction.home_team, fixture.home_team) ||
            !teamMatches(prediction.away_team, fixture.away_team)
          ) {
            return false;
          }

          const fixtureKickoff = new Date(
            fixture.kickoff_utc || fixture.datetime || fixture.date
          ).getTime();

          if (!Number.isFinite(fixtureKickoff)) {
            return false;
          }

          const difference = Math.abs(
            predictionTime - fixtureKickoff
          );

          return difference <= 18 * 60 * 60 * 1000;
        });

        // Only link when exactly one fixture is a safe match.
        // If there are multiple candidates, leave it unlinked
        // for the administrator to choose manually.

        if (candidates.length !== 1) {
          if (candidates.length > 1) {
            console.log(
              `Prediction ${prediction.id}: multiple possible fixtures found. Manual linking required.`
            );
          }

          continue;
        }

        const fixture = candidates[0];

        const {
          data: linked,
          error: linkError
        } = await supabase
          .from("predictions")
          .update({
            api_fixture_id: fixture.id,
            fixture_status: fixture.status || null,
            tracking_updated_at: new Date().toISOString()
          })
          .eq("id", prediction.id)
          .eq("status", "pending")
          .is("api_fixture_id", null)
          .select("id, api_fixture_id");

        if (linkError) {
          console.error(
            `Automatic fixture linking failed for prediction ${prediction.id}:`,
            linkError.message
          );
          continue;
        }

        if (linked && linked.length > 0) {
          linkedCount++;

          console.log(
            `Automatically linked prediction ${prediction.id} to SportAPI fixture ${fixture.id}.`
          );
        }
      }
    }

    console.log(
      `Automatic fixture matching completed. Linked ${linkedCount} prediction(s).`
    );

  } catch (error) {
    console.error(
      "Automatic unlinked-prediction scan failed:",
      error.message
    );
  }
}

// =====================================
// SPORTAPI FIXTURE EVENTS
// =====================================

async function getFixtureEvents(fixtureId) {
  const data = await sportApiRequest(
    `/fixtures/${encodeURIComponent(fixtureId)}/events`
  );

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (data.data && Array.isArray(data.data.data)) {
    return data.data.data;
  }

  return null;
}

// =====================================
// AUTOMATIC TRACKING
// =====================================

async function trackPredictions() {
  if (!supabase || !sportApiKey || trackingBusy) return;

  trackingBusy = true;

  try {
    // First, attempt to link pending predictions that
    // were not linked when they were originally published.

    await autoLinkUnlinkedPredictions();

    const {
      data: predictions,
      error
    } = await supabase
      .from("predictions")
      .select("*")
      .eq("status", "pending")
      .not("api_fixture_id", "is", null)
      .limit(200);

    if (error) throw error;

    if (!predictions || predictions.length === 0) {
      return;
    }

    // Group linked pending predictions by original fixture date.

    const dateGroups = new Map();

    for (const prediction of predictions) {
      const date = kickoffDate(prediction.kickoff);

      if (!date) {
        console.log(
          `Skipping prediction ${prediction.id}: invalid kickoff date.`
        );
        continue;
      }

      if (!dateGroups.has(date)) {
        dateGroups.set(date, []);
      }

      dateGroups.get(date).push(prediction);
    }

    const detailCache = new Map();
    const eventsCache = new Map();

    async function getFixtureDetails(fixtureId) {
      const key = String(fixtureId);

      if (!detailCache.has(key)) {
        detailCache.set(
          key,
          sportApiRequest(
            `/fixtures/${encodeURIComponent(fixtureId)}`
          ).then(data => data.fixture || null)
        );
      }

      return detailCache.get(key);
    }

    async function getCachedFixtureEvents(fixtureId) {
      const key = String(fixtureId);

      if (!eventsCache.has(key)) {
        eventsCache.set(
          key,
          getFixtureEvents(fixtureId).catch(error => {
            console.error(
              `Goal events unavailable for fixture ${fixtureId}:`,
              error.message
            );

            return null;
          })
        );
      }

      return eventsCache.get(key);
    }

    async function processPrediction(prediction, fixture) {
      if (!fixture) return;

      const status = String(
        fixture.status || ""
      ).trim().toUpperCase();

      const now = new Date().toISOString();

      const update = {
        fixture_status: fixture.status || null,
        home_score: safeNumber(fixture.home_score),
        away_score: safeNumber(fixture.away_score),
        tracking_updated_at: now
      };

      // -------------------------------------
      // POSTPONED OR OFFICIALLY CANCELLED
      // -------------------------------------

      if (voidStatus(status)) {
        const reason = status === "POSTPONED"
          ? "Match postponed by SportAPI"
          : "Match officially cancelled by SportAPI";

        const {
          data: settled,
          error: settleError
        } = await supabase
          .from("predictions")
          .update({
            ...update,
            status: "void",
            result: `Automatically settled VOID: ${reason}.`
          })
          .eq("id", prediction.id)
          .eq("status", "pending")
          .eq("api_fixture_id", prediction.api_fixture_id)
          .select("id");

        if (settleError) {
          console.error(
            `VOID settlement failed for prediction ${prediction.id}:`,
            settleError.message
          );
          return;
        }

        if (settled && settled.length > 0) {
          console.log(
            `Prediction ${prediction.id} automatically marked VOID. Reason: ${reason}.`
          );
        }

        return;
      }

      // -------------------------------------
      // NON-FINAL MATCHES
      // -------------------------------------

      if (!finalStatus(status)) {
        const { error: updateError } = await supabase
          .from("predictions")
          .update(update)
          .eq("id", prediction.id)
          .eq("status", "pending")
          .eq("api_fixture_id", prediction.api_fixture_id);

        if (updateError) {
          console.error(
            `Fixture update failed for prediction ${prediction.id}:`,
            updateError.message
          );
        }

        return;
      }

      // -------------------------------------
      // FINISHED MATCH
      // -------------------------------------

      let finalFixture = fixture;

      try {
        const details = await getFixtureDetails(
          prediction.api_fixture_id
        );

        if (details) {
          finalFixture = {
            ...fixture,
            ...details
          };
        }

      } catch (detailError) {
        console.error(
          `Fixture details unavailable for ${prediction.api_fixture_id}:`,
          detailError.message
        );
      }

      update.home_score = safeNumber(finalFixture.home_score);
      update.away_score = safeNumber(finalFixture.away_score);
      update.halftime_home_score = safeNumber(finalFixture.ht_home);
      update.halftime_away_score = safeNumber(finalFixture.ht_away);

      // Do not settle if the final score is missing.

      if (
        update.home_score === null ||
        update.away_score === null
      ) {
        const { error: scoreUpdateError } = await supabase
          .from("predictions")
          .update(update)
          .eq("id", prediction.id)
          .eq("status", "pending")
          .eq("api_fixture_id", prediction.api_fixture_id);

        if (scoreUpdateError) {
          console.error(
            "Unable to save final fixture information:",
            scoreUpdateError.message
          );
        }

        console.log(
          `Prediction ${prediction.id}: final score unavailable. Keeping pending.`
        );

        return;
      }

      // -------------------------------------
      // DETERMINE MARKET RESULT
      // -------------------------------------

      let outcome = null;

      if (isOneUpTwoUpMarket(prediction)) {
        // 1UP / 2UP must be settled using the goal timeline.
        // A final score by itself is not sufficient.

        const events = await getCachedFixtureEvents(
          prediction.api_fixture_id
        );

        outcome = settleOneUpTwoUpMarket(
          prediction,
          finalFixture,
          events
        );

      } else {
        outcome = settleScoreMarket(
          prediction,
          finalFixture
        );
      }

      if (!["won", "lost", "void"].includes(outcome)) {
        const { error: updateError } = await supabase
          .from("predictions")
          .update(update)
          .eq("id", prediction.id)
          .eq("status", "pending")
          .eq("api_fixture_id", prediction.api_fixture_id);

        if (updateError) {
          console.error(
            `Unable to update fixture information for prediction ${prediction.id}:`,
            updateError.message
          );
        }

        console.log(
          `Prediction ${prediction.id}: match finished, but its market could not be safely verified. Keeping pending.`
        );

        return;
      }

      const scoreText =
        `${update.home_score}-${update.away_score}`;

      let resultText;

      if (isOneUpTwoUpMarket(prediction)) {
        resultText =
          `Automatically settled ${outcome.toUpperCase()} using verified SportAPI goal events. Final score ${scoreText}.`;
      } else if (outcome === "void") {
        resultText =
          `Automatically settled VOID: market resulted in a push. Final score ${scoreText}.`;
      } else {
        resultText =
          `Automatically settled ${outcome.toUpperCase()}: final score ${scoreText}.`;
      }

      // -------------------------------------
      // SAFE AUTOMATIC SETTLEMENT
      // -------------------------------------
      // The pending condition prevents automation from
      // overwriting an administrator's manual result.
      //
      // The fixture ID condition ensures only the same
      // linked fixture can be used for settlement.

      const {
        data: settled,
        error: settleError
      } = await supabase
        .from("predictions")
        .update({
          ...update,
          status: outcome,
          result: resultText
        })
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_fixture_id", prediction.api_fixture_id)
        .select("id");

      if (settleError) {
        console.error(
          `Automatic settlement failed for prediction ${prediction.id}:`,
          settleError.message
        );

        return;
      }

      if (settled && settled.length > 0) {
        console.log(
          `Prediction ${prediction.id} automatically settled ${outcome.toUpperCase()}. Score: ${scoreText}.`
        );
      } else {
        console.log(
          `Prediction ${prediction.id} was not changed because it is no longer pending or its fixture link changed.`
        );
      }
    }

    // -------------------------------------
    // FETCH FIXTURES BY DATE
    // -------------------------------------

    for (const [date, group] of dateGroups) {
      let fixtures = [];

      try {
        const dailyData = await sportApiRequest(
          `/fixtures/date/${encodeURIComponent(date)}`
        );

        fixtures = Array.isArray(dailyData.data)
          ? dailyData.data
          : [];

      } catch (dateError) {
        console.error(
          `SportAPI date lookup failed for ${date}:`,
          dateError.message
        );
      }

      for (const prediction of group) {
        let fixture = fixtures.find(item =>
          String(item.id) === String(prediction.api_fixture_id)
        );

        // -------------------------------------
        // RESCHEDULED FIXTURE FALLBACK
        // -------------------------------------

        if (!fixture) {
          const fixtureKey = String(
            prediction.api_fixture_id
          );

          const lastCheck =
            missingFixtureChecks.get(fixtureKey) || 0;

          const currentTime = Date.now();

          if (
            currentTime - lastCheck >=
            MISSING_FIXTURE_RECHECK_MS
          ) {
            missingFixtureChecks.set(
              fixtureKey,
              currentTime
            );

            try {
              fixture = await getFixtureDetails(
                prediction.api_fixture_id
              );

            } catch (detailError) {
              console.error(
                `Rescheduled fixture lookup failed for ${fixtureKey}:`,
                detailError.message
              );
            }
          }
        }

        if (!fixture) {
          console.log(
            `Fixture ${prediction.api_fixture_id} not found yet. Prediction ${prediction.id} remains pending.`
          );
          continue;
        }

        // Verify the fixture still belongs to the
        // teams originally linked to this prediction.

        if (
          !teamMatches(prediction.home_team, fixture.home_team) ||
          !teamMatches(prediction.away_team, fixture.away_team)
        ) {
          console.error(
            `Fixture team mismatch for prediction ${prediction.id}. Automatic settlement blocked.`
          );
          continue;
        }

        try {
          await processPrediction(prediction, fixture);

        } catch (processError) {
          console.error(
            `Processing failed for prediction ${prediction.id}:`,
            processError.message
          );
        }
      }
    }

  } catch (error) {
    console.error(
      "Automatic tracking error:",
      error.message
    );

  } finally {
    trackingBusy = false;
  }
}

// =====================================
// TRACKING SCHEDULE
// =====================================

setInterval(
  trackPredictions,
  3 * 60 * 1000
);

// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {
  console.log(
    `ONLYBOSSTIPS API running on port ${PORT}`
  );

  console.log("Football provider: SportAPI");
  console.log("Automatic prediction settlement: ENABLED");
  console.log("Postponed matches: AUTOMATIC VOID");
  console.log("Cancelled matches: AUTOMATIC VOID");
  console.log("Unlinked predictions: AUTOMATIC FIXTURE MATCHING ENABLED");
  console.log("1UP / 2UP: GOAL-EVENT SETTLEMENT ENABLED");
  console.log("BTTS: YES / NO / GG / NG SETTLEMENT ENABLED");
  console.log("Unsupported markets: REMAIN PENDING");

  if (!sportApiKey) {
    console.error("WARNING: SPORTAPI_KEY is missing.");
  }

  if (!supabase) {
    console.error("WARNING: Supabase is not configured.");
  }

  setTimeout(
    trackPredictions,
    15000
  );
});
