package gitlablabel

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/samyn92/agentops/channels/internal/bridge"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func newTestPoller(base string) *Poller {
	return &Poller{
		cfg:     &bridge.Config{ChannelName: "board", AgentRef: "mgr"},
		client:  bridge.NewAgentClient(testLogger()),
		http:    &http.Client{Timeout: 5 * time.Second},
		logger:  testLogger(),
		baseURL: base,
		project: "samyn92/homecluster",
		token:   "secret-token",
		target:  "issues",
		labels:  []string{"agent::todo"},
		state:   "opened",
		seen:    map[string]time.Time{},
		ttl:     2 * time.Minute,

		inProgressLabel: "agent::in-progress",
		maxRetries:      2,
		attempts:        map[int]int{},
		gaveUp:          map[int]bool{},
	}
}

func TestList_RequestContract(t *testing.T) {
	var gotPath, gotToken, gotLabels, gotState string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.Header.Get("PRIVATE-TOKEN")
		gotLabels = r.URL.Query().Get("labels")
		gotState = r.URL.Query().Get("state")
		_ = json.NewEncoder(w).Encode([]glItem{
			{IID: 7, Title: "Fix it", WebURL: "https://gl/issues/7", State: "opened", ProjectID: 42, Labels: []string{"agent::todo"}},
		})
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	items, err := p.list(context.Background(), "agent::todo")
	if err != nil {
		t.Fatalf("list error: %v", err)
	}

	// Project path must be URL-encoded into the path segment (%2F for "/").
	wantPath := "/api/v4/projects/" + url.QueryEscape("samyn92/homecluster") + "/issues"
	// httptest decodes %2F back to "/" in r.URL.Path, so compare the decoded form.
	if gotPath != "/api/v4/projects/samyn92/homecluster/issues" {
		t.Errorf("path = %q, want decoded %q", gotPath, wantPath)
	}
	if gotToken != "secret-token" {
		t.Errorf("PRIVATE-TOKEN = %q, want %q", gotToken, "secret-token")
	}
	if gotLabels != "agent::todo" {
		t.Errorf("labels query = %q, want single label %q", gotLabels, "agent::todo")
	}
	if gotState != "opened" {
		t.Errorf("state query = %q, want %q", gotState, "opened")
	}
	if len(items) != 1 || items[0].IID != 7 {
		t.Fatalf("items = %+v, want one item iid=7", items)
	}
}

func TestList_GroupScope(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewEncoder(w).Encode([]glItem{})
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	p.project = ""
	p.group = "myorg/platform"
	p.target = "merge_requests"
	if _, err := p.list(context.Background(), "agent::todo"); err != nil {
		t.Fatalf("list error: %v", err)
	}
	if gotPath != "/api/v4/groups/myorg/platform/merge_requests" {
		t.Errorf("group path = %q", gotPath)
	}
}

func TestSeenSet_DedupAndExpiry(t *testing.T) {
	p := newTestPoller("http://unused")
	key := p.seenKey(7, "agent::todo")

	if p.alreadySeen(key) {
		t.Fatal("key should not be seen before marking")
	}
	p.markSeen(key)
	if !p.alreadySeen(key) {
		t.Fatal("key should be seen after marking")
	}

	// A different label for the same iid is a distinct key (re-run via
	// changes-requested must not be suppressed by an earlier todo run).
	if p.alreadySeen(p.seenKey(7, "agent::changes-requested")) {
		t.Fatal("different label must be a distinct seen-key")
	}

	// Expired entries are purged.
	p.mu.Lock()
	p.seen[key] = time.Now().Add(-3 * time.Minute)
	p.mu.Unlock()
	p.purgeExpired()
	if p.alreadySeen(key) {
		t.Fatal("expired key should have been purged")
	}
}

func TestList_APIErrorSurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"401 Unauthorized"}`))
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	if _, err := p.list(context.Background(), "agent::todo"); err == nil {
		t.Fatal("expected error on 401 response")
	}
}

func TestTransition_RequestContract(t *testing.T) {
	var gotMethod, gotPath, gotToken, gotAdd, gotRemove string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotToken = r.Header.Get("PRIVATE-TOKEN")
		gotAdd = r.URL.Query().Get("add_labels")
		gotRemove = r.URL.Query().Get("remove_labels")
		_ = json.NewEncoder(w).Encode(glItem{IID: 7, ProjectID: 42})
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	p.inProgressLabel = "agent::in-progress"
	it := glItem{IID: 7, ProjectID: 42, Labels: []string{"agent::todo"}}
	if err := p.transition(context.Background(), it, "agent::todo", p.inProgressLabel); err != nil {
		t.Fatalf("transition error: %v", err)
	}

	// Always targets the item's own project by numeric ID, regardless of scope.
	if gotMethod != http.MethodPut {
		t.Errorf("method = %q, want PUT", gotMethod)
	}
	if gotPath != "/api/v4/projects/42/issues/7" {
		t.Errorf("path = %q, want /api/v4/projects/42/issues/7", gotPath)
	}
	if gotToken != "secret-token" {
		t.Errorf("PRIVATE-TOKEN = %q", gotToken)
	}
	if gotAdd != "agent::in-progress" {
		t.Errorf("add_labels = %q, want agent::in-progress", gotAdd)
	}
	if gotRemove != "agent::todo" {
		t.Errorf("remove_labels = %q, want agent::todo", gotRemove)
	}
}

func TestTransition_ErrorSurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"403 Forbidden"}`))
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	it := glItem{IID: 7, ProjectID: 42}
	if err := p.transition(context.Background(), it, "agent::todo", "agent::in-progress"); err == nil {
		t.Fatal("expected error on 403 response")
	}
}

