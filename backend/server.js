
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

function finishedOrCancelled(status) {
  return [
    "FT",
    "AET",
    "PENS",
    "CANCELLED"
  ].includes(String(status || "").toUpperCase());
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
    console.log("Total fixtures returned:", fixtures.length);

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
      home_logo: item.home_logo || null,
      away_logo: item.away_logo || null,
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
// AUTOMATIC MATCH TRACKING
// IMPORTANT:
// SportAPI updates match information only.
// It NEVER decides WON, LOST or VOID.
// The administrator enters the final result.
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

      const alreadyFinished = finishedOrCancelled(
        prediction.fixture_status
      );

      return (
        !alreadyFinished &&
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

          // Update match information only.
          // Never update prediction status or result here.

          const update = {
            fixture_status: fixture.status,
            home_score: safeNumber(fixture.home_score),
            away_score: safeNumber(fixture.away_score),
            tracking_updated_at: new Date().toISOString()
          };

          // When a match is finished, retrieve its halftime scores.

          if (finalStatus(status)) {
            try {
              const detailData = await sportApiRequest(
                `/fixtures/${fixture.id}`
              );

              const detail = detailData.fixture || fixture;

              update.halftime_home_score = safeNumber(
                detail.ht_home
              );

              update.halftime_away_score = safeNumber(
                detail.ht_away
              );

            } catch (detailError) {
              console.error(
                "Unable to retrieve final match details:",
                detailError.message
              );
            }
          }

          const { error: updateError } = await supabase
            .from("predictions")
            .update(update)
            .eq("id", prediction.id);

          if (updateError) {
            console.error(
              "Match information update error:",
              updateError.message
            );
          } else {
            console.log(
              `Match information updated for prediction ${prediction.id}. Status: ${status}`
            );
          }

          if (finalStatus(status)) {
            console.log(
              `Match finished. Prediction ${prediction.id} is waiting for manual result.`
            );
          }

          if (status === "CANCELLED") {
            console.log(
              `Fixture cancelled. Prediction ${prediction.id} is waiting for manual review.`
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
