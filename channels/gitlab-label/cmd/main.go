package main

import (
	"log/slog"
	"os"
	"time"

	gitlablabel "github.com/samyn92/agentops/channels/gitlab-label"
	"github.com/samyn92/agentops/channels/internal/bridge"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	cfg := bridge.LoadConfig()

	interval := 30 * time.Second
	if v := os.Getenv("GITLAB_POLL_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			interval = d
		} else {
			logger.Warn("invalid GITLAB_POLL_INTERVAL, using default", "value", v, "default", interval.String())
		}
	}

	p := gitlablabel.New(cfg, interval, logger)
	bridge.RunPoller(p, interval, cfg, logger)
}
