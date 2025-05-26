import express from "express";
require("dotenv").config();
import apiRouter from "./router";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});