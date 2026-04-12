# Contributing to AgentOps

Thank you for your interest in contributing to AgentOps. This document provides guidelines and information for contributors.

## How to Contribute

### Reporting Issues

- Use [GitHub Issues](https://github.com/samyn92/agentops/issues) for bug reports and feature requests
- Search existing issues before creating a new one
- Include reproduction steps for bugs
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)

### Documentation Contributions

This repository hosts the AgentOps documentation site. To contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b docs/my-improvement`)
3. Make your changes in the `content/` directory
4. Test locally with `hugo server`
5. Submit a pull request

### Code Contributions

For code contributions to specific components, see the respective repositories:

| Component | Repository |
|-----------|-----------|
| Kubernetes Operator | [agentops-core](https://github.com/samyn92/agentops-core) |
| Agent Runtime | [agentops-runtime](https://github.com/samyn92/agentops-runtime) |
| Web Console | [agentops-console](https://github.com/samyn92/agentops-console) |
| Memory Service | [agentops-memory](https://github.com/samyn92/agentops-memory) |
| MCP Tool Servers | [agent-tools](https://github.com/samyn92/agent-tools) |
| Helm Chart | [agentops-platform](https://github.com/samyn92/agentops-platform) |

## Development Setup

### Prerequisites

- [Hugo](https://gohugo.io/installation/) (extended edition, v0.110.0+)
- [Go](https://go.dev/dl/) (1.21+, for Hugo modules)

### Local Development

```bash
# Clone the repository
git clone https://github.com/samyn92/agentops.git
cd agentops

# Start the development server
hugo server

# Open http://localhost:1313/agentops/
```

### Building

```bash
hugo --minify
```

The built site will be in the `public/` directory.

## Style Guide

- Use clear, technical language
- Avoid unnecessary jargon
- Include working code examples with real values
- Keep YAML examples consistent with actual CRD specs
- Use ASCII diagrams for architecture illustrations

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
