// Package httpapi exposes the investments service over HTTP with net/http.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/investments"
)

// Limits applied to every request.
const (
	maxBodyBytes   = 64 << 10
	requestTimeout = 5 * time.Second
)

// validID accepts the IDs this API creates ("p-1", "o-<hex>"). Anything else cannot exist,
// and rejecting it early keeps "#" and other key separators out of DynamoDB keys.
var validID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

type handler struct {
	service *investments.Service
	logger  *slog.Logger
}

// NewHandler returns the HTTP routes of the API.
func NewHandler(service *investments.Service, logger *slog.Logger) http.Handler {
	h := &handler{service: service, logger: logger}
	mux := http.NewServeMux()
	h.route(mux, "GET /v1/portfolios/{portfolioId}/positions", h.listPositions)
	h.route(mux, "POST /v1/portfolios/{portfolioId}/orders", h.createOrder)
	h.route(mux, "GET /v1/orders/{orderId}", h.getOrder)
	return mux
}

// route registers fn with a request timeout and one access log line per request.
func (h *handler) route(mux *http.ServeMux, pattern string, fn http.HandlerFunc) {
	mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
		defer cancel()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		fn(rec, r.WithContext(ctx))
		h.logger.Info("request",
			"method", r.Method,
			"route", pattern,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

type positionsResponse struct {
	PortfolioID string                 `json:"portfolio_id"`
	Positions   []investments.Position `json:"positions"`
}

func (h *handler) listPositions(w http.ResponseWriter, r *http.Request) {
	portfolioID := r.PathValue("portfolioId")
	if !validID.MatchString(portfolioID) {
		writeProblem(w, portfolioNotFound(r, portfolioID))
		return
	}
	positions, err := h.service.ListPositions(r.Context(), portfolioID)
	if err != nil {
		h.writeError(w, r, err, portfolioID)
		return
	}
	writeJSON(w, http.StatusOK, positionsResponse{PortfolioID: portfolioID, Positions: positions})
}

func (h *handler) createOrder(w http.ResponseWriter, r *http.Request) {
	portfolioID := r.PathValue("portfolioId")
	if !validID.MatchString(portfolioID) {
		writeProblem(w, portfolioNotFound(r, portfolioID))
		return
	}
	req, err := decodeOrderRequest(w, r)
	if err != nil {
		writeProblem(w, invalidRequest(r, err.Error(), nil))
		return
	}
	order, err := h.service.PlaceOrder(r.Context(), portfolioID, req)
	if err != nil {
		h.writeError(w, r, err, portfolioID)
		return
	}
	w.Header().Set("Location", "/v1/orders/"+order.ID)
	writeJSON(w, http.StatusCreated, order)
}

func (h *handler) getOrder(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("orderId")
	if !validID.MatchString(orderID) {
		writeProblem(w, orderNotFound(r, orderID))
		return
	}
	order, err := h.service.GetOrder(r.Context(), orderID)
	if err != nil {
		h.writeError(w, r, err, orderID)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

// decodeOrderRequest reads exactly one JSON object with known fields only.
func decodeOrderRequest(w http.ResponseWriter, r *http.Request) (investments.OrderRequest, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	var req investments.OrderRequest
	if err := dec.Decode(&req); err != nil {
		return req, fmt.Errorf("request body must be a JSON object: %w", err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return req, errors.New("request body must contain a single JSON object")
	}
	return req, nil
}

// writeError maps domain errors to problem responses. Unknown errors become 500 and are logged.
func (h *handler) writeError(w http.ResponseWriter, r *http.Request, err error, id string) {
	var invalid *investments.ValidationError
	switch {
	case errors.As(err, &invalid):
		writeProblem(w, invalidRequest(r, "one or more fields are invalid", invalid.Fields))
	case errors.Is(err, investments.ErrPortfolioNotFound):
		writeProblem(w, portfolioNotFound(r, id))
	case errors.Is(err, investments.ErrOrderNotFound):
		writeProblem(w, orderNotFound(r, id))
	default:
		h.logger.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
		writeProblem(w, internalError(r))
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json response", "error", err)
	}
}

// statusRecorder keeps the status code for the access log.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
