-- AlterTable
ALTER TABLE "novels" ADD COLUMN "bookSummary" TEXT;
ALTER TABLE "novels" ADD COLUMN "masterOutline" TEXT;

-- AlterTable
ALTER TABLE "volumes" ADD COLUMN "outline" TEXT;

-- CreateTable
CREATE TABLE "chapter_snapshots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chapterId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chapter_snapshots_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ai_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER,
    "chapterId" INTEGER,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_tasks_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "novels" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_tasks_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ai_tasks" ("chapterId", "createdAt", "error", "id", "model", "novelId", "status", "tokensIn", "tokensOut", "type") SELECT "chapterId", "createdAt", "error", "id", "model", "novelId", "status", "tokensIn", "tokensOut", "type" FROM "ai_tasks";
DROP TABLE "ai_tasks";
ALTER TABLE "new_ai_tasks" RENAME TO "ai_tasks";
CREATE INDEX "ai_tasks_novelId_idx" ON "ai_tasks"("novelId");
CREATE TABLE "new_rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "layer" TEXT NOT NULL DEFAULT 'L2',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" REAL NOT NULL DEFAULT 1.0
);
INSERT INTO "new_rules" ("description", "enabled", "id", "layer", "name", "novelId") SELECT "description", "enabled", "id", "layer", "name", "novelId" FROM "rules";
DROP TABLE "rules";
ALTER TABLE "new_rules" RENAME TO "rules";
CREATE INDEX "rules_novelId_idx" ON "rules"("novelId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "chapter_snapshots_chapterId_idx" ON "chapter_snapshots"("chapterId");
