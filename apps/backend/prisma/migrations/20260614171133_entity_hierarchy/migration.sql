-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_entities" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "attributes" TEXT NOT NULL DEFAULT '{}',
    "description" TEXT,
    "parentId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "entities_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "novels" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "entities_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "entities" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_entities" ("aliases", "attributes", "createdAt", "description", "id", "name", "novelId", "type", "updatedAt") SELECT "aliases", "attributes", "createdAt", "description", "id", "name", "novelId", "type", "updatedAt" FROM "entities";
DROP TABLE "entities";
ALTER TABLE "new_entities" RENAME TO "entities";
CREATE INDEX "entities_novelId_type_idx" ON "entities"("novelId", "type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
