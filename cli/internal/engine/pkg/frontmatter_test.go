package pkg

import (
	"reflect"
	"testing"
)

// Lines are file lines: the frontmatter starts at line 2.
func TestParseFrontmatterListsUnsupportedYAML(t *testing.T) {
	cases := []struct {
		name, fm string
		want     []issue
	}{
		{"plain YAML", "name: a\nmeta:\n  k: [x, \"y\"]\n", nil},
		{"merge key", "name: a\n<<: {hooks: {}}\n", []issue{{3, "merge key <<"}}},
		{"quoted merge key", "name: a\n\"<<\": {hooks: {}}\n", []issue{{3, "merge key <<"}}},
		{"anchor and alias", "a: &x 1\nb: *x\n", []issue{{2, "anchor &x"}, {3, "alias *x"}}},
		{"standard tag", "a: !!str 1\n", []issue{{2, "explicit tag !!str"}}},
		{"custom tag", "a: !t 1\n", []issue{{2, "explicit tag !t"}}},
		{"nested tag", "a:\n  - b: !!binary aGk=\n", []issue{{3, "explicit tag !!binary"}}},
		{"duplicate key", "a: 1\na: 2\n", []issue{{3, `duplicate key "a"`}}},
		{"nested duplicate key", "a:\n  b: 1\n  b: 2\n", []issue{{4, `duplicate key "b"`}}},
		{"key that is not a string", "1: a\n", []issue{{2, "a key that is not a string"}}},
		{"second document", "a: 1\n...\n--- {hooks: {}}\n", []issue{{4, "a second YAML document"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			front, err := parseFrontmatter(tc.fm)

			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(front.unsupported, tc.want) {
				t.Fatalf("unsupported = %v, want %v", front.unsupported, tc.want)
			}
		})
	}
}

// The forbidden-field rules also read the resolved mapping, so they hold even if the grammar
// check missed a merge.
func TestFrontmatterHasSeesKeysThatOnlyAMergeBrings(t *testing.T) {
	front, err := parseFrontmatter("name: a\nbase: &b {hooks: {}}\n<<: *b\n")
	if err != nil {
		t.Fatal(err)
	}
	if _, written := front.fields["hooks"]; written {
		t.Fatal("hooks is not written at the top level")
	}
	if line, ok := front.has("hooks"); !ok || line != 1 {
		t.Fatalf("has(hooks) = %d, %v; want 1, true", line, ok)
	}
	if line, ok := front.has("name"); !ok || line != 2 {
		t.Fatalf("has(name) = %d, %v; want 2, true", line, ok)
	}
}

func TestDuplicateKeyFindingsInJSON(t *testing.T) {
	cases := []struct {
		name, data string
		lines      []int
	}{
		{"no duplicate", `{"a": {"b": 1}, "c": [{"b": 2}, {"b": 3}], "b": "a"}`, nil},
		{"top level", "{\"a\": 1,\n\"a\": 2}", []int{2}},
		{"nested object", "{\"a\": {\"b\": 1,\n \"b\": 2}}", []int{2}},
		{"object in an array", "[{\"b\": 1, \"b\": 2}]", []int{1}},
		{"escaped key", `{"hooks": 1, "\u0068ooks": 2}`, []int{1}},
		{"syntax error is left to the decoder", `{"a": `, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var lines []int
			for _, f := range duplicateKeyFindings(File{Path: "x.json", Data: []byte(tc.data)}) {
				if f.Code != CodeYAMLFeature || f.Path != "x.json" {
					t.Fatalf("finding = %+v", f)
				}
				lines = append(lines, f.Line)
			}
			if !reflect.DeepEqual(lines, tc.lines) {
				t.Fatalf("lines = %v, want %v", lines, tc.lines)
			}
		})
	}
}
