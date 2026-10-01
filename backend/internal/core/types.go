package core

import "time"

var Level = map[string]float64{
	"SALES": 1, "ASM": 2, "RGM": 3, "ADMIN": 3.5, "HEAD OF SALES": 4,
	"CHIEF OPERATING OFFICER": 5, "CHIEF COMMERCIAL OFFICER": 5,
	"BOARD OF DIRECTOR": 6, "SUPER ADMIN": 7,
}

type Person struct {
	NIK          string   `json:"nik"`
	Name         string   `json:"nama"`
	Role         string   `json:"role"`
	Region       string   `json:"region"`
	Supervisor   string   `json:"atasan"`
	Sales        bool     `json:"sales"`
	Portfolio    string   `json:"portfolio"`
	BigRegion    string   `json:"wilayah"`
	AdminRegions []string `json:"adminRegions,omitempty"`
	Active       bool     `json:"active"`
}

type Customer struct {
	ID        string `json:"id"`
	Alias     string `json:"alias,omitempty"`
	Name      string `json:"nama"`
	NIK       string `json:"nik"`
	Region    string `json:"region"`
	SubRegion string `json:"subRegion,omitempty"`
	City      string `json:"kota"`
	PIC       string `json:"pic"`
	Address   string `json:"alamat"`
	Phone     string `json:"hp"`
}

type Product struct {
	ID          string `json:"id"`
	Name        string `json:"nama"`
	Brand       string `json:"brand"`
	SourceBrand string `json:"source"`
	Type        string `json:"type"`
	Device      bool   `json:"device"`
}

type Target struct {
	Period, NIK, Brand, Metric, Indicator string
	Value                                 float64
}

type Policy struct {
	Period    string   `json:"period"`
	Region    string   `json:"region"`
	Group     string   `json:"group"`
	Metric    string   `json:"metric"`
	Brand     string   `json:"brand"`
	Weight    float64  `json:"weight"`
	Cap       float64  `json:"cap"`
	Indicator string   `json:"indicator"`
	Label     string   `json:"label"`
	Types     []string `json:"types"`
	MinDA     int      `json:"minDA"`
	MinNOO    int      `json:"minNOO"`
}

type Coverage struct {
	Period  string `json:"period"`
	Cutoff  string `json:"cutoff"`
	Closed  bool   `json:"closed"`
	Version int64  `json:"version"`
}

type DailyRow struct {
	Date      string   `json:"date"`
	Region    string   `json:"region"`
	NIK       string   `json:"nik"`
	Customer  string   `json:"customer"`
	Brand     string   `json:"brand"`
	Type      string   `json:"type"`
	Qty       int64    `json:"q"`
	Amount    float64  `json:"a"`
	Accessory float64  `json:"acc"`
	Docs      []string `json:"docs"`
}

type FirstPurchase struct {
	Date string `json:"date"`
	NIK  string `json:"nik"`
}

type Metrics struct {
	Qty          int64   `json:"qty"`
	Revenue      float64 `json:"omzet"`
	Accessory    float64 `json:"aksesori"`
	ActiveDealer int     `json:"da"`
	NOO          int     `json:"noo"`
	Outlets      int     `json:"outlets"`
	Notes        int     `json:"nota"`
	NOOPending   bool    `json:"nooPending"`
}

type DB struct {
	People    []Person                 `json:"people"`
	Customers map[string]Customer      `json:"customers"`
	Products  map[string]Product       `json:"products"`
	Targets   []Target                 `json:"targets"`
	Policies  []Policy                 `json:"policies"`
	Rows      map[string][]DailyRow    `json:"rows"`
	Coverage  map[string]Coverage      `json:"coverage"`
	First     map[string]FirstPurchase `json:"first"`
	Unlinked  map[string]bool          `json:"unlinked"`
}

type KPIIndicator struct {
	Indicator string   `json:"indicator"`
	Label     string   `json:"label"`
	Metric    string   `json:"metric"`
	Brand     string   `json:"brand"`
	State     string   `json:"state"`
	Types     []string `json:"types"`
	MinDA     int      `json:"minDA"`
	Weight    float64  `json:"weight"`
	Cap       float64  `json:"cap"`
	Target    float64  `json:"target"`
	Actual    float64  `json:"actual"`
	Ach       *float64 `json:"ach"`
	Score     *float64 `json:"score"`
}
type KPIGroup struct {
	Name       string         `json:"name"`
	Score      *float64       `json:"score"`
	Pending    bool           `json:"pending"`
	Partial    bool           `json:"partial"`
	NA         bool           `json:"na"`
	Indicators []KPIIndicator `json:"indicators"`
}
type KPIResult struct {
	Region    string     `json:"region"`
	Sub       string     `json:"sub"`
	Status    string     `json:"status"`
	Tentative bool       `json:"tentative"`
	Score     *float64   `json:"score"`
	Count     int        `json:"count"`
	Groups    []KPIGroup `json:"groups"`
}

type WorkdayInfo struct {
	Days       int      `json:"days"`
	Run        int      `json:"run"`
	TimeGone   float64  `json:"timeGone"`
	Estimate   float64  `json:"estimate"`
	NeedPerDay *float64 `json:"needPerDay"`
}

type HolidaySet map[string]bool

type Session struct {
	ID, NIK, EffectiveNIK, Role string
	Version                     int
	Demo                        bool
	ExpiresAt                   time.Time
}
