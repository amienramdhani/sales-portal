package xlsx

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/xuri/excelize/v2"
)

type Row map[string]string

func Open(path string) (*excelize.File, error) {
	return excelize.OpenFile(path, excelize.Options{RawCellValue: false})
}
func OpenReader(r io.Reader) (*excelize.File, error) {
	return excelize.OpenReader(r, excelize.Options{RawCellValue: false})
}

func FindSheet(f *excelize.File, preferred string) string {
	for _, s := range f.GetSheetList() {
		if strings.EqualFold(strings.TrimSpace(s), preferred) {
			return s
		}
	}
	ls := f.GetSheetList()
	if len(ls) > 0 {
		return ls[0]
	}
	return ""
}
func Rows(f *excelize.File, sheet string) ([]Row, error) {
	if sheet == "" {
		return nil, fmt.Errorf("sheet tidak ditemukan")
	}
	it, err := f.Rows(sheet)
	if err != nil {
		return nil, err
	}
	defer it.Close()
	var headers []string
	out := []Row{}
	n := 0
	for it.Next() {
		n++
		cols, err := it.Columns()
		if err != nil {
			return nil, err
		}
		if n == 1 {
			for _, h := range cols {
				headers = append(headers, strings.TrimSpace(h))
			}
			continue
		}
		m := Row{}
		empty := true
		for i, h := range headers {
			if h == "" {
				continue
			}
			v := ""
			if i < len(cols) {
				v = strings.TrimSpace(cols[i])
			}
			if v != "" {
				empty = false
			}
			m[h] = v
		}

		rawAmount, err := f.GetCellValue(sheet, fmt.Sprintf("J%d", n), excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, err
		}
		m["AMOUNT_RAW"] = strings.TrimSpace(rawAmount)

		if !empty {
			out = append(out, m)
		}
	}
	return out, it.Error()
}
func SaveTemp(prefix string, data []byte) (string, error) {
	f, err := os.CreateTemp("", prefix+"-*.xlsx")
	if err != nil {
		return "", err
	}
	if _, err = f.Write(data); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	return f.Name(), nil
}
