package main

import (
	"log/slog"
	"os"

	"github.com/samyn92/agentops/channels/webhook"
	"github.com/samyn92/agentops/channels/internal/bridge"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	cfg := bridge.LoadConfig()

	ch := webhook.New(cfg, logger)
	bridge.Run(ch, cfg, logger)
}
