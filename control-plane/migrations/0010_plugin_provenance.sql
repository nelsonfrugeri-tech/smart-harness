-- Editorial catalog provenance is separate from immutable published archives and versions.
-- Empty metadata preserves the absence of provenance on earlier publications.
ALTER TABLE plugins ADD COLUMN catalog_metadata TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(catalog_metadata) AND json_type(catalog_metadata) = 'object');
