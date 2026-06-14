-- CreateTable
CREATE TABLE "information" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "knowers" TEXT NOT NULL DEFAULT '[]',
    "sourceEventId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chapters" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "volumeId" INTEGER,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" TEXT NOT NULL DEFAULT '',
    "outlineText" TEXT,
    "sceneConfig" TEXT NOT NULL DEFAULT '{}',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chapters_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "novels" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chapters_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "volumes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_chapters" ("content", "createdAt", "id", "novelId", "order", "outlineText", "status", "title", "updatedAt", "volumeId", "wordCount") SELECT "content", "createdAt", "id", "novelId", "order", "outlineText", "status", "title", "updatedAt", "volumeId", "wordCount" FROM "chapters";
DROP TABLE "chapters";
ALTER TABLE "new_chapters" RENAME TO "chapters";
CREATE INDEX "chapters_novelId_idx" ON "chapters"("novelId");
CREATE INDEX "chapters_volumeId_idx" ON "chapters"("volumeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "information_novelId_idx" ON "information"("novelId");
