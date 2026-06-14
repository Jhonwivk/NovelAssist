-- CreateTable
CREATE TABLE "novels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "genre" TEXT,
    "synopsis" TEXT,
    "worldviewText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "volumes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "volumes_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "novels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "volumeId" INTEGER,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" TEXT NOT NULL DEFAULT '',
    "outlineText" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chapters_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "novels" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chapters_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "volumes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "entities" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "attributes" TEXT NOT NULL DEFAULT '{}',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "entities_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "novels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chapter_summaries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chapterId" INTEGER NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'L2',
    "content" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chapter_summaries_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ai_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER,
    "chapterId" INTEGER,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_tasks_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "novels" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_tasks_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "relations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "objectId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "validFromChapter" INTEGER,
    "validToChapter" INTEGER,
    "attributes" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "chapterId" INTEGER,
    "type" TEXT NOT NULL,
    "participants" TEXT NOT NULL DEFAULT '[]',
    "location" TEXT,
    "result" TEXT,
    "storyTime" TEXT,
    "causes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "entity_states" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entityId" INTEGER NOT NULL,
    "chapterId" INTEGER NOT NULL,
    "attrName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "evidence" TEXT
);

-- CreateTable
CREATE TABLE "foreshadows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "setupChapter" INTEGER,
    "payoffChapter" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'setup',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "layer" TEXT NOT NULL DEFAULT 'L2',
    "enabled" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "style_profiles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "traits" TEXT NOT NULL DEFAULT '{}',
    "bannedWords" TEXT NOT NULL DEFAULT '[]',
    "samples" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "memories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "sourceId" INTEGER,
    "content" TEXT NOT NULL,
    "embedding" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "consistency_issues" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "layer" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "type" TEXT NOT NULL,
    "entities" TEXT NOT NULL DEFAULT '[]',
    "location" TEXT NOT NULL DEFAULT '{}',
    "evidence" TEXT,
    "conflictWith" TEXT,
    "suggestion" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0,
    "autoFixable" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "volumes_novelId_idx" ON "volumes"("novelId");

-- CreateIndex
CREATE INDEX "chapters_novelId_idx" ON "chapters"("novelId");

-- CreateIndex
CREATE INDEX "chapters_volumeId_idx" ON "chapters"("volumeId");

-- CreateIndex
CREATE INDEX "entities_novelId_type_idx" ON "entities"("novelId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_summaries_chapterId_key" ON "chapter_summaries"("chapterId");

-- CreateIndex
CREATE INDEX "ai_tasks_novelId_idx" ON "ai_tasks"("novelId");

-- CreateIndex
CREATE INDEX "relations_novelId_idx" ON "relations"("novelId");

-- CreateIndex
CREATE INDEX "relations_subjectId_idx" ON "relations"("subjectId");

-- CreateIndex
CREATE INDEX "relations_objectId_idx" ON "relations"("objectId");

-- CreateIndex
CREATE INDEX "events_novelId_idx" ON "events"("novelId");

-- CreateIndex
CREATE INDEX "entity_states_entityId_idx" ON "entity_states"("entityId");

-- CreateIndex
CREATE INDEX "entity_states_chapterId_idx" ON "entity_states"("chapterId");

-- CreateIndex
CREATE INDEX "foreshadows_novelId_idx" ON "foreshadows"("novelId");

-- CreateIndex
CREATE INDEX "rules_novelId_idx" ON "rules"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "style_profiles_novelId_key" ON "style_profiles"("novelId");

-- CreateIndex
CREATE INDEX "memories_novelId_level_idx" ON "memories"("novelId", "level");

-- CreateIndex
CREATE INDEX "consistency_issues_novelId_idx" ON "consistency_issues"("novelId");
