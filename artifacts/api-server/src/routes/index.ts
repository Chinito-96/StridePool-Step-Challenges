import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import stridepoolRouter from "./stridepool";
import complianceRouter from "./compliance";
import moneyRouter from "./money";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(stridepoolRouter);
router.use(complianceRouter);
router.use(moneyRouter);

export default router;
