package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/investments"
)

// problemTypeBase prefixes every problem type URI. ".example" is a reserved TLD (RFC 2606),
// so the URIs identify the problem without pointing to a real site.
const problemTypeBase = "https://investimentos.example/problems/"

// Problem is an RFC 9457 problem details body.
type Problem struct {
	Type     string                   `json:"type"`
	Title    string                   `json:"title"`
	Status   int                      `json:"status"`
	Detail   string                   `json:"detail,omitempty"`
	Instance string                   `json:"instance,omitempty"`
	Errors   []investments.FieldError `json:"errors,omitempty"`
}

func newProblem(r *http.Request, status int, slug, title, detail string) Problem {
	return Problem{
		Type:     problemTypeBase + slug,
		Title:    title,
		Status:   status,
		Detail:   detail,
		Instance: r.URL.Path,
	}
}

func writeProblem(w http.ResponseWriter, p Problem) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	if err := json.NewEncoder(w).Encode(p); err != nil {
		slog.Error("write problem response", "error", err)
	}
}

func invalidRequest(r *http.Request, detail string, fields []investments.FieldError) Problem {
	p := newProblem(r, http.StatusBadRequest, "invalid-request", "Invalid request", detail)
	p.Errors = fields
	return p
}

func portfolioNotFound(r *http.Request, portfolioID string) Problem {
	return newProblem(r, http.StatusNotFound, "portfolio-not-found", "Portfolio not found",
		"portfolio "+portfolioID+" does not exist")
}

func orderNotFound(r *http.Request, orderID string) Problem {
	return newProblem(r, http.StatusNotFound, "order-not-found", "Order not found",
		"order "+orderID+" does not exist")
}

// internalError hides the cause from the client; the cause goes to the log.
func internalError(r *http.Request) Problem {
	return newProblem(r, http.StatusInternalServerError, "internal-error", "Internal error",
		"the request could not be completed")
}
