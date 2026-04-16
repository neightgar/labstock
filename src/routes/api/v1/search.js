/**
 * @swagger
 * tags:
 *   name: Search
 *   description: Global full-text search across all entity types
 */

const express = require("express");
const { search } = require("../../../services/search");
const { ok, err } = require("./_helpers");

const router = express.Router();

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Global search
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Search query (minimum 2 characters)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, reagent, consumable, equipment, protocol]
 *           default: all
 *         description: Filter results to a specific entity type
 *       - in: query
 *         name: lang
 *         schema:
 *           type: string
 *           enum: [ru, en]
 *           default: ru
 *         description: Language for result ordering
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 8 }
 *         description: Max results per category
 *     responses:
 *       200:
 *         description: Search results grouped by type
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         reagents:    { type: array, items: { type: object } }
 *                         consumables: { type: array, items: { type: object } }
 *                         equipment:   { type: array, items: { type: object } }
 *                         protocols:   { type: array, items: { type: object } }
 *       400:
 *         description: Query too short
 */
router.get("/", async (req, res, next) => {
  try {
    const q    = (req.query.q || "").trim();
    const lang = ["ru", "en"].includes(req.query.lang) ? req.query.lang : "ru";
    const type = req.query.type || "all";
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 8));

    if (q.length < 2)
      return res.status(400).json(err("QUERY_TOO_SHORT", "Search query must be at least 2 characters"));

    const results = await search(q, lang, req.user, limit);

    // Filter by type if requested
    const VALID_TYPES = ["all", "reagent", "consumable", "equipment", "protocol"];
    if (!VALID_TYPES.includes(type))
      return res.status(400).json(err("INVALID_TYPE", `type must be one of: ${VALID_TYPES.join(", ")}`));

    let data = results;
    if (type !== "all") {
      const keyMap = {
        reagent:    "reagents",
        consumable: "consumables",
        equipment:  "equipment",
        protocol:   "protocols",
      };
      data = { [keyMap[type]]: results[keyMap[type]] || [] };
    }

    res.json(ok(data));
  } catch (e) { next(e); }
});

module.exports = router;
