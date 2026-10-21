package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/investments"
)

// memoryStore is an in-memory investments.Store for handler tests.
type memoryStore struct {
	positions map[string][]investments.Position
	orders    map[string]investments.Order
	err       error
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		positions: map[string][]investments.Position{
			"p-1": {
				{Symbol: "PETR4", Quantity: 100, AveragePriceCents: 3852},
				{Symbol: "VALE3", Quantity: 50, AveragePriceCents: 6120},
			},
			"p-empty": {},
		},
		orders: map[string]investments.Order{
			"o-existing": {
				ID: "o-existing", PortfolioID: "p-1", Symbol: "VALE3", Side: investments.SideSell,
				Quantity: 5, PriceCents: 6200, Status: investments.StatusPending,
				CreatedAt: time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC),
			},
		},
	}
}

func (m *memoryStore) PortfolioExists(_ context.Context, id string) (bool, error) {
	_, ok := m.positions[id]
	return ok, m.err
}

func (m *memoryStore) ListPositions(_ context.Context, id string) ([]investments.Position, error) {
	if m.err != nil {
		return nil, m.err
	}
	p, ok := m.positions[id]
	if !ok {
		return nil, investments.ErrPortfolioNotFound
	}
	return p, nil
}

func (m *memoryStore) CreateOrder(_ context.Context, o investments.Order) error {
	m.orders[o.ID] = o
	return m.err
}

func (m *memoryStore) GetOrder(_ context.Context, id string) (investments.Order, error) {
	if m.err != nil {
		return investments.Order{}, m.err
	}
	o, ok := m.orders[id]
	if !ok {
		return investments.Order{}, investments.ErrOrderNotFound
	}
	return o, nil
}

func newTestHandler(store *memoryStore) http.Handler {
	return NewHandler(investments.NewService(store), slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func do(t *testing.T, h http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, r))
	return rec
}

func decodeProblem(t *testing.T, rec *httptest.ResponseRecorder) Problem {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
	var p Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode problem: %v; body %s", err, rec.Body)
	}
	if p.Status != rec.Code {
		t.Errorf("problem status = %d, response status = %d", p.Status, rec.Code)
	}
	return p
}

func TestListPositions(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		wantCode  int
		wantBody  string
		wantType  string
		storeFail bool
	}{
		{
			name:     "existing portfolio",
			path:     "/v1/portfolios/p-1/positions",
			wantCode: http.StatusOK,
			wantBody: `{"portfolio_id":"p-1","positions":[{"symbol":"PETR4","quantity":100,"average_price_cents":3852},{"symbol":"VALE3","quantity":50,"average_price_cents":6120}]}`,
		},
		{
			name:     "portfolio without positions returns an empty list",
			path:     "/v1/portfolios/p-empty/positions",
			wantCode: http.StatusOK,
			wantBody: `{"portfolio_id":"p-empty","positions":[]}`,
		},
		{name: "unknown portfolio", path: "/v1/portfolios/p-404/positions", wantCode: http.StatusNotFound, wantType: problemTypeBase + "portfolio-not-found"},
		{name: "id with key separator", path: "/v1/portfolios/p-1%23x/positions", wantCode: http.StatusNotFound, wantType: problemTypeBase + "portfolio-not-found"},
		{name: "store failure", path: "/v1/portfolios/p-1/positions", wantCode: http.StatusInternalServerError, wantType: problemTypeBase + "internal-error", storeFail: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newMemoryStore()
			if tt.storeFail {
				store.err = errors.New("secret internal detail")
			}
			rec := do(t, newTestHandler(store), http.MethodGet, tt.path, "")
			if rec.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, tt.wantCode, rec.Body)
			}
			if tt.wantType != "" {
				p := decodeProblem(t, rec)
				if p.Type != tt.wantType {
					t.Errorf("problem type = %q, want %q", p.Type, tt.wantType)
				}
				if strings.Contains(rec.Body.String(), "secret internal detail") {
					t.Errorf("problem body leaks the internal error: %s", rec.Body)
				}
				return
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
		})
	}
}

