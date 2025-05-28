import express from "express";
require("dotenv").config();
import fileRouter from "./fileRouter";
import userRouter from "./userRouter";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

app.use("/api", fileRouter);
app.use("/user", userRouter);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});