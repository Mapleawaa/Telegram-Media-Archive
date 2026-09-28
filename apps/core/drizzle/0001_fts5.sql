-- FTS5 外部内容索引：content 表为 media_search_doc，触发器保持三向同步。
-- tokenize=trigram：内置 unicode61 对中文不分词，trigram 无需外部 DLL 且支持子串匹配。
-- 注意：trigram 索引要求查询词 >= 3 个字符，短查询由应用层 LIKE 兜底（src/search/fts.ts）。
CREATE VIRTUAL TABLE IF NOT EXISTS fts_media USING fts5(
  title,
  filename,
  caption,
  tags,
  summary,
  extra,
  content='media_search_doc',
  content_rowid='doc_id',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_search_doc_ai AFTER INSERT ON media_search_doc BEGIN
  INSERT INTO fts_media(rowid, title, filename, caption, tags, summary, extra)
  VALUES (new.doc_id, new.title, new.filename, new.caption, new.tags, new.summary, new.extra);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_search_doc_ad AFTER DELETE ON media_search_doc BEGIN
  INSERT INTO fts_media(fts_media, rowid, title, filename, caption, tags, summary, extra)
  VALUES ('delete', old.doc_id, old.title, old.filename, old.caption, old.tags, old.summary, old.extra);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_search_doc_au AFTER UPDATE ON media_search_doc BEGIN
  INSERT INTO fts_media(fts_media, rowid, title, filename, caption, tags, summary, extra)
  VALUES ('delete', old.doc_id, old.title, old.filename, old.caption, old.tags, old.summary, old.extra);
  INSERT INTO fts_media(rowid, title, filename, caption, tags, summary, extra)
  VALUES (new.doc_id, new.title, new.filename, new.caption, new.tags, new.summary, new.extra);
END;