func TestCreateOrder(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		body       string
		wantCode   int
		wantType   string
		wantFields []string
	}{
		{name: "buy", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"buy","quantity":10,"price_cents":3850}`, wantCode: http.StatusCreated},
		{name: "sell", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"VALE3","side":"sell","quantity":1,"price_cents":6100}`, wantCode: http.StatusCreated},
		{name: "side hold", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"hold","quantity":10,"price_cents":3850}`, wantCode: http.StatusBadRequest, wantType: "invalid-request", wantFields: []string{"side"}},
		{name: "quantity zero", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"buy","quantity":0,"price_cents":3850}`, wantCode: http.StatusBadRequest, wantType: "invalid-request", wantFields: []string{"quantity"}},
		{name: "quantity negative", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"buy","quantity":-5,"price_cents":3850}`, wantCode: http.StatusBadRequest, wantType: "invalid-request", wantFields: []string{"quantity"}},
		{name: "quantity missing", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"buy","price_cents":3850}`, wantCode: http.StatusBadRequest, wantType: "invalid-request", wantFields: []string{"quantity"}},
		{name: "fractional quantity", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"buy","quantity":1.5,"price_cents":3850}`, wantCode: http.StatusBadRequest, wantType: "invalid-request"},
		{name: "unknown field", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"buy","quantity":1,"price_cents":3850,"price":38.5}`, wantCode: http.StatusBadRequest, wantType: "invalid-request"},
		{name: "malformed json", path: "/v1/portfolios/p-1/orders", body: `{"symbol":`, wantCode: http.StatusBadRequest, wantType: "invalid-request"},
		{name: "two json values", path: "/v1/portfolios/p-1/orders", body: `{"symbol":"PETR4","side":"buy","quantity":1,"price_cents":1}{}`, wantCode: http.StatusBadRequest, wantType: "invalid-request"},
		{name: "empty body", path: "/v1/portfolios/p-1/orders", body: "", wantCode: http.StatusBadRequest, wantType: "invalid-request"},
		{name: "unknown portfolio", path: "/v1/portfolios/p-404/orders", body: `{"symbol":"PETR4","side":"buy","quantity":10,"price_cents":3850}`, wantCode: http.StatusNotFound, wantType: "portfolio-not-found"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newMemoryStore()
			before := len(store.orders)
			rec := do(t, newTestHandler(store), http.MethodPost, tt.path, tt.body)
			if rec.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, tt.wantCode, rec.Body)
			}
			if tt.wantType != "" {
				p := decodeProblem(t, rec)
				if p.Type != problemTypeBase+tt.wantType {
					t.Errorf("problem type = %q, want %q", p.Type, problemTypeBase+tt.wantType)
				}
				var fields []string
				for _, f := range p.Errors {
					fields = append(fields, f.Field)
				}
				if tt.wantFields != nil && strings.Join(fields, ",") != strings.Join(tt.wantFields, ",") {
					t.Errorf("problem fields = %v, want %v", fields, tt.wantFields)
				}
				if len(store.orders) != before {
					t.Errorf("a rejected request stored an order")
				}
				return
			}
			var order investments.Order
			if err := json.Unmarshal(rec.Body.Bytes(), &order); err != nil {
				t.Fatalf("decode order: %v", err)
			}
			if order.Status != investments.StatusPending || order.PortfolioID != "p-1" {
				t.Errorf("order = %+v, want pending order of p-1", order)
			}
			if want := "/v1/orders/" + order.ID; rec.Header().Get("Location") != want {
				t.Errorf("Location = %q, want %q", rec.Header().Get("Location"), want)
			}
			if _, ok := store.orders[order.ID]; !ok {
				t.Errorf("order %s was not stored", order.ID)
			}
		})
	}
}

func TestCreateOrderBodyTooLarge(t *testing.T) {
	body := `{"symbol":"` + strings.Repeat("A", maxBodyBytes) + `"}`
	rec := httptest.NewRecorder()
	newTestHandler(newMemoryStore()).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/portfolios/p-1/orders", bytes.NewBufferString(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	decodeProblem(t, rec)
}

func TestGetOrder(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		wantCode int
		wantBody string
	}{
		{
			name:     "existing order",
			path:     "/v1/orders/o-existing",
			wantCode: http.StatusOK,
			wantBody: `{"order_id":"o-existing","portfolio_id":"p-1","symbol":"VALE3","side":"sell","quantity":5,"price_cents":6200,"status":"pending","created_at":"2026-10-01T10:00:00Z"}`,
		},
		{name: "unknown order", path: "/v1/orders/o-missing", wantCode: http.StatusNotFound},
		{name: "invalid id", path: "/v1/orders/o%20x", wantCode: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, newTestHandler(newMemoryStore()), http.MethodGet, tt.path, "")
			if rec.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, tt.wantCode, rec.Body)
			}
			if tt.wantCode == http.StatusNotFound {
				if p := decodeProblem(t, rec); p.Type != problemTypeBase+"order-not-found" {
					t.Errorf("problem type = %q", p.Type)
				}
				return
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
		})
	}
}

func TestCreatedOrderCanBeRead(t *testing.T) {
	h := newTestHandler(newMemoryStore())
	created := do(t, h, http.MethodPost, "/v1/portfolios/p-1/orders", `{"symbol":"PETR4","side":"buy","quantity":10,"price_cents":3850}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d", created.Code)
	}
	got := do(t, h, http.MethodGet, created.Header().Get("Location"), "")
	if got.Code != http.StatusOK {
		t.Fatalf("get status = %d", got.Code)
	}
	if strings.TrimSpace(got.Body.String()) != strings.TrimSpace(created.Body.String()) {
		t.Errorf("GET body %s differs from POST body %s", got.Body, created.Body)
	}
}
