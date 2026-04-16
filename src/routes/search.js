const express = require("express");
const { search } = require("../services/search");
const { t } = require("../i18n");

const router = express.Router();

// ── GET /search?q=... ─────────────────────────────────────
// Returns JSON for AJAX or renders a page if Accept: text/html
router.get("/", async (req, res, next) => {
  try {
    const q    = (req.query.q || "").trim();
    const lang = req.lang || "ru";

    const results = await search(q, lang, req.user);

    // Labels for the client-side dropdown
    const labels = {
      reagents:    t(lang, "search.category.reagents"),
      consumables: t(lang, "search.category.consumables"),
      equipment:   t(lang, "search.category.equipment"),
      protocols:   t(lang, "search.category.protocols"),
    };

    const noResults = t(lang, "search.noResults");

    if (req.accepts("json") && !req.accepts("html")) {
      return res.json({ ...results, _labels: labels, _noResults: noResults });
    }

    // Graceful HTML fallback (if JS is disabled)
    const total =
      results.reagents.length +
      results.consumables.length +
      results.equipment.length +
      results.protocols.length;

    res.render("search", {
      pageTitle: t(lang, "search.results"),
      active:    "",
      query:     q,
      results,
      total,
      labels,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
