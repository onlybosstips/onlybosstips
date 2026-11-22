
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// CORS
// =====================================

app.use((req, res, next) => {
  const allowedOrigins = ["https://onlybosstips.onrender.com"];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

// =====================================
// SUPABASE
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
// SPORTAPI
// =====================================

const sportApiKey = process.env.SPORTAPI_KEY;
const sportApiUrl = "https://sportapi.ai/api";

async function sportApiRequest(endpoint) {
  if (!sportApiKey) throw new Error("SPORTAPI_KEY is missing in Render.");

  const response = await fetch(`${sportApiUrl}${endpoint}`, {
    method: "GET",
    headers: { "X-Api-Key": sportApiKey },
    signal: AbortSignal.timeout(20000)
  });

  const responseText = await response.text();
  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`SportAPI returned invalid JSON. HTTP ${response.status}`);
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
    manutd: "manchesterunited",
    manutdfootball: "manchesterunited",
    manunited: "manchesterunited",
    manchesterutd: "manchesterunited",
    manchesterunitedfc: "manchesterunited",
    mancity: "manchestercity",
    manchestercityfc: "manchestercity",
    liverpoolfc: "liverpool",
    lfc: "liverpool",
    arsenalfc: "arsenal",
    chelseafc: "chelsea",
    spurs: "tottenhamhotspur",
    tottenhamhotspurfc: "tottenhamhotspur",
    newcastleunitedfc: "newcastleunited",
    nufc: "newcastleunited",
    psg: "parissaintgermain",
    parissaintgermainfc: "parissaintgermain",
    atleticomadrid: "atleticodemadrid",
    atleticodemadridfc: "atleticodemadrid",
    inter: "internazionale",
    intermilan: "internazionale",
    fcinternazionale: "internazionale",
    acmilan: "milan",
    juventusfc: "juventus",
    bayernmunich: "bayernmunchen",
    fcbayernmunchen: "bayernmunchen",
    fcbarcelona: "barcelona",
    realmadridcf: "realmadrid",
    dortmund: "borussiadortmund",
    bvb: "borussiadortmund",

    // Basketball team aliases
    lalakers: "losangeleslakers",
    lakers: "losangeleslakers",
    laclippers: "losangelesclippers",
    clippers: "losangelesclippers",
    nyknicks: "newyorkknicks",
    knicks: "newyorkknicks",
    gswarriors: "goldenstatewarriors",
    warriors: "goldenstatewarriors",
    okcthunder: "oklahomacitythunder",
    thunder: "oklahomacitythunder",
    phx: "phoenixsuns",
    suns: "phoenixsuns",
    sixers: "philadelphia76ers",
    philly76ers: "philadelphia76ers",
    blazers: "portlandtrailblazers",
    trailblazers: "portlandtrailblazers"
  };

  if (aliases[value]) return aliases[value];

  return value.replace(
    /(footballclub|soccerclub|club|women|ladies|fc|cf|afc|sc)$/g,
    ""
  );
}

function teamMatches(first, second) {
  const a = normalizeTeam(first);
  const b = normalizeTeam(second);
  return !!a && !!b && a === b;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
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
  return ["POSTPONED", "CANCELLED", "CANCELED"].includes(
    String(status || "").trim().toUpperCase()
  );
}

function basketballFinalStatus(status) {
  return ["FT", "AOT"].includes(
    String(status || "").trim().toUpperCase()
  );
}

function basketballVoidStatus(status) {
  return ["POST", "CANC"].includes(
    String(status || "").trim().toUpperCase()
  );
}

function kickoffDate(value) {
  const time = new Date(value);
  return Number.isFinite(time.getTime())
    ? time.toISOString().slice(0, 10)
    : null;
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getBasketballTeams(game) {
  return {
    home: game?.home?.name || "",
    away: game?.away?.name || ""
  };
}

function getBasketballStart(game) {
  return game?.start || game?.date || game?.datetime || null;
}

function getBasketballScores(game) {
  return {
    home: safeNumber(game?.home?.score),
    away: safeNumber(game?.away?.score)
  };
}

// =====================================
// FOOTBALL 1UP / 2UP
// =====================================

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

  if (/\b(home|home team)\b/.test(marketType)) side = "home";
  else if (/\b(away|away team)\b/.test(marketType)) side = "away";
  else if (/\b(home|home team)\b/.test(selection)) side = "home";
  else if (/\b(away|away team)\b/.test(selection)) side = "away";
  else if (prediction.home_team && selection &&
    teamMatches(selection, prediction.home_team)) side = "home";
  else if (prediction.away_team && selection &&
    teamMatches(selection, prediction.away_team)) side = "away";

  return side ? { requiredLead, side } : null;
}

function settleOneUpTwoUpMarket(prediction, fixture, eventsResponse) {
  const market = getOneUpTwoUpDetails(prediction);
  if (!market) return null;

  const finalHome = safeNumber(fixture.home_score);
  const finalAway = safeNumber(fixture.away_score);
  if (finalHome === null || finalAway === null) return null;

  let events = [];

  if (Array.isArray(eventsResponse)) events = eventsResponse;
  else if (Array.isArray(eventsResponse?.data)) events = eventsResponse.data;
  else if (Array.isArray(eventsResponse?.data?.data)) {
    events = eventsResponse.data.data;
  } else return null;

  const goals = [];

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event) continue;

    if (normalizedText(event.event_type || event.type) !== "goal") continue;

    const side = String(event.team_side || "").trim().toLowerCase();
    if (side !== "home" && side !== "away") return null;

    const minuteMatch = String(event.minute || "")
      .trim()
      .match(/^(\d+)(?:\s*\+\s*(\d+))?/);

    if (!minuteMatch) return null;

    goals.push({
      side,
      order: Number(minuteMatch[1]) * 1000 + Number(minuteMatch[2] || 0),
      originalIndex: index
    });
  }

  goals.sort((a, b) =>
    a.order !== b.order ? a.order - b.order :
    a.originalIndex - b.originalIndex
  );

  let homeGoals = 0;
  let awayGoals = 0;
  let achievedLead = false;

  for (const goal of goals) {
    if (goal.side === "home") homeGoals++;
    else awayGoals++;

    const lead = market.side === "home"
      ? homeGoals - awayGoals
      : awayGoals - homeGoals;

    if (lead >= market.requiredLead) achievedLead = true;
  }

  if (homeGoals !== finalHome || awayGoals !== finalAway) return null;
  return achievedLead ? "won" : "lost";
}