func TestAttemptBudget_BumpResetGaveUp(t *testing.T) {
	p := newTestPoller("http://unused")

	if got := p.bumpAttempts(7); got != 1 {
		t.Fatalf("first bump = %d, want 1", got)
	}
	if got := p.bumpAttempts(7); got != 2 {
		t.Fatalf("second bump = %d, want 2", got)
	}

	// markGaveUp is one-shot per iid (note posted exactly once).
	if !p.markGaveUp(7) {
		t.Fatal("first markGaveUp should return true")
	}
	if p.markGaveUp(7) {
		t.Fatal("second markGaveUp should return false")
	}

	// A Succeeded run resets both the attempt budget and the gave-up flag.
	p.clearAttempts(7)
	if got := p.bumpAttempts(7); got != 1 {
		t.Fatalf("post-clear bump = %d, want 1", got)
	}
	if !p.markGaveUp(7) {
		t.Fatal("markGaveUp should be re-armed after clearAttempts")
	}
}

func TestClearSeen_ByIID(t *testing.T) {
	p := newTestPoller("http://unused")
	p.markSeen(p.seenKey(7, "agent::todo"))
	p.markSeen(p.seenKey(7, "agent::changes-requested"))
	p.markSeen(p.seenKey(70, "agent::todo")) // distinct iid, must survive

	p.clearSeen(7)

	if p.alreadySeen(p.seenKey(7, "agent::todo")) {
		t.Error("iid 7 todo key should have been cleared")
	}
	if p.alreadySeen(p.seenKey(7, "agent::changes-requested")) {
		t.Error("iid 7 changes-requested key should have been cleared")
	}
	if !p.alreadySeen(p.seenKey(70, "agent::todo")) {
		t.Error("iid 70 must not be affected by clearSeen(7)")
	}
}

func TestAddNote_RequestContract(t *testing.T) {
	var gotMethod, gotPath, gotToken, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotToken = r.Header.Get("PRIVATE-TOKEN")
		gotBody = r.URL.Query().Get("body")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 1})
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	it := glItem{IID: 7, ProjectID: 42}
	if err := p.addNote(context.Background(), it, "re-queued"); err != nil {
		t.Fatalf("addNote error: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/api/v4/projects/42/issues/7/notes" {
		t.Errorf("path = %q, want /api/v4/projects/42/issues/7/notes", gotPath)
	}
	if gotToken != "secret-token" {
		t.Errorf("PRIVATE-TOKEN = %q", gotToken)
	}
	if gotBody != "re-queued" {
		t.Errorf("body = %q, want %q", gotBody, "re-queued")
	}
}

func TestRecoverFailed_RequeuesToTrigger(t *testing.T) {
	var transitionAdd, transitionRemove string
	var noteCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut: // label transition
			transitionAdd = r.URL.Query().Get("add_labels")
			transitionRemove = r.URL.Query().Get("remove_labels")
		case http.MethodPost: // note
			noteCount++
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 1})
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	it := glItem{IID: 7, ProjectID: 42, Labels: []string{"agent::in-progress"}}
	st := bridge.RunStatus{Phase: "Failed", Trigger: "agent::todo", Found: true}

	// First failure: re-queue back to the original trigger label.
	p.recoverFailed(context.Background(), it, st)
	if transitionAdd != "agent::todo" || transitionRemove != "agent::in-progress" {
		t.Errorf("requeue add=%q remove=%q, want todo<-in-progress", transitionAdd, transitionRemove)
	}
	if p.alreadySeen(p.seenKey(7, "agent::todo")) {
		t.Error("seen entry should be cleared so the re-queued card can fire")
	}

	// Exhaust the budget (maxRetries=2): attempt 2 still retries, attempt 3 gives up.
	p.recoverFailed(context.Background(), it, st) // attempt 2
	transitionAdd = ""
	p.recoverFailed(context.Background(), it, st) // attempt 3 -> give up, no transition
	if transitionAdd != "" {
		t.Errorf("over-budget attempt should not transition, got add=%q", transitionAdd)
	}
	// The give-up note is posted exactly once even if recoverFailed is called again.
	prevNotes := noteCount
	p.recoverFailed(context.Background(), it, st)
	if noteCount != prevNotes {
		t.Errorf("give-up note posted more than once: %d -> %d", prevNotes, noteCount)
	}
}

