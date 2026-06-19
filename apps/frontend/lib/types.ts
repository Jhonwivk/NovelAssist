export interface Novel {
  id: number;
  title: string;
  genre?: string | null;
  synopsis?: string | null;
  worldviewText?: string | null;
  masterOutline?: string | null;
  bookSummary?: string | null;
  meta?: Record<string, unknown>;
  status: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
  chapters?: ChapterListItem[];
  volumes?: Volume[];
}

export interface Volume {
  id: number;
  novelId: number;
  title: string;
  order: number;
  summary?: string | null;
}

export interface ChapterListItem {
  id: number;
  title: string;
  order: number;
  status: string;
  wordCount: number;
  volumeId?: number | null;
  updatedAt: string;
}

export interface Chapter {
  id: number;
  novelId: number;
  volumeId?: number | null;
  title: string;
  order: number;
  status: string;
  content: string;
  outlineText?: string | null;
  sceneConfig?: string | null;
  wordCount: number;
  summary?: { id: number; level: string; content: string } | null;
}

export type EntityType =
  | 'character'
  | 'location'
  | 'organization'
  | 'item'
  | 'power_system'
  | 'worldview';

export interface Entity {
  id: number;
  novelId: number;
  type: EntityType;
  name: string;
  aliases: string[];
  attributes: Record<string, unknown>;
  description?: string | null;
}

export interface Bible {
  novelId: number;
  worldviewText?: string | null;
  entities: Entity[];
}