// =====================================
// FOOTBALL MARKET SETTLEMENT
// =====================================

function settleScoreMarket(prediction, fixture) {
  const home = safeNumber(fixture.home_score);
  const away = safeNumber(fixture.away_score);
  if (home === null || away === null) return null;

  const htHome = safeNumber(fixture.ht_home);
  const htAway = safeNumber(fixture.ht_away);

  const selection = normalizedText(prediction.market_selection);
  const marketType = normalizedText(
    prediction.market_type || prediction.market_category
  );
  const category = normalizedText(prediction.market_category);
  const predictionText = normalizedText(prediction.prediction);
  const combined = `${marketType} ${selection} ${predictionText}`;

  const line = safeNumber(prediction.market_line) ??
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
      return value === line ? "void" : value > line ? "won" : "lost";
    }

    if (/\bunder\b/.test(selection) || /\bunder\b/.test(marketType)) {
      return value === line ? "void" : value < line ? "won" : "lost";
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

  if (/full time result|match result|1x2/.test(marketType) ||
      category === "match result") {
    if (/draw no bet/.test(marketType)) {
      if (draw) return "void";
      return selectedSide(homeWin ? "won" : "lost", null,
        awayWin ? "won" : "lost");
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

  if (category === "double chance" || /double chance/.test(marketType)) {
    if (/home or draw|1x/.test(selection)) return homeWin || draw ? "won" : "lost";
    if (/draw or away|x2/.test(selection)) return draw || awayWin ? "won" : "lost";
    if (/home or away|12/.test(selection)) return homeWin || awayWin ? "won" : "lost";
  }

  if (category === "both teams to score" ||
      /both teams to score|btts/.test(marketType)) {
    const bothScored = home > 0 && away > 0;
    const text = normalizedText(
      `${prediction.market_selection || ""} ${prediction.prediction || ""} ` +
      `${prediction.market_type || ""} ${prediction.market_category || ""}`
    );
    const yes = /\b(yes|gg)\b/.test(text);
    const no = /\b(no|ng)\b/.test(text);

    if (/btts and over 2 5|both teams to score and over 2 5/.test(combined)) {
      return bothScored && totalGoals > 2.5 ? "won" : "lost";
    }
    if (/btts and under 2 5|both teams to score and under 2 5/.test(combined)) {
      return bothScored && totalGoals < 2.5 ? "won" : "lost";
    }
    if (yes && !no) return bothScored ? "won" : "lost";
    if (no && !yes) return !bothScored ? "won" : "lost";
    return null;
  }

  if (/total goals over under/.test(marketType)) return overUnder(totalGoals);
  if (/home team goals over under/.test(marketType)) return overUnder(home);
  if (/away team goals over under/.test(marketType)) return overUnder(away);

  if (/exact total goals/.test(marketType)) {
    const exact = safeNumber(prediction.market_line ?? prediction.market_selection);
    return exact === null ? null : totalGoals === exact ? "won" : "lost";
  }

  if (/home team to score/.test(combined)) return home > 0 ? "won" : "lost";
  if (/away team to score/.test(combined)) return away > 0 ? "won" : "lost";
  if (/home clean sheet/.test(combined)) return away === 0 ? "won" : "lost";
  if (/away clean sheet/.test(combined)) return home === 0 ? "won" : "lost";
  if (/home win by 2 or more/.test(combined)) return home - away >= 2 ? "won" : "lost";
  if (/away win by 2 or more/.test(combined)) return away - home >= 2 ? "won" : "lost";
  if (/home win by 1 goal/.test(combined)) return home - away === 1 ? "won" : "lost";
  if (/away win by 1 goal/.test(combined)) return away - home === 1 ? "won" : "lost";
  if (/match to have no goals/.test(combined)) return totalGoals === 0 ? "won" : "lost";

  if (/correct score/.test(marketType)) {
    const match = (selection || predictionText).match(/\b(\d+)\s*[-:]\s*(\d+)\b/);
    if (match) {
      return home === Number(match[1]) && away === Number(match[2])
        ? "won" : "lost";
    }
  }

  if (/half time result|half time goals|half time correct score|correct score half time|correct score first half|home half time goals|away half time goals/.test(marketType)) {
    if (htHome === null || htAway === null) return null;

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
    if (/home half time goals/.test(marketType)) return overUnder(htHome);
    if (/away half time goals/.test(marketType)) return overUnder(htAway);

    if (/correct score/.test(marketType)) {
      const match = (selection || predictionText).match(/\b(\d+)\s*[-:]\s*(\d+)\b/);
      if (match) {
        return htHome === Number(match[1]) && htAway === Number(match[2])
          ? "won" : "lost";
      }
    }
  }

  if (/second half result|second half goals over under/.test(marketType)) {
    if (htHome === null || htAway === null) return null;

    const secondHome = home - htHome;
    const secondAway = away - htAway;
    if (secondHome < 0 || secondAway < 0) return null;

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
    return (home - htHome) + (away - htAway) > 0 ? "won" : "lost";
  }

  if (/goal in both halves/.test(combined)) {
    if (htHome === null || htAway === null) return null;
    const first = htHome + htAway;
    const second = (home - htHome) + (away - htAway);
    return first > 0 && second > 0 ? "won" : "lost";
  }

  if (/home team to win either half/.test(combined)) {
    if (htHome === null || htAway === null) return null;
    return htHome > htAway || (home - htHome) > (away - htAway)
      ? "won" : "lost";
  }

  if (/away team to win either half/.test(combined)) {
    if (htHome === null || htAway === null) return null;
    return htAway > htHome || (away - htAway) > (home - htHome)
      ? "won" : "lost";
  }

  return null;
}

// =====================================
// BASKETBALL MARKET SETTLEMENT
// =====================================

// SportAPI supplies overall scores and an array of
// points scored in each period. We only settle markets
// that can be verified from those scores.

function getBasketballPeriods(game) {
  const home = Array.isArray(game?.home?.periods)
    ? game.home.periods.map(safeNumber) : [];
  const away = Array.isArray(game?.away?.periods)
    ? game.away.periods.map(safeNumber) : [];

  if (!home.length || !away.length) return null;
  if (home.some(v => v === null) || away.some(v => v === null)) return null;

  return { home, away };
}

function basketballSelectionSide(prediction, selection, text) {
  const combined = `${selection} ${text}`;

  if (prediction.home_team &&
      (teamMatches(combined, prediction.home_team) ||
       teamMatches(selection, prediction.home_team))) return "home";

  if (prediction.away_team &&
      (teamMatches(combined, prediction.away_team) ||
       teamMatches(selection, prediction.away_team))) return "away";

  if (/\b(home|home team)\b/.test(combined)) return "home";
  if (/\b(away|away team)\b/.test(combined)) return "away";

  return null;
}

function basketballLine(prediction, combined) {
  const stored = safeNumber(prediction.market_line);
  if (stored !== null) return stored;

  const match = combined.match(/(?:over|under|[+-])\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function settleBasketballMarket(prediction, game) {
  const scores = getBasketballScores(game);
  const periods = getBasketballPeriods(game);

  if (scores.home === null || scores.away === null) return null;

  const selection = normalizedText(prediction.market_selection);
  const type = normalizedText(prediction.market_type);
  const category = normalizedText(prediction.market_category);
  const predictionText = normalizedText(prediction.prediction);
  const combined = `${type} ${category} ${selection} ${predictionText}`;

  const home = scores.home;
  const away = scores.away;
  const total = home + away;

  const side = basketballSelectionSide(
    prediction,
    selection,
    `${type} ${predictionText}`
  );

  const line = basketballLine(prediction, combined);

  function settleTotal(value) {
    if (line === null) return null;

    const over = /\bover\b/.test(combined);
    const under = /\bunder\b/.test(combined);

    if (over === under) return null;
    if (value === line) return "void";

    return over
      ? (value > line ? "won" : "lost")
      : (value < line ? "won" : "lost");
  }

  function settleWinner(homeScore, awayScore) {
    if (homeScore === awayScore) return null;

    if (/\b(draw|tie)\b/.test(combined)) return null;

    if (side === "home") return homeScore > awayScore ? "won" : "lost";
    if (side === "away") return awayScore > homeScore ? "won" : "lost";

    // Also allow the selected team name to appear as
    // the selection itself.
    if (prediction.home_team &&
        teamMatches(selection, prediction.home_team)) {
      return homeScore > awayScore ? "won" : "lost";
    }

    if (prediction.away_team &&
        teamMatches(selection, prediction.away_team)) {
      return awayScore > homeScore ? "won" : "lost";
    }

    return null;
  }

  // Quarter and half markets require verified period scores.
  if (periods) {
    const quarterMatch = combined.match(
      /\b(?:q|quarter)\s*([1-4])\b|\b(first|second|third|fourth)\s+quarter\b/
    );

    let quarter = null;

    if (quarterMatch) {
      if (quarterMatch[1]) quarter = Number(quarterMatch[1]);
      else {
        quarter = {
          first: 1,
          second: 2,
          third: 3,
          fourth: 4
        }[quarterMatch[2]];
      }
    }

    if (quarter && periods.home.length >= quarter &&
        periods.away.length >= quarter) {
      const qHome = periods.home[quarter - 1];
      const qAway = periods.away[quarter - 1];

      if (/winner|win|result|moneyline/.test(combined)) {
        return settleWinner(qHome, qAway);
      }

      if (/total|over|under|points/.test(combined)) {
        return settleTotal(qHome + qAway);
      }

      if (/spread|handicap/.test(combined)) {
        return settleBasketballSpread(
          prediction, qHome, qAway, side, line, combined
        );
      }
    }

    if (/first half|1st half|half 1|h1/.test(combined)) {
      if (periods.home.length < 2 || periods.away.length < 2) return null;

      const hHome = periods.home[0] + periods.home[1];
      const hAway = periods.away[0] + periods.away[1];

      if (/winner|win|result|moneyline/.test(combined)) {
        return settleWinner(hHome, hAway);
      }

      if (/spread|handicap/.test(combined)) {
        return settleBasketballSpread(
          prediction, hHome, hAway, side, line, combined
        );
      }

      if (/total|over|under|points/.test(combined)) {
        return settleTotal(hHome + hAway);
      }
    }

    if (/second half|2nd half|half 2|h2/.test(combined)) {
      if (periods.home.length < 4 || periods.away.length < 4) return null;

      const hHome = periods.home[2] + periods.home[3];
      const hAway = periods.away[2] + periods.away[3];

      if (/winner|win|result|moneyline/.test(combined)) {
        return settleWinner(hHome, hAway);
      }

      if (/spread|handicap/.test(combined)) {
        return settleBasketballSpread(
          prediction, hHome, hAway, side, line, combined
        );
      }

      if (/total|over|under|points/.test(combined)) {
        return settleTotal(hHome + hAway);
      }
    }
  }

  // Full game team totals.
  if (/team total|home total|away total|team points/.test(combined)) {
    let teamSide = side;

    if (!teamSide && /\bhome\b/.test(combined)) teamSide = "home";
    if (!teamSide && /\baway\b/.test(combined)) teamSide = "away";

    if (!teamSide) return null;

    return settleTotal(teamSide === "home" ? home : away);
  }

  // Full game point spread / handicap.
  if (/spread|handicap|points handicap/.test(combined)) {
    return settleBasketballSpread(
      prediction, home, away, side, line, combined
    );
  }

  // Full game total points.
  if (/total points|match points|game points|over under|total score/.test(combined)) {
    return settleTotal(total);
  }

  // Match winner / moneyline. Basketball has no draw
  // outcome for ordinary match-winner markets.
  if (/winner|moneyline|match result|game result|to win/.test(combined)) {
    return settleWinner(home, away);
  }

  return null;
}

function settleBasketballSpread(
  prediction,
  homeScore,
  awayScore,
  side,
  line,
  combined
) {
  if (line === null) return null;

  if (!side) {
    const selection = normalizedText(prediction.market_selection);

    if (prediction.home_team && teamMatches(selection, prediction.home_team)) {
      side = "home";
    } else if (prediction.away_team &&
               teamMatches(selection, prediction.away_team)) {
      side = "away";
    }
  }

  if (!side) return null;

  // Prefer a signed handicap written with the team selection,
  // such as "Lakers -3.5" or "Celtics +4.5".
  const signed = String(
    prediction.market_selection || prediction.prediction || ""
  ).match(/([+-]\s*\d+(?:\.\d+)?)/);

  let handicap = line;

  if (signed) {
    handicap = Number(signed[1].replace(/\s/g, ""));
  } else {
    // If the selection itself does not contain a sign,
    // the stored market_line must contain the signed value.
    if (!String(prediction.market_line ?? "").trim()) return null;
  }

  const selectedScore = side === "home" ? homeScore : awayScore;
  const opponentScore = side === "home" ? awayScore : homeScore;
  const adjusted = selectedScore + handicap;

  if (adjusted === opponentScore) return "void";
  return adjusted > opponentScore ? "won" : "lost";
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

    const token = authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required."
      });
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
      console.error("ADMIN TOKEN VERIFICATION FAILED:", userError?.message);

      return res.status(401).json({
        success: false,
        message: "Invalid or expired login session."
      });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError) {
      console.error("ADMIN TABLE LOOKUP FAILED:", adminError.message);

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
      .select("id, api_basketball_game_id")
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
      message: "Database connection failed. Check that the basketball ID column exists."
    });
  }
});

