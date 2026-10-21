package investments

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// Store persists portfolios, positions and orders.
type Store interface {
	// PortfolioExists reports whether the portfolio exists.
	PortfolioExists(ctx context.Context, portfolioID string) (bool, error)
	// ListPositions returns the positions of an existing portfolio, ordered by symbol.
	// It returns ErrPortfolioNotFound when the portfolio does not exist.
	ListPositions(ctx context.Context, portfolioID string) ([]Position, error)
	// CreateOrder stores a new order. The order ID must not exist yet.
	CreateOrder(ctx context.Context, order Order) error
	// GetOrder returns the order or ErrOrderNotFound.
	GetOrder(ctx context.Context, orderID string) (Order, error)
}

// Service applies the domain rules on top of a Store.
type Service struct {
	store Store
	newID func() (string, error)
	now   func() time.Time
}

// NewService returns a Service with random order IDs and the system clock.
func NewService(store Store) *Service {
	return &Service{store: store, newID: randomOrderID, now: time.Now}
}

// ListPositions returns the positions of a portfolio.
func (s *Service) ListPositions(ctx context.Context, portfolioID string) ([]Position, error) {
	positions, err := s.store.ListPositions(ctx, portfolioID)
	if err != nil {
		return nil, fmt.Errorf("list positions of %q: %w", portfolioID, err)
	}
	return positions, nil
}

// PlaceOrder validates the request and stores a pending order for the portfolio.
func (s *Service) PlaceOrder(ctx context.Context, portfolioID string, req OrderRequest) (Order, error) {
	if err := req.Validate(); err != nil {
		return Order{}, err
	}
	exists, err := s.store.PortfolioExists(ctx, portfolioID)
	if err != nil {
		return Order{}, fmt.Errorf("check portfolio %q: %w", portfolioID, err)
	}
	if !exists {
		return Order{}, fmt.Errorf("place order in %q: %w", portfolioID, ErrPortfolioNotFound)
	}
	id, err := s.newID()
	if err != nil {
		return Order{}, fmt.Errorf("generate order id: %w", err)
	}
	order := Order{
		ID:          id,
		PortfolioID: portfolioID,
		Symbol:      req.Symbol,
		Side:        req.Side,
		Quantity:    req.Quantity,
		PriceCents:  req.PriceCents,
		Status:      StatusPending,
		CreatedAt:   s.now().UTC().Truncate(time.Second),
	}
	if err := s.store.CreateOrder(ctx, order); err != nil {
		return Order{}, fmt.Errorf("create order: %w", err)
	}
	return order, nil
}

// GetOrder returns an order by ID.
func (s *Service) GetOrder(ctx context.Context, orderID string) (Order, error) {
	order, err := s.store.GetOrder(ctx, orderID)
	if err != nil {
		return Order{}, fmt.Errorf("get order %q: %w", orderID, err)
	}
	return order, nil
}

// randomOrderID returns "o-" followed by 16 random hex characters.
func randomOrderID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	return "o-" + hex.EncodeToString(b), nil
}
