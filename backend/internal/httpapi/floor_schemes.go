package httpapi

import (
	"errors"
	"net/http"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
)

func (s *Server) getFloorSchemes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
	artifact, err := s.store.GetFloorSchemeArtifact(r.Context(), r.PathValue("slug"))
	if errors.Is(err, database.ErrNotFound) {
		writeError(w, http.StatusNotFound, "floor_schemes_not_found", "Floor-scheme artifact was not found")
		return
	}
	if err != nil {
		s.internalError(w, "get floor-scheme artifact", err)
		return
	}
	writeJSON(w, http.StatusOK, artifact)
}
