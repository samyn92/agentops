// Console backend entrypoint.
// BFF server: K8s proxy, SSE multiplexer, session relay.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/samyn92/agentops/internal/console/k8s"
	"github.com/samyn92/agentops/internal/console/multiplexer"
	"github.com/samyn92/agentops/internal/console/server"
	"github.com/samyn92/agentops/internal/console/tracing"
)

func main() {
	var (
		addr      = flag.String("addr", ":8080", "HTTP listen address")
		namespace = flag.String("namespace", "", "restrict to namespace (empty = all)")
		dev       = flag.Bool("dev", false, "development mode (relaxed CORS, verbose logging)")
		webDir    = flag.String("web-dir", "", "path to static web assets")
	)

	// controller-runtime registers its own "kubeconfig" flag via init(),
	// so we reuse it instead of defining our own.
	flag.Parse()
	kubeconfig := flag.Lookup("kubeconfig")
	var kubeconfigPath string
	if kubeconfig != nil {
		kubeconfigPath = kubeconfig.Value.String()
	}

	// Logger
	logLevel := slog.LevelInfo
	if *dev {
		logLevel = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})))

	// Context with signal handling
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Initialize OTEL tracing (non-fatal if it fails — BFF works without it)
	tracingShutdown, err := tracing.Init(ctx)
	if err != nil {
		slog.Warn("OTEL tracing init failed, continuing without tracing", "error", err)
	}
	defer func() {
		if tracingShutdown != nil {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := tracingShutdown(shutdownCtx); err != nil {
				slog.Warn("tracing shutdown error", "error", err)
			}
		}
	}()

	// K8s client
	slog.Info("initializing K8s client", "kubeconfig", kubeconfigPath, "namespace", *namespace, "dev", *dev)
	k8sClient, err := k8s.NewClient(kubeconfigPath, *namespace, *dev)
	if err != nil {
		slog.Error("failed to create K8s client", "error", err)
		os.Exit(1)
	}

	// Start informers
	if err := k8sClient.Start(ctx); err != nil {
		slog.Error("failed to start K8s cache", "error", err)
		os.Exit(1)
	}

	// SSE multiplexer
	mux := multiplexer.New(k8sClient)
	mux.Start(ctx)

	// HTTP server
	srv := server.New(server.Config{
		Addr:   *addr,
		Dev:    *dev,
		WebDir: *webDir,
	}, k8sClient, mux)

	// Start server in background
	go func() {
		if err := srv.Start(); err != nil {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	slog.Info("console backend started",
		"addr", *addr,
		"dev", *dev,
		"namespace", *namespace,
	)

	// Block until signal
	<-ctx.Done()
	slog.Info("shutting down...")

	// Graceful shutdown
	mux.Stop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown failed", "error", err)
	}
}
