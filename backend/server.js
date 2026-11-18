
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// CORS CONFIGURATION (NO CORS PACKAGE)
// =====================================

app.use((req, res, next) => {
  const allowedOrigins = [
    "https://onlybosstips.onrender.com"
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

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
// API-FOOTBALL CONFIGURATION
// =====================================

const footballApiKey = process.env.API_FOOTBALL_KEY;

const footballApiUrl =
  "https://v3.football.api-sports.io";

// =====================================
// TEAM NAME HELPERS
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

  return (
    a === b ||
    a.includes(b) ||
    b.includes(a)
  );
}

// =====================================
// API-FOOTBALL REQUEST HELPER
// =====================================

async function footballRequest(endpoint) {
  if (!footballApiKey) {
    throw new Error("API_FOOTBALL_KEY is missing in Render.");
  }

  try {
    const response = await fetch(
      `${footballApiUrl}${endpoint}`,
      {
        method: "GET",
        headers: {
          "x-apisports-key": footballApiKey
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        "API-Football returned invalid JSON. HTTP:",
        response.status
      );

      throw new Error(
        `API-Football returned invalid JSON. HTTP ${response.status}`
      );
    }

    if (!response.ok || Object.keys(data.errors || {}).length > 0) {
      console.error("API-Football diagnostic:", {
        httpStatus: response.status,
        errors: data.errors || {},
        message: data.message || "No message returned"
      });

      throw new Error(
        `API-Football HTTP ${response.status}: ${
          JSON.stringify(data.errors || data.message)
        }`
      );
    }

    return data;

  } catch (error) {
    console.error("Football API error:", error.message);
    throw error;
  }
}

// =====================================
// ADMIN AUTHENTICATION
// =====================================

async function requireAdmin(req, res, next) {
  try {
    if (!supabase) {
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

    const token = authorization.substring(7);

    const {
      data: userData,
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !userData.user) {
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

    if (adminError || !admin) {
      return res.status(403).json({
        success: false,
        message: "Administrator access denied."
      });
    }

    req.adminUser = userData.user;

    next();

  } catch (error) {
    console.error("Admin authentication error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify administrator."
    });
  }
}

// =====================================
// HOME ROUTE
// =====================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ONLYBOSSTIPS API is running."
  });
});

// =====================================
// GENERAL HEALTH CHECK
// =====================================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "ONLYBOSSTIPS backend is online."
  });
});

// =====================================
// DATABASE HEALTH CHECK
// =====================================

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

    if (error) {
      console.error("Database health error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to verify database connection."
      });
    }

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

// =====================================
// API-FOOTBALL HEALTH CHECK
// =====================================

app.get("/health/football", async (req, res) => {
  try {
    if (!footballApiKey) {
      return res.status(500).json({
        success: false,
        message: "API_FOOTBALL_KEY is missing in Render."
      });
    }

    await footballRequest("/status");

    return res.json({
      success: true,
      message: "ONLYBOSSTIPS is connected to API-Football."
    });

  } catch (error) {
    console.error(
      "Football health check failed:",
      error.message
    );

    return res.status(502).json({
      success: false,
      message: "Unable to verify API-Football connection.",
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

    const data = await footballRequest(
      `/fixtures?date=${encodeURIComponent(date)}`
    );

    const fixtures = (data.response || [])
      .filter(item => {
        return (
          teamMatches(item.teams.home.name, home) &&
          teamMatches(item.teams.away.name, away)
        );
      })
      .map(item => ({
        fixture_id: item.fixture.id,
        date: item.fixture.date,
        timezone: item.fixture.timezone,
        status: item.fixture.status.short,
        league: item.league.name,
        country: item.league.country,
        home_team: item.teams.home.name,
        away_team: item.teams.away.name,
        home_team_id: item.teams.home.id,
        away_team_id: item.teams.away.id
      }));

    return res.json({
      success: true,
      message: "Possible fixtures found. Confirm the correct match before linking.",
      requested: {
        home,
        away,
        date
      },
      count: fixtures.length,
      fixtures
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

      if (predictionError || !prediction) {
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

      const fixtureData = await footballRequest(
        `/fixtures?id=${encodeURIComponent(fixtureId)}`
      );

      const fixture = fixtureData.response?.[0];

      if (!fixture) {
        return res.status(404).json({
          success: false,
          message: "Fixture not found on API-Football."
        });
      }

      const homeTeam = fixture.teams.home.name;
      const awayTeam = fixture.teams.away.name;

      if (
        !teamMatches(prediction.home_team, homeTeam) ||
        !teamMatches(prediction.away_team, awayTeam)
      ) {
        return res.status(400).json({
          success: false,
          message: "The selected fixture does not match this prediction.",
          prediction: {
            home: prediction.home_team,
            away: prediction.away_team
          },
          fixture: {
            home: homeTeam,
            away: awayTeam
          }
        });
      }

      const predictionTime = new Date(prediction.kickoff).getTime();
      const fixtureTime = new Date(fixture.fixture.date).getTime();

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
          api_fixture_id: fixture.fixture.id,
          fixture_status: fixture.fixture.status.short,
          tracking_updated_at: new Date().toISOString()
        })
        .eq("id", predictionId)
        .select()
        .single();

      if (updateError) {
        console.error("Fixture linking database error:", updateError.message);

        return res.status(500).json({
          success: false,
          message: "Unable to save the fixture link."
        });
      }

      return res.json({
        success: true,
        message: "Fixture successfully linked to prediction.",
        prediction: updatedPrediction,
        fixture: {
          fixture_id: fixture.fixture.id,
          home_team: homeTeam,
          away_team: awayTeam,
          kickoff: fixture.fixture.date,
          status: fixture.fixture.status.short
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
// START SERVER
// =====================================

app.listen(PORT, () => {
  console.log(`ONLYBOSSTIPS API running on port ${PORT}`);
});
