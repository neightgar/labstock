-- CreateTable
CREATE TABLE "suppliers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- AlterTable reagents
ALTER TABLE "reagents" ADD COLUMN "supplier_id" INTEGER REFERENCES "suppliers"("id");
ALTER TABLE "reagents" ADD COLUMN "supplier_catalog_number" TEXT;

-- AlterTable consumables
ALTER TABLE "consumables" ADD COLUMN "supplier_id" INTEGER REFERENCES "suppliers"("id");
ALTER TABLE "consumables" ADD COLUMN "supplier_catalog_number" TEXT;

-- AlterTable equipment
ALTER TABLE "equipment" ADD COLUMN "supplier_id" INTEGER REFERENCES "suppliers"("id");
ALTER TABLE "equipment" ADD COLUMN "supplier_catalog_number" TEXT;
