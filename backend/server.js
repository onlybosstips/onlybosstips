
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

let supabase = null;

if (supabaseUrl && supabaseSecretKey) {
  supabase = createClient(supabaseUrl, supabaseSecretKey);
  console.log("Supabase connection configured.");
} else {
  console.error("Supabase environment variables are missing.");
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ONLYBOSSTIPS automatic football tracking API is running."
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "ONLYBOSSTIPS API",
    supabaseConfigured: Boolean(supabase)
  });
});

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

app.listen(PORT, () => {
  console.log(`ONLYBOSSTIPS API running on port ${PORT}`);
});
