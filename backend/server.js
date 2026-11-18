
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// SUPABASE CONFIGURATION
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

let supabase = null;

if (supabaseUrl && supabaseSecretKey) {
  supabase = createClient(supabaseUrl, supabaseSecretKey);
  console.log("Supabase connection configured.");
} else {
  console.error("Supabase environment variables are missing.");
}

// API-FOOTBALL CONFIGURATION
const footballApiKey = process.env.API_FOOTBALL_KEY;
const footballApiUrl = "https://v3.football.api-sports.io";

if (footballApiKey) {
  console.log("API-Football configuration detected.");
} else {
  console.error("API_FOOTBALL_KEY is missing.");
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

// SUPABASE DATABASE TEST
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

// API-FOOTBALL CONNECTION TEST
app.get("/health/football", async (req, res) => {
  if (!footballApiKey) {
    return res.status(503).json({
      success: false,
      message: "API-Football key is not configured."
    });
  }

  try {
    const response = await fetch(
      `${footballApiUrl}/status`,
      {
        method: "GET",
        headers: {
          "x-apisports-key": footballApiKey
        },
        signal: AbortSignal.timeout(15000)
      }
    );

    const data = await response.json();

    if (!response.ok || (data.errors && Object.keys(data.errors).length > 0)) {
      console.error("API-Football check failed:", {
        status: response.status,
        errors: data.errors
      });

      return res.status(502).json({
        success: false,
        message: "API-Football connection failed. Check the API key and subscription."
      });
    }

    res.json({
      success: true,
      message: "ONLYBOSSTIPS is connected to API-Football."
    });

  } catch (error) {
    console.error("API-Football connection error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to reach API-Football."
    });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`ONLYBOSSTIPS API running on port ${PORT}`);
});
