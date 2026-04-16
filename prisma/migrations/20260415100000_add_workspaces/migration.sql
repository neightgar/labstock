-- Phase 9б: Workspaces

-- ── 1. Create workspaces table ────────────────────────────
CREATE TABLE "workspaces" (
    "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name_ru"    TEXT    NOT NULL,
    "name_en"    TEXT    NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── 2. Seed default workspace ─────────────────────────────
INSERT INTO "workspaces" ("id", "name_ru", "name_en")
VALUES (1, 'Default', 'Default');

-- ── 3. Create workspace_members table ────────────────────
CREATE TABLE "workspace_members" (
    "user_id"      INTEGER  NOT NULL,
    "workspace_id" INTEGER  NOT NULL,
    "assigned_at"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("user_id", "workspace_id"),
    FOREIGN KEY ("user_id")      REFERENCES "users"("id"),
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
);

-- ── 4. Migrate all non-admin users to default workspace ───
INSERT INTO "workspace_members" ("user_id", "workspace_id")
SELECT "id", 1 FROM "users" WHERE "role" = 'user';

-- ── 5. Add workspace_id to main entity tables ─────────────
ALTER TABLE "reagents"    ADD COLUMN "workspace_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "consumables" ADD COLUMN "workspace_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "equipment"   ADD COLUMN "workspace_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "protocols"   ADD COLUMN "workspace_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "order_items" ADD COLUMN "workspace_id" INTEGER NOT NULL DEFAULT 1;
