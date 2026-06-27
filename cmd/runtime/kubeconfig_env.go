package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var (
	kubeconfigEnvOnce sync.Once
	kubeconfigEnvPath string
	kubeconfigEnvErr  error
)

func configureKubeconfigFromEnv() (string, error) {
	kubeconfigEnvOnce.Do(func() {
		data := os.Getenv("KUBECONFIG_DATA")
		if strings.TrimSpace(data) == "" {
			data = ""
			encoded := strings.TrimSpace(os.Getenv("KUBECONFIG_B64"))
			if encoded != "" {
				decoded, err := base64.StdEncoding.DecodeString(encoded)
				if err != nil {
					kubeconfigEnvErr = fmt.Errorf("decode KUBECONFIG_B64: %w", err)
					return
				}
				data = string(decoded)
			}
		}

		if data == "" {
			kubeconfigEnvPath = os.Getenv("KUBECONFIG")
			return
		}

		dir, err := os.MkdirTemp("", "agentops-kubeconfig-*")
		if err != nil {
			kubeconfigEnvErr = fmt.Errorf("create kubeconfig temp dir: %w", err)
			return
		}

		path := filepath.Join(dir, "config")
		if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
			kubeconfigEnvErr = fmt.Errorf("write kubeconfig: %w", err)
			return
		}
		if err := os.Setenv("KUBECONFIG", path); err != nil {
			kubeconfigEnvErr = fmt.Errorf("set KUBECONFIG: %w", err)
			return
		}
		kubeconfigEnvPath = path
	})

	return kubeconfigEnvPath, kubeconfigEnvErr
}
