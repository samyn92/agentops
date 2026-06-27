package main

import (
	"encoding/base64"
	"os"
	"sync"
	"testing"
)

func resetKubeconfigEnvForTest() {
	kubeconfigEnvOnce = sync.Once{}
	kubeconfigEnvPath = ""
	kubeconfigEnvErr = nil
}

func TestConfigureKubeconfigFromEnvUsesExistingKubeconfig(t *testing.T) {
	resetKubeconfigEnvForTest()
	t.Setenv("KUBECONFIG_DATA", "")
	t.Setenv("KUBECONFIG_B64", "")
	t.Setenv("KUBECONFIG", "/tmp/existing-kubeconfig")

	path, err := configureKubeconfigFromEnv()
	if err != nil {
		t.Fatalf("configureKubeconfigFromEnv() error = %v", err)
	}
	if path != "/tmp/existing-kubeconfig" {
		t.Fatalf("path = %q, want existing kubeconfig", path)
	}
}

func TestConfigureKubeconfigFromEnvWritesKubeconfigData(t *testing.T) {
	resetKubeconfigEnvForTest()
	kubeconfig := "apiVersion: v1\nkind: Config\nclusters: []\n"
	t.Setenv("KUBECONFIG_DATA", kubeconfig)
	t.Setenv("KUBECONFIG_B64", "")
	t.Setenv("KUBECONFIG", "")

	path, err := configureKubeconfigFromEnv()
	if err != nil {
		t.Fatalf("configureKubeconfigFromEnv() error = %v", err)
	}
	if path == "" {
		t.Fatal("path is empty")
	}
	if got := os.Getenv("KUBECONFIG"); got != path {
		t.Fatalf("KUBECONFIG = %q, want %q", got, path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read generated kubeconfig: %v", err)
	}
	if string(data) != kubeconfig {
		t.Fatalf("generated kubeconfig = %q, want %q", string(data), kubeconfig)
	}
}

func TestConfigureKubeconfigFromEnvDecodesBase64(t *testing.T) {
	resetKubeconfigEnvForTest()
	kubeconfig := "apiVersion: v1\nkind: Config\nusers: []\n"
	t.Setenv("KUBECONFIG_DATA", "")
	t.Setenv("KUBECONFIG_B64", base64.StdEncoding.EncodeToString([]byte(kubeconfig)))
	t.Setenv("KUBECONFIG", "")

	path, err := configureKubeconfigFromEnv()
	if err != nil {
		t.Fatalf("configureKubeconfigFromEnv() error = %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read generated kubeconfig: %v", err)
	}
	if string(data) != kubeconfig {
		t.Fatalf("generated kubeconfig = %q, want %q", string(data), kubeconfig)
	}
}
