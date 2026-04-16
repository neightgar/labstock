-- AlterTable: add role column to users (default "user" for existing rows)
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- First registered user becomes admin
UPDATE "users" SET "role" = 'admin' WHERE "id" = (SELECT MIN("id") FROM "users");

-- CreateTable: settings key/value store
CREATE TABLE "settings" (
    "key"   TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);
