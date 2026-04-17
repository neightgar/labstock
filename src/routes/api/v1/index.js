const express = require("express");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const path = require("path");
const { apiAuth } = require("../../../middleware/apiAuth");

const router = express.Router();

// ── Swagger / OpenAPI ─────────────────────────────────────

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "LabStock REST API",
      version: "1.0.0",
      description:
        "REST API for the LabStock lab inventory database. " +
        "Authenticate via **X-API-Key** header (generate in your Profile page) " +
        "or an active browser session.",
    },
    servers: [{ url: "/api/v1", description: "Current server" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
        },
      },
      schemas: {
        Success: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: {},
            meta: {
              type: "object",
              properties: {
                page:  { type: "integer" },
                limit: { type: "integer" },
                total: { type: "integer" },
              },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                code:    { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: [path.join(__dirname, "*.js")],
});

router.get("/docs.json", (_req, res) => res.json(swaggerSpec));
router.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { customSiteTitle: "LabStock API Docs" })
);

// ── Auth guard for all /api/v1/* routes ───────────────────
router.use(apiAuth);

// ── Sub-routes ────────────────────────────────────────────
router.use("/reagents",      require("./reagents"));
router.use("/consumables",   require("./consumables"));
router.use("/equipment",     require("./equipment"));
router.use("/orders",        require("./orders"));
router.use("/protocols",     require("./protocols"));
router.use("/locations",     require("./references").locationsRouter);
router.use("/manufacturers", require("./references").manufacturersRouter);
router.use("/suppliers",     require("./references").suppliersRouter);
router.use("/item-types",    require("./references").itemTypesRouter);
router.use("/search",        require("./search"));

// ── API-level error handler ───────────────────────────────
router.use((err, req, res, _next) => {
  console.error("[api/v1]", err.message);
  const status = err.status || 500;
  const code   = err.code   || "INTERNAL_ERROR";
  res.status(status).json({
    success: false,
    error: { code, message: err.message || "Internal server error" },
  });
});

module.exports = router;