func TestClosingMRs_RequestContract(t *testing.T) {
	var gotPath, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.Header.Get("PRIVATE-TOKEN")
		// Mirrors the real billing-svc#4 closed_by payload: one live MR + one abandoned.
		_ = json.NewEncoder(w).Encode([]glMR{
			{IID: 4, State: "opened", WebURL: "https://gl/mr/4"},
			{IID: 1, State: "closed", WebURL: "https://gl/mr/1"},
		})
	}))
	defer srv.Close()

	p := newTestPoller(srv.URL)
	mrs, err := p.closingMRs(context.Background(), glItem{IID: 7, ProjectID: 42})
	if err != nil {
		t.Fatalf("closingMRs error: %v", err)
	}
	// Always targets the item's own project by numeric ID, regardless of scope.
	if gotPath != "/api/v4/projects/42/issues/7/closed_by" {
		t.Errorf("path = %q, want /api/v4/projects/42/issues/7/closed_by", gotPath)
	}
	if gotToken != "secret-token" {
		t.Errorf("PRIVATE-TOKEN = %q", gotToken)
	}
	if len(mrs) != 2 || mrs[0].IID != 4 || mrs[0].State != "opened" {
		t.Fatalf("mrs = %+v, want [{4 opened ...} {1 closed ...}]", mrs)
	}
}

func TestHasLiveMR(t *testing.T) {
	cases := []struct {
		name string
		mrs  []glMR
		want bool
	}{
		{"none", nil, false},
		{"open", []glMR{{State: "opened"}}, true},
		{"merged", []glMR{{State: "merged"}}, true},
		{"closed only", []glMR{{State: "closed"}}, false},
		{"locked only", []glMR{{State: "locked"}}, false},
		{"abandoned then live", []glMR{{State: "closed"}, {State: "opened"}}, true},
	}
	for _, tc := range cases {
		if got := hasLiveMR(tc.mrs); got != tc.want {
			t.Errorf("%s: hasLiveMR = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// promoteServer routes the three endpoints promoteReviewable touches: the
// in-progress list, the per-issue closed_by lookup, and the PUT label
// transition. mrState controls what closed_by returns for the single issue.
func promoteServer(t *testing.T, mrState string, transitioned *bool, add, remove *string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/closed_by"):
			_ = json.NewEncoder(w).Encode([]glMR{{IID: 9, State: mrState, WebURL: "https://gl/mr/9"}})
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/issues"):
			_ = json.NewEncoder(w).Encode([]glItem{
				{IID: 7, ProjectID: 42, State: "opened", Labels: []string{"agent::in-progress"}},
			})
		case r.Method == http.MethodPut:
			*transitioned = true
			*add = r.URL.Query().Get("add_labels")
			*remove = r.URL.Query().Get("remove_labels")
			_ = json.NewEncoder(w).Encode(glItem{IID: 7, ProjectID: 42})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{})
		}
	}))
}

func TestPromoteReviewable_PromotesOnLiveMR(t *testing.T) {
	var transitioned bool
	var add, remove string
	srv := promoteServer(t, "opened", &transitioned, &add, &remove)
	defer srv.Close()

	p := newTestPoller(srv.URL)
	p.reviewLabel = "agent::needs-review"
	p.markSeen(p.seenKey(7, "agent::todo")) // simulate the prior todo fire

	p.promoteReviewable(context.Background())

	if !transitioned {
		t.Fatal("expected a transition for an in-progress issue with a live closing MR")
	}
	if add != "agent::needs-review" || remove != "agent::in-progress" {
		t.Errorf("promote add=%q remove=%q, want needs-review<-in-progress", add, remove)
	}
	// Promotion clears the prior seen entry so a later changes-requested cycle can fire.
	if p.alreadySeen(p.seenKey(7, "agent::todo")) {
		t.Error("seen entry for promoted iid should have been cleared")
	}
}

func TestPromoteReviewable_SkipsWhenNoLiveMR(t *testing.T) {
	var transitioned bool
	var add, remove string
	srv := promoteServer(t, "closed", &transitioned, &add, &remove) // only an abandoned MR
	defer srv.Close()

	p := newTestPoller(srv.URL)
	p.reviewLabel = "agent::needs-review"
	p.promoteReviewable(context.Background())

	if transitioned {
		t.Error("must NOT promote when the only closing MR is closed/abandoned")
	}
}

