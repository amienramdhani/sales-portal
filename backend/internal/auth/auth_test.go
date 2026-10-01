package auth

import "testing"

func TestLegacyHashDeterministic(t *testing.T) {
	a := LegacyHash("pep", "N1", "salt", "1234")
	b := LegacyHash("pep", "N1", "salt", "1234")
	if a != b || a == "" {
		t.Fatal("hash mismatch")
	}
	for _, c := range a {
		if c == '=' {
			t.Fatal("padding must be removed")
		}
	}
}