app.get("/health/football", async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const data = await sportApiRequest(`/fixtures/date/${date}`);

    return res.json({
      success: true,
      message: "ONLYBOSSTIPS is connected to SportAPI football.",
      fixtures_returned: Array.isArray(data.data) ? data.data.length : 0
    });

  } catch (error) {
    console.error("Football health check failed:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to verify SportAPI football connection.",
      diagnostic: error.message
    });
  }
});

app.get("/health/basketball", async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const data = await sportApiRequest(
      `/basketball/games/date/${date}?tz=UTC`
    );

    return res.json({
      success: true,
      message: "ONLYBOSSTIPS is connected to SportAPI basketball.",
      games_returned: Array.isArray(data.data) ? data.data.length : 0
    });

  } catch (error) {
    console.error("Basketball health check failed:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to verify SportAPI basketball connection.",
      diagnostic: error.message
    });
  }
});

// =====================================
// FOOTBALL FIXTURE SEARCH
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
      total_fixtures_returned: fixtures.length,
      matching_fixtures: results.length,
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
// BASKETBALL GAME SEARCH
// =====================================

app.get("/basketball/games/search", async (req, res) => {
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
      `/basketball/games/date/${encodeURIComponent(date)}?tz=UTC`
    );

    const games = Array.isArray(data.data) ? data.data : [];

    const matches = games.filter(game =>
      teamMatches(game?.home?.name, home) &&
      teamMatches(game?.away?.name, away)
    );

    return res.json({
      success: true,
      requested: { home, away, date },
      total_games_returned: games.length,
      matching_games: matches.length,
      games: matches
    });

  } catch (error) {
    console.error("Basketball game search error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to search basketball games.",
      diagnostic: error.message
    });
  }
});

