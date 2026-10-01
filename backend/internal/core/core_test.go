package core

import "testing"

func TestNumber(t *testing.T) {
	cases := map[string]float64{"1.234,50": 1234.5, "1,234.50": 1234.5, "1234": 1234, "-2,5": -2.5}
	for s, w := range cases {
		g, e := Number(s)
		if e != nil || g != w {
			t.Fatalf("%s got %v err %v want %v", s, g, e, w)
		}
	}
}
func TestScope(t *testing.T) {
	p := []Person{{NIK: "A", Role: "RGM"}, {NIK: "B", Role: "ASM", Supervisor: "A"}, {NIK: "C", Role: "SALES", Supervisor: "B"}, {NIK: "D", Role: "SALES"}}
	x, e := Scope(p, "A")
	if e != nil || len(x) != 3 {
		t.Fatalf("scope %#v %v", x, e)
	}
}
func TestWorkdays(t *testing.T) {
	d, r, e := Workdays("2026-09", "2026-09-10", false, HolidaySet{})
	if e != nil || d == 0 || r == 0 || r > d {
		t.Fatalf("bad %d %d %v", d, r, e)
	}
}
