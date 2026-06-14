-- CreateTable
CREATE TABLE "novel_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "genre" TEXT,
    "theme" TEXT,
    "trope" TEXT,
    "coreSetting" TEXT,
    "audience" TEXT,
    "synopsisHint" TEXT,
    "worldviewSkeleton" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_novels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "genre" TEXT,
    "synopsis" TEXT,
    "worldviewText" TEXT,
    "masterOutline" TEXT,
    "bookSummary" TEXT,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_novels" ("bookSummary", "createdAt", "genre", "id", "masterOutline", "status", "synopsis", "title", "updatedAt", "wordCount", "worldviewText") SELECT "bookSummary", "createdAt", "genre", "id", "masterOutline", "status", "synopsis", "title", "updatedAt", "wordCount", "worldviewText" FROM "novels";
DROP TABLE "novels";
ALTER TABLE "new_novels" RENAME TO "novels";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
