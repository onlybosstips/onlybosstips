
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
  supabase = createClient(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
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

  const response = await fetch(
    `${sportApiUrl}${endpoint}`,
    {
      method: "GET",
      headers: {
        "X-Api-Key": sportApiKey
      },
      signal: AbortSignal.timeout(20000)
    }
  );

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
  return String(name || "")
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|club|women|w|ladies)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function teamMatches(first, second) {
  const a = normalizeTeam(first);
  const b = normalizeTeam(second);

  if (!a || !b) return false;

  return a === b || a.includes(b) || b.includes(a);
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finalStatus(status) {
  return ["FT", "AET", "PENS"].includes(
    String(status || "").toUpperCase()
  );
}

function parseMinute(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 9999;
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
      console.error("ADMIN AUTH: Missing bearer token.");

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

    // Verify the user's Supabase login token.

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

    // Check whether the authenticated user exists in admins.

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
      console.error(
        "ADMIN RECORD NOT FOUND FOR AUTHENTICATED USER."
      );

      return res.status(403).json({
        success: false,
        message: "Administrator access denied."
      });
    }

    console.log("ADMIN AUTHENTICATION SUCCESSFUL.");

    req.adminUser = userData.user;

    return next();

  } catch (error) {
    console.error(
      "Admin authentication error:",
      error.message
    );

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

    const data = await sportApiRequest(
      `/fixtures/date/${date}`
    );

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

    const fixtures = Array.isArray(data.data)
      ? data.data
      : [];

    console.log("SPORTAPI FIXTURE SEARCH");
    console.log("Requested date:", date);
    console.log("Response keys:", Object.keys(data));
    console.log("Total fixtures returned:", fixtures.length);

    console.log(
      "First five fixtures:",
      JSON.stringify(
        fixtures.slice(0, 5).map(item => ({
          id: item.id,
          home_team: item.home_team,
          away_team: item.away_team,
          date: item.date,
          kickoff_utc: item.kickoff_utc
        })),
        null,
        2
      )
    );

    const matches = fixtures.filter(item => {
      return (
        teamMatches(item.home_team, home) &&
        teamMatches(item.away_team, away)
      );
    });

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
      home_score: item.home_score,
      away_score: item.away_score
    }));

    return res.json({
      success: true,
      diagnostic: true,
      requested: {
        home,
        away,
        date
      },
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
        console.error(
          "PREDICTION LOOKUP ERROR:",
          predictionError.message
        );

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

      const predictionTime = new Date(
        prediction.kickoff
      ).getTime();

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

      const update = {
        api_fixture_id: fixture.id,
        fixture_status: fixture.status,
        tracking_updated_at: new Date().toISOString()
      };

      const {
        data: updatedPrediction,
        error: updateError
      } = await supabase
        .from("predictions")
        .update(update)
        .eq("id", predictionId)
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
// MARKET SETTLEMENT HELPERS
// =====================================

function overUnderResult(actual, selection, line) {
  if (actual === null || line === null) return null;

  const choice = String(selection || "").toLowerCase();

  if (choice.includes("over")) {
    if (actual > line) return "won";
    if (actual < line) return "lost";
    return "void";
  }

  if (choice.includes("under")) {
    if (actual < line) return "won";
    if (actual > line) return "lost";
    return "void";
  }

  return null;
}

function getTeamSide(prediction, type) {
  const team = String(
    prediction.market_team || ""
  ).toLowerCase();

  if (team === "home") return "home";
  if (team === "away") return "away";

  const lower = String(type || "").toLowerCase();

  if (lower.includes("home")) return "home";
  if (lower.includes("away")) return "away";

  return null;
}

function getStat(stats, side, key) {
  if (!stats || !stats[side]) return null;

  return safeNumber(stats[side][key]);
}

function settlePrediction(prediction, fixture, events, stats) {
  const category = String(
    prediction.market_category || ""
  ).toLowerCase();

  const type = String(
    prediction.market_type || ""
  ).toLowerCase();

  const selection = String(
    prediction.market_selection || ""
  ).toLowerCase().trim();

  const line = safeNumber(prediction.market_line);

  const home = safeNumber(fixture.home_score);
  const away = safeNumber(fixture.away_score);

  if (home === null || away === null) return null;

  // FULL-TIME MATCH RESULT

  if (
    category.includes("match result") ||
    type.includes("full time result") ||
    type.includes("draw no bet")
  ) {
    const result = home > away ? "home" :
      home < away ? "away" : "draw";

    if (type.includes("draw no bet")) {
      if (result === "draw") return "void";

      const wanted = type.includes("away") ? "away" : "home";

      return result === wanted ? "won" : "lost";
    }

    let wanted = null;

    if (type.includes("home win")) wanted = "home";
    else if (type.includes("away win")) wanted = "away";
    else if (type.includes("draw")) wanted = "draw";
    else if (selection.includes("home")) wanted = "home";
    else if (selection.includes("away")) wanted = "away";
    else if (selection.includes("draw")) wanted = "draw";

    if (!wanted) return null;

    return result === wanted ? "won" : "lost";
  }

  // DOUBLE CHANCE

  if (category.includes("double chance")) {
    const result = home > away ? "home" :
      home < away ? "away" : "draw";

    if (
      selection.includes("1x") ||
      type.includes("home or draw")
    ) {
      return ["home", "draw"].includes(result) ? "won" : "lost";
    }

    if (
      selection.includes("x2") ||
      type.includes("draw or away")
    ) {
      return ["draw", "away"].includes(result) ? "won" : "lost";
    }

    if (
      selection.includes("12") ||
      type.includes("home or away")
    ) {
      return result !== "draw" ? "won" : "lost";
    }

    return null;
  }

  // BOTH TEAMS TO SCORE

  if (
    category.includes("both teams to score") ||
    type.includes("both teams to score") ||
    type.includes("btts")
  ) {
    const bothScored = home > 0 && away > 0;

    const wantsYes =
      selection.includes("yes") ||
      type.includes("yes");

    const wantsNo =
      selection.includes("no") ||
      type.includes("no");

    if (wantsYes) return bothScored ? "won" : "lost";
    if (wantsNo) return bothScored ? "lost" : "won";

    return null;
  }

  // PLAYER GOAL MARKETS
  // This must come before general goals markets.

  if (
    category.includes("player goals") &&
    type.includes("anytime goalscorer")
  ) {
    const playerName = String(
      prediction.player_name || prediction.market_selection || ""
    ).trim().toLowerCase();

    if (!playerName || !Array.isArray(events)) return null;

    const scored = events.some(event =>
      String(event.event_type || "").toLowerCase() === "goal" &&
      String(event.player_name || "").trim().toLowerCase() === playerName
    );

    return scored ? "won" : "lost";
  }

  // TOTAL AND TEAM GOALS

  if (
    category.includes("goals") ||
    type.includes("total goals") ||
    type.includes("team goals")
  ) {
    if (line === null) return null;

    let actual = null;

    if (type.includes("home team goals")) {
      actual = home;
    } else if (type.includes("away team goals")) {
      actual = away;
    } else {
      actual = home + away;
    }

    return overUnderResult(actual, selection, line);
  }

  // HALF-TIME MARKETS

  if (
    category.includes("half time") ||
    type.includes("half time")
  ) {
    const htHome = safeNumber(fixture.ht_home);
    const htAway = safeNumber(fixture.ht_away);

    if (htHome === null || htAway === null) return null;

    if (type.includes("half time result")) {
      const result = htHome > htAway ? "home" :
        htHome < htAway ? "away" : "draw";

      const wanted = type.includes("home") ? "home" :
        type.includes("away") ? "away" :
        type.includes("draw") ? "draw" : selection;

      if (!["home", "away", "draw"].includes(wanted)) {
        return null;
      }

      return result === wanted ? "won" : "lost";
    }

    if (type.includes("half time goals")) {
      if (line === null) return null;

      return overUnderResult(
        htHome + htAway,
        selection,
        line
      );
    }

    return null;
  }

  // CORRECT SCORE

  if (
    category.includes("correct score") ||
    type.includes("correct score")
  ) {
    const scoreMatch = selection.match(/(\d+)\s*[-:]\s*(\d+)/);

    if (!scoreMatch) return null;

    const wantedHome = Number(scoreMatch[1]);
    const wantedAway = Number(scoreMatch[2]);

    return home === wantedHome && away === wantedAway
      ? "won"
      : "lost";
  }

  // TEAM STATISTICS

  if (!stats || !stats.available || !stats.data) {
    return null;
  }

  const statMarkets = [
    {
      words: ["foul"],
      category: "foul",
      key: "fouls",
      total: true
    },
    {
      words: ["yellow card"],
      category: "card",
      key: "yellow_cards",
      total: true
    },
    {
      words: ["shot on target"],
      category: "shot",
      key: "shots_on_target",
      total: true
    },
    {
      words: ["total shots", "team shots"],
      category: "shot",
      key: "shots",
      total: true
    },
    {
      words: ["saves"],
      category: "goalkeeper",
      key: "saves",
      total: true
    }
  ];

  for (const market of statMarkets) {
    const matchesMarket =
      market.words.some(word => type.includes(word)) ||
      category.includes(market.category);

    if (!matchesMarket) continue;

    if (line === null) return null;

    const side = getTeamSide(prediction, type);

    if (side) {
      const actual = getStat(stats.data, side, market.key);

      return overUnderResult(actual, selection, line);
    }

    const homeValue = getStat(stats.data, "home", market.key);
    const awayValue = getStat(stats.data, "away", market.key);

    if (homeValue === null || awayValue === null) return null;

    return overUnderResult(
      homeValue + awayValue,
      selection,
      line
    );
  }

  // PLAYER CARD MARKETS

  if (
    category.includes("player cards") &&
    type.includes("player to receive a card")
  ) {
    const playerName = String(
      prediction.player_name || prediction.market_selection || ""
    ).trim().toLowerCase();

    if (!playerName || !Array.isArray(events)) return null;

    const booked = events.some(event => {
      const eventType = String(
        event.event_type || ""
      ).toLowerCase();

      return (
        eventType.includes("card") &&
        String(event.player_name || "").trim().toLowerCase() === playerName
      );
    });

    return booked ? "won" : "lost";
  }

  // FIRST SUBSTITUTION TEAM

  if (
    category.includes("substitutions") &&
    type.includes("team to make first substitution")
  ) {
    if (!Array.isArray(events)) return null;

    const substitutions = events
      .filter(event =>
        String(event.event_type || "")
          .toLowerCase()
          .includes("substitution")
      )
      .sort((a, b) =>
        parseMinute(a.minute) - parseMinute(b.minute)
      );

    if (!substitutions.length) return null;

    const firstSide = String(
      substitutions[0].team_side || ""
    ).toLowerCase();

    if (!["home", "away"].includes(firstSide)) return null;

    const wanted = selection.includes("home") ? "home" :
      selection.includes("away") ? "away" : null;

    if (!wanted) return null;

    return firstSide === wanted ? "won" : "lost";
  }

  // CORNERS AND UNSUPPORTED MARKETS
  // These remain pending for manual review.

  return null;
}

// =====================================
// AUTOMATIC MATCH TRACKING
// =====================================

let trackingBusy = false;

async function trackPredictions() {
  if (!supabase || !sportApiKey || trackingBusy) return;

  trackingBusy = true;

  try {
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

    if (!predictions || !predictions.length) return;

    const now = Date.now();

    const activePredictions = predictions.filter(prediction => {
      const kickoff = new Date(
        prediction.kickoff
      ).getTime();

      if (!Number.isFinite(kickoff)) return false;

      const alreadyFinal = finalStatus(
        prediction.fixture_status
      );

      return (
        !alreadyFinal &&
        kickoff <= now + 30 * 60 * 1000
      );
    });

    if (!activePredictions.length) return;

    // Group predictions by fixture date.

    const dateGroups = new Map();

    for (const prediction of activePredictions) {
      const date = new Date(
        prediction.kickoff
      ).toISOString().slice(0, 10);

      if (!dateGroups.has(date)) {
        dateGroups.set(date, []);
      }

      dateGroups.get(date).push(prediction);
    }

    for (const [date, group] of dateGroups) {
      try {
        const dailyData = await sportApiRequest(
          `/fixtures/date/${date}`
        );

        const fixtures = Array.isArray(dailyData.data)
          ? dailyData.data
          : [];

        for (const prediction of group) {
          const fixture = fixtures.find(item =>
            String(item.id) === String(prediction.api_fixture_id)
          );

          if (!fixture) continue;

          const status = String(
            fixture.status || ""
          ).toUpperCase();

          const update = {
            fixture_status: fixture.status,
            home_score: safeNumber(fixture.home_score),
            away_score: safeNumber(fixture.away_score),
            tracking_updated_at: new Date().toISOString()
          };

          // CANCELLED FIXTURES ARE VOID.

          if (status === "CANCELLED") {
            const { error: voidError } = await supabase
              .from("predictions")
              .update({
                ...update,
                status: "void",
                result: "Fixture cancelled"
              })
              .eq("id", prediction.id);

            if (voidError) {
              console.error(
                "Void update error:",
                voidError.message
              );
            } else {
              console.log(
                `Prediction ${prediction.id} marked void: fixture cancelled.`
              );
            }

            continue;
          }

          // Save live scores without changing prediction result.

          if (!finalStatus(status)) {
            const { error: liveError } = await supabase
              .from("predictions")
              .update(update)
              .eq("id", prediction.id);

            if (liveError) {
              console.error(
                "Live update error:",
                liveError.message
              );
            }

            continue;
          }

          // Retrieve detailed final match data.

          const [
            detailResult,
            eventsResult,
            statsResult
          ] = await Promise.allSettled([
            sportApiRequest(`/fixtures/${fixture.id}`),
            sportApiRequest(`/fixtures/${fixture.id}/events`),
            sportApiRequest(`/fixtures/${fixture.id}/stats`)
          ]);

          const detail = detailResult.status === "fulfilled"
            ? detailResult.value.fixture || fixture
            : fixture;

          const events = eventsResult.status === "fulfilled"
            ? eventsResult.value.data || []
            : null;

          const stats = statsResult.status === "fulfilled"
            ? statsResult.value
            : null;

          const outcome = settlePrediction(
            prediction,
            detail,
            events,
            stats
          );

          const statistics = {
            provider: "SportAPI",
            fixture_id: fixture.id,
            events_available: Array.isArray(events),
            stats_available: Boolean(stats && stats.available),
            settlement_checked_at: new Date().toISOString(),
            settlement: outcome || "manual_review_required"
          };

          const finalUpdate = {
            ...update,
            half_time_home_score: safeNumber(detail.ht_home),
            half_time_away_score: safeNumber(detail.ht_away),
            statistics
          };

          if (outcome) {
            finalUpdate.status = outcome;
            finalUpdate.result = outcome.toUpperCase();
          }

          const { error: finalError } = await supabase
            .from("predictions")
            .update(finalUpdate)
            .eq("id", prediction.id);

          if (finalError) {
            console.error(
              "Final settlement error:",
              finalError.message
            );
          } else if (outcome) {
            console.log(
              `Prediction ${prediction.id} settled: ${outcome}`
            );
          } else {
            console.log(
              `Prediction ${prediction.id} requires manual review.`
            );
          }
        }

      } catch (error) {
        console.error(
          `Tracking error for ${date}:`,
          error.message
        );
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
