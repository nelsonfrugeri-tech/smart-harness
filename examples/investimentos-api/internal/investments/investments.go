// Package investments holds the domain types and rules of the example API:
// portfolios own positions, and orders are placed against a portfolio.
package investments

import (
	"errors"
	"fmt"
	"time"
)

// Errors returned by the Store and the Service. Callers compare them with errors.Is.
var (
	ErrPortfolioNotFound = errors.New("portfolio not found")
	ErrOrderNotFound     = errors.New("order not found")
)

// Side is the direction of an order.
type Side string

// Accepted order sides.
const (
	SideBuy  Side = "buy"
	SideSell Side = "sell"
)

// OrderStatus is the lifecycle state of an order. New orders start as pending;
// nothing in this project moves them to another state yet.
type OrderStatus string

// StatusPending is the status of every newly placed order.
const StatusPending OrderStatus = "pending"

// Position is the quantity of one asset held by a portfolio.
// Money is always an integer amount of cents.
type Position struct {
	Symbol            string `json:"symbol"`
	Quantity          int64  `json:"quantity"`
	AveragePriceCents int64  `json:"average_price_cents"`
}

// Order is a request to buy or sell an asset for a portfolio.
type Order struct {
	ID          string      `json:"order_id"`
	PortfolioID string      `json:"portfolio_id"`
	Symbol      string      `json:"symbol"`
	Side        Side        `json:"side"`
	Quantity    int64       `json:"quantity"`
	PriceCents  int64       `json:"price_cents"`
	Status      OrderStatus `json:"status"`
	CreatedAt   time.Time   `json:"created_at"`
}

// OrderRequest is the client input for placing an order.
type OrderRequest struct {
	Symbol     string `json:"symbol"`
	Side       Side   `json:"side"`
	Quantity   int64  `json:"quantity"`
	PriceCents int64  `json:"price_cents"`
}

// FieldError describes one invalid field of a request.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationError lists every invalid field of a request.
type ValidationError struct {
	Fields []FieldError
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("invalid request: %d invalid field(s)", len(e.Fields))
}

// maxSymbolLength bounds the asset symbol so it stays a small, readable key.
const maxSymbolLength = 12

// Validate returns a *ValidationError when the request breaks a rule, or nil.
func (r OrderRequest) Validate() error {
	var fields []FieldError
	switch {
	case r.Symbol == "":
		fields = append(fields, FieldError{"symbol", "is required"})
	case len(r.Symbol) > maxSymbolLength:
		fields = append(fields, FieldError{"symbol", fmt.Sprintf("must have at most %d characters", maxSymbolLength)})
	}
	if r.Side != SideBuy && r.Side != SideSell {
		fields = append(fields, FieldError{"side", "must be buy or sell"})
	}
	if r.Quantity <= 0 {
		fields = append(fields, FieldError{"quantity", "must be greater than zero"})
	}
	if r.PriceCents <= 0 {
		fields = append(fields, FieldError{"price_cents", "must be greater than zero"})
	}
	if len(fields) > 0 {
		return &ValidationError{Fields: fields}
	}
	return nil
}
