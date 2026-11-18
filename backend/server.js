
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const footballApiKey = process.env.API_FOOTBALL_KEY;
const footballApiUrl = "https://v3.football.api-sports.io";

const WEBSITE_URL = "https://onlybosstips.onrender.com";

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin === WEBSITE_URL) {
    res.setHeader("Access-Control-Allow-Origin", WEBSITE_URL);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "20kb" }));

let supabase = null;

if (supabaseUrl && supabaseSecretKey) {
  supabase = createClient(supabaseUrl, supabaseSecretKey);
  console.log("Supabase connection configured.");
}

if (footballApiKey) {
  console.log("API-Football configuration detected.");
}

const searchRequests = new Map();

function normalizeTeam(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamMatches(requested, actual) {
  const a = normalizeTeam(requested);
  const b = normalizeTeam(actual);

  if (!a || !b) return false;
  if (a === b) return true;

  return (
    (a.length >= 6 && b.includes(a)) ||
    (b.length >= 6 && a.includes(b))
  );
}

async function footballRequest(endpoint) {
  const response = await fetch(
    `${footballApiUrl}${endpoint}`,
    {
      headers: {
        "x-apisports-key": footballApiKey
      },
      signal: AbortSignal.timeout(20000)
    }
  );

  const data = await response.json();

  if (
    !response.ok ||
    Object.keys(data.errors || {}).length > 0
  ) {
    throw new Error("Football API request failed.");
  }

  return data;
}

async function requireAdmin(req, res, next) {
  if (!supabase) {
    return res.status(503).json({
      success: false,
      message: "Database is not configured."
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Administrator authentication required."
    });
  }

  try {
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired login session."
      });
    }

    const { data: admin, error: adminError } =
      await supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", authData.user.id)
        .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({
        success: false,
        message: "Administrator access denied."
      });
    }

    req.adminUser = authData.user;
    next();

  } catch (error) {
    console.error("Admin authentication error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Administrator verification failed."
    });
  }
}

// HOME
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ONLYBOSSTIPS automatic football tracking API is running."
  });
});

// GENERAL HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "ONLYBOSSTIPS API",
    supabaseConfigured: Boolean(supabase),
    footballConfigured: Boolean(footballApiKey)
  });
});

// DATABASE CHECK
app.get("/health/database", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({
      success: false,
      message: "Database connection is not configured."
    });
  }

  try {
    const { error } = await supabase
      .from("predictions")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Database check failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Database check failed."
      });
    }

    res.json({
      success: true,
      message: "ONLYBOSSTIPS database connection is working."
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Database connection error."
    });
  }
});

// API-FOOTBALL CONNECTION CHECK
app.get("/health/football", async (req, res) => {
  if (!footballApiKey) {
    return res.status(503).json({
      success: false,
      message: "API-Football key is not configured."
    });
  }

  try {
    await footballRequest("/status");

    res.json({
      success: true,
      message: "ONLYBOSSTIPS is connected to API-Football."
    });

  } catch (error) {
    console.error("Football API error:", error.message);

    res.status(502).json({
      success: false,
      message: "Unable to verify API-Football connection."
    });
  }
});

// SEARCH FIXTURES BY DATE AND TEAMS
app.get("/fixtures/search", async (req, res) => {
  if (!footballApiKey) {
    return res.status(503).json({
      success: false,
      message: "API-Football key is not configured."
    });
  }

  const { home, away, date } = req.query;

  if (
    typeof home !== "string" ||
    typeof away !== "string" ||
    typeof date !== "string" ||
    home.length < 2 ||
    away.length < 2 ||
    home.length > 80 ||
    away.length > 80 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide home, away and a valid date in YYYY-MM-DD format."
    });
  }

  const clientIp = req.ip;
  const now = Date.now();
  const previous = searchRequests.get(clientIp) || [];
  const recent = previous.filter(time => now - time < 60000);

  if (recent.length >= 10) {
    return res.status(429).json({
      success: false,
      message: "Too many searches. Please wait one minute."
    });
  }

  recent.push(now);
  searchRequests.set(clientIp, recent);

  try {
    const url = new URL(`${footballApiUrl}/fixtures`);
    url.searchParams.set("date", date);
    url.searchParams.set("timezone", "Africa/Lagos");

    const data = await footballRequest(
      `/fixtures?${url.searchParams.toString()}`
    );

    const fixtures = (data.response || [])
      .filter(item =>
        teamMatches(home, item.teams.home.name) &&
        teamMatches(away, item.teams.away.name)
      )
      .map(item => ({
        fixture_id: item.fixture.id,
        date: item.fixture.date,
        timezone: "Africa/Lagos",
        status: item.fixture.status.short,
        league: item.league.name,
        country: item.league.country,
        home_team: item.teams.home.name,
        away_team: item.teams.away.name,
        home_team_id: item.teams.home.id,
        away_team_id: item.teams.away.id
      }));

    res.json({
      success: true,
      message: fixtures.length
        ? "Possible fixtures found. Confirm the correct match before linking."
        : "No clear fixture match found for those teams and date.",
      requested: { home, away, date },
      count: fixtures.length,
      fixtures
    });

  } catch (error) {
    console.error("Fixture search error:", error.message);

    res.status(502).json({
      success: false,
      message: "Fixture search could not be completed."
    });
  }
});

