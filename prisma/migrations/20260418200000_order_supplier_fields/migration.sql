ALTER TABLE "order_items" ADD COLUMN "supplier" TEXT;
ALTER TABLE "order_items" ADD COLUMN "supplier_catalog_number" TEXT;
ALTER TABLE "order_items" DROP COLUMN "notify_enabled";
