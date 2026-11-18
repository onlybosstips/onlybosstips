
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ONLYBOSSTIPS automatic football tracking API is running."
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "ONLYBOSSTIPS API"
  });
});

app.listen(PORT, () => {
  console.log(`ONLYBOSSTIPS API running on port ${PORT}`);
});
