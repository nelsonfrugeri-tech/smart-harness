package pkg

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// duplicateKeyFindings reports SH-STR-003 for each repeated key in any object of a JSON file.
// encoding/json and most clients keep the last value of a repeated key, so a policy check could
// read a value the client does not use; a repeated key is rejected instead.
// Syntax errors are left to the normal decode, which reports them with the file's own code.
func duplicateKeyFindings(file File) []Finding {
	type container struct {
		keys    map[string]bool // nil for an array
		wantKey bool
	}
	var findings []Finding
	var stack []*container
	valueDone := func() {
		if n := len(stack); n > 0 && stack[n-1].keys != nil {
			stack[n-1].wantKey = true
		}
	}
	dec := json.NewDecoder(bytes.NewReader(file.Data))
	for {
		tok, err := dec.Token()
		if err != nil { // io.EOF or a syntax error
			return findings
		}
		if n := len(stack); n > 0 && stack[n-1].wantKey {
			if key, ok := tok.(string); ok {
				top := stack[n-1]
				if top.keys[key] {
					findings = append(findings, Finding{Code: CodeYAMLFeature, Path: file.Path,
						Line:    1 + bytes.Count(file.Data[:dec.InputOffset()], []byte("\n")),
						Message: fmt.Sprintf("duplicate key %q in a JSON object", key),
						Hint:    "keep one entry per key; clients read only the last one"})
				}
				top.keys[key] = true
				top.wantKey = false
				continue
			}
		}
		switch tok {
		case json.Delim('{'):
			stack = append(stack, &container{keys: map[string]bool{}, wantKey: true})
		case json.Delim('['):
			stack = append(stack, &container{})
		case json.Delim('}'), json.Delim(']'):
			stack = stack[:len(stack)-1]
			valueDone()
		default:
			valueDone()
		}
	}
}
