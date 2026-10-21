package investments

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

type fakeStore struct {
	portfolios map[string]bool
	orders     map[string]Order
	err        error
}

func (f *fakeStore) PortfolioExists(_ context.Context, id string) (bool, error) {
	return f.portfolios[id], f.err
}

func (f *fakeStore) ListPositions(_ context.Context, id string) ([]Position, error) {
	if f.err != nil {
		return nil, f.err
	}
	if !f.portfolios[id] {
		return nil, ErrPortfolioNotFound
	}
	return []Position{}, nil
}

func (f *fakeStore) CreateOrder(_ context.Context, o Order) error {
	if f.err != nil {
		return f.err
	}
	f.orders[o.ID] = o
	return nil
}

func (f *fakeStore) GetOrder(_ context.Context, id string) (Order, error) {
	o, ok := f.orders[id]
	if !ok {
		return Order{}, ErrOrderNotFound
	}
	return o, nil
}

func TestOrderRequestValidate(t *testing.T) {
	valid := OrderRequest{Symbol: "PETR4", Side: SideBuy, Quantity: 10, PriceCents: 3850}
	tests := []struct {
		name       string
		mutate     func(*OrderRequest)
		wantFields []string
	}{
		{"valid buy", func(*OrderRequest) {}, nil},
		{"valid sell", func(r *OrderRequest) { r.Side = SideSell }, nil},
		{"side hold", func(r *OrderRequest) { r.Side = "hold" }, []string{"side"}},
		{"side empty", func(r *OrderRequest) { r.Side = "" }, []string{"side"}},
		{"side uppercase", func(r *OrderRequest) { r.Side = "BUY" }, []string{"side"}},
		{"quantity zero", func(r *OrderRequest) { r.Quantity = 0 }, []string{"quantity"}},
		{"quantity negative", func(r *OrderRequest) { r.Quantity = -1 }, []string{"quantity"}},
		{"price zero", func(r *OrderRequest) { r.PriceCents = 0 }, []string{"price_cents"}},
		{"symbol missing", func(r *OrderRequest) { r.Symbol = "" }, []string{"symbol"}},
		{"symbol too long", func(r *OrderRequest) { r.Symbol = "ABCDEFGHIJKLM" }, []string{"symbol"}},
		{"all invalid", func(r *OrderRequest) { *r = OrderRequest{} }, []string{"symbol", "side", "quantity", "price_cents"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := valid
			tt.mutate(&req)
			err := req.Validate()
			if tt.wantFields == nil {
				if err != nil {
					t.Fatalf("Validate() = %v, want nil", err)
				}
				return
			}
			var verr *ValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("Validate() = %v, want *ValidationError", err)
			}
			var got []string
			for _, f := range verr.Fields {
				got = append(got, f.Field)
			}
			if !reflect.DeepEqual(got, tt.wantFields) {
				t.Errorf("invalid fields = %v, want %v", got, tt.wantFields)
			}
		})
	}
}

func TestServicePlaceOrder(t *testing.T) {
	fixed := time.Date(2026, 10, 21, 12, 30, 45, 123, time.FixedZone("BRT", -3*3600))
	req := OrderRequest{Symbol: "PETR4", Side: SideBuy, Quantity: 10, PriceCents: 3850}
	storeErr := errors.New("dynamodb unavailable")

	tests := []struct {
		name        string
		store       *fakeStore
		req         OrderRequest
		wantErr     error
		wantInvalid bool
	}{
		{name: "creates pending order", store: &fakeStore{portfolios: map[string]bool{"p-1": true}, orders: map[string]Order{}}, req: req},
		{name: "unknown portfolio", store: &fakeStore{portfolios: map[string]bool{}, orders: map[string]Order{}}, req: req, wantErr: ErrPortfolioNotFound},
		{name: "store failure", store: &fakeStore{portfolios: map[string]bool{"p-1": true}, err: storeErr}, req: req, wantErr: storeErr},
		{name: "invalid request skips store", store: &fakeStore{err: storeErr}, req: OrderRequest{Side: "hold"}, wantInvalid: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &Service{store: tt.store, newID: func() (string, error) { return "o-test", nil }, now: func() time.Time { return fixed }}
			order, err := s.PlaceOrder(context.Background(), "p-1", tt.req)
			switch {
			case tt.wantErr != nil:
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("PlaceOrder() error = %v, want %v", err, tt.wantErr)
				}
				return
			case tt.wantInvalid:
				var verr *ValidationError
				if !errors.As(err, &verr) {
					t.Fatalf("PlaceOrder() error = %v, want *ValidationError", err)
				}
				return
			case err != nil:
				t.Fatalf("PlaceOrder() error = %v", err)
			}
			want := Order{
				ID: "o-test", PortfolioID: "p-1", Symbol: "PETR4", Side: SideBuy,
				Quantity: 10, PriceCents: 3850, Status: StatusPending,
				CreatedAt: time.Date(2026, 10, 21, 15, 30, 45, 0, time.UTC),
			}
			if order != want {
				t.Errorf("order = %+v, want %+v", order, want)
			}
			if stored := tt.store.orders["o-test"]; stored != want {
				t.Errorf("stored order = %+v, want %+v", stored, want)
			}
		})
	}
}

func TestRandomOrderID(t *testing.T) {
	a, err := randomOrderID()
	if err != nil {
		t.Fatal(err)
	}
	b, err := randomOrderID()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 18 || a[:2] != "o-" {
		t.Errorf("randomOrderID() = %q, want o- followed by 16 hex characters", a)
	}
	if a == b {
		t.Errorf("two calls returned the same id %q", a)
	}
}
