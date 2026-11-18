
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const footballApiKey = process.env.API_FOOTBALL_KEY;
const footballApiUrl = "https://v3.football.api-sports.io";

let supabase = null;

if (supabaseUrl && supabaseSecretKey) {
  supabase = createClient(supabaseUrl, supabaseSecretKey);
  console.log("Supabase connection configured.");
}

if (footballApiKey) {
  console.log("API-Football configuration detected.");
}

// Simple rate limit for fixture searches
const searchRequests = new Map();

function normalizeTeam(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamMatches(requested, actual) {
  const a = normalizeTeam(requested);
  const b = normalizeTeam(actual);

  return a === b || a.includes(b) || b.includes(a);
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
    console.error("Database error:", error.message);
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
    const response = await fetch(`${footballApiUrl}/status`, {
      headers: {
        "x-apisports-key": footballApiKey
      },
      signal: AbortSignal.timeout(15000)
    });

    const data = await response.json();

    if (!response.ok || Object.keys(data.errors || {}).length > 0) {
      return res.status(502).json({
        success: false,
        message: "API-Football connection failed."
      });
    }

    res.json({
      success: true,
      message: "ONLYBOSSTIPS is connected to API-Football."
    });

  } catch (error) {
    console.error("Football API error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to reach API-Football."
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

  // Limit searches to 10 per minute per IP
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

    const response = await fetch(url, {
      headers: {
        "x-apisports-key": footballApiKey
      },
      signal: AbortSignal.timeout(20000)
    });

    const data = await response.json();

    if (!response.ok || Object.keys(data.errors || {}).length > 0) {
      console.error("Fixture search failed:", {
        status: response.status,
        errors: data.errors
      });

      return res.status(502).json({
        success: false,
        message: "API-Football could not return fixtures."
      });
    }

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

    res.status(500).json({
      success: false,
      message: "Fixture search could not be completed."
    });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`ONLYBOSSTIPS API running on port ${PORT}`);
});