// SECURELY LINK A CONFIRMED FIXTURE TO A PREDICTION
app.post("/predictions/link-fixture", requireAdmin, async (req, res) => {
  if (!footballApiKey) {
    return res.status(503).json({
      success: false,
      message: "API-Football key is not configured."
    });
  }

  const { prediction_id, fixture_id } = req.body || {};

  if (
    (typeof prediction_id !== "string" &&
      typeof prediction_id !== "number") ||
    !String(prediction_id).trim() ||
    !Number.isInteger(Number(fixture_id)) ||
    Number(fixture_id) <= 0
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid prediction_id and fixture_id are required."
    });
  }

  try {
    const { data: prediction, error: predictionError } =
      await supabase
        .from("predictions")
        .select("id, home_team, away_team, kickoff, api_fixture_id")
        .eq("id", prediction_id)
        .maybeSingle();

    if (predictionError) {
      console.error("Prediction lookup failed:", predictionError.message);

      return res.status(500).json({
        success: false,
        message: "Could not check the prediction."
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

    const data = await footballRequest(
      `/fixtures?id=${Number(fixture_id)}`
    );

    const fixture = data.response?.[0];

    if (!fixture) {
      return res.status(404).json({
        success: false,
        message: "Fixture not found on API-Football."
      });
    }

    const correctHome = teamMatches(
      prediction.home_team,
      fixture.teams.home.name
    );

    const correctAway = teamMatches(
      prediction.away_team,
      fixture.teams.away.name
    );

    if (!correctHome || !correctAway) {
      return res.status(409).json({
        success: false,
        message: "The fixture teams do not match this prediction."
      });
    }

    const predictionTime = new Date(prediction.kickoff).getTime();
    const fixtureTime = new Date(fixture.fixture.date).getTime();

    if (
      !Number.isFinite(predictionTime) ||
      !Number.isFinite(fixtureTime) ||
      Math.abs(predictionTime - fixtureTime) > 18 * 60 * 60 * 1000
    ) {
      return res.status(409).json({
        success: false,
        message: "The fixture kickoff time does not match the prediction."
      });
    }

    const { data: linked, error: updateError } =
      await supabase
        .from("predictions")
        .update({
          api_fixture_id: fixture.fixture.id,
          fixture_status: fixture.fixture.status.short,
          tracking_updated_at: new Date().toISOString()
        })
        .eq("id", prediction_id)
        .is("api_fixture_id", null)
        .select("id, api_fixture_id, fixture_status")
        .maybeSingle();

    if (updateError) {
      console.error("Fixture linking failed:", updateError.message);

      return res.status(500).json({
        success: false,
        message: "Could not save the fixture link."
      });
    }

    if (!linked) {
      return res.status(409).json({
        success: false,
        message: "The prediction may already have been linked. Refresh and check it."
      });
    }

    res.json({
      success: true,
      message: "Fixture successfully linked to the prediction.",
      prediction: linked,
      fixture: {
        fixture_id: fixture.fixture.id,
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        kickoff: fixture.fixture.date,
        status: fixture.fixture.status.short,
        league: fixture.league.name
      }
    });

  } catch (error) {
    console.error("Fixture linking error:", error.message);

    res.status(502).json({
      success: false,
      message: "Fixture linking could not be completed."
    });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`ONLYBOSSTIPS API running on port ${PORT}`);
});
