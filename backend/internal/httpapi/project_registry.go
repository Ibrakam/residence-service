package httpapi

import (
	"net/http"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

type projectRegistryRoutes struct {
	passportPath   string
	apartmentsPath string
	aliases        []string
}

// publishedSalesSiteRoutes is deliberately explicit. A catalog slug is not a
// public URL contract: Avalon is published at the origin root, and a newly
// imported catalog must not become discoverable here until its sales site is
// reviewed and published.
var publishedSalesSiteRoutes = map[string]projectRegistryRoutes{
	"4u":               {passportPath: "/4u", apartmentsPath: "/4u/apartments", aliases: []string{"4 U", "4U Tashkent"}},
	"avalon-residence": {passportPath: "/", aliases: []string{"Avalon", "Авалон", "Авалон Резиденс"}},
	"bayterak":         {passportPath: "/bayterak", apartmentsPath: "/bayterak/apartments", aliases: []string{"Baiterek", "Байтерек"}},
	"botanika-saroyi":  {passportPath: "/botanika-saroyi", apartmentsPath: "/botanika-saroyi/apartments", aliases: []string{"Ботаника Саройи"}},
	"c1":               {passportPath: "/c1", apartmentsPath: "/c1/apartments", aliases: []string{"C-1", "C 1"}},
	"flagman":          {passportPath: "/flagman", apartmentsPath: "/flagman/apartments", aliases: []string{"Флагман"}},
	"jomiy":            {passportPath: "/jomiy", apartmentsPath: "/jomiy/apartments", aliases: []string{"Жомий"}},
	"maftun-makon":     {passportPath: "/maftun-makon", apartmentsPath: "/maftun-makon/apartments", aliases: []string{"Мафтун Макон"}},
	"meros":            {passportPath: "/meros", apartmentsPath: "/meros/apartments", aliases: []string{"Мерос"}},
	"mirador":          {passportPath: "/mirador", apartmentsPath: "/mirador/apartments", aliases: []string{"Мирадор"}},
	"ofiyat":           {passportPath: "/ofiyat", apartmentsPath: "/ofiyat/apartments", aliases: []string{"Офият"}},
	"regnum-plaza":     {passportPath: "/regnum-plaza", apartmentsPath: "/regnum-plaza/apartments", aliases: []string{"Регнум Плаза"}},
	"saadiyat":         {passportPath: "/saadiyat", apartmentsPath: "/saadiyat/apartments", aliases: []string{"Саадият"}},
	"sado":             {passportPath: "/sado", apartmentsPath: "/sado/apartments", aliases: []string{"Sad'O", "Садо"}},
	"sarbon":           {passportPath: "/sarbon", apartmentsPath: "/sarbon/apartments", aliases: []string{"Сарбон"}},
	"soy-boyi":         {passportPath: "/soy-boyi", apartmentsPath: "/soy-boyi/apartments", aliases: []string{"Soy Boyi", "Soy Bo'yi", "Сой Бойи", "Сой Бўйи"}},
	"sun":              {passportPath: "/sun", apartmentsPath: "/sun/apartments", aliases: []string{"Сан"}},
	"voha":             {passportPath: "/voha", apartmentsPath: "/voha/apartments", aliases: []string{"Воха"}},
	"yangibaxt":        {passportPath: "/yangibaxt", apartmentsPath: "/yangibaxt/apartments", aliases: []string{"Yangi Baxt", "Янги Бахт"}},
	"zamon":            {passportPath: "/zamon", apartmentsPath: "/zamon/apartments", aliases: []string{"Замон"}},
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
			Aliases:        append([]string(nil), routes.aliases...),
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
