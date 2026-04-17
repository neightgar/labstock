ALTER TABLE "users" ADD COLUMN "api_key" TEXT;
CREATE UNIQUE INDEX "users_api_key_key" ON "users"("api_key");
