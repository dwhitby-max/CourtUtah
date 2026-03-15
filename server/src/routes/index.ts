import { Router } from "express";
import authRouter from "./auth";
import searchRouter from "./search";
import calendarRouter from "./calendar";
import notificationsRouter from "./notifications";
import watchedCasesRouter from "./watchedCases";
import savedSearchesRouter from "./savedSearches";
import adminRouter from "./admin";
import healthRouter from "./health";

const router = Router();

router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/search", searchRouter);
router.use("/calendar", calendarRouter);
router.use("/notifications", notificationsRouter);
router.use("/watched-cases", watchedCasesRouter);
router.use("/saved-searches", savedSearchesRouter);
router.use("/admin", adminRouter);

export default router;
