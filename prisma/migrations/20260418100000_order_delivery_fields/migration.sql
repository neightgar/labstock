ALTER TABLE "order_items" ADD COLUMN "delivery_date" DATETIME;
ALTER TABLE "order_items" ADD COLUMN "notify_on_overdue" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "notify_enabled" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "order_items" DROP COLUMN "notes";
