package httpapi

import (
	"net/http"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

type projectRegistryRoutes struct {
	passportPath   string
	apartmentsPath string
}

// publishedSalesSiteRoutes is deliberately explicit. A catalog slug is not a
// public URL contract: Avalon is published at the origin root, and a newly
// imported catalog must not become discoverable here until its sales site is
// reviewed and published.
var publishedSalesSiteRoutes = map[string]projectRegistryRoutes{
	"4u":               {passportPath: "/4u", apartmentsPath: "/4u/apartments"},
	"avalon-residence": {passportPath: "/"},
	"bayterak":         {passportPath: "/bayterak", apartmentsPath: "/bayterak/apartments"},
	"botanika-saroyi":  {passportPath: "/botanika-saroyi", apartmentsPath: "/botanika-saroyi/apartments"},
	"c1":               {passportPath: "/c1", apartmentsPath: "/c1/apartments"},
	"flagman":          {passportPath: "/flagman", apartmentsPath: "/flagman/apartments"},
	"jomiy":            {passportPath: "/jomiy", apartmentsPath: "/jomiy/apartments"},
	"maftun-makon":     {passportPath: "/maftun-makon", apartmentsPath: "/maftun-makon/apartments"},
	"meros":            {passportPath: "/meros", apartmentsPath: "/meros/apartments"},
	"mirador":          {passportPath: "/mirador", apartmentsPath: "/mirador/apartments"},
	"ofiyat":           {passportPath: "/ofiyat", apartmentsPath: "/ofiyat/apartments"},
	"regnum-plaza":     {passportPath: "/regnum-plaza", apartmentsPath: "/regnum-plaza/apartments"},
	"saadiyat":         {passportPath: "/saadiyat", apartmentsPath: "/saadiyat/apartments"},
	"sado":             {passportPath: "/sado", apartmentsPath: "/sado/apartments"},
	"sarbon":           {passportPath: "/sarbon", apartmentsPath: "/sarbon/apartments"},
	"soy-boyi":         {passportPath: "/soy-boyi", apartmentsPath: "/soy-boyi/apartments"},
	"sun":              {passportPath: "/sun", apartmentsPath: "/sun/apartments"},
	"voha":             {passportPath: "/voha", apartmentsPath: "/voha/apartments"},
	"yangibaxt":        {passportPath: "/yangibaxt", apartmentsPath: "/yangibaxt/apartments"},
	"zamon":            {passportPath: "/zamon", apartmentsPath: "/zamon/apartments"},
}

func buildProjectRegistry(projects []domain.ProjectSummary) []domain.ProjectRegistryItem {
	items := make([]domain.ProjectRegistryItem, 0, len(projects))
	for _, project := range projects {
		routes, published := publishedSalesSiteRoutes[project.Slug]
		if !published {
			continue
		}
		items = append(items, domain.ProjectRegistryItem{
			ProjectKey:     project.Slug,
			Name:           project.Name,
			Published:      true,
			PassportPath:   routes.passportPath,
			ApartmentsPath: routes.apartmentsPath,
			TotalUnits:     project.TotalUnits,
			AvailableUnits: project.AvailableUnits,
			UpdatedAt:      project.UpdatedAt,
		})
	}
	return items
}

func (s *Server) listProjectRegistry(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects(r.Context())
	if err != nil {
		s.internalError(w, "list project registry", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": buildProjectRegistry(projects)})
}