// =====================================
// SECURE ADMIN FOOTBALL FIXTURE LINKING
// =====================================

app.post("/predictions/link-fixture", requireAdmin, async (req, res) => {
  try {
    const predictionId = req.body.prediction_id;
    const fixtureId = req.body.fixture_id;

    if (!predictionId || !fixtureId) {
      return res.status(400).json({
        success: false,
        message: "prediction_id and fixture_id are required."
      });
    }

    const { data: prediction, error: predictionError } = await supabase
      .from("predictions")
      .select("*")
      .eq("id", predictionId)
      .maybeSingle();

    if (predictionError) throw predictionError;
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

    if (prediction.api_fixture_id || prediction.api_basketball_game_id) {
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

    if (!teamMatches(prediction.home_team, fixture.home_team) ||
        !teamMatches(prediction.away_team, fixture.away_team)) {
      return res.status(400).json({
        success: false,
        message: "The selected fixture does not match this prediction."
      });
    }

    const predictionTime = new Date(prediction.kickoff).getTime();
    const fixtureTime = new Date(
      fixture.kickoff_utc || fixture.datetime
    ).getTime();

    if (!Number.isFinite(predictionTime) || !Number.isFinite(fixtureTime) ||
        Math.abs(predictionTime - fixtureTime) > 18 * 60 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        message: "Unable to verify kickoff time or the time differs by more than 18 hours."
      });
    }

    const { data: linked, error: updateError } = await supabase
      .from("predictions")
      .update({
        api_fixture_id: fixture.id,
        fixture_status: fixture.status,
        tracking_updated_at: new Date().toISOString()
      })
      .eq("id", predictionId)
      .eq("status", "pending")
      .is("api_fixture_id", null)
      .is("api_basketball_game_id", null)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({
      success: true,
      message: "Football fixture successfully linked.",
      prediction: linked
    });

  } catch (error) {
    console.error("Football fixture linking error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to link football fixture.",
      diagnostic: error.message
    });
  }
});

// =====================================
// SECURE ADMIN BASKETBALL GAME LINKING
// =====================================

