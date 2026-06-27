package main

import "testing"

func TestGitLabBulkDryRunDefault(t *testing.T) {
	if !bulkDryRun(nil) {
		t.Fatal("nil dry_run should default to true")
	}
	yes := true
	if !bulkDryRun(&yes) {
		t.Fatal("dry_run=true should stay true")
	}
	no := false
	if bulkDryRun(&no) {
		t.Fatal("dry_run=false should execute")
	}
}

func TestGitLabBulkSizeGuard(t *testing.T) {
	if err := validateBulkSize(1); err != nil {
		t.Fatalf("single item should be accepted: %v", err)
	}
	if err := validateBulkSize(maxGitLabBulkItems); err != nil {
		t.Fatalf("max item count should be accepted: %v", err)
	}
	if err := validateBulkSize(0); err == nil {
		t.Fatal("zero items should be rejected")
	}
	if err := validateBulkSize(maxGitLabBulkItems + 1); err == nil {
		t.Fatal("too many items should be rejected")
	}
}
