package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"salesportal/internal/auth"
)

func aiIntent(q string) string {
	x := strings.ToLower(q)
	switch {
	case strings.Contains(x, "belum order") || strings.Contains(x, "ga order") || strings.Contains(x, "tidak order"):
		return "DEALER_BELUM_ORDER"
	case strings.Contains(x, "kpi") || strings.Contains(x, "ranking") || strings.Contains(x, "peringkat"):
		return "KPI"
	case strings.Contains(x, "dealer") || strings.Contains(x, "outlet"):
		return "DEALER"
	case strings.Contains(x, "sales") || strings.Contains(x, "tim"):
		return "TEAM"
	case strings.Contains(x, "dos") || strings.Contains(x, "stok"):
		return "DOS"
	default:
		return "SUMMARY"
	}
}

func (s *Server) aiChat(ctx context.Context, sess auth.Session, p map[string]any) (any, int, error) {
	q := str(p, "message")
	if len([]rune(q)) < 2 {
		return nil, 400, errors.New("Tulis pertanyaan minimal 2 karakter.")
	}
	if len([]rune(q)) > 1000 {
		q = string([]rune(q)[:1000])
	}
	period, selection := str(p, "period"), str(p, "selection")
	intent := aiIntent(q)
	start := time.Now()
	scopeLabel := sess.Role + " · " + sess.EffectiveNIK
	dash, e := s.Reporting.Dashboard(ctx, sess.EffectiveNIK, period, selection)
	if e != nil {
		return nil, code(e), e
	}
	evidence := map[string]any{"period": period, "scopeCount": dash.ScopeCount, "total": dash.Total, "previous": dash.Previous, "brands": dash.Brands, "kpi": dash.KPI, "customers": dash.Customers}
	// Keep the evidence intentionally bounded before it leaves the server.
	if a, ok := evidence["customers"].([]any); ok && len(a) > 40 {
		evidence["customers"] = a[:40]
	}
	ev, _ := json.Marshal(evidence)
	answer := fmt.Sprintf("SELL THRU %d unit, Dealer Aktif %d, NOO %d, omzet %.0f untuk periode %s.", dash.Total.Qty, dash.Total.ActiveDealer, dash.Total.NOO, dash.Total.Revenue, period)
	model := "LOCAL-FALLBACK"
	fallback := "AI provider belum dikonfigurasi"
	status := "OK_FALLBACK"
	if s.Cfg.AIAPIKey != "" && s.Cfg.AIBaseURL != "" {
		endpoint := strings.TrimRight(s.Cfg.AIBaseURL, "/")
		if !strings.HasSuffix(endpoint, "/chat/completions") {
			endpoint += "/chat/completions"
		}
		system := "Anda adalah AI Assistant Sales Portal. Jawab Bahasa Indonesia, ringkas, faktual, hanya berdasarkan evidence JSON yang diberikan. Jangan mengarang angka. Jika evidence tidak cukup, katakan data tidak tersedia. Jangan memberikan data di luar cakupan user."
		prompt := fmt.Sprintf("Pertanyaan: %s\nIntent: %s\nPeriode: %s\nEvidence JSON: %s", q, intent, period, string(ev))
		body := map[string]any{"model": s.Cfg.AIModel, "temperature": 0.1, "messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": prompt}}}
		bb, _ := json.Marshal(body)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bb))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+s.Cfg.AIAPIKey)
		client := &http.Client{Timeout: 35 * time.Second}
		resp, err := client.Do(req)
		if err == nil {
			defer resp.Body.Close()
			rb, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				var obj struct {
					Choices []struct {
						Message struct {
							Content string `json:"content"`
						} `json:"message"`
					} `json:"choices"`
					Model string `json:"model"`
				}
				if json.Unmarshal(rb, &obj) == nil && len(obj.Choices) > 0 && strings.TrimSpace(obj.Choices[0].Message.Content) != "" {
					answer = strings.TrimSpace(obj.Choices[0].Message.Content)
					model = obj.Model
					if model == "" {
						model = s.Cfg.AIModel
					}
					fallback = ""
					status = "OK"
				} else {
					fallback = "Respons AI tidak valid"
				}
			} else {
				fallback = fmt.Sprintf("AI HTTP %d", resp.StatusCode)
			}
		} else {
			fallback = err.Error()
		}
	}
	ms := int(time.Since(start) / time.Millisecond)
	_, _ = s.Reporting.DB.Exec(context.Background(), `insert into ai_log(nik,role,question,intent,scope,rows_returned,model,status,duration_ms) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, sess.EffectiveNIK, sess.Role, q, intent, scopeLabel, dash.ScopeCount, model, status, ms)
	return map[string]any{"answer": answer, "intent": intent, "scope": scopeLabel, "period": period, "model": model, "rows": dash.ScopeCount, "readOnly": true, "fallbackReason": fallback}, 200, nil
}
