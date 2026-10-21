package pkg

import (
	"bytes"
	"fmt"
	"strings"

	"go.yaml.in/yaml/v3"
)

// splitFrontmatter splits "---\n<yaml>\n---\n<body>" after normalizing CRLF to LF.
// It returns false when the data does not start with a frontmatter block.
func splitFrontmatter(data []byte) (fm, body string, ok bool) {
	text := string(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")))
	rest, ok := strings.CutPrefix(text, "---\n")
	if !ok {
		return "", "", false
	}
	if after, found := strings.CutPrefix(rest, "---\n"); found {
		return "", after, true // empty frontmatter
	}
	end := strings.Index(rest, "\n---\n")
	if end < 0 {
		if !strings.HasSuffix(rest, "\n---") {
			return "", "", false
		}
		return strings.TrimSuffix(rest, "\n---"), "", true
	}
	return rest[:end+1], rest[end+len("\n---\n"):], true
}

// field is one top-level frontmatter key. Line is the line in the file (the frontmatter starts at line 2).
type field struct {
	line  int
	value *yaml.Node
}

type fields map[string]field

// frontmatterFields decodes the frontmatter as a YAML mapping. Duplicate keys are an error.
func frontmatterFields(fm string) (fields, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(fm), &doc); err != nil {
		return nil, err
	}
	out := fields{}
	if doc.Kind == 0 {
		return out, nil // empty frontmatter
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("frontmatter must be a mapping")
	}
	for i := 0; i+1 < len(root.Content); i += 2 {
		key := root.Content[i]
		if _, dup := out[key.Value]; dup {
			return nil, fmt.Errorf("line %d: key %q is repeated", key.Line+1, key.Value)
		}
		out[key.Value] = field{line: key.Line + 1, value: root.Content[i+1]}
	}
	return out, nil
}

// lookup describes a field read with str or list: present, well typed, and its line.
type lookup struct {
	present bool
	ok      bool
	line    int
}

// str reads a string scalar. A null value counts as absent.
func (f fields) str(key string) (string, lookup) {
	fl, present := f[key]
	if !present || isNull(fl.value) {
		return "", lookup{line: fl.line}
	}
	ok := fl.value.Kind == yaml.ScalarNode && fl.value.Tag == "!!str"
	return fl.value.Value, lookup{present: true, ok: ok, line: fl.line}
}

// list reads a sequence of string scalars, in block or flow style. A null value counts as absent.
func (f fields) list(key string) ([]string, lookup) {
	fl, present := f[key]
	if !present || isNull(fl.value) {
		return nil, lookup{line: fl.line}
	}
	if fl.value.Kind != yaml.SequenceNode {
		return nil, lookup{present: true, line: fl.line}
	}
	items := make([]string, 0, len(fl.value.Content))
	for _, n := range fl.value.Content {
		if n.Kind != yaml.ScalarNode || n.Tag != "!!str" {
			return nil, lookup{present: true, line: fl.line}
		}
		items = append(items, n.Value)
	}
	return items, lookup{present: true, ok: true, line: fl.line}
}

func isNull(n *yaml.Node) bool {
	return n.Kind == yaml.ScalarNode && n.Tag == "!!null"
}

// trimBlankLines removes leading and trailing lines that contain only whitespace.
func trimBlankLines(s string) string {
	lines := strings.Split(s, "\n")
	start, end := 0, len(lines)
	for start < end && strings.TrimSpace(lines[start]) == "" {
		start++
	}
	for end > start && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	return strings.Join(lines[start:end], "\n")
}
