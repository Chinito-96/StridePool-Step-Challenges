import { Router, type IRouter } from "express";
import { CheckEligibilityBody } from "@workspace/api-zod";
import { checkEligibility, getComplianceStatus } from "../services/ledger";

const router: IRouter = Router();

router.get("/compliance/status", (_req, res) => {
  // Read current controls on every request; do not cache a previous launch approval.
  res.set("Cache-Control", "no-store");
  res.json(getComplianceStatus());
});

router.post("/compliance/eligibility", (req, res) => {
  const parsed = CheckEligibilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid age, two-letter state, identity status, and terms decision." });
    return;
  }
  res.json(checkEligibility(parsed.data));
});

export default router;