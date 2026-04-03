import { Router } from "express";
import authRouter from "./auth";
import searchRouter from "./search";
import calendarRouter from "./calendar";
import notificationsRouter from "./notifications";
import watchedCasesRouter from "./watchedCases";

import exportTemplatesRouter from "./exportTemplates";
import adminRouter from "./admin";
import healthRouter from "./health";
import billingRouter from "./billing";
import supportRouter from "./support";

const router = Router();

router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/search", searchRouter);
router.use("/calendar", calendarRouter);
router.use("/notifications", notificationsRouter);
router.use("/watched-cases", watchedCasesRouter);

router.use("/export-templates", exportTemplatesRouter);
router.use("/admin", adminRouter);
router.use("/billing", billingRouter);
router.use("/support", supportRouter);

export default router;