app.post("/predictions/link-basketball-game", requireAdmin, async (req, res) => {
  try {
    const predictionId = req.body.prediction_id;
    const gameId = req.body.game_id;

    if (!predictionId || !gameId) {
      return res.status(400).json({
        success: false,
        message: "prediction_id and game_id are required."
      });
    }

    const { data: prediction, error: predictionError } = await supabase
      .from("predictions")
      .select("*")
      .eq("id", predictionId)
      .maybeSingle();

    if (predictionError) throw predictionError;
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

    if (prediction.api_fixture_id || prediction.api_basketball_game_id) {
      return res.status(409).json({
        success: false,
        message: "This prediction already has a linked game."
      });
    }

    const response = await sportApiRequest(
      `/basketball/games/${encodeURIComponent(gameId)}`
    );

    const game = response.data;

    if (!game) {
      return res.status(404).json({
        success: false,
        message: "Basketball game not found on SportAPI."
      });
    }

    const teams = getBasketballTeams(game);

    if (!teamMatches(prediction.home_team, teams.home) ||
        !teamMatches(prediction.away_team, teams.away)) {
      return res.status(400).json({
        success: false,
        message: "Basketball teams do not match this prediction."
      });
    }

    const predictionTime = new Date(prediction.kickoff).getTime();
    const gameTime = new Date(getBasketballStart(game)).getTime();

    if (!Number.isFinite(predictionTime) || !Number.isFinite(gameTime) ||
        Math.abs(predictionTime - gameTime) > 18 * 60 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        message: "Unable to verify basketball game kickoff time."
      });
    }

    const { data: linked, error: updateError } = await supabase
      .from("predictions")
      .update({
        api_basketball_game_id: String(game.id),
        fixture_status: game.status || null,
        tracking_updated_at: new Date().toISOString()
      })
      .eq("id", predictionId)
      .eq("status", "pending")
      .is("api_fixture_id", null)
      .is("api_basketball_game_id", null)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({
      success: true,
      message: "Basketball game successfully linked.",
      prediction: linked,
      game
    });

  } catch (error) {
    console.error("Basketball game linking error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to link basketball game.",
      diagnostic: error.message
    });
  }
});

// =====================================
// AUTOMATIC MATCH TRACKING & SETTLEMENT
// =====================================

let trackingBusy = false;

const missingFixtureChecks = new Map();
const MISSING_FIXTURE_RECHECK_MS = 15 * 60 * 1000;

let lastAutoLinkScanAt = 0;
const AUTO_LINK_INTERVAL_MS = 15 * 60 * 1000;
const AUTO_LINK_MAX_PREDICTIONS = 100;
const AUTO_LINK_MAX_DATE_GROUPS = 12;

// =====================================
// AUTOMATIC MATCHING FOR BOTH SPORTS
// =====================================

// Predictions use the same publishing form, so the
// backend checks both SportAPI sports before linking.
//
// A prediction is linked only when exactly one sport
// has exactly one matching fixture and the other sport
// has no matching fixture.
//
// This prevents basketball IDs being stored as football IDs.

