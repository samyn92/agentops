FROM golang:1.26 AS builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /workspace
COPY go.mod ./
COPY internal/ internal/
COPY channels/gitlab/ channels/gitlab/

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -a -o channel-gitlab ./channels/gitlab/cmd/

FROM gcr.io/distroless/static:nonroot
WORKDIR /
COPY --from=builder /workspace/channel-gitlab .
USER 65532:65532
ENTRYPOINT ["/channel-gitlab"]
