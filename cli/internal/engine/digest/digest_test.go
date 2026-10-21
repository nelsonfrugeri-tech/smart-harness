package digest

import "testing"

// Expected value from `printf abc | shasum -a 256` (also the FIPS 180-2 example).
func TestOf(t *testing.T) {
	want := "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got := Of([]byte("abc")); got != want {
		t.Fatalf("Of(abc) = %s, want %s", got, want)
	}
}

func TestValid(t *testing.T) {
	ok := "sha256:" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	for s, want := range map[string]bool{
		ok:                             true,
		ok[:len(ok)-1]:                 false,
		"sha512:" + ok[7:]:             false,
		"sha256:" + "ABCDEF" + ok[13:]: false,
	} {
		if Valid(s) != want {
			t.Errorf("Valid(%q) = %v, want %v", s, !want, want)
		}
	}
}
