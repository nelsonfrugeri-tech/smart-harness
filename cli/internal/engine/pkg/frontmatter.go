package pkg

import (
	"bytes"
	"fmt"
	"io"
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

// issue is a YAML feature outside the frontmatter grammar, with its line in the file.
type issue struct {
	line int
	msg  string
}

// frontmatter is a decoded frontmatter.
type frontmatter struct {
	fields fields // top-level keys as written
	// resolved is the mapping a YAML client reads after it resolves merge keys and aliases.
	// It is nil when the YAML has an unsupported feature that stops the decode (a duplicate key).
	resolved map[string]any
	// unsupported lists anchors, aliases, merge keys, explicit tags, non-string or duplicate
	// keys, and extra documents, anywhere in the YAML. A package with any of them is invalid.
	unsupported []issue
}

// parseFrontmatter decodes the frontmatter. The error is for YAML that does not parse, or that
// is not a mapping; unsupported features are listed in unsupported, not returned as an error.
func parseFrontmatter(fm string) (frontmatter, error) {
	out := frontmatter{fields: fields{}}
	dec := yaml.NewDecoder(strings.NewReader(fm))
	var doc yaml.Node
	if err := dec.Decode(&doc); err == io.EOF {
		return out, nil // empty frontmatter
	} else if err != nil {
		return out, err
	}
	var extra yaml.Node
	switch err := dec.Decode(&extra); {
	case err == nil:
		out.unsupported = append(out.unsupported, issue{line: extra.Line + 1, msg: "a second YAML document"})
	case err != io.EOF:
		return out, err
	}
	if len(doc.Content) == 0 {
		return out, nil // a document with only comments
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return out, fmt.Errorf("frontmatter must be a mapping")
	}
	checkGrammar(root, &out.unsupported)
	for i := 0; i+1 < len(root.Content); i += 2 {
		key := root.Content[i]
		if _, dup := out.fields[key.Value]; !dup {
			out.fields[key.Value] = field{line: key.Line + 1, value: root.Content[i+1]}
		}
	}
	var resolved map[string]any
	if err := doc.Decode(&resolved); err == nil {
		out.resolved = resolved
	} else if len(out.unsupported) == 0 {
		return out, err
	}
	return out, nil
}

// checkGrammar walks the whole YAML tree and lists the features outside plain YAML.
// They are rejected because a client resolves them and may read keys the engine did not check.
func checkGrammar(n *yaml.Node, out *[]issue) {
	add := func(format string, a ...any) {
		*out = append(*out, issue{line: n.Line + 1, msg: fmt.Sprintf(format, a...)})
	}
	if n.Anchor != "" {
		add("anchor &%s", n.Anchor)
	}
	if n.Kind == yaml.AliasNode {
		add("alias *%s", n.Value)
		return
	}
	if n.Style&yaml.TaggedStyle != 0 {
		add("explicit tag %s", n.Tag)
	}
	if n.Kind != yaml.MappingNode {
		for _, c := range n.Content {
			checkGrammar(c, out)
		}
		return
	}
	seen := map[string]bool{}
	for i := 0; i+1 < len(n.Content); i += 2 {
		key := n.Content[i]
		switch {
		case key.Kind == yaml.ScalarNode && (key.Tag == "!!merge" || key.Value == "<<"):
			*out = append(*out, issue{line: key.Line + 1, msg: "merge key <<"})
		case key.Kind != yaml.ScalarNode || key.Tag != "!!str":
			*out = append(*out, issue{line: key.Line + 1, msg: "a key that is not a string"})
		case seen[key.Value]:
			*out = append(*out, issue{line: key.Line + 1, msg: fmt.Sprintf("duplicate key %q", key.Value)})
		}
		seen[key.Value] = true
		checkGrammar(key, out)
		checkGrammar(n.Content[i+1], out)
	}
}

// has reports whether key is in the frontmatter, as written or after merges and aliases.
// It returns the line of the key, or 1 when only the resolved mapping has it.
func (f frontmatter) has(key string) (int, bool) {
	if fl, ok := f.fields[key]; ok {
		return fl.line, true
	}
	if _, ok := f.resolved[key]; ok {
		return 1, true
	}
	return 0, false
}

// unsupportedFindings turns each unsupported YAML feature into an SH-STR-003 finding.
func unsupportedFindings(path string, issues []issue) []Finding {
	var out []Finding
	for _, is := range issues {
		out = append(out, Finding{Code: CodeYAMLFeature, Path: path, Line: is.line,
			Message: "unsupported YAML feature in frontmatter: " + is.msg,
			Hint:    "write plain YAML: no anchors (&), aliases (*), merge keys (<<), tags (!), duplicate keys or extra documents"})
	}
	return out
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
