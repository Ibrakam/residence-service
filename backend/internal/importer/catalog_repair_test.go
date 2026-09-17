package importer

import (
	"encoding/json"
	"testing"
)

func TestOptionalRepairIncludedPreservesUnknown(t *testing.T) {
	for _, test := range []struct {
		name      string
		payload   string
		want      bool
		wantKnown bool
	}{
		{name: "provider boolean true", payload: `{"repairIncluded":true}`, want: true, wantKnown: true},
		{name: "provider boolean false", payload: `{"isRepaired":false}`, want: false, wantKnown: true},
		{name: "uysot alias", payload: `{"repaired":true}`, want: true, wantKnown: true},
		{name: "legacy exact label", payload: `{"repair":"Без ремонта"}`, want: false, wantKnown: true},
		{name: "missing provider field", payload: `{}`, wantKnown: false},
		{name: "null provider field", payload: `{"repairIncluded":null}`, wantKnown: false},
		{name: "ambiguous marketing text", payload: `{"repair":"Улучшенная отделка"}`, wantKnown: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			values := make(map[string]json.RawMessage)
			if err := json.Unmarshal([]byte(test.payload), &values); err != nil {
				t.Fatal(err)
			}
			got, known := optionalRepairIncluded(values)
			if known != test.wantKnown || known && got != test.want {
				t.Fatalf("optionalRepairIncluded(%s)=(%v,%v), want (%v,%v)", test.payload, got, known, test.want, test.wantKnown)
			}
		})
	}
}