async function autoLinkUnlinkedPredictions() {
  if (!supabase || !sportApiKey) return;

  if (Date.now() - lastAutoLinkScanAt < AUTO_LINK_INTERVAL_MS) {
    return;
  }

  try {
    const { data: unlinked, error } = await supabase
      .from("predictions")
      .select("*")
      .eq("status", "pending")
      .is("api_fixture_id", null)
      .is("api_basketball_game_id", null)
      .limit(AUTO_LINK_MAX_PREDICTIONS);

    if (error) throw error;

    lastAutoLinkScanAt = Date.now();

    if (!unlinked || unlinked.length === 0) {
      console.log("Automatic matching: no unlinked pending predictions.");
      return;
    }

    const now = Date.now();
    const earliestAllowed = now - 36 * 60 * 60 * 1000;
    const latestAllowed = now + 7 * 24 * 60 * 60 * 1000;

    const eligible = unlinked.filter(prediction => {
      const kickoff = new Date(prediction.kickoff).getTime();

      return Number.isFinite(kickoff) &&
        kickoff >= earliestAllowed &&
        kickoff <= latestAllowed &&
        prediction.home_team &&
        prediction.away_team;
    });

    const dateGroups = new Map();

    for (const prediction of eligible) {
      const date = kickoffDate(prediction.kickoff);
      if (!date) continue;

      if (!dateGroups.has(date)) dateGroups.set(date, []);
      dateGroups.get(date).push(prediction);
    }

    const footballCache = new Map();
    const basketballCache = new Map();

    async function getFootballFixtures(date) {
      if (!footballCache.has(date)) {
        footballCache.set(
          date,
          sportApiRequest(`/fixtures/date/${encodeURIComponent(date)}`)
            .then(data => Array.isArray(data.data) ? data.data : [])
        );
      }

      return footballCache.get(date);
    }

    async function getBasketballGames(date) {
      if (!basketballCache.has(date)) {
        basketballCache.set(
          date,
          sportApiRequest(
            `/basketball/games/date/${encodeURIComponent(date)}?tz=UTC`
          ).then(data => Array.isArray(data.data) ? data.data : [])
        );
      }

      return basketballCache.get(date);
    }

    let scannedGroups = 0;
    let footballLinked = 0;
    let basketballLinked = 0;

    for (const [date, predictionsForDate] of dateGroups) {
      scannedGroups++;

      if (scannedGroups > AUTO_LINK_MAX_DATE_GROUPS) {
        console.log("Automatic matching date scan limit reached.");
        break;
      }

      const dates = [
        shiftDate(date, -1),
        date,
        shiftDate(date, 1)
      ].filter(Boolean);

      let footballFixtures = [];
      let basketballGames = [];

      for (const searchDate of dates) {
        try {
          const fixtures = await getFootballFixtures(searchDate);
          footballFixtures.push(...fixtures);
        } catch (error) {
          console.error(
            `Football fixture search failed for ${searchDate}:`,
            error.message
          );
        }

        try {
          const games = await getBasketballGames(searchDate);
          basketballGames.push(...games);
        } catch (error) {
          console.error(
            `Basketball game search failed for ${searchDate}:`,
            error.message
          );
        }
      }

      const uniqueFootball = new Map();

      for (const fixture of footballFixtures) {
        if (fixture?.id !== undefined && fixture?.id !== null) {
          uniqueFootball.set(String(fixture.id), fixture);
        }
      }

      const uniqueBasketball = new Map();

      for (const game of basketballGames) {
        if (game?.id !== undefined && game?.id !== null) {
          uniqueBasketball.set(String(game.id), game);
        }
      }

      footballFixtures = Array.from(uniqueFootball.values());
      basketballGames = Array.from(uniqueBasketball.values());

      for (const prediction of predictionsForDate) {
        const predictionTime = new Date(prediction.kickoff).getTime();

        const matchingFootball = footballFixtures.filter(fixture => {
          if (
            !teamMatches(prediction.home_team, fixture.home_team) ||
            !teamMatches(prediction.away_team, fixture.away_team)
          ) {
            return false;
          }

          const fixtureTime = new Date(
            fixture.kickoff_utc || fixture.datetime || fixture.date
          ).getTime();

          return Number.isFinite(fixtureTime) &&
            Math.abs(predictionTime - fixtureTime) <= 18 * 60 * 60 * 1000;
        });

        const matchingBasketball = basketballGames.filter(game => {
          const teams = getBasketballTeams(game);
          const start = getBasketballStart(game);
          const gameTime = new Date(start).getTime();

          if (
            !teamMatches(prediction.home_team, teams.home) ||
            !teamMatches(prediction.away_team, teams.away)
          ) {
            return false;
          }

          return Number.isFinite(gameTime) &&
            Math.abs(predictionTime - gameTime) <= 18 * 60 * 60 * 1000;
        });

        // Never guess if both sports match or if either
        // sport has multiple possible games.

        if (
          matchingFootball.length > 0 &&
          matchingBasketball.length > 0
        ) {
          console.log(
            `Prediction ${prediction.id}: both sports produced possible matches. Left pending for safety.`
          );
          continue;
        }

        if (
          matchingFootball.length > 1 ||
          matchingBasketball.length > 1
        ) {
          console.log(
            `Prediction ${prediction.id}: multiple possible games. Left pending.`
          );
          continue;
        }

        if (
          matchingFootball.length === 0 &&
          matchingBasketball.length === 0
        ) {
          continue;
        }

        if (matchingFootball.length === 1) {
          const fixture = matchingFootball[0];

          const { data: linked, error: linkError } = await supabase
            .from("predictions")
            .update({
              api_fixture_id: fixture.id,
              fixture_status: fixture.status || null,
              tracking_updated_at: new Date().toISOString()
            })
            .eq("id", prediction.id)
            .eq("status", "pending")
            .is("api_fixture_id", null)
            .is("api_basketball_game_id", null)
            .select("id");

          if (linkError) {
            console.error(
              `Football auto-link failed for ${prediction.id}:`,
              linkError.message
            );
            continue;
          }

          if (linked?.length) {
            footballLinked++;
            console.log(
              `Prediction ${prediction.id} linked to football fixture ${fixture.id}.`
            );
          }
        }

        if (matchingBasketball.length === 1) {
          const game = matchingBasketball[0];

          const { data: linked, error: linkError } = await supabase
            .from("predictions")
            .update({
              api_basketball_game_id: String(game.id),
              fixture_status: game.status || null,
              tracking_updated_at: new Date().toISOString()
            })
            .eq("id", prediction.id)
            .eq("status", "pending")
            .is("api_fixture_id", null)
            .is("api_basketball_game_id", null)
            .select("id");

          if (linkError) {
            console.error(
              `Basketball auto-link failed for ${prediction.id}:`,
              linkError.message
            );
            continue;
          }

          if (linked?.length) {
            basketballLinked++;
            console.log(
              `Prediction ${prediction.id} linked to basketball game ${game.id}.`
            );
          }
        }
      }
    }

    console.log(
      `Automatic matching completed. Football: ${footballLinked}; Basketball: ${basketballLinked}.`
    );

  } catch (error) {
    console.error("Automatic matching scan failed:", error.message);
  }
}

// =====================================
// FOOTBALL FIXTURE EVENTS
// =====================================

async function getFixtureEvents(fixtureId) {
  const data = await sportApiRequest(
    `/fixtures/${encodeURIComponent(fixtureId)}/events`
  );

  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.data?.data)) return data.data.data;

  return null;
}

// =====================================
// FOOTBALL AUTOMATIC TRACKING
// =====================================

