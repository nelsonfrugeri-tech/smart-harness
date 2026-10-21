-- Existing immutable versions keep empty keywords; only new publications declare tags.
ALTER TABLE plugin_versions ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(keywords) AND json_type(keywords) = 'array');