async function trackFootballPredictions() {
  const { data: predictions, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("status", "pending")
    .not("api_fixture_id", "is", null)
    .limit(200);

  if (error) throw error;
  if (!predictions?.length) return;

  const dateGroups = new Map();

  for (const prediction of predictions) {
    const date = kickoffDate(prediction.kickoff);

    if (!date) continue;
    if (!dateGroups.has(date)) dateGroups.set(date, []);
    dateGroups.get(date).push(prediction);
  }

  const detailCache = new Map();
  const eventsCache = new Map();

  async function getFixtureDetails(fixtureId) {
    const key = String(fixtureId);

    if (!detailCache.has(key)) {
      detailCache.set(
        key,
        sportApiRequest(`/fixtures/${encodeURIComponent(fixtureId)}`)
          .then(data => data.fixture || null)
      );
    }

    return detailCache.get(key);
  }

  async function getCachedEvents(fixtureId) {
    const key = String(fixtureId);

    if (!eventsCache.has(key)) {
      eventsCache.set(
        key,
        getFixtureEvents(fixtureId).catch(error => {
          console.error(
            `Goal events unavailable for ${fixtureId}:`,
            error.message
          );
          return null;
        })
      );
    }

    return eventsCache.get(key);
  }

  async function processFootballPrediction(prediction, fixture) {
    if (!fixture) return;

    const status = String(fixture.status || "").trim().toUpperCase();
    const now = new Date().toISOString();

    const update = {
      fixture_status: fixture.status || null,
      home_score: safeNumber(fixture.home_score),
      away_score: safeNumber(fixture.away_score),
      tracking_updated_at: now
    };

    if (voidStatus(status)) {
      const reason = status === "POSTPONED"
        ? "Match postponed by SportAPI"
        : "Match officially cancelled by SportAPI";

      const { data: settled, error } = await supabase
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

      if (error) {
        console.error("Football VOID settlement failed:", error.message);
      } else if (settled?.length) {
        console.log(`Football prediction ${prediction.id} marked VOID.`);
      }

      return;
    }

    if (!finalStatus(status)) {
      const { error } = await supabase
        .from("predictions")
        .update(update)
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_fixture_id", prediction.api_fixture_id);

      if (error) {
        console.error("Football score update failed:", error.message);
      }

      return;
    }

    let finalFixture = fixture;

    try {
      const details = await getFixtureDetails(prediction.api_fixture_id);
      if (details) finalFixture = { ...fixture, ...details };
    } catch (error) {
      console.error("Football detail lookup failed:", error.message);
    }

    update.home_score = safeNumber(finalFixture.home_score);
    update.away_score = safeNumber(finalFixture.away_score);
    update.halftime_home_score = safeNumber(finalFixture.ht_home);
    update.halftime_away_score = safeNumber(finalFixture.ht_away);

    if (update.home_score === null || update.away_score === null) {
      await supabase
        .from("predictions")
        .update(update)
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_fixture_id", prediction.api_fixture_id);

      console.log(
        `Football prediction ${prediction.id}: final score unavailable; still pending.`
      );
      return;
    }

    let outcome = null;

    if (isOneUpTwoUpMarket(prediction)) {
      const events = await getCachedEvents(prediction.api_fixture_id);

      outcome = settleOneUpTwoUpMarket(
        prediction,
        finalFixture,
        events
      );
    } else {
      outcome = settleScoreMarket(prediction, finalFixture);
    }

    if (!["won", "lost", "void"].includes(outcome)) {
      await supabase
        .from("predictions")
        .update(update)
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_fixture_id", prediction.api_fixture_id);

      console.log(
        `Football prediction ${prediction.id}: unsupported or unverified market; still pending.`
      );
      return;
    }

    const scoreText = `${update.home_score}-${update.away_score}`;

    const resultText = isOneUpTwoUpMarket(prediction)
      ? `Automatically settled ${outcome.toUpperCase()} using verified SportAPI goal events. Final score ${scoreText}.`
      : outcome === "void"
        ? `Automatically settled VOID: market resulted in a push. Final score ${scoreText}.`
        : `Automatically settled ${outcome.toUpperCase()}: final score ${scoreText}.`;

    const { data: settled, error } = await supabase
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

    if (error) {
      console.error(
        `Football settlement failed for ${prediction.id}:`,
        error.message
      );
    } else if (settled?.length) {
      console.log(
        `Football prediction ${prediction.id} settled ${outcome.toUpperCase()}.`
      );
    }
  }

  for (const [date, group] of dateGroups) {
    let fixtures = [];

    try {
      const dailyData = await sportApiRequest(
        `/fixtures/date/${encodeURIComponent(date)}`
      );

      fixtures = Array.isArray(dailyData.data) ? dailyData.data : [];
    } catch (error) {
      console.error(`Football date lookup failed for ${date}:`, error.message);
    }

    for (const prediction of group) {
      let fixture = fixtures.find(
        item => String(item.id) === String(prediction.api_fixture_id)
      );

      if (!fixture) {
        const key = String(prediction.api_fixture_id);
        const lastCheck = missingFixtureChecks.get(`football-${key}`) || 0;

        if (Date.now() - lastCheck >= MISSING_FIXTURE_RECHECK_MS) {
          missingFixtureChecks.set(`football-${key}`, Date.now());

          try {
            fixture = await getFixtureDetails(prediction.api_fixture_id);
          } catch (error) {
            console.error(
              `Football rescheduled fixture lookup failed for ${key}:`,
              error.message
            );
          }
        }
      }

      if (!fixture) {
        console.log(
          `Football fixture ${prediction.api_fixture_id} not found yet.`
        );
        continue;
      }

      if (
        !teamMatches(prediction.home_team, fixture.home_team) ||
        !teamMatches(prediction.away_team, fixture.away_team)
      ) {
        console.error(
          `Football team mismatch for prediction ${prediction.id}. Settlement blocked.`
        );
        continue;
      }

      try {
        await processFootballPrediction(prediction, fixture);
      } catch (error) {
        console.error(
          `Football prediction ${prediction.id} processing failed:`,
          error.message
        );
      }
    }
  }
}

// =====================================
// BASKETBALL AUTOMATIC TRACKING
// =====================================

async function trackBasketballPredictions() {
  const { data: predictions, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("status", "pending")
    .not("api_basketball_game_id", "is", null)
    .limit(200);

  if (error) throw error;
  if (!predictions?.length) return;

  const dateGroups = new Map();

  for (const prediction of predictions) {
    const date = kickoffDate(prediction.kickoff);

    if (!date) continue;
    if (!dateGroups.has(date)) dateGroups.set(date, []);
    dateGroups.get(date).push(prediction);
  }

  const gameCache = new Map();

  async function getBasketballGame(gameId) {
    const key = String(gameId);

    if (!gameCache.has(key)) {
      gameCache.set(
        key,
        sportApiRequest(
          `/basketball/games/${encodeURIComponent(gameId)}`
        ).then(response => response.data || null)
      );
    }

    return gameCache.get(key);
  }

  async function processBasketballPrediction(prediction, game) {
    if (!game) return;

    const status = String(game.status || "").trim().toUpperCase();
    const scores = getBasketballScores(game);
    const now = new Date().toISOString();

    const update = {
      fixture_status: game.status || null,
      home_score: scores.home,
      away_score: scores.away,
      tracking_updated_at: now
    };

    // Only documented postponed/cancelled statuses are voided.

    if (basketballVoidStatus(status)) {
      const reason = status === "POST"
        ? "Basketball game postponed by SportAPI"
        : "Basketball game cancelled by SportAPI";

      const { data: settled, error } = await supabase
        .from("predictions")
        .update({
          ...update,
          status: "void",
          result: `Automatically settled VOID: ${reason}.`
        })
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_basketball_game_id", String(prediction.api_basketball_game_id))
        .select("id");

      if (error) {
        console.error(
          `Basketball VOID settlement failed for ${prediction.id}:`,
          error.message
        );
      } else if (settled?.length) {
        console.log(
          `Basketball prediction ${prediction.id} automatically marked VOID.`
        );
      }

      return;
    }

    // Never settle a game that is still live or not started.

    if (!basketballFinalStatus(status)) {
      const { error } = await supabase
        .from("predictions")
        .update(update)
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_basketball_game_id", String(prediction.api_basketball_game_id));

      if (error) {
        console.error(
          `Basketball score update failed for ${prediction.id}:`,
          error.message
        );
      }

      return;
    }

    // Fetch the latest full game object after the final status.
    // It contains the period scores needed for quarter and half markets.

    let finalGame = game;

    try {
      const details = await getBasketballGame(
        prediction.api_basketball_game_id
      );

      if (details) finalGame = { ...game, ...details };
    } catch (error) {
      console.error(
        `Basketball game detail lookup failed for ${prediction.api_basketball_game_id}:`,
        error.message
      );
    }

    const finalScores = getBasketballScores(finalGame);

    update.home_score = finalScores.home;
    update.away_score = finalScores.away;
    update.fixture_status = finalGame.status || status;

    if (update.home_score === null || update.away_score === null) {
      await supabase
        .from("predictions")
        .update(update)
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_basketball_game_id", String(prediction.api_basketball_game_id));

      console.log(
        `Basketball prediction ${prediction.id}: final score unavailable; still pending.`
      );
      return;
    }

    const outcome = settleBasketballMarket(prediction, finalGame);

    if (!["won", "lost", "void"].includes(outcome)) {
      await supabase
        .from("predictions")
        .update(update)
        .eq("id", prediction.id)
        .eq("status", "pending")
        .eq("api_basketball_game_id", String(prediction.api_basketball_game_id));

      console.log(
        `Basketball prediction ${prediction.id}: market could not be verified; still pending.`
      );
      return;
    }

    const scoreText = `${update.home_score}-${update.away_score}`;

    const resultText = outcome === "void"
      ? `Automatically settled VOID: basketball market resulted in a push. Final score ${scoreText}.`
      : `Automatically settled ${outcome.toUpperCase()} using SportAPI basketball results. Final score ${scoreText}.`;

    // Only update a still-pending prediction linked to this
    // exact basketball game. Manual results are never overwritten.

    const { data: settled, error: settleError } = await supabase
      .from("predictions")
      .update({
        ...update,
        status: outcome,
        result: resultText
      })
      .eq("id", prediction.id)
      .eq("status", "pending")
      .eq("api_basketball_game_id", String(prediction.api_basketball_game_id))
      .select("id");

    if (settleError) {
      console.error(
        `Basketball settlement failed for ${prediction.id}:`,
        settleError.message
      );
      return;
    }

    if (settled?.length) {
      console.log(
        `Basketball prediction ${prediction.id} automatically settled ${outcome.toUpperCase()}. Score: ${scoreText}.`
      );
    }
  }

  for (const [date, group] of dateGroups) {
    let games = [];

    try {
      const response = await sportApiRequest(
        `/basketball/games/date/${encodeURIComponent(date)}?tz=UTC`
      );

      games = Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error(
        `Basketball date lookup failed for ${date}:`,
        error.message
      );
    }

    for (const prediction of group) {
      let game = games.find(
        item => String(item.id) === String(prediction.api_basketball_game_id)
      );

      if (!game) {
        const key = String(prediction.api_basketball_game_id);
        const lastCheck = missingFixtureChecks.get(`basketball-${key}`) || 0;

        if (Date.now() - lastCheck >= MISSING_FIXTURE_RECHECK_MS) {
          missingFixtureChecks.set(`basketball-${key}`, Date.now());

          try {
            game = await getBasketballGame(prediction.api_basketball_game_id);
          } catch (error) {
            console.error(
              `Basketball rescheduled game lookup failed for ${key}:`,
              error.message
            );
          }
        }
      }

      if (!game) {
        console.log(
          `Basketball game ${prediction.api_basketball_game_id} not found yet.`
        );
        continue;
      }

      const teams = getBasketballTeams(game);

      if (
        !teamMatches(prediction.home_team, teams.home) ||
        !teamMatches(prediction.away_team, teams.away)
      ) {
        console.error(
          `Basketball team mismatch for prediction ${prediction.id}. Settlement blocked.`
        );
        continue;
      }

      try {
        await processBasketballPrediction(prediction, game);
      } catch (error) {
        console.error(
          `Basketball prediction ${prediction.id} processing failed:`,
          error.message
        );
      }
    }
  }
}

// =====================================
// MAIN TRACKING RUNNER
// =====================================

async function trackPredictions() {
  if (!supabase || !sportApiKey || trackingBusy) return;

  trackingBusy = true;

  try {
    // Match unlinked predictions against both sports first.
    await autoLinkUnlinkedPredictions();

    // Then independently process linked predictions.
    await trackFootballPredictions();
    await trackBasketballPredictions();

  } catch (error) {
    console.error("Automatic tracking error:", error.message);

  } finally {
    trackingBusy = false;
  }
}

// =====================================
// TRACKING SCHEDULE
// =====================================

setInterval(trackPredictions, 3 * 60 * 1000);

// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {
  console.log(`ONLYBOSSTIPS API running on port ${PORT}`);

  console.log("Football provider: SportAPI");
  console.log("Basketball provider: SportAPI");
  console.log("Football automatic settlement: ENABLED");
  console.log("Basketball automatic settlement: ENABLED");
  console.log("Automatic football fixture matching: ENABLED");
  console.log("Automatic basketball game matching: ENABLED");
  console.log("Basketball match winner: ENABLED");
  console.log("Basketball quarter winner: ENABLED");
  console.log("Basketball half winner: ENABLED");
  console.log("Basketball total points: ENABLED");
  console.log("Basketball team totals: ENABLED");
  console.log("Basketball point spread/handicap: ENABLED");
  console.log("Manual settlement protection: ENABLED");
  console.log("Unsupported markets: REMAIN PENDING");

  if (!sportApiKey) {
    console.error("WARNING: SPORTAPI_KEY is missing.");
  }

  if (!supabase) {
    console.error("WARNING: Supabase is not configured.");
  }

  setTimeout(trackPredictions, 15000);
});

